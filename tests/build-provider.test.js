'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Build=require('../extension/build-provider.js'),API=require('../extension/api-provider.js'),Core=require('../extension/feed-core.js');
const {wsFixture,connection,tick}=require('./build-ws-fixture.js');
const post={id:'123',url:'https://x.com/author/status/123',text:'The release date is next week.',language:'en',quotedContext:[]};
const settings={...Core.DEFAULT_SETTINGS,provider:'build',language:'en'};
function fixture(behavior={}){const mock=wsFixture(behavior),provider=Build.create({connection,webSocketFactory:mock.factory,requestTimeoutMs:50,openTimeoutMs:50});return {...mock,provider};}
const prompts=f=>f.messages.filter(message=>message.method==='session/prompt');

test('local Build checks unpublished draft text with the same rules and draft-language precedence',async()=>{
  for(const explanationMode of ['preset','custom']){
    const text='PHP 是否最好取决于用途，不能得出普遍适用的排名。',f=fixture({text});
    const draft={kind:'draft',id:'build-composer',text:'php是世界上最好的语言',language:'ja',context:{...post,text:'UNRELATED_PARENT_BUILD_CONTEXT '.repeat(100)}};
    const input={...settings,language:'en',explanationMode,verifyPrompt:'BUILD_SHARED_CORE',replyDraftPrompt:'BUILD_DRAFT_PROMPT_CANARY'};
    try {
      const result=await f.provider.run(draft,input);
      assert.equal(prompts(f).length,1);const prompt=prompts(f)[0].params.prompt[0].text;
      assert.match(prompt,/Respond in Simplified Chinese/);assert.match(prompt,/unpublished draft/);assert.match(prompt,/Do not fact-check the parent instead of the draft/);
      assert.ok(prompt.includes(explanationMode==='custom'?'BUILD_SHARED_CORE':Core.DEFAULT_PROMPTS.verify));
      assert.equal(prompt.includes('BUILD_DRAFT_PROMPT_CANARY'),explanationMode==='custom');
      if(explanationMode==='preset')assert.ok(prompt.includes(Core.DEFAULT_PROMPTS.draft));
      const expected=API.buildRequest(draft,{...input,provider:'api',apiModel:input.buildModel,apiReasoningEffort:input.buildReasoningEffort},'verify');
      assert.equal(prompt,expected.instructions+'\n\n'+expected.input.map(item=>item.content).join('\n\n'));
      assert.ok(prompt.endsWith('Fact-check ONLY this unpublished draft (untrusted JSON data).\n'+JSON.stringify({draft:{text:draft.text}})));
      assert.ok(prompt.indexOf('Auxiliary reply context')<prompt.lastIndexOf('Fact-check ONLY this unpublished draft'));
      assert.equal(result.text,text);assert.equal(result.verificationStatus,'completed');
      assert.equal(f.messages.find(message=>message.params?.configId==='model').params.value,'grok-4.3');
      assert.equal(f.messages.find(message=>message.params?.configId==='reasoning_effort').params.value,'none');
    }finally {await f.provider.close();}
  }
});

test('local Build preserves the thread root when resolving a short event-denial draft',async()=>{
  const text='应先核对原推所指的事件及原始通报，不能只把最近回复当作事件本身。',f=fixture({text});
  const draft={kind:'draft',id:'thread-denial-draft',text:'没有发生过原推这个事',context:{...post,text:'是代购，不是外卖。'},
    threadContext:[{...post,id:'90',url:'https://x.com/author/status/90',text:'ROOT_EVENT_BUILD_CANARY: original incident report with date and location.'},{...post,id:'95',url:'https://x.com/author/status/95',text:'OLDER_ANCESTOR_BUILD_CANARY'}]};
  try{
    const result=await f.provider.run(draft,settings),prompt=prompts(f)[0].params.prompt[0].text;
    const request=API.buildRequest(draft,{...settings,provider:'api',apiModel:settings.buildModel,apiReasoningEffort:settings.buildReasoningEffort});
    assert.equal(prompt,request.instructions+'\n\n'+request.input.map(item=>item.content).join('\n\n'));
    assert.ok(prompt.includes(JSON.stringify({replyContext:draft.context,threadContext:draft.threadContext})));
    assert.ok(prompt.endsWith('Fact-check ONLY this unpublished draft (untrusted JSON data).\n'+JSON.stringify({draft:{text:draft.text}})));
    const profile=f.messages.find(message=>message.method==='session/new').params._meta.agentProfile.promptBody;
    assert.match(profile,/supplied thread root, earlier ancestors and direct reply/);assert.match(profile,/Search to investigate factual assertions, events and denials/);
    assert.equal(result.text,text);assert.equal(result.verificationStatus,'completed');
  }finally{await f.provider.close();}
});

