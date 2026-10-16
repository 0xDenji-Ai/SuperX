'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const {encode,Decoder}=require('../connector/lib/framing.cjs');
const policy=require('../connector/lib/policy.cjs');
const profiles=require('../connector/lib/profiles.cjs');
const {Turn,metadataSources}=require('../connector/lib/updates.cjs');
const {Engine}=require('../connector/lib/engine.cjs');
const {killTree}=require('../connector/lib/process.cjs');
const {serve}=require('../connector/host.cjs');

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const request=(overrides={})=>policy.validateRequest({protocolVersion:1,type:'RUN',requestId:'job-1',task:'verify',transport:'acp',model:'grok-4.7',effort:'low',webSearch:false,xSearch:true,prompt:'Check this public post.',...overrides});
const fullOptions=(model='grok-4.7',effort='low',behavior={})=>[
  {id:'model',currentValue:model,options:behavior.models??[{value:'grok-4.7',name:'Grok 4.7'},{value:'grok-4.6',name:'Grok 4.6'}]},
  {id:'reasoning_effort',currentValue:effort,options:(behavior.efforts??['low','medium','high']).map(value=>({value}))},
];
function fakeRuntime(behavior={}) {
  const calls=[],messages=[],processes=[];let pid=3000,sid=0;
  function spawnImpl(exe,args,options) {
    const child=new EventEmitter();child.pid=++pid;child.stdout=new PassThrough();child.stderr=new PassThrough();child.closed=false;
    child.kill=signal=>{finish(null,signal);return true;};
    child.stdin=new Writable({write(chunk,encoding,callback){
      const line=chunk.toString();for(const raw of line.trim().split('\n'))if(raw){const m=JSON.parse(raw);messages.push(m);handle(m);}callback();
    }});
    child.stdin.on('finish',()=>{setImmediate(()=>finish(0));});
    const call={exe,args,options,child};calls.push(call);processes.push(child);
    const send=m=>{if(!child.closed)child.stdout.write(JSON.stringify(m)+'\n');};
    const reply=(m,result)=>send({jsonrpc:'2.0',id:m.id,result});
    function finish(code,signal=null){if(child.closed)return;child.closed=true;child.stdout.end();child.stderr.end();child.emit('close',code,signal);}
    let model=behavior.initialModel??behavior.models?.[0]?.value??'grok-4.7',effort=behavior.initialEffort??'high',pendingPrompt;
    function search(sessionId) {
      const update=update=>send({jsonrpc:'2.0',method:'session/update',params:{sessionId,update}});
      update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'PRIVATE_REASONING_CANARY'}});
      if(!behavior.noSearch) {
        update({sessionUpdate:'tool_call',toolCallId:'search-1',status:'in_progress',rawInput:{variant:behavior.localTool?'ReadFile':'XSearch',backend:!behavior.localTool}});
        update({sessionUpdate:'tool_call_update',toolCallId:'search-1',status:'completed',rawOutput:{name:'x_thread_fetch',sources:[{url:'https://example.com/evidence',title:'Evidence'}]}});
      }
      update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Supported answer.'}});
    }
    function handle(m) {
      if(!m.method)return;
      if(m.method==='session/cancel') {if(pendingPrompt&&!behavior.ignoreCancel)reply(pendingPrompt,{stopReason:'cancelled',...(behavior.cancelUsage?{_meta:{usage:{inputTokens:40,outputTokens:10,totalTokens:50}}}:{})});return;}
      setImmediate(()=>{
        if(child.closed)return;
        if(m.method==='initialize')reply(m,{protocolVersion:1,authMethods:behavior.noLogin?[]:[{id:'cached_token'}]});
        else if(m.method==='authenticate')reply(m,{});
        else if(m.method==='session/new')reply(m,{sessionId:'session-'+(++sid),configOptions:fullOptions(model,effort,behavior)});
        else if(m.method==='session/set_config_option') {
          if(m.params.configId==='model'&&!behavior.wrongModel)model=m.params.value;
          if(m.params.configId==='reasoning_effort'&&!behavior.wrongEffort)effort=m.params.value;
          reply(m,{configOptions:fullOptions(model,effort,behavior)});
        }
        else if(m.method==='_x.ai/session/info')reply(m,{result:{agentName:'superx-'+(behavior.agentName||path.basename(args[args.indexOf('--agent-profile')+1],'.md')),model,context:{total:256000,toolDefinitionsCount:behavior.localCount??0}}});
        else if(m.method==='session/close')reply(m,{});
        else if(m.method==='session/prompt') {
          pendingPrompt=m;
          if(behavior.permission) {send({jsonrpc:'2.0',id:'reverse-1',method:'session/request_permission',params:{private:'PRIVATE_TOOL_CANARY'}});return;}
          if(behavior.fsRequest) {send({jsonrpc:'2.0',id:'reverse-2',method:'fs/read_text_file',params:{path:'PRIVATE_FILE_CANARY'}});return;}
          if(behavior.warning){child.stderr.write('unmappable entries; keeping full grok toolset\n');return;}
          if(behavior.holdPrompt&&!behavior.afterOutput)return;
          if(!m.params._meta?.outputSchema)search(m.params.sessionId);
          if(behavior.holdPrompt)return;
          const usage={inputTokens:40,outputTokens:10,totalTokens:50,cachedReadTokens:20};
          reply(m,{stopReason:behavior.stopReason||'end_turn',_meta:{modelId:model,usage,...(m.params._meta?.outputSchema?{structuredOutput:behavior.comments||['One.','Two.','Three.']}:{})}});
        }
      });
    }
    setImmediate(()=>{
      if(args.includes('/PID')){const target=processes.find(item=>item.pid===Number(args[args.indexOf('/PID')+1]));target?.kill('SIGKILL');finish(0);}
      else if(args.includes('--version')){if(behavior.versionHold)return;child.stdout.write('grok '+(behavior.version||'1.0.60')+' (mock)\n');finish(0);}
      else if(args.includes('--prompt-file')) {
        if(behavior.cliHold)return;
        const structured=args.includes('--json-schema');
        if(structured)child.stdout.write(JSON.stringify({stopReason:'end_turn',structuredOutput:behavior.comments||['One.','Two.','Three.'],usage:{input_tokens:20,cache_read_input_tokens:20,cache_creation_input_tokens:0,output_tokens:10,total_tokens:50}},null,2));
        else {
          child.stdout.write(JSON.stringify({type:'tool_call',toolCallId:'s',status:'in_progress',rawInput:{variant:'XSearch',backend:true}})+'\n');
          child.stdout.write(JSON.stringify({type:'tool_call_update',toolCallId:'s',status:'completed',rawOutput:{name:'x_thread_fetch',sources:[{url:'https://example.com/cli',title:'CLI evidence'}]}})+'\n');
          child.stdout.write(JSON.stringify({type:'text',data:'CLI answer.'})+'\n');
          child.stdout.write(JSON.stringify({type:'end',stopReason:'end_turn',usage:{input_tokens:20,cache_read_input_tokens:20,cache_creation_input_tokens:0,output_tokens:10,total_tokens:50}})+'\n');
        }
        finish(0);
      }
    });
    return child;
  }
  return {spawnImpl,calls,messages,processes};
}
async function fixture(t,behavior={},options={}) {
  const temp=await fsp.mkdtemp(path.join(os.tmpdir(),'superx-host-test-'));
  const exe=path.join(temp,'official-mock');await fsp.writeFile(exe,'mock runtime\n'+policy.ISOLATION_MARKERS.join('\n'));
  const runtime=fakeRuntime(behavior),engine=new Engine({grokPath:exe,runtimeVersion:policy.VERSION},{...runtime,tmpdir:temp,grokHome:path.join(temp,'no-user-config'),configurationExists:file=>file.startsWith(temp+path.sep)&&fs.existsSync(file),rpcTimeoutMs:100,promptTimeoutMs:150,cancelGraceMs:5,shutdownGraceMs:20,idleTimeoutMs:10000,...options});
  t.after(async()=>{await engine.close();const absolute=path.resolve(temp);assert.equal(path.dirname(absolute),path.resolve(os.tmpdir()));assert.match(path.basename(absolute),/^superx-host-test-/);await fsp.rm(absolute,{recursive:true,force:true});});
  return {engine,runtime,temp,exe};
}

