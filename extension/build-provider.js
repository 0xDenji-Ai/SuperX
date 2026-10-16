(function (root) {
  'use strict';
  const Core=root.XGrokCore||(typeof require==='function'?require('./feed-core.js'):null);
  const API=root.GrokFirstAPI||(typeof require==='function'?require('./api-provider.js'):null);
  const HOST='com.superx.grok',PROTOCOL_VERSION=1,MAX_PENDING=16,MAX_MESSAGE=1000000,MAX_TEXT=120000;
  const ERROR_MESSAGES=Object.freeze({
    BUILD_NATIVE_MISSING:'Install the SuperX native bridge before using Grok Build.',
    BUILD_PERMISSION_REQUIRED:'Allow native messaging before using Grok Build.',
    BUILD_LOGIN_REQUIRED:'Sign in to Grok Build locally before running this task.',
    BUILD_UNAVAILABLE:'Grok Build is unavailable. Check its local installation and configuration.',
    BUILD_VERSION_UNSUPPORTED:'This Grok Build version is unsupported. Update the local runtime.',
    BUILD_CONFIG_UNSUPPORTED:'The local Grok Build configuration is unsupported.',
    BUILD_MODEL_UNSUPPORTED:'The selected model is unavailable in Grok Build. Select an available model.',
    BUILD_EFFORT_UNSUPPORTED:'The selected reasoning effort is unavailable for this Grok Build model.',
    BUILD_TOOL_POLICY:'Grok Build could not apply the requested search-tool policy.',
    BUILD_PROTOCOL_ERROR:'The native bridge returned an invalid response.',
    BUILD_DISCONNECTED:'The connection to Grok Build ended before the task completed.',
    BUILD_TIMEOUT:'Grok Build did not finish in time. You can retry manually.',
    BUILD_OUTPUT_INVALID:'Grok Build did not return a complete reader answer.',
    BUILD_LANGUAGE_MISMATCH:'Grok Build did not follow the selected output language.',
    BUILD_SEARCH_NOT_PERFORMED:'Grok Build did not confirm the required search-tool use.',
    BUILD_LIMIT:'Grok Build has too many pending tasks. Try again after they finish.',
    RATE_LIMIT:'Grok Build reached a usage limit. Try again later.',
    CANCELED:'The Grok Build request was canceled.',
    POST_INVALID:'Provide a valid original X post URL.',
    URL_SEARCH_REQUIRED:'Enable X search or web search to retrieve the full original post.',
    COMMENTS_INVALID_RESPONSE:'Grok Build did not return three valid comment drafts.'
  });
  function errorFor(code) {
    const error=new Error(ERROR_MESSAGES[code]||ERROR_MESSAGES.BUILD_UNAVAILABLE);
    error.code=Object.hasOwn(ERROR_MESSAGES,code)?code:'BUILD_UNAVAILABLE';
    if(error.code==='CANCELED')error.name='AbortError';
    return error;
  }
  function hostErrorCode(code) {
    if(['BUILD_CANCELLED','BUILD_CANCELED','CANCELLED','CANCELED'].includes(code))return 'CANCELED';
    if(['BUILD_QUOTA','BUILD_RATE_LIMIT','QUOTA_EXCEEDED','RATE_LIMIT','rate_limit_exceeded'].includes(code))return 'RATE_LIMIT';
    return Object.hasOwn(ERROR_MESSAGES,code)?code:'BUILD_UNAVAILABLE';
  }
  function publicError(error) {
    const code=hostErrorCode(error?.code);
    return {code,error:ERROR_MESSAGES[code]};
  }
  function connectionCode(error) {
    // Browser diagnostics are used only to classify a local failure. Never
    // expose their text, host paths, command output or credentials to the UI.
    const text=typeof error?.message==='string'?error.message:'';
    if(/permission|forbidden|not allowed|access.*denied|nativeMessaging/i.test(text))return 'BUILD_PERMISSION_REQUIRED';
    if(/not found|not registered|specified native messaging host|host manifest|does not exist/i.test(text))return 'BUILD_NATIVE_MISSING';
    return 'BUILD_DISCONNECTED';
  }
  function aborted(signal) {if(signal?.aborted)throw errorFor('CANCELED');}
  let sequence=0;
  function requestId() {
    const random=typeof root.crypto?.randomUUID==='function'?root.crypto.randomUUID():Math.random().toString(36).slice(2);
    return `sx-${random}-${(++sequence).toString(36)}`.slice(0,80);
  }
  function boundedMessage(value) {
    try {return value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(value).length<=MAX_MESSAGE;}
    catch {return false;}
  }
  class NativeBridge {
    constructor(nativeConnect,{timeoutMs=180000,statusTimeoutMs=15000}={}) {
      this.nativeConnect=nativeConnect;this.timeoutMs=timeoutMs;this.statusTimeoutMs=statusTimeoutMs;
      this.port=null;this.pending=new Map();
    }
    connect() {
      if(this.port)return this.port;
      let port;
      try {port=this.nativeConnect(HOST);}
      catch(error) {throw errorFor(connectionCode(error));}
      if(!port?.onMessage?.addListener||!port?.onDisconnect?.addListener||typeof port.postMessage!=='function')throw errorFor('BUILD_PROTOCOL_ERROR');
      this.port=port;
      port.onMessage.addListener(message=>{
        if(this.port!==port||!message||typeof message!=='object'||typeof message.requestId!=='string')return;
        const pending=this.pending.get(message.requestId);
        if(!pending)return;
        if(!boundedMessage(message)) {pending.finish(errorFor('BUILD_PROTOCOL_ERROR'));if(pending.type==='RUN')this.cancel(message.requestId);return;}
        if(message.protocolVersion!=null&&message.protocolVersion!==PROTOCOL_VERSION) {pending.finish(errorFor('BUILD_PROTOCOL_ERROR'));return;}
        if(message.type==='UPDATE'&&pending.type==='RUN') {
          try {pending.onUpdate(message);}catch(error){pending.finish(error);this.cancel(message.requestId);}
        } else if(message.type==='ERROR')pending.finish(errorFor(hostErrorCode(message.code||message.errorCode)),message);
        else if(message.type===(pending.type==='STATUS'?'STATUS':'RESULT'))pending.finish(null,message);
        else {pending.finish(errorFor('BUILD_PROTOCOL_ERROR'));this.cancel(message.requestId);}
      });
      port.onDisconnect.addListener(()=>{
        if(this.port!==port)return;
        this.port=null;
        let diagnostic;
        try {diagnostic=port.error||root.chrome?.runtime?.lastError;}catch { /* No diagnostic available. */ }
        const code=connectionCode(diagnostic);
        for(const pending of [...this.pending.values()])pending.finish(errorFor(code));
      });
      return port;
    }
    cancel(id) {
      try {this.port?.postMessage({protocolVersion:PROTOCOL_VERSION,type:'CANCEL',requestId:id});}catch { /* A disconnected task is already stopped. */ }
    }
    request(payload,{signal,onUpdate=()=>{}}={}) {
      aborted(signal);
      if(this.pending.size>=MAX_PENDING)return Promise.reject(errorFor('BUILD_LIMIT'));
      if(!boundedMessage(payload))return Promise.reject(errorFor('BUILD_PROTOCOL_ERROR'));
      let port;
      try {port=this.connect();}catch(error){return Promise.reject(error);}
      const id=requestId(),message={...payload,protocolVersion:PROTOCOL_VERSION,requestId:id};
      return new Promise((resolve,reject)=>{
        let settled=false;
        const finish=(error,value)=>{
          if(settled)return;settled=true;
          clearTimeout(timer);signal?.removeEventListener('abort',cancel);
          this.pending.delete(id);
          if(error) {if(value)error.nativeResponse=value;reject(error);}else resolve(value);
        };
        const cancel=()=>{finish(errorFor('CANCELED'));this.cancel(id);};
        const timer=setTimeout(()=>{finish(errorFor('BUILD_TIMEOUT'));if(payload.type==='RUN')this.cancel(id);},payload.type==='STATUS'?this.statusTimeoutMs:this.timeoutMs);
        this.pending.set(id,{type:payload.type,finish,onUpdate});
        signal?.addEventListener('abort',cancel,{once:true});
        if(signal?.aborted){cancel();return;}
        try {port.postMessage(message);}catch(error){finish(errorFor(connectionCode(error)));}
      });
    }
  }
  const defaultConnect=host=>{
    if(typeof root.chrome?.runtime?.connectNative!=='function')throw new Error('nativeMessaging permission unavailable');
    return root.chrome.runtime.connectNative(host);
  };
  const bridges=new WeakMap();
  function bridgeFor(nativeConnect=defaultConnect) {
    if(typeof nativeConnect!=='function')throw errorFor('BUILD_PERMISSION_REQUIRED');
    let bridge=bridges.get(nativeConnect);
    if(!bridge){bridge=new NativeBridge(nativeConnect);bridges.set(nativeConnect,bridge);}
    return bridge;
  }
  function metadata(value,stage,previous={usage:{},model:'',usageComplete:false}) {
    const supplied=API.sanitizedUsage(value?.usage);
    const usage=Object.keys(supplied).length?supplied:previous.usage;
    const model=API.sanitizedModel(value?.model)||previous.model;
    const complete=typeof value?.usageComplete==='boolean'?value.usageComplete:previous.usageComplete;
    return {...API.sanitizedMetadata({usage,model,usageByStage:{[stage]:usage},modelByStage:{[stage]:model}}),usageComplete:complete===true&&API.usageComplete(usage)};
  }
  function sourceList(value) {
    // Share the API citation sanitizer. Only explicit host source metadata is
    // admitted; links in generated prose do not establish retrieval or search.
    return API.responseSources({citations:Array.isArray(value)?value:[]});
  }
  function readerText(message,{final=false}={}) {
    if(typeof message?.text!=='string'||message.text.length>MAX_TEXT) {
      if(final)throw errorFor('BUILD_OUTPUT_INVALID');
      return '';
    }
    if(['analysis','reasoning','commentary','tool','tool_call'].includes(message.channel)||['analysis','reasoning','commentary','tool','tool_call'].includes(message.phase))return '';
    return Core.readerOutput(message.text,{final}).text;
  }
  function checkLanguage(text,language,streaming,task) {
    try {API.assertMatchingScript(text,language,streaming,task);}
    catch(error) {if(error?.code==='API_LANGUAGE_MISMATCH')throw errorFor('BUILD_LANGUAGE_MISMATCH');throw error;}
  }
  function taskRequest(post,settings,task,analysis) {
    const request=API.buildRequest(post,{...settings,provider:'api',apiModel:settings.buildModel,apiReasoningEffort:settings.buildReasoningEffort},task,analysis);
    const prompt=request.instructions+'\n\n'+request.input.map(input=>input.content).join('\n\n');
    if(prompt.length>MAX_TEXT)throw errorFor('BUILD_OUTPUT_INVALID');
    return {type:'RUN',task,transport:settings.buildTransport,model:settings.buildModel,effort:settings.buildReasoningEffort,
      webSearch:task==='verify'&&settings.webSearch,xSearch:task==='verify'&&settings.xSearch,prompt,
      ...(task==='comments'?{outputSchema:request.text.format.schema}:{})};
  }
  function normalizedSettings(settings,post) {
    const normalized=Core.normalizeSettings(settings);
    return {...normalized,provider:'build',language:API.resolveLanguage(normalized.language,post)};
  }
  function failureFor(error) {
    const codes={BUILD_TIMEOUT:'CONNECTION',BUILD_DISCONNECTED:'CONNECTION',BUILD_PROTOCOL_ERROR:'CONNECTION',BUILD_OUTPUT_INVALID:'INCOMPLETE',BUILD_LANGUAGE_MISMATCH:'LANGUAGE_MISMATCH',RATE_LIMIT:'RATE_LIMIT',BUILD_LOGIN_REQUIRED:'ACCESS',BUILD_MODEL_UNSUPPORTED:'ACCESS',BUILD_EFFORT_UNSUPPORTED:'ACCESS',BUILD_SEARCH_NOT_PERFORMED:'INCOMPLETE'};
    return {stage:'verify',code:codes[error.code]||'UNKNOWN'};
  }
  async function runStage(post,settings,task,analysis,{signal,onUpdate=()=>{},bridge}) {
    aborted(signal);
    const request=taskRequest(post,settings,task,analysis);
    let text='',sources=[],searched=false,reported=metadata({},task);
    const ingest=(message,final=false)=>{
      reported=metadata(message,task,reported);
      if(Array.isArray(message.sources))sources=sourceList(message.sources);
      // Search is an observed host event, never inferred from citations, the
      // prompt or the configured search switches.
      if(message.searched===true)searched=true;
      if(Object.hasOwn(message,'text'))text=readerText(message,{final});
      if(task==='verify'&&text)checkLanguage(text,settings.language,!final,task);
    };
    const publish=()=>onUpdate({text,sources,searched,...reported,phase:task,provider:'build',verified:false,apiVerification:'only',verificationStatus:'running',warning:''});
    try {
      const result=await bridge.request(request,{signal,onUpdate:message=>{ingest(message);publish();}});
      aborted(signal);ingest(result,true);
      if(result.status!=null&&!['completed','complete','success'].includes(result.status))throw errorFor('BUILD_OUTPUT_INVALID');
      // A terminal empty/missing or tool-only snapshot is authoritative. Do
      // not resurrect intermediate prose as a completed reader answer.
      if(!Object.hasOwn(result,'text')||!text.trim()) {text='';throw errorFor('BUILD_OUTPUT_INVALID');}
      return {text,sources,searched,...reported};
    } catch(caught) {
      const error=errorFor(signal?.aborted?'CANCELED':hostErrorCode(caught?.code));
      if(caught?.nativeResponse)reported=metadata(caught.nativeResponse,task,reported);
      Object.assign(error,reported);
      const partial=Core.readerOutput(text,{final:true});
      if(task==='verify'&&partial.kind==='content'&&partial.text.trim()&&!['CANCELED','BUILD_LANGUAGE_MISMATCH'].includes(error.code)) {
        error.partialText=partial.text;error.partialSources=sources;error.partialSearched=searched;
      }
      throw error;
    }
  }
  function resultFor(stage,settings,status,warning) {
    return {...stage,provider:'build',task:'verify',verified:false,apiVerification:'only',verificationStatus:status,warning,completedAt:Date.now()};
  }
  async function runWithBridge(post,input,options,bridge) {
    const {signal,onUpdate=()=>{}}=options;
    aborted(signal);
    const settings=normalizedSettings(input,post),labels=API.labels(settings);
    // Validate before publishing or connecting to the local runtime.
    taskRequest(post,settings,'verify');
    onUpdate({text:'',sources:[],searched:false,phase:'verify',provider:'build',verified:false,apiVerification:'only',verificationStatus:'running',warning:''});
    try {
      const result=await runStage(post,settings,'verify',undefined,{signal,onUpdate,bridge});
      return resultFor(result,settings,result.searched?'completed':'unverified',result.searched?labels.completed:labels.unverified);
    } catch(error) {
      error.verificationFailure=failureFor(error);
      if(!error.partialText||['CANCELED','BUILD_LANGUAGE_MISMATCH'].includes(error.code))throw error;
      try {checkLanguage(error.partialText,settings.language,false,'verify');}
      catch(languageError) {
        Object.assign(languageError,API.sanitizedMetadata(error));
        languageError.verificationFailure=failureFor(languageError);
        throw languageError;
      }
      const partial=resultFor({text:error.partialText,sources:error.partialSources,searched:error.partialSearched,...API.sanitizedMetadata(error),usageComplete:error.usageComplete===true,verificationFailure:error.verificationFailure},settings,'incomplete',labels.incomplete);
      error.partialResult=partial;
      onUpdate(partial);
      // Keep the failure visible to the caller. The worker may retain this
      // actual partial answer, but must never cache it as a completed task.
      throw error;
    }
  }
  async function commentsWithBridge(post,input,{analysis,signal}={},bridge) {
    aborted(signal);
    const settings=normalizedSettings(input,post);
    const result=await runStage(post,settings,'comments',analysis,{signal,bridge});
    try {
      const comments=API.parseComments(result.text);
      for(const comment of comments)checkLanguage(comment,settings.language,false,'comments');
      return {comments,provider:'build',task:'comments',verified:false,searched:false,...API.sanitizedMetadata(result),usageComplete:result.usageComplete,completedAt:Date.now()};
    } catch(caught) {
      const error=errorFor(hostErrorCode(caught?.code));Object.assign(error,API.sanitizedMetadata(result));throw error;
    }
  }
  function modelCatalog(value) {
    if(!Array.isArray(value))return undefined;
    return value.slice(0,100).flatMap(entry=>{
      const id=API.sanitizedModel(typeof entry==='string'?entry:entry?.id||entry?.value||entry?.model);
      if(!id)return [];
      if(typeof entry==='string')return [{id}];
      const efforts=Array.isArray(entry.efforts)?entry.efforts.filter(effort=>['auto','none','low','medium','high','xhigh'].includes(effort)):undefined;
      return [{id,...(typeof entry.available==='boolean'?{available:entry.available}:{}),...(efforts?{efforts:[...new Set(efforts)]}:{})}];
    });
  }
  async function statusWithBridge(bridge) {
    try {
      const result=await bridge.request({type:'STATUS'});
      const catalog=modelCatalog(result.modelCatalog);
      return {connected:true,permission:'granted',installed:result.installed===true,available:result.available===true,
        ...(typeof result.authenticated==='boolean'?{authenticated:result.authenticated}:{}),
        ...(typeof result.version==='string'&&/^[A-Za-z0-9.+_-]{1,80}$/.test(result.version)?{version:result.version}:{}),
        ...(catalog?{modelCatalog:catalog}:{}),...(result.errorCode?{errorCode:hostErrorCode(result.errorCode)}:{})};
    } catch(error) {
      const code=hostErrorCode(error?.code),connected=Boolean(bridge.port);
      return {connected,permission:connected?'granted':code==='BUILD_PERMISSION_REQUIRED'?'denied':'unknown',installed:connected,available:false,
        ...(code==='BUILD_LOGIN_REQUIRED'?{authenticated:false}:{}),errorCode:code};
    }
  }
  const provider={
    run:(post,settings,options={})=>runWithBridge(post,settings,options,bridgeFor(options.nativeConnect)),
    generateComments:(post,settings,options={})=>commentsWithBridge(post,settings,options,bridgeFor(options.nativeConnect)),
    status:(options={})=>statusWithBridge(bridgeFor(options.nativeConnect)),publicError,
    // Isolated bridge injection is useful to embedders and deterministic tests.
    create:({nativeConnect=defaultConnect,...timeouts}={})=>{
      const bridge=new NativeBridge(nativeConnect,timeouts);
      return {run:(post,settings,options={})=>runWithBridge(post,settings,options,bridge),generateComments:(post,settings,options={})=>commentsWithBridge(post,settings,options,bridge),status:()=>statusWithBridge(bridge),publicError};
    }
  };
  root.SuperXBuild=provider;
  if(typeof module!=='undefined')module.exports=provider;
})(globalThis);