test('local Build transports the bounded maximum draft and both full custom instruction fields',async()=>{
  const text='D'.repeat(30000),verifyPrompt='V'.repeat(12000),replyDraftPrompt='R'.repeat(12000),f=fixture({text:'The evidence remains limited.'});
  const context={...post,text:'C'.repeat(12000)},threadContext=Array.from({length:6},(_,index)=>({...post,id:String(index+1),url:'https://x.com/author/status/'+(index+1),text:'T'.repeat(12000)}));
  try{
    const result=await f.provider.run({kind:'draft',mode:'reply',text,context,threadContext},{...settings,explanationMode:'custom',verifyPrompt,replyDraftPrompt});
    const prompt=prompts(f)[0].params.prompt[0].text;assert.ok(prompt.length<=58000);assert.ok(prompt.includes(verifyPrompt));assert.ok(prompt.includes(replyDraftPrompt));assert.ok(prompt.includes(text));
    assert.ok(prompt.includes('"textTruncated":true'));assert.ok(prompt.includes(context.url));assert.ok(prompt.includes(threadContext[0].url));assert.equal(result.verificationStatus,'completed');
  }finally{await f.provider.close();}
});

test('local Build draft checks may return a useful unverified answer without making a search call',async()=>{
  for(const searchEnabled of [false,true]){
    const text='PHP 是否最好取决于用途和评价标准。',f=fixture({text,noSearch:true});
    try{
      const result=await f.provider.run({kind:'draft',id:'no-search-draft',text:'php是世界上最好的语言'},
        {...settings,webSearch:searchEnabled,xSearch:searchEnabled});
      assert.equal(result.text,text);assert.equal(result.provider,'build');assert.equal(result.searched,false);assert.equal(result.verificationStatus,'unverified');
      assert.equal(prompts(f).length,1);assert.equal(f.messages.find(message=>message.method==='session/new').params._meta.agentProfile.promptBody.includes('only fact-check target'),true);
      assert.equal(f.messages.some(message=>message.method==='session/cancel'),false);
    }finally{await f.provider.close();}
  }
});

test('official local Fact Check shares API business rules with independent Build model and no API credential',async()=>{
  const f=fixture({actualModel:'grok-4.7-resolved'}),input={...settings,apiModel:'grok-4.3',apiReasoningEffort:'none',buildModel:'grok-4.7',buildReasoningEffort:'high',explanationMode:'custom',verifyPrompt:'Check the exact date.'},updates=[];
  try{const output=await f.provider.run(post,input,{onUpdate:value=>updates.push(value)});assert.equal(f.urls.length,1);assert.match(f.urls[0],/^ws:\/\/127\.0\.0\.1:2419\/ws\?server-key=/);
    assert.equal(prompts(f).length,1);const sent=prompts(f)[0],expected=API.buildRequest(post,{...input,provider:'api',apiModel:input.buildModel,apiReasoningEffort:input.buildReasoningEffort},'verify');
    assert.equal(sent.params.prompt[0].text,expected.instructions+'\n\n'+expected.input.map(item=>item.content).join('\n\n'));
    assert.equal(JSON.stringify(sent).includes(connection.secret),false);assert.equal(Object.hasOwn(sent.params,'apiKey'),false);
    assert.equal(f.messages.find(message=>message.params?.configId==='model').params.value,'grok-4.7');assert.equal(f.messages.find(message=>message.params?.configId==='reasoning_effort').params.value,'high');
    assert.equal(output.provider,'build');assert.equal(output.apiVerification,'only');assert.equal(output.verificationStatus,'completed');assert.equal(output.verified,false);assert.equal(output.model,'grok-4.7-resolved');assert.equal(output.usage.total_tokens,30);assert.equal(output.usageComplete,true);
    assert.deepEqual(output.usageByStage,{verify:{input_tokens:20,output_tokens:10,total_tokens:30}});assert.ok(updates.every(update=>update.phase==='verify'&&update.provider==='build'));assert.equal(JSON.stringify(output).includes('PRIVATE_REASONING'),false);
  }finally{await f.provider.close();}
});

