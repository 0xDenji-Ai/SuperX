'use strict';
const connection={port:2419,secret:'s'.repeat(64)};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function wsFixture(behavior={}){
  const sockets=[],messages=[],urls=[],sessionProfiles=new Map(),pending=new Map();let sid=0,model=behavior.currentModel||'grok-4.3',effort=behavior.currentEffort??'high';
  const models=behavior.models||['grok-4.3','grok-4.7','grok-4.6','grok-4.5','grok-4.7-build-fast'];
  const configs=()=>[{id:'model',currentValue:model,options:models.map(value=>({value,name:value}))},{id:'reasoning_effort',currentValue:effort,options:(behavior.efforts||(model==='grok-4.3'?['none','low','medium','high']:['low','medium','high','xhigh'])).map(value=>({value}))}];
  const result=()=>({stopReason:behavior.stopReason||'end_turn',_meta:{modelId:behavior.actualModel||model,usage:behavior.usage||{inputTokens:20,outputTokens:10,totalTokens:30},...(Object.hasOwn(behavior,'structured')?{structuredOutput:behavior.structured}:{})}});
  const respond=(socket,message,value)=>socket.emit({jsonrpc:'2.0',id:message.id,result:value});
  const update=(socket,sessionId,value)=>socket.emit({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:value}});
  const process=(socket,message)=>{
    messages.push(message);
    if(behavior.onMessage?.(message,socket,{respond,update,pending,result})===true)return;
    if(!Object.hasOwn(message,'id')){if(message.method==='session/cancel'){const task=pending.get(message.params.sessionId);if(task){pending.delete(message.params.sessionId);respond(task.socket,task.message,{stopReason:'cancelled'});}}return;}
    if(message.method==='initialize')return respond(socket,message,{protocolVersion:behavior.protocolVersion??1,authMethods:behavior.noLogin?[{id:'grok.com'}]:[{id:'cached_token'}],...(behavior.imageInput?{agentCapabilities:{promptCapabilities:{image:true}}}:{}),_meta:{agentVersion:behavior.version||'1.0.60',currentWorkingDirectory:behavior.cwd||'C:\\isolated SuperX workspace'}});
    if(message.method==='authenticate'){if(behavior.authError)return socket.emit({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'Login required PRIVATE_AUTH_CANARY'}});return respond(socket,message,{});}
    if(message.method==='session/new'){const sessionId='session-'+(++sid);sessionProfiles.set(sessionId,message.params._meta.agentProfile);return respond(socket,message,{sessionId,configOptions:configs()});}
    if(message.method==='session/set_config_option'){if(message.params.configId==='model'&&!behavior.wrongModel)model=message.params.value;if(message.params.configId==='reasoning_effort'&&!behavior.wrongEffort)effort=message.params.value;return respond(socket,message,{configOptions:configs()});}
    if(message.method==='_x.ai/session/info')return respond(socket,message,{result:{agentName:behavior.agentName||sessionProfiles.get(message.params.sessionId)?.name,model:behavior.infoModel||model,context:{total:256000,toolDefinitionsCount:behavior.localCount??0}}});
    if(message.method==='session/close'){if(behavior.cleanupError)return socket.emit({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'PRIVATE_CLEANUP_ERROR'}});return respond(socket,message,{});}
    if(message.method==='session/prompt'){
      const id=message.params.sessionId,profile=sessionProfiles.get(id),comments=profile?.name==='superx-none';pending.set(id,{socket,message});
      if(behavior.promptError){pending.delete(id);return socket.emit({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:behavior.promptError+' PRIVATE_UPSTREAM_CANARY'}});}
      if(behavior.reverse)socket.emit({jsonrpc:'2.0',id:'reverse',method:behavior.reverse,params:{secret:'PRIVATE_REVERSE_CANARY'}});
      if(!comments&&!behavior.noSearch){update(socket,id,{sessionUpdate:'tool_call',toolCallId:'search',status:'in_progress',rawInput:{variant:'XSearch',backend:true}});update(socket,id,{sessionUpdate:'tool_call_update',toolCallId:'search',status:'completed',rawOutput:{name:behavior.toolName||'x_thread_fetch',sources:behavior.sources||[]}});}
      update(socket,id,{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'PRIVATE_REASONING_CANARY'}});
      update(socket,id,{sessionUpdate:'usage_update',usage:behavior.usage||{inputTokens:20,outputTokens:10,totalTokens:30}});
      const text=comments?(behavior.text??'["First comment.","Second comment.","Third comment."]'):(behavior.text??'The date remains unconfirmed.');
      for(const chunk of behavior.chunks||[text])update(socket,id,{sessionUpdate:'agent_message_chunk',content:{type:'text',text:chunk}});
      if(behavior.disconnectPrompt){socket.close();return;}
      if(behavior.holdPrompt)return;
      pending.delete(id);respond(socket,message,result());return;
    }
    socket.emit({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Unknown fixture method'}});
  };
  function factory(url){
    urls.push(url);const listeners=new Map();
    const socket={readyState:0,addEventListener(name,listener){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(listener);},dispatch(name,event={}){for(const listener of listeners.get(name)||[])listener(event);},emit(value){socket.dispatch('message',{data:JSON.stringify(value)});},send(text){process(socket,JSON.parse(text));},close(){if(socket.readyState===3)return;socket.readyState=3;socket.dispatch('close');}};
    sockets.push(socket);queueMicrotask(()=>{if(behavior.openError){socket.dispatch('error');return;}socket.readyState=1;socket.dispatch('open');});return socket;
  }
  const finish=()=>{for(const [id,task]of [...pending]){pending.delete(id);respond(task.socket,task.message,result());}};
  return {factory,connection,messages,sockets,urls,pending,sessionProfiles,finish,tick};
}
module.exports={wsFixture,connection,tick};
