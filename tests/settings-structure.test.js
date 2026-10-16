'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

// This validates our source's explicit nesting. It deliberately rejects markup
// that a browser would silently repair; native DOM and constraint validation
// are separately exercised in an isolated Chromium acceptance run.
function strictTree(html){
  const root={tag:'#document',children:[]},stack=[root],ids=new Map();
  const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const source=html.replace(/<!--[\s\S]*?-->/g,'');
  for(const match of source.matchAll(/<\/?([A-Za-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*\/?>/g)){
    const tag=match[1].toLowerCase(),token=match[0];
    if(token.startsWith('</')){assert.equal(stack.at(-1).tag,tag,`Unexpected </${tag}>; current parent is <${stack.at(-1).tag}>`);stack.pop();continue;}
    const node={tag,parent:stack.at(-1),children:[],token};node.parent.children.push(node);
    const id=token.match(/\bid\s*=\s*(["'])(.*?)\1/i)?.[2];if(id){assert.equal(ids.has(id),false,`Duplicate #${id}`);ids.set(id,node);}
    if(!voidTags.has(tag)&&!token.endsWith('/>'))stack.push(node);
  }
  assert.equal(stack.length,1,`Unclosed <${stack.at(-1).tag}>`);return {root,ids};
}
const source=file=>fs.readFileSync(path.join(__dirname,'../extension',file+'.html'),'utf8');
const ancestor=(node,target)=>{for(let current=node;current;current=current.parent)if(current===target)return true;return false;};

test('Settings and setup HTML have explicit balanced nesting and unique IDs',()=>{
  for(const file of ['options','setup'])assert.doesNotThrow(()=>strictTree(source(file)),file);
});

test('provider panels are siblings and every provider-specific control belongs to its panel and settings form',()=>{
  const {ids}=strictTree(source('options')),form=ids.get('settings-form'),api=ids.get('api-fields'),build=ids.get('build-fields');
  assert.ok(form&&api&&build);assert.equal(api.parent,build.parent);assert.equal(api.parent.tag,'section');
  for(const [panel,controls]of [[api,['api-key','remember-key','api-model','api-reasoning-effort','api-concurrency','fast-preset','clear-key']],[build,['build-platform','generate-build-command','build-port','build-secret','build-model','build-reasoning-effort','check-build','build-guide','clear-build-connection']]]){
    for(const id of controls){assert.ok(ancestor(ids.get(id),panel),`#${id} escaped #${panel===api?'api-fields':'build-fields'}`);assert.ok(ancestor(ids.get(id),form),`#${id} escaped #settings-form`);}
  }
  for(const id of ['provider','enabled','analysis-dwell','web-search','x-search','language','interface-language','verify-prompt','comments-prompt','history-enabled','clear-cache','reload-extension']){
    assert.ok(ancestor(ids.get(id),form),`#${id} escaped #settings-form`);assert.equal(ancestor(ids.get(id),api)||ancestor(ids.get(id),build),false,`Shared #${id} is trapped in a provider panel`);
  }
});

test('a premature provider closing tag fails the structural check instead of relying on browser repair',()=>{
  const html=source('options'),marker=html.match(/<div class="connection-actions">[^\n]*<\/div>/)?.[0];assert.ok(marker);
  assert.throws(()=>strictTree(html.replace(marker,marker+'\n</div>')),/Unexpected/);
});
