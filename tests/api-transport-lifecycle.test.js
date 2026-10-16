'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../extension/api-provider.js');

const settings = {apiModel:'grok-4.3',apiReasoningEffort:'none',language:'en',webSearch:true,xSearch:true,explanationMode:'preset'};
const post = {id:'100',url:'https://x.com/author/status/100',text:'A factual claim.',language:'en'};
const encoder = new TextEncoder();
const turn = () => new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function event(value){return encoder.encode('data: '+JSON.stringify(value)+'\n\n');}
function terminal(){return {type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'The date is incorrect.'}]}]}};}
function observed(promise){let settled=false;const outcome=promise.then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});return {outcome,get settled(){return settled;}};}

test('an aborted response stays unsettled until the stream cancellation completes',async()=>{
  const cleanup=deferred(),controller=new AbortController();let cancellations=0;
  const body=new ReadableStream({cancel(){cancellations++;return cleanup.promise;}});
  const request=observed(api.run(post,settings,'test-key',{signal:controller.signal,fetchImpl:async()=>new Response(body)}));
  await turn();controller.abort();await turn();
  assert.equal(cancellations,1);assert.equal(request.settled,false,'An aborted read is not proof that transport cleanup finished');
  cleanup.resolve();const result=await request.outcome;
  assert.equal(result.error.code,'CANCELED');assert.equal(body.locked,false);
});

test('a valid terminal response waits for its cancelled socket tail before returning its lease',async()=>{
  const cleanup=deferred();let cancellations=0;
  const body=new ReadableStream({start(stream){stream.enqueue(event(terminal()));},cancel(){cancellations++;return cleanup.promise;}});
  const request=observed(api.run(post,settings,'test-key',{fetchImpl:async()=>new Response(body)}));
  await turn();assert.equal(cancellations,1);assert.equal(request.settled,false);
  cleanup.resolve();const result=await request.outcome;
  assert.equal(result.value.text,'The date is incorrect.');assert.equal(body.locked,false);
});

test('a provider stream error retains its cause while waiting for transport cancellation',async()=>{
  const cleanup=deferred();let cancellations=0;
  const body=new ReadableStream({start(stream){stream.enqueue(event({type:'error',code:'spending_limit',message:'Account spending limit reached.'}));},cancel(){cancellations++;return cleanup.promise;}});
  const request=observed(api.run(post,settings,'test-key',{fetchImpl:async()=>new Response(body)}));
  await turn();assert.equal(cancellations,1);assert.equal(request.settled,false);
  cleanup.resolve();const result=await request.outcome;
  assert.equal(result.error.code,'API_ERROR');assert.equal(result.error.verificationFailure.providerCode,'spending_limit');assert.equal(body.locked,false);
});

test('an oversized HTTP error body keeps its transport lease until cleanup settles',async()=>{
  const cleanup=deferred();let cancellations=0;
  const body=new ReadableStream({start(stream){stream.enqueue(encoder.encode('x'.repeat(17000)));},cancel(){cancellations++;return cleanup.promise;}});
  const request=observed(api.run(post,settings,'test-key',{fetchImpl:async()=>new Response(body,{status:402})}));
  await turn();assert.equal(cancellations,1);assert.equal(request.settled,false);
  cleanup.resolve();const result=await request.outcome;
  assert.equal(result.error.verificationFailure.httpStatus,402);assert.equal(result.error.requestDiagnostics.transportStatus,402);assert.equal(body.locked,false);
});

test('headers delivered after abort still close their unconsumed response body before settling',async()=>{
  const headers=deferred(),cleanup=deferred(),controller=new AbortController();let cancellations=0;
  const body=new ReadableStream({cancel(){cancellations++;return cleanup.promise;}});
  const request=observed(api.run(post,settings,'test-key',{signal:controller.signal,fetchImpl:()=>headers.promise}));
  controller.abort();headers.resolve(new Response(body));await turn();
  assert.equal(cancellations,1);assert.equal(request.settled,false);
  cleanup.resolve();const result=await request.outcome;
  assert.equal(result.error.code,'CANCELED');assert.equal(body.locked,false);
});
