(function(root){
  'use strict';
  const ACP=root.SuperXACP||(typeof require==='function'?require('./build-acp.js'):null);
  const MAX_MESSAGE=1000000,MAX_PENDING=16;
  function fail(code){return Object.assign(new Error('The local Grok connection could not complete the request.'),{code});}
  function connection(value){if(!value||!Number.isInteger(value.port)||value.port<1024||value.port>65535||typeof value.secret!=='string'||!/^[-_A-Za-z0-9]{24,256}$/.test(value.secret)||/^(?:xai|sk)-/i.test(value.secret))throw fail('BUILD_CONNECTION_REQUIRED');return {port:value.port,secret:value.secret};}
  const defaultFactory=url=>new root.WebSocket(url);
  class Socket {
    constructor(input,{webSocketFactory=defaultFactory,openTimeoutMs=8000,requestTimeoutMs=20000}={}){this.connection=connection(input);this.factory=webSocketFactory;this.openTimeoutMs=openTimeoutMs;this.requestTimeoutMs=requestTimeoutMs;this.socket=null;this.opening=null;this.pending=new Map();this.listeners=new Set();this.uncertainSessions=new Set();this.sequence=0;this.closed=false;}
    get connected(){return this.socket?.readyState===1;}
    async open(){
      if(this.closed)throw fail('BUILD_DISCONNECTED');if(this.connected)return;if(this.opening)return this.opening;
      this.opening=new Promise((resolve,reject)=>{
        let socket,settled=false,timer;
        const openingDone=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
        const stop=code=>{openingDone(fail(code));if(this.socket===socket)this.socket=null;for(const entry of [...this.pending.values()])entry.finish(fail(code));};
        try{socket=this.factory(`ws://127.0.0.1:${this.connection.port}/ws?server-key=${encodeURIComponent(this.connection.secret)}`);this.socket=socket;}
        catch{openingDone(fail('BUILD_UNAVAILABLE'));return;}
        socket.addEventListener('open',()=>openingDone());
        socket.addEventListener('error',()=>{stop(settled?'BUILD_DISCONNECTED':'BUILD_UNAVAILABLE');try{socket.close();}catch{}});
        socket.addEventListener('close',()=>stop(settled?'BUILD_DISCONNECTED':'BUILD_UNAVAILABLE'));
        socket.addEventListener('message',event=>{
          if(this.socket!==socket)return;
          let message;
          try{if(typeof event.data!=='string'||event.data.length>MAX_MESSAGE)throw 0;message=JSON.parse(event.data);if(!message||Array.isArray(message)||message.jsonrpc!=='2.0')throw 0;}
          catch{stop('BUILD_PROTOCOL_ERROR');try{socket.close();}catch{}return;}
          if(typeof message.method==='string'){for(const listener of [...this.listeners])listener(message);return;}
          const entry=this.pending.get(message.id);if(!entry)return;
          if(Object.hasOwn(message,'error')){const error=fail('BUILD_PROTOCOL_ERROR');const diagnostic=String(message.error?.message??'');if(/auth|log.?in|cached.token|401/i.test(diagnostic))error.code='BUILD_LOGIN_REQUIRED';else if(/quota|rate.limit|usage.limit|429|402/i.test(diagnostic))error.code='BUILD_RATE_LIMIT';entry.finish(error);}
          else if(Object.hasOwn(message,'result'))entry.finish(null,message.result);
          else entry.finish(fail('BUILD_PROTOCOL_ERROR'));
        });
        timer=setTimeout(()=>{stop('BUILD_UNAVAILABLE');try{socket.close();}catch{}},this.openTimeoutMs);
        timer.unref?.();
      });
      try{await this.opening;}finally{this.opening=null;}
    }
    send(value){if(!this.connected)throw fail('BUILD_DISCONNECTED');const text=JSON.stringify(value);if(text.length>MAX_MESSAGE)throw fail('BUILD_LIMIT');this.socket.send(text);}
    async request(method,params,{timeoutMs=this.requestTimeoutMs,signal}={}){
      if(signal?.aborted)throw fail('BUILD_CANCELLED');await this.open();if(signal?.aborted)throw fail('BUILD_CANCELLED');if(this.pending.size>=MAX_PENDING)throw fail('BUILD_LIMIT');
      const id=++this.sequence;
      return new Promise((resolve,reject)=>{
        let done=false;
        const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);this.pending.delete(id);error?reject(error):resolve(value);};
        const abort=()=>finish(fail('BUILD_CANCELLED'));
        const timer=setTimeout(()=>finish(fail('BUILD_TIMEOUT')),Math.max(1,timeoutMs));timer.unref?.();
        this.pending.set(id,{finish});signal?.addEventListener('abort',abort,{once:true});
        try{this.send({jsonrpc:'2.0',id,method,params});}catch{finish(fail('BUILD_DISCONNECTED'));}
      });
    }
    notify(method,params){this.send({jsonrpc:'2.0',method,params});}
    respond(id,result,error){this.send({jsonrpc:'2.0',id,...(error?{error}:{result})});}
    onMessage(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
    async cleanupSession(sessionId,{cancel}={}){
      // Disconnecting the official service does not stop its work. Reconnect
      // solely for cancel/close control, never to replay a paid prompt.
      this.uncertainSessions.add(sessionId);let control=this,temporary=false;
      try{
        if(!this.connected){control=new Socket(this.connection,{webSocketFactory:this.factory,openTimeoutMs:this.openTimeoutMs,requestTimeoutMs:5000});temporary=true;const init=await control.request('initialize',{protocolVersion:1,clientCapabilities:{},clientInfo:{name:'superx-cleanup',version:'1.0.0'}});if(init?.protocolVersion!==1)throw 0;if((init.authMethods??[]).some(method=>method.id==='cached_token'))await control.request('authenticate',{methodId:'cached_token',_meta:{headless:true}});}
        if(cancel)control.notify('session/cancel',{sessionId});
        await control.request('session/close',{sessionId},{timeoutMs:5000});this.uncertainSessions.delete(sessionId);return {confirmed:true};
      }catch{return {confirmed:false};}finally{if(temporary)control.close();}
    }
    close(){this.closed=true;const socket=this.socket;this.socket=null;try{socket?.close();}catch{}for(const entry of [...this.pending.values()])entry.finish(fail('BUILD_DISCONNECTED'));this.listeners.clear();}
  }
  class Bridge {
    constructor(input,options={}){this.connection=connection(input);this.options=options;this.transport=null;this.client=null;this.active=null;this.lastStatus=null;this.controller=null;this.uncertainSessions=new Set();}
    get connected(){return this.transport?.connected===true;}
    prepare(){if(!this.client){this.transport=new Socket(this.connection,this.options);this.client=ACP.create({transport:this.transport,heartbeatMs:this.options.heartbeatMs});}return this.client;}
    async request(payload,{signal,onUpdate}={}){
      if(this.active){if(payload.type==='STATUS'&&this.lastStatus?.available)return {...this.lastStatus,busy:true};throw fail('BUILD_BUSY');}
      let client;this.controller=new AbortController();const abort=()=>this.controller?.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      const task=(async()=>{
        if(this.uncertainSessions.size){const control=new Socket(this.connection,this.options);try{for(const id of [...this.uncertainSessions]){const result=await control.cleanupSession(id,{cancel:true});if(!result.confirmed)throw fail('BUILD_CANCEL_UNCONFIRMED');this.uncertainSessions.delete(id);}}finally{control.close();}}
        client=this.prepare();
        if(payload.type==='STATUS'){
          const result=await client.status();this.lastStatus={...result,connected:this.connected,installed:this.connected};return this.lastStatus;
        }
        return client.run(payload,{signal:this.controller.signal,onUpdate});
      })();this.active=task;
      try{return await task;}catch(error){if(error?.code==='BUILD_CANCEL_UNCONFIRMED')for(const id of this.transport?.uncertainSessions??[])this.uncertainSessions.add(id);throw error;}finally{signal?.removeEventListener('abort',abort);this.active=null;this.controller=null;if(client&&(client.failure||!this.connected||this.lastStatus?.available===false||this.uncertainSessions.size)){await client.close();for(const id of this.transport?.uncertainSessions??[])this.uncertainSessions.add(id);this.client=null;this.transport=null;}}
    }
    async close(){this.controller?.abort();try{await this.active;}catch{}await this.client?.close();for(const id of this.transport?.uncertainSessions??[])this.uncertainSessions.add(id);this.client=null;this.transport=null;this.lastStatus=null;return {confirmed:this.uncertainSessions.size===0};}
  }
  const pools=new Map();
  function bridgeFor(input,webSocketFactory=defaultFactory){const value=connection(input);let group=pools.get(webSocketFactory);if(!group){group=new Map();pools.set(webSocketFactory,group);}const id=value.port+':'+value.secret;let bridge=group.get(id);if(!bridge){if(group.size>=4){const idle=[...group].find(([,item])=>!item.active&&!item.uncertainSessions.size);if(!idle)throw fail('BUILD_BUSY');void idle[1].close();group.delete(idle[0]);}bridge=new Bridge(value,{webSocketFactory});group.set(id,bridge);}return bridge;}
  async function closeAll(){
    let confirmed=true;
    for(const [factory,group]of pools){for(const [id,bridge]of group){const result=await bridge.close();if(result.confirmed)group.delete(id);else confirmed=false;}if(!group.size)pools.delete(factory);}
    // Forgetting a saved code cannot make an unconfirmed old task safe to
    // replay. Keep its cleanup-only quarantine for this worker's lifetime.
    return {confirmed};
  }
  const exported={Socket,Bridge,connection,bridgeFor,closeAll,defaultFactory};root.SuperXBuildTransport=exported;if(typeof module==='object'&&module.exports)module.exports=exported;
})(typeof globalThis!=='undefined'?globalThis:this);
