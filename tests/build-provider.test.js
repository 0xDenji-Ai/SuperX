'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Build=require('../extension/build-provider.js');
const API=require('../extension/api-provider.js');
const Core=require('../extension/feed-core.js');
const post={id:'123',url:'https://x.com/author/status/123',text:'The release date is next week.',language:'en',quotedContext:[]};
const settings={...Core.DEFAULT_SETTINGS,provider:'build',language:'en'};
function nativeMock(onPost=()=>{}) {
  const listeners=[],disconnects=[],messages=[],hosts=[];
  const port={onMessage:{addListener(fn){listeners.push(fn);}},onDisconnect:{addListener(fn){disconnects.push(fn);}},postMessage(message){messages.push(message);onPost(message,port);},
    emit(message){for(const listener of listeners)listener(message);},disconnect(error){port.error=error;for(const listener of disconnects)listener();}};
  const connect=host=>{hosts.push(host);return port;};
  return {port,messages,hosts,connect};
}
function reply(port,message,type,extra={}) {port.emit({type,protocolVersion:1,requestId:message.requestId,...extra});}
function result(port,message,extra={}) {reply(port,message,'RESULT',{text:'The release date remains unconfirmed.',...extra});}
const usage={input_tokens:20,output_tokens:10,total_tokens:30,cost_in_usd_ticks:0,server_side_tool_usage_details:{web_search_calls:1}};
test('canonical Chrome forbidden-host errors request permission instead of reinstalling',async()=>{
  const client=Build.create({nativeConnect(){throw new Error('Access to the specified native messaging host is forbidden.');}});
  const status=await client.status();assert.equal(status.errorCode,'BUILD_PERMISSION_REQUIRED');assert.equal(status.available,false);
});

test('one native verify request shares API business rules with independent Build model and no credential',async()=>{
  const mock=nativeMock((message,port)=>{if(message.type==='RUN')result(port,message,{searched:true,usage,usageComplete:true,model:'grok-4.7-build'});});
  const input={...settings,apiModel:'grok-4.3',apiReasoningEffort:'none',buildModel:'grok-4.7',buildReasoningEffort:'high',explanationMode:'custom',verifyPrompt:'Check the exact date.'};
  const updates=[],output=await Build.run(post,input,{nativeConnect:mock.connect,onUpdate:value=>updates.push(value)});
  assert.equal(mock.messages.length,1);assert.deepEqual(mock.hosts,['com.superx.grok']);
  const request=mock.messages[0];
  assert.equal(request.type,'RUN');assert.equal(request.task,'verify');assert.equal(request.transport,'acp');assert.equal(request.model,'grok-4.7');assert.equal(request.effort,'high');assert.equal(request.protocolVersion,1);
  assert.match(request.requestId,/^sx-[A-Za-z0-9-]{1,76}$/);assert.ok(request.requestId.length<=80);
  const expected=API.buildRequest(post,{...input,provider:'api',apiModel:input.buildModel,apiReasoningEffort:input.buildReasoningEffort},'verify');
  assert.equal(request.prompt,expected.instructions+'\n\n'+expected.input.map(item=>item.content).join('\n\n'));
  assert.equal(request.webSearch,true);assert.equal(request.xSearch,true);assert.equal(Object.hasOwn(request,'apiKey'),false);assert.equal(Object.hasOwn(request,'outputSchema'),false);
  assert.equal(output.provider,'build');assert.equal(output.task,'verify');assert.equal(output.apiVerification,'only');assert.equal(output.verificationStatus,'completed');assert.equal(output.verified,false);
  assert.deepEqual(output.usageByStage,{verify:usage});assert.deepEqual(output.modelByStage,{verify:'grok-4.7-build'});assert.equal(output.usageComplete,true);
  assert.ok(updates.every(update=>update.phase==='verify'&&update.provider==='build'));
});

