#!/usr/bin/env node
'use strict';
const path=require('node:path');
const {Decoder,encode}=require('./lib/framing.cjs');
const {Engine}=require('./lib/engine.cjs');
const {loadConfig,authorizedOrigin,validateRequest,publicError,failure,validRequestId}=require('./lib/policy.cjs');

function serve({input=process.stdin,output=process.stdout,engine,onClose=()=>{}}) {
  let queue=[],active=null,closed=false,draining=false;const outstanding=new Set();
  function send(message) {
    if(closed)return;
    if(output.writableLength>2*1024*1024){close();return;}
    try{output.write(encode(message));}catch{close();}
  }
  async function close() {
    if(closed)return;closed=true;queue=[];outstanding.clear();active?.controller.abort();
    input.pause?.();await engine.close().catch(()=>{});onClose();
  }
  async function drain() {
    if(draining||closed)return;draining=true;
    try {
      while(queue.length&&!closed) {
        const request=queue.shift(),controller=new AbortController();active={request,controller};
        try {
          if(request.type==='STATUS')send(await engine.status(request.requestId));
          else send(await engine.run(request,send,controller.signal));
        }catch(error){send(publicError(error,request.requestId));}
        finally{outstanding.delete(request.requestId);active=null;}
      }
    }finally{draining=false;}
  }
  function receive(raw) {
    let request;
    try{request=validateRequest(raw);}catch(error){if(validRequestId(raw?.requestId))send(publicError(error,raw.requestId));else close();return;}
    if(request.type==='CANCEL') {
      if(active?.request.requestId===request.requestId)active.controller.abort();
      else {const index=queue.findIndex(item=>item.requestId===request.requestId);if(index>=0){queue.splice(index,1);outstanding.delete(request.requestId);send(publicError(failure('BUILD_CANCELLED'),request.requestId));}}
      return;
    }
    if(outstanding.has(request.requestId)){send(publicError(failure('BUILD_PROTOCOL_ERROR'),request.requestId));close();return;}
    if(queue.length>=16){send(publicError(failure('BUILD_LIMIT'),request.requestId));return;}
    outstanding.add(request.requestId);queue.push(request);drain().catch(()=>close());
  }
  const decoder=new Decoder(receive,()=>close());
  input.on('data',chunk=>decoder.push(chunk));input.once('end',()=>{decoder.end();close();});input.once('error',close);output.once('error',close);
  return {close,receive};
}
function main(argv=process.argv.slice(2)) {
  let config;
  try{config=loadConfig(path.join(__dirname,'config.json'));if(!authorizedOrigin(argv,config))return false;}catch{return false;}
  const engine=new Engine(config);const server=serve({engine,onClose:()=>{process.exitCode=0;}});
  process.once('SIGINT',()=>server.close());process.once('SIGTERM',()=>server.close());return true;
}
if(require.main===module&&!main())process.exitCode=1;
module.exports={serve,main};
