'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/feed-core.js');

test('new installations and retired selections use API preset without erasing prompts, language or model', () => {
  assert.equal(core.DEFAULT_SETTINGS.explanationMode, 'preset');
  const legacy = core.normalizeSettings({provider:'native',language:'ja',explainPrompt:'My saved explanation.',verifyPrompt:'My saved check.',commentsPrompt:'My saved comments.',apiModel:'custom-model'});
  assert.equal(legacy.explanationMode,'preset');
  assert.equal(legacy.provider,'api');assert.equal(legacy.language,'ja');assert.equal(legacy.apiModel,'custom-model');
  assert.equal(legacy.explainPrompt,'My saved explanation.');assert.equal(legacy.verifyPrompt,'My saved check.');assert.equal(legacy.commentsPrompt,'My saved comments.');
});

test('explanation modes normalize consistently and reject unexpected mode types', () => {
  for(const mode of ['preset','custom']) {
    assert.equal(core.explanationMode({explanationMode:mode}),mode);
    assert.equal(core.normalizeSettings({explanationMode:mode}).explanationMode,mode);
  }
  for(const mode of [undefined,null,'','url','URL','invalid',{},true,1]) {
    assert.equal(core.explanationMode({explanationMode:mode}),'preset');
    assert.equal(core.normalizeSettings({explanationMode:mode}).explanationMode,'preset');
  }
});

test('switching Fact Check styles preserves saved and dormant drafts and independent language and search', () => {
  let settings = core.normalizeSettings({explanationMode:'custom',language:'zh-TW',webSearch:false,xSearch:true,apiVerification:'off',explainPrompt:'\nMy explanation.\n',verifyPrompt:'My verification.'});
  for(const mode of ['preset','custom']) {
    settings=core.normalizeSettings({...settings,explanationMode:mode});
    assert.equal(settings.explainPrompt,'\nMy explanation.\n');assert.equal(settings.verifyPrompt,'My verification.');
    assert.equal(settings.language,'zh-TW');assert.equal(settings.webSearch,false);assert.equal(settings.xSearch,true);assert.equal(settings.apiVerification,'only');
  }
});

test('every API analysis style follows display language while expansion, edits and quotes remain stable', () => {
  const post={id:'123',url:'https://x.com/person/status/123',text:'This is the original English post.',language:'en'};
  for(const mode of ['preset','custom']) {
    const settings={provider:'api',explanationMode:mode,language:'auto'};
    const initial=core.apiPostIdentity(post,settings);
    assert.deepEqual(JSON.parse(initial),['post-input-v3-full-url',post.url,'en']);
    assert.notEqual(initial,core.apiPostIdentity({...post,text:'这是当前显示的中文翻译。',language:'zh-CN'},settings));
    assert.equal(initial,core.apiPostIdentity({...post,text:post.text+' This expansion stays in English.',quotedContext:[{text:'日本語の引用文です',language:'ja'}],images:[{url:'https://pbs.twimg.com/media/photo.jpg'}]},settings));
    assert.equal(initial,core.apiPostIdentity({...post,text:'An edited same-language display of the same full original post.'},settings));
    assert.equal(initial,core.apiPostIdentity({...post,url:post.url+'?s=20',language:'en-US'},settings));
    assert.notEqual(initial,core.apiPostIdentity({...post,id:'124',url:'https://x.com/person/status/124'},settings));
  }
});

test('every API style with a forced language keeps its identity across original and translated displays', () => {
  const original={id:'123',url:'https://x.com/person/status/123',text:'This is the English original.',language:'en'};
  const translated={...original,text:'これは表示中の日本語訳です。',language:'ja'};
  for(const mode of ['preset','custom'])for(const language of ['en','zh-CN','ja','pt-BR']) {
    const settings={provider:'api',explanationMode:mode,language};
    assert.equal(core.apiPostIdentity(original,settings),core.apiPostIdentity(translated,settings),language);
  }
  assert.notEqual(core.apiPostIdentity(original,{explanationMode:'preset',language:'en'}),core.apiPostIdentity(original,{explanationMode:'preset',language:'ja'}));
});

test('every API style recognizes display language before late DOM hint hydration without changing same-language jobs', () => {
  const post={id:'123',url:'https://x.com/person/status/123',text:'This is the original post with enough English prose.'};
  for(const mode of ['preset','custom']) {
    const settings={provider:'api',explanationMode:mode,language:'auto'};
    assert.equal(core.apiPostIdentity(post,settings),core.apiPostIdentity({...post,language:'en'},settings));
    assert.notEqual(core.apiPostIdentity(post,settings),core.apiPostIdentity({...post,text:'这是当前显示的中文帖子。'},settings));
  }
});

test('comment snapshots retain local text and quote identity',()=>{
  const original={id:'123',url:'https://x.com/person/status/123',text:'A visible excerpt.',quotedContext:[{id:'9',text:'The visible quote.'}]};
  const edited={...original,text:'An expanded visible excerpt.'},quoted={...original,quotedContext:[{id:'9',text:'An expanded visible quote.'}]};
  for(const settings of [undefined,{provider:'api',task:'comments',explanationMode:'preset',language:'auto'}]) {
    assert.notEqual(core.apiPostIdentity(original,settings),core.apiPostIdentity(edited,settings));
    assert.notEqual(core.apiPostIdentity(original,settings),core.apiPostIdentity(quoted,settings));
  }
});