test('persistent port reuses one bridge and attributes interleaved jobs using extension IDs',async()=>{
  const mock=nativeMock();
  const first=Build.run(post,settings,{nativeConnect:mock.connect});
  const second=Build.run({...post,id:'124',url:'https://x.com/author/status/124'},settings,{nativeConnect:mock.connect});
  assert.equal(mock.hosts.length,1);assert.equal(mock.messages.length,2);assert.notEqual(mock.messages[0].requestId,mock.messages[1].requestId);
  reply(mock.port,{requestId:'not-an-active-request'},'RESULT',{text:'Unattributed answer.'});
  result(mock.port,mock.messages[1],{text:'Second finding.'});result(mock.port,mock.messages[0],{text:'First finding.'});
  assert.equal((await first).text,'First finding.');assert.equal((await second).text,'Second finding.');
});

test('reported search evidence and sources are sanitized independently of generated links',async()=>{
  const mock=nativeMock((message,port)=>result(port,message,{text:'See https://example.com/evidence for context.',sources:[{url:'javascript:alert(1)',title:'bad'},{url:'https://user:password@example.com/a'},{url:'https://example.com/a',title:'Primary source'},{url:'https://example.com/a',title:'Duplicate'}],usage:{total_tokens:1,negative:-1},model:'<script>secret</script>'}));
  const output=await Build.run(post,settings,{nativeConnect:mock.connect});
  assert.equal(output.searched,false);assert.equal(output.verificationStatus,'unverified');assert.deepEqual(output.sources,[{url:'https://example.com/a',title:'Primary source'}]);
  assert.deepEqual(output.usage,{total_tokens:1});assert.equal(output.model,undefined);assert.equal(output.usageComplete,false);
});

test('update metadata snapshots replace counts and actual search persists without inferred tool use',async()=>{
  const mock=nativeMock((message,port)=>{
    reply(port,message,'UPDATE',{text:'Checking the date.',usage:{total_tokens:4},model:'actual-model',searched:true});
    reply(port,message,'UPDATE',{text:'The date remains unconfirmed.',usage:{total_tokens:6}});
    result(port,message,{usage:{total_tokens:9},usageComplete:true});
  });
  const updates=[],output=await Build.run(post,settings,{nativeConnect:mock.connect,onUpdate:update=>updates.push(update)});
  assert.equal(output.usage.total_tokens,9);assert.equal(output.model,'actual-model');assert.equal(output.searched,true);assert.equal(output.usageComplete,true);
  assert.deepEqual(updates.slice(1).map(update=>update.usage.total_tokens),[4,6]);
});

test('empty or malformed native metadata cannot erase a previously reported usage snapshot',async()=>{
  const mock=nativeMock((message,port)=>{
    reply(port,message,'UPDATE',{text:'A provisional fact-check.',usage,model:'actual-model'});
    reply(port,message,'ERROR',{code:'BUILD_DISCONNECTED',usage:null,model:'<invalid>'});
  });
  await assert.rejects(Build.run(post,settings,{nativeConnect:mock.connect}),error=>error.code==='BUILD_DISCONNECTED'&&error.usage.total_tokens===30&&error.model==='actual-model'&&error.partialResult?.usage.total_tokens===30);
});

test('comments share strict three-comment rules and no search is requested or claimed',async()=>{
  const comments=['What evidence confirms the date?','The timing could affect the rollout.','An official announcement would help.'];
  const mock=nativeMock((message,port)=>result(port,message,{text:JSON.stringify(comments),searched:true,usage,usageComplete:true,model:'build-comments'}));
  const output=await Build.generateComments(post,settings,{nativeConnect:mock.connect,analysis:{text:'Earlier finding.'}});
  assert.deepEqual(output.comments,comments);assert.equal(output.provider,'build');assert.equal(output.searched,false);assert.equal(output.verified,false);
  const request=mock.messages[0];assert.equal(request.task,'comments');assert.equal(request.webSearch,false);assert.equal(request.xSearch,false);
  assert.deepEqual(request.outputSchema,{type:'array',minItems:3,maxItems:3,items:{type:'string',minLength:1,maxLength:280}});
  assert.match(request.prompt,/Return only a JSON array of three nonempty strings/);assert.match(request.prompt,/No search tools are available/);assert.match(request.prompt,/Earlier finding/);
  assert.deepEqual(output.usageByStage,{comments:usage});
});