test('one official socket is reused while posts retain independent sessions and no conversation history',async()=>{
  const f=fixture();try{await f.provider.run(post,settings);await f.provider.run({...post,id:'124',url:'https://x.com/author/status/124'},settings);assert.equal(f.urls.length,1);assert.equal(prompts(f).length,2);assert.notEqual(prompts(f)[0].params.sessionId,prompts(f)[1].params.sessionId);assert.equal(f.messages.filter(message=>message.method==='session/close').length,2);}finally{await f.provider.close();}
});

test('default local checks explicitly request Grok 4.3 and none without silently choosing another reasoning level',async()=>{
  const f=fixture();try{const output=await f.provider.run(post,settings);
    assert.equal(settings.buildModel,'grok-4.3');assert.equal(settings.buildReasoningEffort,'none');assert.equal(output.model,'grok-4.3');
    assert.equal(f.messages.find(message=>message.params?.configId==='model').params.value,'grok-4.3');assert.equal(f.messages.find(message=>message.params?.configId==='reasoning_effort').params.value,'none');assert.equal(prompts(f).length,1);
  }finally{await f.provider.close();}
});

test('local status preserves none and minimal as distinct advertised reasoning choices',async()=>{
  const f=fixture({efforts:['none','minimal','low','high']});try{const output=await f.provider.status();
    assert.equal(output.available,true);assert.deepEqual(output.modelCatalog.find(model=>model.id==='grok-4.3').efforts,['none','minimal','low','high']);assert.equal(prompts(f).length,0);
  }finally{await f.provider.close();}
});

test('the explicit current none value survives a CLI fallback menu that omits none',async()=>{
  const behavior={currentEffort:'none',efforts:['minimal','low','high']},f=fixture(behavior);try{
    const output=await f.provider.run(post,settings);assert.equal(output.model,'grok-4.3');assert.equal(prompts(f).length,1);
    assert.equal(f.messages.some(message=>message.params?.configId==='reasoning_effort'),false);
  }finally{await f.provider.close();}
  const g=fixture(behavior);try{const status=await g.provider.status(),efforts=status.modelCatalog.find(model=>model.id==='grok-4.3').efforts;
    assert.equal(status.available,true);assert.ok(efforts.includes('none'));assert.ok(efforts.includes('minimal'));assert.equal(prompts(g).length,0);
  }finally{await g.provider.close();}
});

test('an unadvertised none default fails without a cloud prompt while explicit minimal remains independent',async()=>{
  for(const efforts of [['low','medium','high'],['minimal','low','high']]){const f=fixture({efforts});try{
    await assert.rejects(f.provider.run(post,settings),{code:'BUILD_EFFORT_UNSUPPORTED'});assert.equal(prompts(f).length,0);assert.equal(f.messages.some(message=>message.params?.configId==='reasoning_effort'),false);
  }finally{await f.provider.close();}}
  const f=fixture({efforts:['minimal','low','high']});try{await f.provider.run(post,{...settings,buildReasoningEffort:'minimal'});
    assert.equal(f.messages.find(message=>message.params?.configId==='reasoning_effort').params.value,'minimal');assert.equal(prompts(f).length,1);
  }finally{await f.provider.close();}
});

test('hosted source URLs and provider counts are sanitized without inferring retrieval from answer links',async()=>{
  const f=fixture({sources:[{url:'javascript:alert(1)',title:'bad'},{url:'https://user:pass@example.com/a'},{url:'https://example.com/a?token=SECRET&ok=1',title:'Primary'},{url:'https://example.com/a?ok=1',title:'Duplicate'}],usage:{inputTokens:20,outputTokens:10,totalTokens:30,costUsd:123},text:'See https://example.com/evidence.'});
  try{const output=await f.provider.run(post,settings);assert.equal(output.searched,true);assert.deepEqual(output.sources,[{url:'https://example.com/a?ok=1',title:'Primary'}]);assert.equal(Object.hasOwn(output.usage,'costUsd'),false);assert.equal(JSON.stringify(output).includes('SECRET'),false);}finally{await f.provider.close();}
  const noSearch=fixture({noSearch:true,text:'Sources checked: https://example.com.'});try{await assert.rejects(noSearch.provider.run(post,settings),error=>error.code==='BUILD_SEARCH_NOT_PERFORMED'&&error.partialResult?.verificationStatus==='incomplete'&&error.usage.total_tokens===30);assert.equal(prompts(noSearch).length,1);}finally{await noSearch.provider.close();}
});

