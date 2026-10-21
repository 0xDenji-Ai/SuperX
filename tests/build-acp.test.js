'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ACP=require('../extension/build-acp.js');
const Core=require('../extension/feed-core.js');
const request=(overrides={})=>({requestId:'job-1',task:'verify',model:'grok-4.7',effort:'low',xSearch:true,webSearch:false,prompt:'Check the linked post.',...overrides});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(behavior={}){
  const messages=[],notifications=[],responses=[],cleanups=[],listeners=new Set();let sid=0,model=behavior.currentModel??'grok-4.3',effort=behavior.currentEffort??'high',activeSession,resolvePrompt;
  const models=behavior.models??['grok-4.3','grok-4.7','grok-4.6'];
  function configs(){return [{id:'model',currentValue:model,options:models.map(value=>({value,name:value}))},{id:'reasoning_effort',currentValue:effort,options:(behavior.efforts??(model==='grok-4.3'?['none','low','medium','high']:['low','medium','high'])).map(value=>({value}))}];}
  const emit=value=>{for(const listener of listeners)listener(value);};
  const update=value=>emit({jsonrpc:'2.0',method:'session/update',params:{sessionId:activeSession,update:value}});
  const reply=()=>({stopReason:behavior.stopReason??'end_turn',_meta:{modelId:behavior.actualModel??model,usage:behavior.usage??{inputTokens:40,outputTokens:10,totalTokens:50},...(behavior.structured?{structuredOutput:behavior.structured}:{})}});
  const transport={
    onMessage(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    respond(id,result,error){responses.push({id,result,error});},
    notify(method,params){notifications.push({method,params});if(method==='session/cancel'&&resolvePrompt)resolvePrompt({stopReason:'cancelled'});},
    close(){messages.push({method:'CLOSED'});},
    async cleanupSession(id,options){cleanups.push({id,...options});if(behavior.cleanupFalse)return {confirmed:false};if(options.cancel&&resolvePrompt)resolvePrompt({stopReason:'cancelled'});return {confirmed:true};},
    async request(method,params,options){
      messages.push({method,params,options});
      if(method==='initialize')return {protocolVersion:behavior.protocolVersion??1,authMethods:behavior.noLogin?[{id:'grok.com'}]:[{id:'cached_token'}],_meta:{agentVersion:behavior.version??'1.0.60',currentWorkingDirectory:behavior.cwd??'C:\\SuperX\\isolated work'}};
      if(method==='authenticate'){if(behavior.authError)throw new Error(behavior.authError);return {};}
      if(method==='session/new'){activeSession='session-'+(++sid);return {sessionId:activeSession,configOptions:configs()};}
      if(method==='session/set_config_option'){if(params.configId==='model'&&!behavior.wrongModel)model=params.value;if(params.configId==='reasoning_effort'&&!behavior.wrongEffort)effort=params.value;return {configOptions:configs()};}
      if(method==='_x.ai/session/info'){const created=messages.filter(message=>message.method==='session/new').at(-1);return {result:{agentName:behavior.agentName??created.params._meta.agentProfile.name,model:behavior.infoModel??model,context:{total:256000,toolDefinitionsCount:behavior.localCount??0}}};}
      if(method==='session/close')return {};
      if(method==='session/prompt'){
        if(behavior.promptError)throw Object.assign(new Error('PRIVATE_UPSTREAM_CANARY'),{code:behavior.promptError});
        if(behavior.reverse)emit({jsonrpc:'2.0',id:'reverse',method:behavior.reverse,params:{secret:'PRIVATE_CANARY'}});
        if(behavior.localTool)update({sessionUpdate:'tool_call',toolCallId:'bad',rawInput:{variant:'ReadFile',backend:false},status:'in_progress'});
        if(!behavior.noSearch&&!behavior.structured){update({sessionUpdate:'tool_call',toolCallId:'search',rawInput:{variant:'XSearch',backend:true},status:'in_progress'});update({sessionUpdate:'tool_call_update',toolCallId:'search',status:'completed',rawOutput:{name:behavior.toolName??'x_thread_fetch',sources:[{url:'https://evidence.example/check?token=PRIVATE&ok=1',title:'Evidence'}]}});}
        update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'PRIVATE_REASONING_CANARY'}});
        if(!behavior.structured)update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:behavior.text??'The claim is supported.'}});
        if(behavior.holdPrompt)return new Promise(resolve=>{resolvePrompt=resolve;});
        return reply();
      }
      throw new Error('Unexpected mock method '+method);
    }
  };
  return {client:ACP.create({transport,heartbeatMs:behavior.heartbeatMs??20000}),transport,messages,notifications,responses,cleanups,update,emit,finish:()=>resolvePrompt?.(reply())};
}

