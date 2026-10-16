'use strict';
const {ChildTransport}=require('./process.cjs');
const {failure,classifyError,modelId,usage}=require('./policy.cjs');
const {commonArgs,profilePath}=require('./profiles.cjs');
const {Turn}=require('./updates.cjs');

const unwrap=value=>value?.data??value?.result??value;
function options(items) {return Array.isArray(items)?items.flatMap(item=>Array.isArray(item.options)?options(item.options):[item]):[];}
function option(configs,id) {return (configs??[]).find(item=>item.id===id);}
function catalog(configs) {
  return options(option(configs,'model')?.options).filter(item=>modelId(item.value)).slice(0,40).map(item=>({id:item.value,name:typeof item.name==='string'?item.name.slice(0,100):item.value}));
}
const PROBE_EFFORTS=new Set(['minimal','low','medium','high','xhigh']);
function probeModel(created,models) {
  const current=option(created?.configOptions,'model')?.currentValue??created?.models?.currentModelId;
  return models.find(item=>item.id===current)?.id??models[0]?.id;
}
function probeEffort(config) {
  const advertised=options(config?.options).map(item=>item.value).filter(value=>PROBE_EFFORTS.has(value));
  return advertised.includes('low')?'low':advertised.includes(config?.currentValue)?config.currentValue:advertised[0];
}
class AcpClient {
  constructor(config,key,settings) {
    this.config=config;this.key=key;this.settings=settings;this.pending=new Map();this.nextId=1;this.sessions=new Set();this.authenticated=false;this.active=null;
    // Account catalog selection happens after session/new. A fixed boot model
    // would make STATUS fail before an account's available catalog is known.
    const request={webSearch:['web','x-web'].includes(key)};
    const args=[...commonArgs(request),'agent','--no-leader','--agent-profile',profilePath(key,settings.profilesRoot),'stdio'];
    this.transport=new ChildTransport(config.grokPath,args,settings);
    this.transport.on('message',message=>this.receive(message));
    this.transport.on('fatal',error=>this.rejectPending(error));
    this.transport.on('closed',()=>this.rejectPending(this.transport.fatal||failure('BUILD_UNAVAILABLE')));
  }
  rejectPending(error) {for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(error);}this.pending.clear();}
  request(method,params,ms=this.settings.rpcTimeoutMs??20000) {
    if(this.transport.fatal||this.transport.closed)return Promise.reject(this.transport.fatal||failure('BUILD_UNAVAILABLE'));
    const id=this.nextId++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(failure('BUILD_TIMEOUT'));},ms);this.pending.set(id,{resolve,reject,timer});
      try{this.transport.send({jsonrpc:'2.0',id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
    });
  }
  notify(method,params) {this.transport.send({jsonrpc:'2.0',method,params});}
  receive(message) {
    if(message.jsonrpc!=='2.0')throw failure('BUILD_PROTOCOL_ERROR');
    if(message.method) {
      if(Object.hasOwn(message,'id')) {
        if(message.method==='session/request_permission')this.transport.send({jsonrpc:'2.0',id:message.id,result:{outcome:{outcome:'cancelled'}}});
        else this.transport.send({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'SuperX client tools are disabled.'}});
        this.cancelActive();this.transport.fail(failure('BUILD_TOOL_POLICY'));return;
      }
      if(message.method==='session/update'&&this.active&&message.params?.sessionId===this.active.sessionId)this.active.turn.observe(message.params.update);
      return;
    }
    const pending=this.pending.get(message.id);if(!pending)return;
    clearTimeout(pending.timer);this.pending.delete(message.id);
    if(message.error)pending.reject(classifyError({message:String(message.error.message??'')+' '+String(message.error.code??'')}));
    else if(Object.hasOwn(message,'result'))pending.resolve(message.result);
    else pending.reject(failure('BUILD_PROTOCOL_ERROR'));
  }
  async start() {
    const init=await this.request('initialize',{protocolVersion:1,clientCapabilities:{},clientInfo:{name:'superx-connector',version:'1.0.0'}});
    if(init?.protocolVersion!==1)throw failure('BUILD_PROTOCOL_ERROR');
    if(!(init.authMethods??[]).some(method=>method.id==='cached_token'))throw failure('BUILD_LOGIN_REQUIRED');
    try {await this.request('authenticate',{methodId:'cached_token',_meta:{headless:true}});}catch(e){throw classifyError(e,'BUILD_LOGIN_REQUIRED');}
    this.authenticated=true;return this;
  }
  async createSession(request) {
    const probe=request===undefined;
    const created=await this.request('session/new',{cwd:this.settings.cwd,mcpServers:[]});
    const id=created?.sessionId;if(typeof id!=='string'||!id||id.length>256)throw failure('BUILD_PROTOCOL_ERROR');this.sessions.add(id);
    const models=catalog(created.configOptions);
    const model=probe?probeModel(created,models):request.model;
    if(!models.some(item=>item.id===model))throw failure('BUILD_MODEL_UNSUPPORTED');
    const selected=await this.request('session/set_config_option',{sessionId:id,configId:'model',value:model});
    if(option(selected?.configOptions,'model')?.currentValue!==model)throw failure('BUILD_MODEL_UNSUPPORTED');
    const effort=option(selected?.configOptions,'reasoning_effort');
    const wantedEffort=probe?probeEffort(effort):request.effort;
    if(!wantedEffort||!options(effort?.options).some(item=>item.value===wantedEffort))throw failure('BUILD_EFFORT_UNSUPPORTED');
    const configured=await this.request('session/set_config_option',{sessionId:id,configId:'reasoning_effort',value:wantedEffort});
    if(option(configured?.configOptions,'reasoning_effort')?.currentValue!==wantedEffort||option(configured?.configOptions,'model')?.currentValue!==model)throw failure('BUILD_EFFORT_UNSUPPORTED');
    const state=unwrap(await this.request('_x.ai/session/info',{sessionId:id}));
    if(state?.agentName!==`superx-${this.key}`||state.model!==model||!Number.isFinite(state.context?.total)||state.context.total<=0||state.context?.toolDefinitionsCount!==0)throw failure('BUILD_TOOL_POLICY');
    if(this.transport.fatal)throw this.transport.fatal;
    return {id,modelCatalog:models};
  }
  async closeSession(id) {
    if(!this.sessions.has(id))return;this.sessions.delete(id);
    if(!this.transport.closed&&!this.transport.fatal)await this.request('session/close',{sessionId:id},this.settings.closeTimeoutMs??5000);
  }
  cancelActive() {if(this.active&&!this.transport.closed&&!this.transport.fatal)try{this.notify('session/cancel',{sessionId:this.active.sessionId});}catch{}}
  async inspect(request) {
    let session;
    try{session=await this.createSession(request);return session.modelCatalog;}
    finally{if(session)await this.closeSession(session.id);else await this.close();}
  }
  async run(request,onUpdate,signal) {
    let session,cancelTimer;
    const abort=()=>{this.cancelActive();cancelTimer=setTimeout(()=>{this.close().catch(()=>{});},this.settings.cancelGraceMs??1500);};
    signal?.addEventListener('abort',abort,{once:true});
    try {
      if(signal?.aborted)throw failure('BUILD_CANCELLED');
      session=await this.createSession(request);
      if(signal?.aborted)throw failure('BUILD_CANCELLED');
      const turn=new Turn(request,onUpdate);this.active={sessionId:session.id,turn};this.transport.resetLimit();
      profilePath(this.key,this.settings.profilesRoot);
      const result=await this.request('session/prompt',{sessionId:session.id,prompt:[{type:'text',text:request.prompt}],
        ...(request.outputSchema?{_meta:{outputSchema:request.outputSchema}}:{})},this.settings.promptTimeoutMs??120000);
      if(signal?.aborted)throw failure('BUILD_CANCELLED',{...usage(result?._meta?.usage,'acp'),model:modelId(result?._meta?.modelId)?result._meta.modelId:turn.model});
      return turn.finish(result,'acp');
    }catch(error) {
      this.cancelActive();
      const turn=this.active?.turn;
      const safe=signal?.aborted?failure('BUILD_CANCELLED',{usage:error?.usage,usageComplete:error?.usageComplete,model:error?.model}):classifyError(error);
      if(turn)Object.assign(safe,{usage:safe.usage??turn.usage,usageComplete:safe.usageComplete??turn.usageComplete,model:safe.model??turn.model});
      // A failed/cancelled RPC may still be running. Never reuse that process.
      await this.close();throw safe;
    }finally {
      clearTimeout(cancelTimer);signal?.removeEventListener('abort',abort);this.active=null;
      if(session&&!this.transport.closed&&!this.transport.fatal)await this.closeSession(session.id);
    }
  }
  async close() {
    if(this.closing)return this.closing;
    this.closing=(async()=>{
      this.cancelActive();
      for(const id of [...this.sessions])try{await this.closeSession(id);}catch{}
      await this.transport.close(this.settings.shutdownGraceMs??6000);
    })();return this.closing;
  }
}
module.exports={AcpClient,catalog,options,option};