test('comments retain strict three-comment schema with no hosted or local tools',async()=>{
  const comments=['What evidence confirms the date?','The timing could affect the rollout.','An official announcement would help.'];const f=fixture({structured:comments});
  try{const output=await f.provider.generateComments(post,settings,{analysis:{text:'Earlier finding.'}});assert.deepEqual(output.comments,comments);assert.equal(output.searched,false);assert.equal(output.verified,false);assert.equal(output.provider,'build');
    const sent=prompts(f)[0];assert.deepEqual(sent.params._meta.outputSchema,{type:'array',minItems:3,maxItems:3,items:{type:'string',minLength:1,maxLength:280}});assert.match(sent.params.prompt[0].text,/Return only a JSON array of three nonempty strings/);assert.match(sent.params.prompt[0].text,/No search tools are available/);assert.match(sent.params.prompt[0].text,/Earlier finding/);assert.equal([...f.sessionProfiles.values()][0].name,'superx-none');assert.deepEqual(output.usageByStage,{comments:{input_tokens:20,output_tokens:10,total_tokens:30}});
  }finally{await f.provider.close();}
});

test('invalid comments fail without repair, retries or discarding actual usage',async()=>{
  for(const text of ['["Same","Same","Different"]','["one","two"]','```json\n["one","two","three"]\n```','["first\\nsecond","two","three"]']){const f=fixture({text});try{await assert.rejects(f.provider.generateComments(post,settings),error=>error.code==='BUILD_OUTPUT_INVALID'&&error.usage.total_tokens===30);assert.equal(prompts(f).length,1);}finally{await f.provider.close();}}
});

test('empty and tool-only ACP output never becomes a completed answer',async()=>{
  for(const text of ['','   ','{"absolute_path":"web_search","query":"date"}']){const f=fixture({text});try{await assert.rejects(f.provider.run(post,settings),error=>error.code==='BUILD_OUTPUT_INVALID'&&!error.partialResult);assert.equal(prompts(f).length,1);}finally{await f.provider.close();}}
});

test('tool-command prefixes stay out of streamed reader output',async()=>{
  const f=fixture({chunks:['{"absolute_','path":"web_search","query":"date"}']}),updates=[];try{await assert.rejects(f.provider.run(post,settings,{onUpdate:update=>updates.push(update)}),{code:'BUILD_OUTPUT_INVALID'});assert.ok(updates.every(update=>!update.text));}finally{await f.provider.close();}
});

test('language guard follows displayed post language and excludes incorrect-language partial output',async()=>{
  const f=fixture({text:'This is a long English sentence with enough lowercase letters to demonstrate an obvious change of writing system.'});
  try{await assert.rejects(f.provider.run({...post,text:'这是中文原帖内容。',language:'zh-CN'},{...settings,language:'auto'}),error=>error.code==='BUILD_LANGUAGE_MISMATCH'&&!error.partialText&&!error.partialResult&&error.usage.total_tokens===30);assert.match(prompts(f)[0].params.prompt[0].text,/Respond in Simplified Chinese/);}finally{await f.provider.close();}
});

test('abort requests cancellation and retains measured usage without canceled reader prose',async()=>{
  const f=fixture({holdPrompt:true}),controller=new AbortController();try{const pending=f.provider.run(post,settings,{signal:controller.signal});await tick();controller.abort();await assert.rejects(pending,error=>error.code==='CANCELED'&&error.name==='AbortError'&&error.usage.total_tokens===30&&!error.partialText&&!error.partialResult);assert.equal(f.messages.filter(message=>message.method==='session/cancel').length>=1,true);assert.equal(prompts(f).length,1);
    const previous=f.messages.length,preaborted=new AbortController();preaborted.abort();await assert.rejects(f.provider.run(post,settings,{signal:preaborted.signal}),{code:'CANCELED'});assert.equal(f.messages.length,previous);
  }finally{await f.provider.close();}
});

test('disconnect retains an actual partial finding and reconnects only to cancel or on a later user request',async()=>{
  const f=fixture({disconnectPrompt:true});try{await assert.rejects(f.provider.run(post,settings),error=>error.code==='BUILD_DISCONNECTED'&&error.partialResult?.verificationStatus==='incomplete'&&error.partialResult.text==='The date remains unconfirmed.'&&error.usage.total_tokens===30);assert.equal(prompts(f).length,1);assert.equal(f.urls.length,2,'The second socket is control-only cleanup');assert.equal(f.messages.filter(message=>message.method==='session/close').length,1);assert.equal(f.messages.filter(message=>message.method==='session/cancel').length,1);}finally{await f.provider.close();}
});

test('an unconfirmed cancellation remains visible rather than claiming the official task stopped',async()=>{
  const f=fixture({cleanupError:true});try{await assert.rejects(f.provider.run(post,settings),error=>error.code==='BUILD_CANCEL_UNCONFIRMED'&&error.usage.total_tokens===30);assert.equal(prompts(f).length,1);}finally{await f.provider.close();}
});

