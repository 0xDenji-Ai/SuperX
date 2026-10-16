'use strict';
const {spawn}=require('node:child_process');
const {EventEmitter}=require('node:events');
const path=require('node:path');
const {failure,configurationWarning}=require('./policy.cjs');

function raceDelay(promise,ms) {
  let timer;return Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),ms);})]).finally(()=>clearTimeout(timer));
}
async function killTree(child,{platform=process.platform,spawnImpl=spawn,killImpl=process.kill.bind(process)}={}) {
  if(!Number.isSafeInteger(child?.pid)||child.pid<=0)return;
  if(platform==='win32') {
    // Fixed executable and numeric PID, never a shell command or user argument.
    const exe=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe');
    await new Promise(resolve=>{
      let proc;try{proc=spawnImpl(exe,['/PID',String(child.pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore',timeout:5000});}catch{resolve();return;}
      proc.once('error',resolve);proc.once('close',resolve);
    });
  } else {
    try{killImpl(-child.pid,'SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}
  }
  try{child.kill('SIGKILL');}catch{}
}
class ChildTransport extends EventEmitter {
  constructor(exe,args,options={}) {
    super();this.closed=false;this.fatal=null;this.stderrTail='';this.buffer='';this.bytes=0;this.pendingBytes=0;
    this.spawnImpl=options.spawnImpl||spawn;this.platform=options.platform||process.platform;this.jsonDocument=Boolean(options.jsonDocument);
    this.child=this.spawnImpl(exe,args,{cwd:options.cwd,env:options.env,stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false,detached:this.platform!=='win32'});
    this.done=new Promise(resolve=>{this.resolveDone=resolve;});
    this.child.stdin.on('error',()=>{this.fail(failure('BUILD_UNAVAILABLE'));});
    this.child.stdout.setEncoding('utf8');this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data',chunk=>this.consume(chunk));
    this.child.stderr.on('data',chunk=>{
      this.stderrTail=(this.stderrTail+chunk).slice(-4096);
      if(configurationWarning(this.stderrTail))this.fail(failure('BUILD_TOOL_POLICY'));
    });
    this.child.once('error',()=>this.fail(failure('BUILD_UNAVAILABLE')));
    this.child.once('close',(code,signal)=>{
      this.closed=true;this.exit={code,signal};
      if(this.buffer.trim()&&!this.fatal)this.parseLine(this.buffer.trim());
      this.resolveDone(true);this.emit('closed',this.exit);
    });
  }
  resetLimit() {this.bytes=0;}
  consume(chunk) {
    if(this.fatal)return;
    this.bytes+=Buffer.byteLength(chunk);this.buffer+=chunk;
    if(this.bytes>8*1024*1024||Buffer.byteLength(this.buffer)>2*1024*1024){this.fail(failure('BUILD_LIMIT'));return;}
    if(this.jsonDocument)return;
    let index;
    while((index=this.buffer.indexOf('\n'))>=0&&!this.fatal) {
      const line=this.buffer.slice(0,index).trim();this.buffer=this.buffer.slice(index+1);if(line)this.parseLine(line);
    }
  }
  parseLine(line) {
    try{const message=JSON.parse(line);if(!message||typeof message!=='object'||Array.isArray(message))throw Error();this.emit('message',message);}
    catch(error){this.fail(error?.code?error:failure('BUILD_PROTOCOL_ERROR'));}
  }
  send(message) {
    if(this.closed||this.fatal||this.child.stdin.destroyed)throw this.fatal||failure('BUILD_UNAVAILABLE');
    const line=JSON.stringify(message)+'\n';
    if(Buffer.byteLength(line)>1024*1024)throw failure('BUILD_LIMIT');
    if(this.child.stdin.writableLength>2*1024*1024)throw failure('BUILD_LIMIT');
    this.child.stdin.write(line);
  }
  fail(error) {
    if(this.fatal)return;this.fatal=error;this.emit('fatal',error);
    // Always attach a rejection handler; termination must not create an orphan.
    this.terminate().catch(()=>{});
  }
  async terminate() {
    if(this.termination)return this.termination;
    if(this.closed)return;
    this.termination=(async()=>{await killTree(this.child,{platform:this.platform,spawnImpl:this.spawnImpl});await raceDelay(this.done,2000);})();
    return this.termination;
  }
  async close(ms=6000) {
    if(this.closed)return;
    try{this.child.stdin.end();}catch{}
    if(!await raceDelay(this.done,ms))await this.terminate();
  }
}
module.exports={ChildTransport,killTree,raceDelay};