test('invalid comments never become finished drafts and retain real server metadata',async()=>{
  for(const text of ['["Same","Same","Different"]','["one","two"]','```json\n["one","two","three"]\n```','["first\\nsecond","two","three"]']) {
    const mock=nativeMock((message,port)=>result(port,message,{text,usage,usageComplete:true,model:'actual'}));
    await assert.rejects(Build.generateComments(post,settings,{nativeConnect:mock.connect}),error=>error.code==='COMMENTS_INVALID_RESPONSE'&&error.usage.total_tokens===30&&error.model==='actual');
  }
});

test('no missing, empty, tool-only or incomplete terminal output can resurrect a streamed answer',async()=>{
  for(const terminal of [{},{text:''},{text:'   '},{text:'{"absolute_path":"web_search","query":"date"}'},{text:'Partial result.',status:'incomplete'}]) {
    const mock=nativeMock((message,port)=>{reply(port,message,'UPDATE',{text:'Earlier provisional prose.',usage});reply(port,message,'RESULT',terminal);});
    await assert.rejects(Build.run(post,settings,{nativeConnect:mock.connect}),error=>error.code==='BUILD_OUTPUT_INVALID'&&(!error.partialResult||error.partialResult.verificationStatus==='incomplete'));
    assert.equal(mock.messages.filter(message=>message.type==='RUN').length,1);
  }
});

test('language guard is shared and rejected language never becomes a retained partial result',async()=>{
  const mock=nativeMock((message,port)=>result(port,message,{text:'This is a long English sentence with enough lowercase letters to demonstrate an obvious change of writing system.',usage,model:'actual'}));
  await assert.rejects(Build.run({...post,text:'这是中文原帖内容。',language:'zh-CN'},{...settings,language:'auto'},{nativeConnect:mock.connect}),error=>error.code==='BUILD_LANGUAGE_MISMATCH'&&!error.partialText&&error.usage.total_tokens===30);
  const request=mock.messages[0];assert.match(request.prompt,/Respond in Simplified Chinese/);
});

test('language drift found in an unfinished final snapshot still retains actual usage',async()=>{
  const mock=nativeMock((message,port)=>{
    reply(port,message,'UPDATE',{text:'this unfinished english prose has enough lowercase letters to demonstrate a clear script change',usage,model:'actual'});
    if(message.type==='RUN')port.disconnect({message:'Local process ended'});
  });
  await assert.rejects(Build.run({...post,text:'这是中文原帖内容。',language:'zh-CN'},{...settings,language:'auto'},{nativeConnect:mock.connect}),error=>error.code==='BUILD_LANGUAGE_MISMATCH'&&!error.partialText&&!error.partialResult&&error.usage.total_tokens===30&&error.model==='actual');
});

test('abort forwards only the original request ID and preserves usage without canceled reader output',async()=>{
  const mock=nativeMock(),controller=new AbortController();
  const output=Build.run(post,settings,{nativeConnect:mock.connect,signal:controller.signal});
  const request=mock.messages[0];reply(mock.port,request,'UPDATE',{text:'A provisional finding.',usage,model:'actual'});
  controller.abort();
  await assert.rejects(output,error=>error.code==='CANCELED'&&error.name==='AbortError'&&error.usage.total_tokens===30&&error.model==='actual'&&!error.partialText&&!error.partialResult);
  assert.deepEqual(mock.messages[1],{protocolVersion:1,type:'CANCEL',requestId:request.requestId});
  result(mock.port,request,{text:'Late answer.'});assert.equal(mock.messages.length,2);
  const preaborted=new AbortController();preaborted.abort();await assert.rejects(Build.run(post,settings,{nativeConnect:mock.connect,signal:preaborted.signal}),{code:'CANCELED'});assert.equal(mock.messages.length,2);
});

