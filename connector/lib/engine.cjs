'use strict';
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawn}=require('node:child_process');
const {VERSION,ISOLATION_MARKERS,failure,classifyError,cleanEnvironment,checkConfiguration}=require('./policy.cjs');
const {profileKey,profilePath}=require('./profiles.cjs');
const {AcpClient}=require('./acp.cjs');
const {runCli}=require('./cli.cjs');
const {killTree,raceDelay}=require('./process.cjs');

function fileIdentity(filename) {return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');}
function verifyIsolationSupport(filename) {
  // Static capability check is supplementary: initialize, cached-token auth,
  // selected settings and actual tool count must still pass before any prompt.
  const bytes=fs.readFileSync(filename);
  if(ISOLATION_MARKERS.some(name=>!bytes.includes(Buffer.from(name))))throw failure('BUILD_VERSION_UNSUPPORTED');
}
async function probeVersion(config,settings,signal) {
  if(signal?.aborted)throw failure('BUILD_CANCELLED');
  const child=(settings.spawnImpl||spawn)(config.grokPath,['--version'],{cwd:settings.cwd,env:settings.env,stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false,detached:(settings.platform||process.platform)!=='win32'});
  let output='',failed=false;
  child.stdout.setEncoding('utf8');child.stdout.on('data',value=>{output+=value;if(output.length>4096){failed=true;killTree(child,settings).catch(()=>{});}});
  child.stderr.resume();
  const done=new Promise(resolve=>{child.once('error',()=>{failed=true;resolve(null);});child.once('close',code=>resolve(code));});
  const abort=()=>killTree(child,settings).catch(()=>{});signal?.addEventListener('abort',abort,{once:true});
  let code;
  try{code=await raceDelay(done,settings.versionTimeoutMs??10000);}finally{signal?.removeEventListener('abort',abort);}
  if(signal?.aborted)throw failure('BUILD_CANCELLED');
  if(code===false){await killTree(child,settings);throw failure('BUILD_TIMEOUT');}
  if(failed||code!==0)throw failure('BUILD_UNAVAILABLE');
  if(!new RegExp('^grok\\s+'+VERSION.replace(/\./g,'\\.')+'(?:\\s|$)').test(output.trim()))throw failure('BUILD_VERSION_UNSUPPORTED');
  return VERSION;
}
class Engine {
  constructor(config,options={}) {this.config=config;this.options=options;this.clients=new Map();this.idleTimers=new Map();this.controllers=new Set();this.executions=new Set();this.closed=false;}
  async prepare(signal) {
    if(this.closed||signal?.aborted)throw failure('BUILD_CANCELLED');
    if(!this.settings) {
      const tempRoot=await fsp.mkdtemp(path.join(this.options.tmpdir||os.tmpdir(),'superx-grok-'));
      const cwd=path.join(tempRoot,'work'),grokHome=path.join(tempRoot,'grok-home');
      await fsp.mkdir(cwd,{mode:0o700});await fsp.mkdir(grokHome,{mode:0o700});
      this.settings={...this.options,tempRoot,cwd,grokHome,env:cleanEnvironment(this.options.env,{grokHome})};
    }
    if(this.closed||signal?.aborted)throw failure('BUILD_CANCELLED');
    checkConfiguration(this.settings.cwd,this.settings.grokHome,this.options.configurationExists,{platform:this.options.platform||process.platform,username:this.options.username});
    if((await fsp.readdir(this.settings.cwd)).length)throw failure('BUILD_TOOL_POLICY');
    if(this.config.runtimeVersion!==VERSION)throw failure('BUILD_VERSION_UNSUPPORTED');
    const digest=fileIdentity(this.config.grokPath);
    if(this.digest&&this.digest!==digest)throw failure('BUILD_VERSION_UNSUPPORTED');
    if(!this.digest)verifyIsolationSupport(this.config.grokPath);
    this.digest=digest;await probeVersion(this.config,this.settings,signal);
    if(this.closed||signal?.aborted)throw failure('BUILD_CANCELLED');
    if(fileIdentity(this.config.grokPath)!==digest)throw failure('BUILD_VERSION_UNSUPPORTED');
  }
  async client(key) {
    if(this.closed)throw failure('BUILD_CANCELLED');
    clearTimeout(this.idleTimers.get(key));this.idleTimers.delete(key);profilePath(key,this.settings.profilesRoot);
    let client=this.clients.get(key);
    if(client&&(client.closing||client.transport.closed||client.transport.fatal)){await client.close();this.clients.delete(key);client=null;}
    if(!client) {
      client=new AcpClient(this.config,key,this.settings);this.clients.set(key,client);
      try{await client.start();}catch(error){await client.close();this.clients.delete(key);throw error;}
    }
    return client;
  }
  scheduleIdle(key) {
    clearTimeout(this.idleTimers.get(key));
    const timer=setTimeout(()=>{this.idleTimers.delete(key);const client=this.clients.get(key);this.clients.delete(key);client?.close().catch(()=>{});},this.options.idleTimeoutMs??30000);
    timer.unref?.();this.idleTimers.set(key,timer);
  }
  verifyIdentity() {if(this.digest!==fileIdentity(this.config.grokPath))throw failure('BUILD_VERSION_UNSUPPORTED');}
  status(requestId) {
    const controller=new AbortController();this.controllers.add(controller);
    const operation=this.inspectStatus(requestId,controller.signal).finally(()=>{this.controllers.delete(controller);this.executions.delete(operation);});
    this.executions.add(operation);return operation;
  }
  async inspectStatus(requestId,signal) {
    try {
      await this.prepare(signal);const client=await this.client('none');
      const modelCatalog=await client.inspect();this.verifyIdentity();if(!this.closed)this.scheduleIdle('none');
      return {type:'STATUS',requestId,installed:true,available:true,authenticated:true,version:VERSION,modelCatalog};
    }catch(error) {
      const safe=classifyError(error,'BUILD_UNAVAILABLE');return {type:'STATUS',requestId,installed:true,available:false,authenticated:safe.code==='BUILD_LOGIN_REQUIRED'?false:undefined,version:VERSION,errorCode:safe.code};
    }
  }
  run(request,onUpdate,signal) {
    const controller=new AbortController();const abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();this.controllers.add(controller);
    const operation=this.execute(request,onUpdate,controller.signal).finally(()=>{signal?.removeEventListener('abort',abort);this.controllers.delete(controller);this.executions.delete(operation);});
    this.executions.add(operation);return operation;
  }
  async execute(request,onUpdate,signal) {
    let key;
    const abort=()=>{const client=this.clients.get(key);client?.cancelActive();client?.close().catch(()=>{});};
    signal?.addEventListener('abort',abort,{once:true});
    try {
      await this.prepare(signal);if(signal?.aborted)throw failure('BUILD_CANCELLED');key=profileKey(request);const client=await this.client(key);
      let result;
      if(request.transport==='cli') {
        // This zero-prompt ACP inspection checks the same exact profile and runtime
        // before starting headless CLI, whose warning might otherwise arrive late.
        await client.inspect(request);if(signal?.aborted)throw failure('BUILD_CANCELLED');
        this.verifyIdentity();result=await runCli(this.config,request,this.settings,onUpdate,signal);
      }else result=await client.run(request,onUpdate,signal);
      this.verifyIdentity();return result;
    }catch(error){throw signal?.aborted?failure('BUILD_CANCELLED',{usage:error?.usage,usageComplete:error?.usageComplete,model:error?.model}):classifyError(error,'BUILD_UNAVAILABLE');}
    finally{signal?.removeEventListener('abort',abort);if(key&&!this.closed)this.scheduleIdle(key);}
  }
  async close() {
    if(this.closing)return this.closing;this.closed=true;
    this.closing=(async()=>{
      for(const timer of this.idleTimers.values())clearTimeout(timer);this.idleTimers.clear();
      for(const controller of this.controllers)controller.abort();
      await Promise.allSettled([...this.clients.values()].map(client=>client.close()));this.clients.clear();
      await Promise.allSettled([...this.executions]);
      if(this.settings) {
        const root=path.resolve(this.settings.tempRoot),parent=path.resolve(this.options.tmpdir||os.tmpdir());
        // Verify the recursive removal target is exactly our own temporary child.
        if(path.dirname(root)===parent&&path.basename(root).startsWith('superx-grok-'))await fsp.rm(root,{recursive:true,force:true});
      }
    })();return this.closing;
  }
}
module.exports={Engine,probeVersion,fileIdentity,verifyIsolationSupport};