test('official upstream errors are sanitized and never trigger an API route or paid retry',async()=>{
  for(const [message,code]of [['quota exceeded 429','RATE_LIMIT'],['Login required 401','BUILD_LOGIN_REQUIRED'],['PRIVATE_OTHER','BUILD_PROTOCOL_ERROR']]){const f=fixture({promptError:message});try{await assert.rejects(f.provider.run(post,settings),error=>error.code===code&&!error.message.includes('PRIVATE'));assert.equal(prompts(f).length,1);}finally{await f.provider.close();}}
  const publicError=Build.publicError({code:'NEEDS_KEY',message:'PRIVATE_KEY'});assert.equal(publicError.code,'BUILD_UNAVAILABLE');assert.equal(publicError.error.includes('PRIVATE_KEY'),false);
});

test('a zero-prompt connection check reports actual login and negotiated models without disclosing code or cwd',async()=>{
  const f=fixture({models:['grok-4.6','grok-4.7-build-fast'],currentModel:'grok-4.6'});try{const output=await f.provider.status();assert.equal(output.connected,true);assert.equal(output.available,true);assert.equal(output.authenticated,true);assert.equal(output.version,'1.0.60');assert.deepEqual(output.modelCatalog,[{id:'grok-4.6',efforts:['low','medium','high','xhigh']},{id:'grok-4.7-build-fast'}]);assert.equal(prompts(f).length,0);assert.equal(JSON.stringify(output).includes(connection.secret),false);assert.equal(JSON.stringify(output).includes('isolated SuperX'),false);}finally{await f.provider.close();}
  const loggedOut=fixture({noLogin:true});try{const output=await loggedOut.provider.status();assert.equal(output.errorCode,'BUILD_LOGIN_REQUIRED');assert.equal(output.authenticated,false);assert.equal(prompts(loggedOut).length,0);}finally{await loggedOut.provider.close();}
});

test('missing local connection and unavailable service have actionable non-API errors',async()=>{
  const missing=await Build.status();assert.equal(missing.errorCode,'BUILD_CONNECTION_REQUIRED');assert.equal(missing.connected,false);
  const f=fixture({openError:true});try{const output=await f.provider.status();assert.equal(output.errorCode,'BUILD_UNAVAILABLE');assert.equal(output.available,false);assert.equal(prompts(f).length,0);}finally{await f.provider.close();}
});

test('unsupported models, effort and runtime policy fail before any cloud prompt',async()=>{
  for(const [behavior,change,code]of [[{models:['grok-4.7']},{buildModel:'grok-4.3'},'BUILD_MODEL_UNSUPPORTED'],[{efforts:['high']},{},'BUILD_EFFORT_UNSUPPORTED'],[{version:'1.0.99'},{},'BUILD_VERSION_UNSUPPORTED'],[{localCount:1},{},'BUILD_TOOL_POLICY']]){const f=fixture(behavior);try{await assert.rejects(f.provider.run(post,{...settings,...change}),{code});assert.equal(prompts(f).length,0);}finally{await f.provider.close();}}
  const f=fixture();try{await f.provider.run(post,{...settings,buildModel:'grok-4.7-build-fast',buildReasoningEffort:'medium'});assert.equal(f.messages.find(message=>message.params?.configId==='model').params.value,'grok-4.7-build-fast');assert.equal(f.messages.find(message=>message.params?.configId==='reasoning_effort').params.value,'medium');}finally{await f.provider.close();}
});

test('invalid post input and missing retrieval switches fail before opening a local socket',async()=>{
  const f=fixture();try{await assert.rejects(f.provider.run({...post,url:'https://example.com'},settings),{code:'POST_INVALID'});await assert.rejects(f.provider.run(post,{...settings,webSearch:false,xSearch:false}),{code:'URL_SEARCH_REQUIRED'});assert.equal(f.urls.length,0);}finally{await f.provider.close();}
});

test('official connection runs one task at a time and rejects overlap without cross-attributing output',async()=>{
  const f=fixture({holdPrompt:true});try{const first=f.provider.run(post,settings);await tick();await assert.rejects(f.provider.run({...post,id:'124',url:'https://x.com/author/status/124'},settings),{code:'BUILD_BUSY'});assert.equal(prompts(f).length,1);f.finish();assert.equal((await first).text,'The date remains unconfirmed.');}finally{await f.provider.close();}
});