test('disconnect keeps actual partial text incomplete and reconnects only for a later explicit request',async()=>{
  const mock=nativeMock();const output=Build.run(post,settings,{nativeConnect:mock.connect});
  reply(mock.port,mock.messages[0],'UPDATE',{text:'A provisional fact-check.',usage,model:'actual',searched:true});mock.port.disconnect({message:'Untrusted native host path C:\\secret token=hidden'});
  await assert.rejects(output,error=>error.code==='BUILD_DISCONNECTED'&&error.partialResult?.verificationStatus==='incomplete'&&error.partialResult.text==='A provisional fact-check.'&&error.usage.total_tokens===30&&!error.message.includes('secret'));
  assert.equal(mock.hosts.length,1);assert.equal(mock.messages.length,1);
  const next=Build.run(post,settings,{nativeConnect:mock.connect});result(mock.port,mock.messages[1]);await next;assert.equal(mock.hosts.length,2);
});

test('timeout cancels once with no automatic retry and preserves last native billing snapshot',async()=>{
  const mock=nativeMock((message,port)=>{if(message.type==='RUN')reply(port,message,'UPDATE',{text:'A provisional finding.',usage,model:'actual'});});
  const provider=Build.create({nativeConnect:mock.connect,timeoutMs:10,statusTimeoutMs:10});
  await assert.rejects(provider.run(post,settings),error=>error.code==='BUILD_TIMEOUT'&&error.usage.total_tokens===30&&error.partialResult?.verificationStatus==='incomplete');
  assert.deepEqual(mock.messages.map(message=>message.type),['RUN','CANCEL']);
});

test('host errors and arbitrary diagnostics are mapped without API-key errors or secrets',async()=>{
  for(const [code,expected] of [['BUILD_LOGIN_REQUIRED','BUILD_LOGIN_REQUIRED'],['BUILD_MODEL_UNSUPPORTED','BUILD_MODEL_UNSUPPORTED'],['BUILD_EFFORT_UNSUPPORTED','BUILD_EFFORT_UNSUPPORTED'],['BUILD_QUOTA','RATE_LIMIT'],['NEEDS_KEY','BUILD_UNAVAILABLE'],['token=secret','BUILD_UNAVAILABLE']]) {
    const mock=nativeMock((message,port)=>reply(port,message,'ERROR',{code,message:'token=secret',usage,model:'actual'}));
    await assert.rejects(Build.run(post,settings,{nativeConnect:mock.connect}),error=>error.code===expected&&!error.message.includes('secret')&&error.usage.total_tokens===30);
  }
  assert.deepEqual(Build.publicError({code:'NEEDS_KEY',message:'token=secret'}),{code:'BUILD_UNAVAILABLE',error:'Grok Build is unavailable. Check its local installation and configuration.'});
});

test('status probes report connection, permissions, authentication and negotiated models without a prompt',async()=>{
  const mock=nativeMock((message,port)=>reply(port,message,'STATUS',{installed:true,available:true,authenticated:false,version:'0.3.1',modelCatalog:['grok-4.7',{id:'grok-4.6',available:false,efforts:['low','high','invalid']},{id:'<unsafe>'}],apiKey:'hidden'}));
  const output=await Build.status({nativeConnect:mock.connect});
  assert.deepEqual(output,{connected:true,permission:'granted',installed:true,available:true,authenticated:false,version:'0.3.1',modelCatalog:[{id:'grok-4.7'},{id:'grok-4.6',available:false,efforts:['low','high']}]});
  assert.equal(mock.messages.length,1);assert.equal(mock.messages[0].type,'STATUS');assert.equal(Object.hasOwn(mock.messages[0],'prompt'),false);assert.equal(Object.hasOwn(output,'apiKey'),false);
  const missing=await Build.status({nativeConnect(){throw new Error('Specified native messaging host not found: C:\\private');}});
  assert.equal(missing.errorCode,'BUILD_NATIVE_MISSING');assert.equal(missing.connected,false);assert.equal(missing.installed,false);assert.equal(Object.hasOwn(missing,'authenticated'),false);
  const denied=await Build.status({nativeConnect(){throw new Error('Access forbidden nativeMessaging permission');}});
  assert.equal(denied.errorCode,'BUILD_PERMISSION_REQUIRED');assert.equal(denied.permission,'denied');
});