test('native framing handles split headers, Unicode and consecutive frames',()=>{
  const received=[],errors=[];const decoder=new Decoder(m=>received.push(m),e=>errors.push(e));
  const frames=Buffer.concat([encode({requestId:'one',text:'中文🙂'}),encode({requestId:'two'})]);
  for(let offset=0;offset<frames.length;offset+=3)decoder.push(frames.subarray(offset,offset+3));decoder.end();
  assert.deepEqual(received,[{requestId:'one',text:'中文🙂'},{requestId:'two'}]);assert.equal(errors.length,0);
});
test('native framing refuses huge, malformed, invalid UTF8 and truncated frames',()=>{
  for(const bytes of [Buffer.from([1,0,16,0]),Buffer.from([0,0,0,0]),Buffer.concat([Buffer.from([1,0,0,0]),Buffer.from([255])]),Buffer.from([5,0,0,0,123])]) {
    const errors=[];const decoder=new Decoder(()=>assert.fail('must not decode'),e=>errors.push(e));decoder.push(bytes);decoder.end();assert.equal(errors.length,1);
  }
  assert.throws(()=>encode({text:'x'.repeat(policy.MAX_FRAME)}),{code:'BUILD_LIMIT'});
});
test('only exact registered extension origins can start the host',()=>{
  const config={extensionIds:['a'.repeat(32)]},origin='chrome-extension://'+'a'.repeat(32)+'/';
  assert.equal(policy.authorizedOrigin([origin,'--parent-window=123'],config),true);
  for(const args of [[],['https://example.com'],[origin+'other'],[origin.slice(0,-1)],[origin.replace('aaaa','bbbb')],[origin,'--bad=1'],['--parent-window=123',origin]])assert.equal(policy.authorizedOrigin(args,config),false);
});
test('request trust boundary forbids external tools, arbitrary schemas and excessive data',()=>{
  assert.equal(request().task,'verify');
  for(const change of [{prompt:'x'.repeat(60001)},{requestId:'bad\n'},{task:'shell'},{webSearch:false,xSearch:false},{task:'comments'},{outputSchema:{type:'object'}},{protocolVersion:2},{cwd:'/tmp'},{effort:'auto'}])assert.throws(()=>request(change));
  assert.deepEqual(request({task:'comments',xSearch:false,outputSchema:{items:{maxLength:280,minLength:1,type:'string'},maxItems:3,minItems:3,type:'array'}}).outputSchema,policy.COMMENTS_SCHEMA);
});
test('child environment strips key, auth, endpoint, Node injection and inherited Grok overrides',()=>{
  const isolated=path.join(os.tmpdir(),'superx-test-home');const env=policy.cleanEnvironment({PATH:'safe',XAI_API_KEY:'secret',grok_base_url:'secret',OTHER_ACCESS_TOKEN:'secret',NODE_OPTIONS:'--require evil',DYLD_INSERT_LIBRARIES:'evil',GROK_AUTH_PATH:'untrusted-override'},{grokHome:isolated});
  assert.equal(env.PATH,'safe');assert.equal(env.XAI_API_KEY,undefined);assert.equal(env.grok_base_url,undefined);assert.equal(env.OTHER_ACCESS_TOKEN,undefined);assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.DYLD_INSERT_LIBRARIES,undefined);assert.equal(env.GROK_SUBAGENTS,'0');
  assert.equal(env.GROK_HOME,isolated);assert.equal(env.GROK_AUTH_PATH,path.join(os.homedir(),'.grok','auth.json'));
  for(const key of ['GROK_CLAUDE_MCPS_ENABLED','GROK_CURSOR_MCPS_ENABLED','GROK_MANAGED_MCPS_ENABLED','GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED','GROK_CLAUDE_HOOKS_ENABLED','GROK_CURSOR_SKILLS_ENABLED'])assert.equal(env[key],'0');
});
test('isolated configuration accepts an existing personal config without opening or altering it',async t=>{
  const {engine,runtime,temp}=await fixture(t);const personal=path.join(temp,'user','.grok');const cwd=path.join(temp,'user','AppData','Local','Temp','superx','work');const isolated=path.join(temp,'isolated');
  await fsp.mkdir(personal,{recursive:true});await fsp.mkdir(cwd,{recursive:true});await fsp.mkdir(isolated);const configPath=path.join(personal,'config.toml');const canary='api_key="PRIVATE_USER_CONFIG_CANARY"';await fsp.writeFile(configPath,canary);
  policy.checkConfiguration(cwd,isolated,fs.existsSync,{platform:'win32'});assert.equal(await fsp.readFile(configPath,'utf8'),canary);
  const authPath=path.join(os.homedir(),'.grok','auth.json'),originalRead=fs.readFileSync;
  fs.readFileSync=function(file,...args){assert.notEqual(path.resolve(String(file)),path.resolve(authPath),'host must never open the official login store');assert.notEqual(path.resolve(String(file)),path.resolve(configPath),'host must not open personal config');return originalRead.call(fs,file,...args);};
  try{assert.equal((await engine.status('isolated')).available,true);}finally{fs.readFileSync=originalRead;}
  assert.notEqual(engine.settings.grokHome,path.join(os.homedir(),'.grok'));assert.equal(path.dirname(engine.settings.grokHome),engine.settings.tempRoot);
  for(const call of runtime.calls){assert.equal(call.options.env.GROK_HOME,engine.settings.grokHome);assert.equal(call.options.env.GROK_AUTH_PATH,authPath);}
});
test('stat-only configuration guard rejects repo ancestry and exact system policy paths',()=>{
  const cwd=path.join(os.tmpdir(),'superx-policy','work'),isolated=path.join(os.tmpdir(),'superx-policy','grok-home');
  const parentGit=path.join(path.dirname(cwd),'.git');assert.throws(()=>policy.checkConfiguration(cwd,isolated,file=>file===parentGit,{platform:'win32'}),{code:'BUILD_CONFIG_UNSUPPORTED'});
  for(const policyPath of policy.systemConfigPaths('darwin','sample-user'))assert.throws(()=>policy.checkConfiguration(cwd,isolated,file=>file===policyPath,{platform:'darwin',username:'sample-user'}),{code:'BUILD_CONFIG_UNSUPPORTED'});
  assert.doesNotThrow(()=>policy.checkConfiguration(cwd,isolated,file=>file==='/Library/Managed Preferences',{platform:'darwin',username:'sample-user'}));
  assert.deepEqual(policy.systemConfigPaths('win32'),[]);assert.ok(policy.systemConfigPaths('darwin','sample-user').includes('/Library/Managed Preferences/sample-user/ai.x.grok.plist'));
});
test('missing pinned-runtime isolation capabilities fail before initialization',async t=>{
  const {engine,runtime,exe}=await fixture(t);await fsp.writeFile(exe,'mock runtime without required isolation knobs');const status=await engine.status('missing-capability');assert.equal(status.errorCode,'BUILD_VERSION_UNSUPPORTED');assert.equal(runtime.calls.length,0);assert.equal(runtime.messages.length,0);
});
test('exact approved profiles isolate the sentinel and separately gate hosted families',async t=>{
  const temp=await fsp.mkdtemp(path.join(os.tmpdir(),'superx-profile-test-'));t.after(async()=>fsp.rm(temp,{recursive:true,force:true}));
  for(const key of ['none','x','web','x-web']) {
    const source=profiles.profileSource(key);await fsp.writeFile(path.join(temp,key+'.md'),source);
    assert.equal(profiles.profilePath(key,temp),path.join(temp,key+'.md'));assert.match(source,/injectDefaultTools: false/);assert.match(source,/  - read_file/);assert.match(source,/  - use_tool/);
    assert.equal(source.includes('  - x_search\n'),!['x','x-web'].includes(key));assert.equal(source.includes('  - web_search\n'),!['web','x-web'].includes(key));
    await fsp.writeFile(path.join(temp,key+'.md'),source.replace('agentsMd: false','agentsMd: false\nunknownSetting: true'));assert.throws(()=>profiles.profilePath(key,temp),{code:'BUILD_TOOL_POLICY'});
  }
});
test('tool tracking requires a completed real hosted search and never trusts generated citations',()=>{
  const updates=[],turn=new Turn(request(),update=>updates.push(update));
  turn.observe({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'PRIVATE_THOUGHT'}});
  turn.observe({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'I searched https://invented.invalid.'}});
  assert.equal(turn.searched,false);assert.equal(turn.sources.size,0);assert.throws(()=>turn.finish({stopReason:'end_turn'},'acp'),{code:'BUILD_SEARCH_NOT_PERFORMED'});
  const actual=new Turn(request());actual.observe({sessionUpdate:'tool_call',toolCallId:'id',rawInput:{variant:'XSearch',backend:true}});
  actual.observe({sessionUpdate:'tool_call_update',toolCallId:'id',status:'completed',rawOutput:{name:'x_thread_fetch',sources:[{url:'https://example.com/evidence?api_key=SECRET',title:'Evidence'}]}});actual.append('Answer.');
  const result=actual.finish({stopReason:'end_turn'},'acp');assert.equal(result.searched,true);assert.deepEqual(result.sources,[{url:'https://example.com/evidence',title:'Evidence'}]);
  assert.equal(JSON.stringify(updates).includes('PRIVATE_THOUGHT'),false);
  for(const bad of [{type:'tool_call_update',toolCallId:'unseen',status:'completed',rawOutput:{name:'x_thread_fetch'}},{type:'tool_call',toolCallId:'read',rawInput:{variant:'ReadFile',backend:false}}])assert.throws(()=>new Turn(request()).observe(bad),{code:'BUILD_TOOL_POLICY'});
});
test('metadata citation collection rejects nonpublic schemes and credentials',()=>{
  assert.deepEqual(metadataSources({citations:[{url:'file:///secret'},{url:'https://user:secret@example.com/'},{url:'https://example.com/path',title:'Primary'}]}),[{url:'https://example.com/path',title:'Primary'}]);
});
test('status performs zero prompts and returns only allowlisted login/model metadata',async t=>{
  const {engine,runtime}=await fixture(t);const status=await engine.status('status');
  assert.equal(status.available,true,JSON.stringify(status));assert.equal(status.authenticated,true);assert.equal(status.version,'1.0.60');assert.equal(status.modelCatalog[0].id,'grok-4.7');
  assert.equal(runtime.messages.some(m=>m.method==='session/prompt'),false);assert.equal(runtime.messages.some(m=>m.method==='authenticate'&&m.params.methodId==='cached_token'),true);
});
test('STATUS negotiates its zero-prompt probe from the actual account catalog and advertised effort',async t=>{
  const cases=[
    {models:[{value:'grok-4.6',name:'Available model'}],efforts:['medium','low','high'],initialModel:'grok-4.6',initialEffort:'high',expectedModel:'grok-4.6',expectedEffort:'low'},
    {models:[{value:'grok-4.5'},{value:'grok-4.6'}],efforts:['medium','high'],initialModel:'grok-4.6',initialEffort:'high',expectedModel:'grok-4.6',expectedEffort:'high'},
    {models:[{value:'invalid-model'},{value:'grok-4.6'}],efforts:['unsupported','medium','high'],initialModel:'grok-unlisted',initialEffort:'unsupported',expectedModel:'grok-4.6',expectedEffort:'medium'},
  ];
  for(const behavior of cases) {
    const {engine,runtime}=await fixture(t,behavior);const status=await engine.status('available-catalog');assert.equal(status.available,true,JSON.stringify(status));assert.equal(status.authenticated,true);
    assert.deepEqual(status.modelCatalog.map(item=>item.id),behavior.models.map(item=>item.value).filter(policy.modelId));
    assert.equal(runtime.messages.find(m=>m.method==='session/set_config_option'&&m.params.configId==='model').params.value,behavior.expectedModel);
    assert.equal(runtime.messages.find(m=>m.method==='session/set_config_option'&&m.params.configId==='reasoning_effort').params.value,behavior.expectedEffort);
    assert.equal(runtime.messages.some(m=>m.method==='session/prompt'),false);
    const acp=runtime.calls.find(call=>call.args.includes('stdio'));assert.equal(acp.args.includes('--model'),false);assert.equal(acp.args.includes('--reasoning-effort'),false);
  }
});
test('catalog negotiation during STATUS never substitutes the selected RUN model or effort',async t=>{
  const {engine,runtime}=await fixture(t,{models:[{value:'grok-4.6'}],efforts:['medium'],initialModel:'grok-4.6',initialEffort:'medium'});
  assert.equal((await engine.status('check')).available,true);
  await assert.rejects(engine.run(request({model:'grok-4.7',effort:'medium'})),{code:'BUILD_MODEL_UNSUPPORTED'});
  await assert.rejects(engine.run(request({model:'grok-4.6',effort:'low'})),{code:'BUILD_EFFORT_UNSUPPORTED'});
  assert.equal(runtime.messages.some(m=>m.method==='session/prompt'),false);
});
test('version mismatch, cached login missing and config overrides fail before any prompt',async t=>{
  const version=await fixture(t,{version:'1.0.61'});assert.equal((await version.engine.status('v')).errorCode,'BUILD_VERSION_UNSUPPORTED');assert.equal(version.runtime.messages.length,0);
  const login=await fixture(t,{noLogin:true});assert.equal((await login.engine.status('a')).errorCode,'BUILD_LOGIN_REQUIRED');assert.equal(login.runtime.messages.some(m=>m.method==='session/prompt'),false);
  const config=await fixture(t);await config.engine.prepare();const before=config.runtime.calls.length;await fsp.writeFile(path.join(config.engine.settings.grokHome,'config.toml'),'api_key="PRIVATE_NEVER_READ"');assert.equal((await config.engine.status('c')).errorCode,'BUILD_CONFIG_UNSUPPORTED');assert.equal(config.runtime.calls.length,before);
});
test('ACP reuses the restricted process but creates a fresh confirmed session per post',async t=>{
  const {engine,runtime}=await fixture(t),updates=[];
  const first=await engine.run(request(),m=>updates.push(m));const second=await engine.run(request({requestId:'job-2'}),()=>{});
  assert.equal(first.text,'Supported answer.');assert.deepEqual(first.usage,{input_tokens:40,output_tokens:10,total_tokens:50,input_tokens_details:{cached_tokens:20}});assert.equal(first.usageComplete,true);assert.equal(second.text,first.text);
  assert.equal(runtime.calls.filter(call=>call.args.includes('stdio')).length,1);assert.equal(runtime.messages.filter(m=>m.method==='session/new').length,2);assert.equal(runtime.messages.filter(m=>m.method==='session/close').length,2);
  const prompts=runtime.messages.filter(m=>m.method==='session/prompt');assert.notEqual(prompts[0].params.sessionId,prompts[1].params.sessionId);
  assert.equal(runtime.messages.filter(m=>m.method==='session/set_config_option'&&m.params.configId==='model').length,2);assert.equal(runtime.messages.filter(m=>m.method==='session/set_config_option'&&m.params.configId==='reasoning_effort').length,2);
  assert.equal(JSON.stringify(updates).includes('PRIVATE_REASONING_CANARY'),false);
  for(const call of runtime.calls)assert.equal(call.options.shell,false);
});
test('ACP refuses model/effort/profile confirmation and local function mismatches before inference',async t=>{
  for(const [behavior,changes,code] of [[{}, {model:'grok-4.3'},'BUILD_MODEL_UNSUPPORTED'],[{wrongModel:true},{model:'grok-4.6'},'BUILD_MODEL_UNSUPPORTED'],[{wrongEffort:true},{},'BUILD_EFFORT_UNSUPPORTED'],[{localCount:1},{},'BUILD_TOOL_POLICY'],[{agentName:'wrong-profile'},{},'BUILD_TOOL_POLICY']]) {
    const {engine,runtime}=await fixture(t,behavior);await assert.rejects(engine.run(request(changes)),{code});assert.equal(runtime.messages.some(m=>m.method==='session/prompt'),false);
  }
});
test('ACP reverse permission and filesystem requests are denied, cancelled and never leaked',async t=>{
  for(const behavior of [{permission:true},{fsRequest:true}]) {
    const {engine,runtime}=await fixture(t,behavior);let error;
    try{await engine.run(request());}catch(e){error=e;}
    assert.equal(error.code,'BUILD_TOOL_POLICY');assert.equal(JSON.stringify(policy.publicError(error,'job-1')).includes('PRIVATE'),false);
    assert.equal(runtime.messages.some(m=>m.method==='session/cancel'),true);
    assert.equal(runtime.messages.some(m=>m.id==='reverse-1'&&m.result?.outcome?.outcome==='cancelled'||m.id==='reverse-2'&&m.error?.code===-32601),true);
  }
});
test('ACP requires end_turn and stops on tool fallback warnings without retry',async t=>{
  for(const [behavior,code] of [[{stopReason:'max_tokens'},'BUILD_OUTPUT_INVALID'],[{warning:true},'BUILD_TOOL_POLICY'],[{noSearch:true},'BUILD_SEARCH_NOT_PERFORMED'],[{localTool:true},'BUILD_TOOL_POLICY']]) {
    const {engine,runtime}=await fixture(t,behavior);await assert.rejects(engine.run(request()),{code});assert.equal(runtime.messages.filter(m=>m.method==='session/prompt').length,1);
  }
});
test('ACP cancellation before and after body output sends cancel and closes session',async t=>{
  for(const afterOutput of [false,true]) {
    const {engine,runtime}=await fixture(t,{holdPrompt:true,afterOutput});const controller=new AbortController();
    const job=engine.run(request(),()=>{},controller.signal);while(!runtime.messages.some(m=>m.method==='session/prompt'))await tick();await tick();controller.abort();
    await assert.rejects(job,{code:'BUILD_CANCELLED'});assert.equal(runtime.messages.some(m=>m.method==='session/cancel'),true);assert.equal(runtime.messages.some(m=>m.method==='session/close'),true);
  }
});
test('ACP timeout closes the process and never retries the paid prompt',async t=>{
  const {engine,runtime}=await fixture(t,{holdPrompt:true},{promptTimeoutMs:15});await assert.rejects(engine.run(request()),{code:'BUILD_TIMEOUT'});assert.equal(runtime.messages.filter(m=>m.method==='session/prompt').length,1);assert.equal(runtime.processes.every(p=>p.closed),true);
});
test('ACP cancelled terminal usage remains visible on the public error envelope',async t=>{
  const {engine,runtime}=await fixture(t,{holdPrompt:true,cancelUsage:true});const controller=new AbortController();const job=engine.run(request(),()=>{},controller.signal);
  while(!runtime.messages.some(m=>m.method==='session/prompt'))await tick();await tick();controller.abort();
  await assert.rejects(job,error=>{assert.equal(error.code,'BUILD_CANCELLED');assert.equal(policy.publicError(error,'job-1').usage.total_tokens,50);assert.equal(error.usageComplete,true);return true;});
});
test('comments use fixed native schema and validate exactly three distinct single-line drafts',async t=>{
  const {engine,runtime}=await fixture(t);const result=await engine.run(request({task:'comments',xSearch:false}));assert.deepEqual(JSON.parse(result.text),['One.','Two.','Three.']);assert.equal(result.searched,false);
  assert.deepEqual(runtime.messages.find(m=>m.method==='session/prompt').params._meta.outputSchema,policy.COMMENTS_SCHEMA);
  for(const value of [['One.','One.','Two.'],['One.','Two.\nBad','Three.'],['One.','Two.'],['One.','Two.','x'.repeat(281)],'prefix ["One.","Two.","Three."]'])assert.throws(()=>policy.validateComments(value),{code:'BUILD_OUTPUT_INVALID'});
});
test('CLI observes official NDJSON, preflights through ACP, keeps prompts out of argv and cleans temp files',async t=>{
  const {engine,runtime}=await fixture(t);const result=await engine.run(request({transport:'cli',prompt:'PRIVATE_PROMPT_CANARY'}));assert.equal(result.text,'CLI answer.');assert.equal(result.searched,true);assert.equal(result.usage.input_tokens,40);
  const cli=runtime.calls.find(call=>call.args.includes('--prompt-file'));assert.ok(cli);assert.equal(cli.args.includes('PRIVATE_PROMPT_CANARY'),false);assert.equal(fs.existsSync(cli.args[cli.args.indexOf('--prompt-file')+1]),false);
  assert.equal(runtime.messages.some(m=>m.method==='session/prompt'),false);assert.equal(runtime.messages.some(m=>m.method==='_x.ai/session/info'),true);
});
test('CLI supports native-schema final JSON and validates it without extracting JSON from prose',async t=>{
  const {engine}=await fixture(t);const result=await engine.run(request({task:'comments',transport:'cli',xSearch:false}));assert.deepEqual(JSON.parse(result.text),['One.','Two.','Three.']);
});
test('invalid terminal comments retain actual usage metadata without retry',async t=>{
  for(const transport of ['acp','cli']) {
    const {engine,runtime}=await fixture(t,{comments:['Duplicate','Duplicate','Third']});
    await assert.rejects(engine.run(request({task:'comments',transport,xSearch:false})),error=>{assert.equal(error.code,'BUILD_OUTPUT_INVALID');assert.equal(error.usage.total_tokens,50);assert.equal(error.usageComplete,true);return true;});
    assert.equal(transport==='acp'?runtime.messages.filter(m=>m.method==='session/prompt').length:runtime.calls.filter(c=>c.args.includes('--prompt-file')).length,1);
  }
});
test('engine shutdown cancels live CLI and removes its own temporary directory',async t=>{
  const {engine,runtime}=await fixture(t,{cliHold:true});const job=engine.run(request({transport:'cli'}));while(!runtime.calls.some(call=>call.args.includes('--prompt-file')))await tick();const owned=engine.settings.tempRoot;await engine.close();await assert.rejects(job,{code:'BUILD_CANCELLED'});assert.equal(fs.existsSync(owned),false);assert.equal(runtime.processes.every(p=>p.closed),true);
});
test('engine shutdown during status version preflight leaves no runtime process or temp directory',async t=>{
  const {engine,runtime}=await fixture(t,{versionHold:true});const pending=engine.status('status');while(!runtime.calls.some(call=>call.args.includes('--version')))await tick();const owned=engine.settings.tempRoot;
  await engine.close();assert.equal((await pending).available,false);assert.equal(runtime.processes.every(p=>p.closed),true);assert.equal(fs.existsSync(owned),false);assert.equal(runtime.messages.length,0);
});
test('Windows process-tree termination uses a fixed taskkill executable and numeric PID without a shell',async()=>{
  let called,killed=false;
  await killTree({pid:1234,kill(){killed=true;}},{platform:'win32',spawnImpl(exe,args,options){called={exe,args,options};const child=new EventEmitter();setImmediate(()=>child.emit('close',0));return child;}});
  assert.match(called.exe,/System32\\taskkill\.exe$/i);assert.deepEqual(called.args,['/PID','1234','/T','/F']);assert.equal(called.options.shell,false);assert.equal(called.options.windowsHide,true);assert.equal(killed,true);
  let touched=false;await killTree({pid:'1 & evil'},{platform:'win32',spawnImpl(){touched=true;}});assert.equal(touched,false);
});
test('macOS process-tree termination targets its own detached process group',async()=>{
  let target,signal;await killTree({pid:1234,kill(){}},{platform:'darwin',killImpl(pid,sig){target=pid;signal=sig;}});assert.equal(target,-1234);assert.equal(signal,'SIGKILL');
});
test('native host serializes jobs, cancels queued jobs and cleans up on stdin EOF',async()=>{
  const input=new PassThrough(),output=new PassThrough(),received=[];const decoder=new Decoder(m=>received.push(m),assert.fail);output.on('data',bytes=>decoder.push(bytes));
  let release,started=0,closed=false;const engine={status:async id=>({type:'STATUS',requestId:id,installed:true,available:true}),run:async(r,update,signal)=>{started++;return await new Promise((resolve,reject)=>{release=()=>resolve({type:'RESULT',requestId:r.requestId,text:'done',sources:[],searched:true});signal.addEventListener('abort',()=>reject(policy.failure('BUILD_CANCELLED')),{once:true});});},close:async()=>{closed=true;}};
  const server=serve({input,output,engine});input.write(encode(request()));input.write(encode(request({requestId:'queued'})));input.write(encode({type:'CANCEL',requestId:'queued'}));await tick();assert.equal(started,1);assert.equal(received.find(m=>m.requestId==='queued').code,'BUILD_CANCELLED');release();await tick();input.end();await tick();assert.equal(closed,true);await server.close();
});
test('connector public errors contain only safe allowlisted messages and billing fields',()=>{
  const raw=Object.assign(new Error('xai-SECRET JWT SECRET PRIVATE_PATH'),{code:'UPSTREAM_SECRET',model:'grok-4.7',usage:{total_tokens:42,api_key:'SECRET'},secret:'SECRET'});
  const result=policy.publicError(raw,'job-1');assert.equal(result.code,'BUILD_PROTOCOL_ERROR');assert.deepEqual(result.usage,{total_tokens:42});assert.equal(JSON.stringify(result).includes('SECRET'),false);
});
