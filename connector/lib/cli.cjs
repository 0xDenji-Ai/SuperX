'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {ChildTransport}=require('./process.cjs');
const {failure,classifyError}=require('./policy.cjs');
const {profileKey,profilePath,commonArgs}=require('./profiles.cjs');
const {Turn}=require('./updates.cjs');

async function runCli(config,request,settings,onUpdate,signal) {
  if(signal?.aborted)throw failure('BUILD_CANCELLED');
  const key=profileKey(request),turn=new Turn(request,onUpdate);
  // Keep task data out of argv/process listings and outside the empty workspace.
  const promptFile=path.join(settings.tempRoot,randomUUID()+'.txt');
  await fs.writeFile(promptFile,request.prompt,{mode:0o600,flag:'wx'});
  let transport,timer,terminal;
  const abort=()=>transport?.terminate().catch(()=>{});
  try {
    if(signal?.aborted)throw failure('BUILD_CANCELLED');
    const args=[...commonArgs(request),'--cwd',settings.cwd,'--agent',profilePath(key,settings.profilesRoot),'--max-turns',request.task==='comments'?'1':'4',
      ...(request.outputSchema?['--json-schema',JSON.stringify(request.outputSchema)]:[]),'--output-format',request.outputSchema?'json':'streaming-json','--prompt-file',promptFile];
    transport=new ChildTransport(config.grokPath,args,{...settings,jsonDocument:Boolean(request.outputSchema)});
    transport.on('message',message=>{
      if(message.type==='error')throw classifyError({message:message.message});
      turn.observe(message.params?.update??message.update??message);
      if(message.type==='end'||typeof message.stopReason==='string') {
        if(terminal)throw failure('BUILD_PROTOCOL_ERROR');terminal=message;
      }
    });
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>transport.fail(failure('BUILD_TIMEOUT')),settings.promptTimeoutMs??120000);
    await transport.done;
    if(signal?.aborted)throw failure('BUILD_CANCELLED');
    if(transport.fatal)throw transport.fatal;
    if(transport.exit?.code!==0||!terminal)throw failure('BUILD_OUTPUT_INVALID');
    return turn.finish(terminal,'cli');
  }catch(error) {
    if(transport&&!transport.closed)await transport.terminate();
    const safe=signal?.aborted?failure('BUILD_CANCELLED'):classifyError(error);
    Object.assign(safe,{usage:safe.usage??turn.usage,usageComplete:safe.usageComplete??turn.usageComplete,model:safe.model??turn.model});throw safe;
  }finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);await fs.unlink(promptFile).catch(()=>{});}
}
module.exports={runCli};