test('inline profiles use a denied curated sentinel and disable local discovery for all search combinations',()=>{
  for(const [task,xSearch,webSearch,key] of [['comments',false,false,'none'],['verify',true,false,'x'],['verify',false,true,'web'],['verify',true,true,'x-web']]){
    const profile=ACP.agentProfile({task,xSearch,webSearch});assert.equal(profile.name,'superx-'+key);assert.deepEqual(profile.toolConfig,{tools:[{id:'GrokBuild:read_file'}]});assert.ok(profile.disallowedTools.includes('read_file'));assert.equal(profile.permissionMode,'dontAsk');
    for(const field of ['agentsMd','discoverSkills','inheritSkills','injectDefaultTools','background'])assert.equal(profile[field],false);
    for(const field of ['skills','mcpServers','tools'])assert.deepEqual(profile[field],[]);assert.equal(profile.mcpInheritance,'none');assert.deepEqual(profile.hooks,{});assert.equal(profile.memory,null);assert.equal(profile.disallowedTools.includes('x_search'),!xSearch);assert.equal(profile.disallowedTools.includes('web_search'),!webSearch);
  }
});
test('draft profiles keep the unpublished text as the only target with the same restricted tools',()=>{
  for(const [xSearch,webSearch] of [[false,false],[true,false],[false,true],[true,true]]){
    const profile=ACP.agentProfile(request({target:'draft',xSearch,webSearch}));
    assert.match(profile.promptBody,/only fact-check target is the user's unpublished draft/);
    assert.match(profile.promptBody,/Parent-post and reply context are auxiliary data only/);
    assert.match(profile.promptBody,/Every finding must address the draft itself/);
    assert.equal(profile.permissionMode,'dontAsk');assert.deepEqual(profile.toolConfig,{tools:[{id:'GrokBuild:read_file'}]});
    for(const field of ['agentsMd','discoverSkills','inheritSkills','injectDefaultTools','background'])assert.equal(profile[field],false);
    for(const field of ['skills','mcpServers','tools'])assert.deepEqual(profile[field],[]);
    assert.equal(profile.disallowedTools.includes('read_file'),true);assert.equal(profile.disallowedTools.includes('run_terminal_cmd'),true);
    assert.equal(profile.disallowedTools.includes('x_search'),!xSearch);assert.equal(profile.disallowedTools.includes('web_search'),!webSearch);
    if(!xSearch&&!webSearch){assert.match(profile.promptBody,/requested reader-facing fact-check answer/);assert.match(profile.promptBody,/Do not use tools or search/);assert.doesNotMatch(profile.promptBody,/Return only the requested JSON array/);}
    else {assert.match(profile.promptBody,/Search to investigate factual assertions, events and denials/);assert.match(profile.promptBody,/original reports, dates, places, mechanisms and relevant cases/);assert.match(profile.promptBody,/Search is optional for purely subjective taste/);assert.doesNotMatch(profile.promptBody,/Check the public claims/);}
    assert.match(profile.promptBody,/supplied thread root, earlier ancestors and direct reply/);
    assert.match(profile.promptBody,/A short denial can dispute the earlier event without repeating its details/);
  }
  assert.match(ACP.agentProfile({task:'comments',xSearch:false,webSearch:false}).promptBody,/Return only the requested JSON array/);
});

test('drafts may complete without search while observed allowed searches retain their evidence metadata',async()=>{
  for(const [xSearch,webSearch,noSearch] of [[false,false,true],[true,false,true],[true,true,true],[true,false,false]]){
    const text='The claim that PHP is universally best depends on the intended use.',f=fixture({noSearch,text});
    const result=await f.client.run(request({target:'draft',xSearch,webSearch,prompt:'Check only the unpublished PHP draft.'}));
    assert.equal(result.type,'RESULT');assert.equal(result.text,text);assert.equal(result.searched,!noSearch);
    assert.equal(result.sources.length,noSearch?0:1);assert.deepEqual(f.cleanups,[{id:'session-1',cancel:false}]);
    const sent=f.messages.find(message=>message.method==='session/prompt');assert.equal(sent.params._meta,undefined);
    assert.deepEqual(sent.params.prompt,[{type:'text',text:'Check only the unpublished PHP draft.'}]);
  }
});

test('draft target cannot turn a comment task or arbitrary target into a different permission profile',async()=>{
  for(const change of [{target:'draft',task:'comments',xSearch:false},{target:'post'},{target:null},{target:true},{target:{kind:'draft'}}]){
    const f=fixture();await assert.rejects(f.client.run(request(change)),{code:'BUILD_PROTOCOL_ERROR'});assert.equal(f.messages.length,0);
  }
});

test('drafts still reject local tools, unenabled search families and reverse permission requests',async()=>{
  for(const [behavior,change] of [[{localTool:true},{}],[{toolName:'read_file'},{}],[{}, {xSearch:false,webSearch:true}],[{reverse:'session/request_permission'},{}],[{reverse:'fs/read_text_file'},{}]]){
    const f=fixture({...behavior,holdPrompt:true});await assert.rejects(f.client.run(request({target:'draft',...change})),{code:'BUILD_TOOL_POLICY'});
    assert.equal(f.cleanups[0].cancel,true);
  }
});

test('zero-prompt status confirms authentication, actual empty toolset and account model catalog',async()=>{
  const f=fixture({models:['grok-4.6','grok-4.7-build-fast'],currentModel:'grok-4.6'}),status=await f.client.status();assert.equal(status.available,true);assert.equal(status.authenticated,true);assert.equal(status.runtimeVersionConfirmed,true);assert.equal(status.version,'1.0.60');assert.deepEqual(status.modelCatalog.map(item=>item.id),['grok-4.6','grok-4.7-build-fast']);
  assert.equal(f.messages.some(message=>message.method==='session/prompt'),false);assert.deepEqual(f.messages[0].params.clientCapabilities,{});const created=f.messages.find(message=>message.method==='session/new');assert.equal(created.params.cwd,'C:\\SuperX\\isolated work');assert.equal(JSON.stringify(status).includes('isolated work'),false);assert.equal(created.params._meta.agentProfile.name,'superx-none');assert.deepEqual(created.params.mcpServers,[]);assert.deepEqual(f.cleanups,[{id:'session-1',cancel:false}]);
});
test('logged-out status never calls cached-token authentication or sends a prompt',async()=>{
  const f=fixture({noLogin:true}),status=await f.client.status();assert.equal(status.errorCode,'BUILD_LOGIN_REQUIRED');assert.equal(status.authenticated,false);assert.equal(f.messages.some(message=>['authenticate','session/prompt','session/new'].includes(message.method)),false);
});
test('explicit incompatible protocol and reported version fail before creating a session',async()=>{
  for(const behavior of [{protocolVersion:2},{version:'1.0.99'}]){const f=fixture(behavior),status=await f.client.status();assert.equal(status.available,false);assert.equal(f.messages.some(message=>message.method==='session/new'),false);}
});
test('session model and reasoning effort must be advertised and reconfirmed before inference',async()=>{
  for(const [behavior,change,code] of [[{models:['grok-4.7','grok-4.6']}, {model:'grok-4.3'},'BUILD_MODEL_UNSUPPORTED'],[{wrongModel:true},{model:'grok-4.6'},'BUILD_MODEL_UNSUPPORTED'],[{wrongEffort:true},{},'BUILD_EFFORT_UNSUPPORTED'],[{efforts:['high']},{},'BUILD_EFFORT_UNSUPPORTED']]){
    const f=fixture(behavior);await assert.rejects(f.client.run(request(change)),{code});assert.equal(f.messages.some(message=>message.method==='session/prompt'),false);assert.equal(f.cleanups.length,1);
  }
});
test('the shared defaults explicitly select Grok 4.3 and none only when the live ACP catalog supports them',async()=>{
  const f=fixture(),defaults=Core.DEFAULT_SETTINGS;
  assert.equal(defaults.buildModel,'grok-4.3');assert.equal(defaults.buildReasoningEffort,'none');
  const result=await f.client.run(request({model:defaults.buildModel,effort:defaults.buildReasoningEffort}));
  assert.equal(result.model,'grok-4.3');assert.equal(f.messages.find(message=>message.params?.configId==='model').params.value,'grok-4.3');
  assert.equal(f.messages.find(message=>message.params?.configId==='reasoning_effort').params.value,'none');assert.equal(f.messages.filter(message=>message.method==='session/prompt').length,1);
});
test('none is not translated to low or minimal when the official ACP catalog does not advertise none',async()=>{
  for(const efforts of [['low','medium','high'],['minimal','low','high']]){
    const f=fixture({efforts});await assert.rejects(f.client.run(request({model:'grok-4.3',effort:'none'})),{code:'BUILD_EFFORT_UNSUPPORTED'});
    assert.equal(f.messages.some(message=>message.method==='session/prompt'),false);assert.equal(f.messages.some(message=>message.params?.configId==='reasoning_effort'),false);
  }
  const minimal=fixture({efforts:['minimal','low','high']});await minimal.client.run(request({model:'grok-4.3',effort:'minimal'}));
  assert.equal(minimal.messages.find(message=>message.params?.configId==='reasoning_effort').params.value,'minimal');
});
test('zero-prompt status preserves an advertised none level independently from minimal',async()=>{
  const f=fixture({efforts:['none','minimal','low','high']}),status=await f.client.status();
  assert.deepEqual(status.modelCatalog.find(model=>model.id==='grok-4.3').efforts,['none','minimal','low','high']);assert.equal(status.available,true);
  assert.equal(f.messages.some(message=>message.method==='session/prompt'),false);
});
test('an explicit current none value remains usable when the CLI fallback menu omits none',async()=>{
  const behavior={currentEffort:'none',efforts:['minimal','low','high']},f=fixture(behavior);
  const result=await f.client.run(request({model:'grok-4.3',effort:'none'}));assert.equal(result.model,'grok-4.3');
  assert.equal(f.messages.some(message=>message.params?.configId==='reasoning_effort'),false);assert.equal(f.messages.filter(message=>message.method==='session/prompt').length,1);
  const g=fixture(behavior),status=await g.client.status(),efforts=status.modelCatalog.find(model=>model.id==='grok-4.3').efforts;
  assert.equal(status.available,true);assert.ok(efforts.includes('none'));assert.ok(efforts.includes('minimal'));assert.equal(g.messages.some(message=>message.method==='session/prompt'),false);
});
test('reported tool count and profile/model identity are runtime safety gates',async()=>{
  for(const behavior of [{localCount:1},{agentName:'grok-build'},{infoModel:'grok-4.6'}]){const f=fixture(behavior);await assert.rejects(f.client.run(request()),{code:'BUILD_TOOL_POLICY'});assert.equal(f.messages.some(message=>message.method==='session/prompt'),false);assert.equal(f.cleanups[0].cancel,true);}
});
test('observed hosted search completion, actual model and usage produce a reader result',async()=>{
  const f=fixture({actualModel:'grok-4.7-resolved'}),updates=[],result=await f.client.run(request(),{onUpdate:update=>updates.push(update)});assert.equal(result.type,'RESULT');assert.equal(result.text,'The claim is supported.');assert.equal(result.searched,true);assert.equal(result.model,'grok-4.7-resolved');assert.deepEqual(result.usage,{input_tokens:40,output_tokens:10,total_tokens:50});assert.equal(result.usageComplete,true);assert.deepEqual(result.sources,[{url:'https://evidence.example/check?ok=1',title:'Evidence'}]);assert.equal(JSON.stringify(updates).includes('PRIVATE_REASONING'),false);assert.deepEqual(f.cleanups,[{id:'session-1',cancel:false}]);
});
test('generated URLs and search-like labels cannot substitute for an observed allowed search event',async()=>{
  const f=fixture({noSearch:true,text:'See https://example.com. Search complete.'});await assert.rejects(f.client.run(request()),{code:'BUILD_SEARCH_NOT_PERFORMED'});assert.equal(f.cleanups[0].cancel,true);
});
test('unexpected local tools, hosted tool family and tool result names stop the active task',async()=>{
  for(const behavior of [{localTool:true},{toolName:'read_file'}]){const f=fixture({...behavior,holdPrompt:true});await assert.rejects(f.client.run(request()),{code:'BUILD_TOOL_POLICY'});assert.equal(f.cleanups[0].cancel,true);}
});
test('all reverse filesystem, terminal and permission requests are refused and cancel the task',async()=>{
  for(const method of ['fs/read_text_file','fs/write_text_file','terminal/create','session/request_permission','_x.ai/shell/exec']){const f=fixture({reverse:method,holdPrompt:true});await assert.rejects(f.client.run(request()),{code:'BUILD_TOOL_POLICY'});assert.equal(f.responses.length,1);assert.equal(f.responses[0].id,'reverse');if(method==='session/request_permission')assert.deepEqual(f.responses[0].result,{outcome:{outcome:'cancelled'}});else assert.equal(f.responses[0].error.code,-32601);assert.equal(f.cleanups[0].cancel,true);}
});
test('abort sends session cancel then cleanup, with no automatic paid retry',async()=>{
  const f=fixture({holdPrompt:true}),controller=new AbortController(),pending=f.client.run(request(),{signal:controller.signal});await tick();controller.abort();await assert.rejects(pending,{code:'BUILD_CANCELLED'});assert.equal(f.notifications.some(message=>message.method==='session/cancel'),true);assert.equal(f.cleanups[0].cancel,true);assert.equal(f.messages.filter(message=>message.method==='session/prompt').length,1);
});
test('disconnected prompt performs only cancellation cleanup and exposes an unconfirmed stop',async()=>{
  const f=fixture({promptError:'BUILD_DISCONNECTED',cleanupFalse:true});await assert.rejects(f.client.run(request()),{code:'BUILD_CANCEL_UNCONFIRMED'});assert.equal(f.cleanups[0].cancel,true);assert.equal(f.messages.filter(message=>message.method==='session/prompt').length,1);
});
test('failed close after a terminal answer retains the actual answer as partial instead of claiming success',async()=>{
  const f=fixture({cleanupFalse:true});await assert.rejects(f.client.run(request()),error=>error.code==='BUILD_CANCEL_UNCONFIRMED'&&error.partialResult?.text==='The claim is supported.');
});
test('heartbeat is read-only and reconfirms the active restricted session while thinking',async()=>{
  const f=fixture({holdPrompt:true,heartbeatMs:5}),pending=f.client.run(request());await new Promise(resolve=>setTimeout(resolve,18));f.finish();await pending;assert.ok(f.messages.filter(message=>message.method==='_x.ai/session/info').length>=2);assert.equal(f.messages.filter(message=>message.method==='session/prompt').length,1);
});
test('comment output requires exactly three distinct one-line strings and cannot use search',async()=>{
  const f=fixture({structured:['One.','Two.','Three.']}),result=await f.client.run(request({task:'comments',xSearch:false,outputSchema:ACP.COMMENTS_SCHEMA}));assert.equal(result.text,'["One.","Two.","Three."]');assert.equal(result.searched,false);const prompt=f.messages.find(message=>message.method==='session/prompt');assert.deepEqual(prompt.params._meta.outputSchema,ACP.COMMENTS_SCHEMA);
  for(const structured of [['One.','One.','Three.'],['One.','Two.'],['One.\nTwo.','Three.','Four.']]){const g=fixture({structured});await assert.rejects(g.client.run(request({task:'comments',xSearch:false})),{code:'BUILD_OUTPUT_INVALID'});}
});
test('bounds, arbitrary output schema, unspecified effort and disallowed search fail before connecting',async()=>{
  for(const change of [{prompt:'x'.repeat(60001)},{effort:'auto'},{outputSchema:{type:'object'}},{task:'verify',xSearch:false},{task:'comments'}]){const f=fixture();await assert.rejects(f.client.run(request(change)));assert.equal(f.messages.length,0);}
});
test('usage excludes provider cost estimates and rejects inconsistent aggregate counts as complete',()=>{
  assert.deepEqual(ACP.usage({inputTokens:5,outputTokens:10,totalTokens:15,totalCostUsd:99}),{usage:{input_tokens:5,output_tokens:10,total_tokens:15},usageComplete:true});assert.equal(ACP.usage({inputTokens:5,outputTokens:10,totalTokens:12}).usageComplete,false);
});
test('one client cannot create competing sessions before the first prompt starts',async()=>{
  const f=fixture({holdPrompt:true}),first=f.client.run(request());await assert.rejects(f.client.run(request({requestId:'other'})),{code:'BUILD_LIMIT'});await tick();f.finish();await first;assert.equal(f.messages.filter(message=>message.method==='session/new').length,1);
});
test('sequential posts receive independent sessions and no prior messages or tools',async()=>{
  const f=fixture();await f.client.run(request());await f.client.run(request({requestId:'second',prompt:'Check a different post.'}));const created=f.messages.filter(message=>message.method==='session/new'),prompts=f.messages.filter(message=>message.method==='session/prompt');assert.equal(created.length,2);assert.notEqual(prompts[0].params.sessionId,prompts[1].params.sessionId);assert.deepEqual(prompts[1].params.prompt,[{type:'text',text:'Check a different post.'}]);assert.equal(prompts.some(message=>JSON.stringify(message).includes('previous')),false);
});
test('server working directories accept Windows and Mac paths without exposing them in status',async()=>{
  for(const cwd of ['C:\\SuperX\\Sample User','/Users/sample user/Library/SuperX']){const f=fixture({cwd}),status=await f.client.status();assert.equal(status.available,true);assert.equal(f.messages.find(message=>message.method==='session/new').params.cwd,cwd);assert.equal(JSON.stringify(status).includes(cwd),false);}
  for(const cwd of ['relative/folder','C:relative','/tmp/evil\npath']){const f=fixture({cwd}),status=await f.client.status();assert.equal(status.errorCode,'BUILD_PROTOCOL_ERROR');assert.equal(f.messages.some(message=>message.method==='session/new'),false);}
});
test('failed status cleanup reports uncertainty and retains the session for control-only cleanup retry',async()=>{
  const f=fixture({wrongEffort:true,cleanupFalse:true});const status=await f.client.status();assert.equal(status.errorCode,'BUILD_CANCEL_UNCONFIRMED');assert.equal(f.client.sessionIds.size,1);f.transport.cleanupSession=async()=>({confirmed:true});assert.equal((await f.client.close()).confirmed,true);assert.equal(f.client.sessionIds.size,0);assert.equal(f.messages.some(message=>message.method==='session/prompt'),false);
});
test('a throttled reader chunk is flushed on disconnect without publishing thought or tool content',async()=>{
  const f=fixture({holdPrompt:true}),updates=[],pending=f.client.run(request(),{onUpdate:value=>updates.push(value)});await tick();f.client.fail(Object.assign(new Error('Disconnected'),{code:'BUILD_DISCONNECTED'}));await assert.rejects(pending,{code:'BUILD_DISCONNECTED'});assert.equal(updates.at(-1).text,'The claim is supported.');assert.equal(JSON.stringify(updates).includes('PRIVATE_REASONING'),false);
});
