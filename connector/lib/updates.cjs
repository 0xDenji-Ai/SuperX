'use strict';
const {MAX_TEXT,failure,modelId,usage,validateComments}=require('./policy.cjs');
function safeUrl(value) {
  if(typeof value!=='string'||value.length>2048)return null;
  try{const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return null;
    for(const key of [...url.searchParams.keys()])if(/token|key|auth|secret|password|signature|credential/i.test(key))url.searchParams.delete(key);
    url.hash='';return url.href;
  }catch{return null;}
}
function metadataSources(value) {
  const found=[];let nodes=0;
  function walk(item,depth) {
    if(!item||typeof item!=='object'||depth>8||++nodes>1000)return;
    if(Array.isArray(item)){for(const child of item.slice(0,100))walk(child,depth+1);return;}
    const url=safeUrl(item.url??item.uri??item.href);
    if(url)found.push({url,title:typeof item.title==='string'?item.title.replace(/[\x00-\x1f]/g,' ').slice(0,200):''});
    for(const key of ['sources','citations','annotations','references','results','links','content','resource','data','url_citation'])if(item[key]&&typeof item[key]==='object')walk(item[key],depth+1);
  }
  walk(value,0);return found;
}
class Turn {
  constructor(request,onUpdate=()=>{}) {this.request=request;this.onUpdate=onUpdate;this.text='';this.searched=false;this.tools=new Map();this.sources=new Map();this.model=request.model;this.usage={};this.usageComplete=false;this.finished=false;this.lastEmit=0;}
  addSources(object) {for(const item of metadataSources(object))if(this.sources.size<100&&!this.sources.has(item.url))this.sources.set(item.url,item);}
  publish(force=false) {
    if(this.finished)return;
    if(!force&&Date.now()-this.lastEmit<45)return;this.lastEmit=Date.now();
    this.onUpdate({type:'UPDATE',requestId:this.request.requestId,text:this.text,phase:'verify',searched:this.searched,usage:this.usage,usageComplete:this.usageComplete,model:this.model});
  }
  observe(update) {
    if(this.finished||!update||typeof update!=='object')return;
    const kind=update.sessionUpdate??update.type;
    if(kind==='agent_message_chunk'&&update.content?.type==='text'&&typeof update.content.text==='string')this.append(update.content.text,update.content);
    if(kind==='text'&&typeof update.data==='string')this.append(update.data);
    if(kind==='tool_call'||kind==='tool_call_update')this.tool(update,kind);
    if(kind==='usage_update') {const normalized=usage(update.usage??update,'acp');if(Object.keys(normalized.usage).length)this.usage=normalized.usage;}
    // Thought chunks, tool arguments, user echoes and JSON blocks are never forwarded.
  }
  append(text,metadata) {
    if(this.text.length+text.length>MAX_TEXT)throw failure('BUILD_LIMIT');
    this.text+=text;if(metadata)this.addSources(metadata);this.publish();
  }
  tool(update,kind) {
    const id=update.toolCallId;
    if(typeof id!=='string'||id.length>256)throw failure('BUILD_TOOL_POLICY');
    let tool=this.tools.get(id);
    if(!tool) {
      if(kind!=='tool_call'||this.tools.size>=32)throw failure('BUILD_TOOL_POLICY');
      const input=update.rawInput;
      const family=input?.backend===true?(input.variant==='XSearch'?'x':input.variant==='WebSearch'?'web':null):null;
      if(!family||this.request.task==='comments'||(family==='x'&&!this.request.xSearch)||(family==='web'&&!this.request.webSearch))throw failure('BUILD_TOOL_POLICY');
      tool={family,completed:false};this.tools.set(id,tool);
    }
    if(update.status==='completed') {
      const name=update.rawOutput?.name;
      const allowed=tool.family==='x'?/^x_(?:thread_fetch|keyword_search|semantic_search|user_search)$/.test(name):/^(?:web_search|web_fetch|browse_page|open_page|find_in_page|search|browse)$/.test(name);
      if(!allowed)throw failure('BUILD_TOOL_POLICY');
      tool.completed=true;this.searched=true;this.addSources(update.rawOutput);this.addSources(update.content);this.addSources(update.locations);this.publish(true);
    } else if(update.status&&!['pending','in_progress','failed'].includes(update.status))throw failure('BUILD_TOOL_POLICY');
  }
  finish(result,route) {
    if(this.finished)throw failure('BUILD_PROTOCOL_ERROR');
    const metadata=result?._meta??{};
    const rawUsage=result.usage??metadata.usage;
    const accounting=usage(rawUsage,route);this.usage=accounting.usage;this.usageComplete=accounting.usageComplete;
    const actual=metadata.modelId??Object.keys(result.modelUsage??{})[0];if(modelId(actual))this.model=actual;
    const details={usage:this.usage,usageComplete:this.usageComplete,model:this.model};
    if(result.stopReason!=='end_turn')throw failure(result.stopReason==='cancelled'?'BUILD_CANCELLED':'BUILD_OUTPUT_INVALID',details);
    if(this.request.task==='comments')this.text=validateComments(metadata.structuredOutput??metadata.structured_output??result.structuredOutput??result.structured_output??this.text??result.text);
    else if(!this.text&&typeof result.text==='string')this.append(result.text);
    if(!this.text.trim())throw failure('BUILD_OUTPUT_INVALID',details);
    if(this.request.task==='verify'&&!this.searched)throw failure('BUILD_SEARCH_NOT_PERFORMED',details);
    this.addSources(metadata);this.addSources({sources:result.sources,citations:result.citations,annotations:result.annotations});
    this.publish(true);this.finished=true;
    return {type:'RESULT',requestId:this.request.requestId,text:this.text,sources:[...this.sources.values()],searched:this.searched,...details};
  }
}
module.exports={Turn,safeUrl,metadataSources};