test('malformed protocol responses fail closed and valid unavailable model is sent unchanged for host rejection',async()=>{
  const mock=nativeMock((message,port)=>reply(port,message,'ERROR',{code:'BUILD_MODEL_UNSUPPORTED'}));
  await assert.rejects(Build.run(post,{...settings,buildModel:'grok-4.3'},{nativeConnect:mock.connect}),{code:'BUILD_MODEL_UNSUPPORTED'});
  assert.equal(mock.messages[0].model,'grok-4.3');assert.equal(mock.messages.length,1);
  const bad=nativeMock((message,port)=>reply(port,message,'RESULT',{protocolVersion:99,text:'Ignored answer.'}));
  await assert.rejects(Build.run(post,settings,{nativeConnect:bad.connect}),{code:'BUILD_PROTOCOL_ERROR'});
  const oversized=nativeMock((message,port)=>{if(message.type==='RUN')reply(port,message,'RESULT',{text:'x'.repeat(1000001)});});
  await assert.rejects(Build.run(post,settings,{nativeConnect:oversized.connect}),{code:'BUILD_PROTOCOL_ERROR'});
  assert.deepEqual(oversized.messages.map(message=>message.type),['RUN','CANCEL']);
  const custom=nativeMock((message,port)=>result(port,message,{model:message.model}));
  await Build.run(post,{...settings,buildModel:'grok-4.7-build-fast',buildReasoningEffort:'medium'},{nativeConnect:custom.connect});
  assert.equal(custom.messages[0].model,'grok-4.7-build-fast');assert.equal(custom.messages[0].effort,'medium');
});

test('invalid input and absent search are rejected before any native prompt or connection',async()=>{
  const mock=nativeMock();
  await assert.rejects(Build.run({...post,url:'https://example.com'},settings,{nativeConnect:mock.connect}),{code:'POST_INVALID'});
  await assert.rejects(Build.run(post,{...settings,webSearch:false,xSearch:false},{nativeConnect:mock.connect}),{code:'URL_SEARCH_REQUIRED'});
  assert.equal(mock.messages.length,0);assert.equal(mock.hosts.length,0);
});

test('bounded native work rejects overflow and aborted slots cannot complete late',async()=>{
  const mock=nativeMock(),provider=Build.create({nativeConnect:mock.connect});
  const controllers=Array.from({length:16},()=>new AbortController());
  const pending=controllers.map(controller=>provider.run(post,settings,{signal:controller.signal}).catch(error=>error));
  await assert.rejects(provider.run(post,settings),{code:'BUILD_LIMIT'});
  assert.equal(mock.messages.length,16);assert.equal(mock.hosts.length,1);
  for(const controller of controllers)controller.abort();
  for(const outcome of await Promise.all(pending))assert.equal(outcome.code,'CANCELED');
  assert.equal(mock.messages.filter(message=>message.type==='CANCEL').length,16);
  const next=provider.run(post,settings),request=mock.messages.at(-1);result(mock.port,request);assert.equal((await next).verificationStatus,'unverified');
});

test('a connected status error preserves installation evidence without claiming authentication',async()=>{
  const mock=nativeMock((message,port)=>reply(port,message,'ERROR',{code:'BUILD_LOGIN_REQUIRED',message:'private auth output'}));
  const status=await Build.status({nativeConnect:mock.connect});
  assert.deepEqual(status,{connected:true,permission:'granted',installed:true,available:false,authenticated:false,errorCode:'BUILD_LOGIN_REQUIRED'});
});
