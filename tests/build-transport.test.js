'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Transport=require('../extension/build-transport.js');
const {wsFixture,connection,tick}=require('./build-ws-fixture.js');
function socket(behavior={},options={}){const fixture=wsFixture(behavior);return {...fixture,socket:new Transport.Socket(connection,{webSocketFactory:fixture.factory,...options})};}
test('the worker only constructs a numeric IPv4 loopback endpoint and never puts credentials in diagnostics',async()=>{
  const f=socket();try{await f.socket.request('initialize',{});const url=new URL(f.urls[0]);assert.equal(url.protocol,'ws:');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'2419');assert.equal(url.pathname,'/ws');assert.deepEqual([...url.searchParams.keys()],['server-key']);assert.equal(url.searchParams.get('server-key'),connection.secret);}finally{f.socket.close();}
  for(const value of [{port:80,secret:connection.secret},{port:'2419',secret:connection.secret},{port:2419,secret:'xai-'+'a'.repeat(64)},{port:2419,secret:'$(bad)'},{url:'ws://remote',secret:connection.secret}])assert.throws(()=>new Transport.Socket(value),error=>error.code==='BUILD_CONNECTION_REQUIRED'&&!error.message.includes(connection.secret));
});
test('bounded RPC frames, malformed messages and individual response IDs cannot bleed between calls',async()=>{
  const f=socket({onMessage:()=>true});try{const a=f.socket.request('alpha',{}),b=f.socket.request('beta',{});await tick();const [first,second]=f.messages;f.sockets[0].emit({jsonrpc:'2.0',id:second.id,result:{name:'beta'}});f.sockets[0].emit({jsonrpc:'2.0',id:'unknown',result:{name:'wrong'}});f.sockets[0].emit({jsonrpc:'2.0',id:first.id,result:{name:'alpha'}});assert.deepEqual(await a,{name:'alpha'});assert.deepEqual(await b,{name:'beta'});
    const bad=f.socket.request('bad',{});await tick();f.sockets[0].dispatch('message',{data:'not JSON PRIVATE_CODE'});await assert.rejects(bad,error=>error.code==='BUILD_PROTOCOL_ERROR'&&!error.message.includes('PRIVATE'));assert.equal(f.socket.connected,false);
  }finally{f.socket.close();}
});
test('pending limits, abort and timeout affect only the matching RPC without replaying it',async()=>{
  const f=socket({onMessage:()=>true},{requestTimeoutMs:20});const keepAlive=setTimeout(()=>{},1000);try{
    const controller=new AbortController(),aborted=f.socket.request('abort',{}, {signal:controller.signal});await tick();controller.abort();await assert.rejects(aborted,{code:'BUILD_CANCELLED'});
    const pending=Array.from({length:16},()=>f.socket.request('hold',{}));const settlements=Promise.allSettled(pending);await tick();await assert.rejects(f.socket.request('over-limit',{}),{code:'BUILD_LIMIT'});const outcomes=await settlements;assert.equal(outcomes.every(value=>value.reason.code==='BUILD_TIMEOUT'),true);assert.equal(f.messages.filter(value=>value.method==='hold').length,16);assert.equal(f.messages.some(value=>value.method==='over-limit'),false);
  }finally{clearTimeout(keepAlive);f.socket.close();}
});
test('browser handshake errors remain actionable but never invent authentication proof',async()=>{
  const f=socket({openError:true});try{await assert.rejects(f.socket.request('initialize',{}),error=>error.code==='BUILD_UNAVAILABLE'&&!error.message.includes(connection.secret));assert.equal(f.messages.length,0);}finally{f.socket.close();}
});
test('disconnected cleanup opens only a control socket and never creates or prompts a new session',async()=>{
  const f=socket();try{await f.socket.request('initialize',{});f.sockets[0].close();assert.deepEqual(await f.socket.cleanupSession('known-session',{cancel:true}),{confirmed:true});assert.equal(f.urls.length,2);assert.deepEqual(f.messages.map(value=>value.method),['initialize','initialize','authenticate','session/cancel','session/close']);assert.equal(f.socket.uncertainSessions.size,0);}finally{f.socket.close();}
});
test('unconfirmed cleanup quarantines a bridge and prevents the next paid prompt',async()=>{
  const f=wsFixture({cleanupError:true}),bridge=new Transport.Bridge(connection,{webSocketFactory:f.factory});const request={type:'RUN',task:'verify',model:'grok-4.7',effort:'low',prompt:'Check the claim.',xSearch:true,webSearch:false};
  try{await assert.rejects(bridge.request(request),{code:'BUILD_CANCEL_UNCONFIRMED'});assert.ok(bridge.uncertainSessions.size>0);const before=f.messages.filter(value=>value.method==='session/prompt').length;await assert.rejects(bridge.request(request),{code:'BUILD_CANCEL_UNCONFIRMED'});assert.equal(f.messages.filter(value=>value.method==='session/prompt').length,before);assert.equal(before,1);}finally{await bridge.close();}
});
test('forgetting connections and pool eviction cannot discard an unconfirmed task quarantine',async()=>{
  const f=wsFixture({cleanupError:true}),first=Transport.bridgeFor(connection,f.factory),request={type:'RUN',task:'verify',model:'grok-4.7',effort:'low',prompt:'Check the claim.',xSearch:true,webSearch:false};
  await assert.rejects(first.request(request),{code:'BUILD_CANCEL_UNCONFIRMED'});assert.equal((await Transport.closeAll()).confirmed,false);
  const reused=Transport.bridgeFor(connection,f.factory);assert.equal(reused,first);await assert.rejects(reused.request(request),{code:'BUILD_CANCEL_UNCONFIRMED'});assert.equal(f.messages.filter(value=>value.method==='session/prompt').length,1);
  for(let i=0;i<6;i++)Transport.bridgeFor({...connection,port:2500+i},f.factory);
  assert.equal(Transport.bridgeFor(connection,f.factory),first);await assert.rejects(first.request(request),{code:'BUILD_CANCEL_UNCONFIRMED'});assert.equal(f.messages.filter(value=>value.method==='session/prompt').length,1);
});
