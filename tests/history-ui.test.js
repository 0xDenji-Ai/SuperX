'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const history = require('../extension/history.js');
const core = require('../extension/feed-core.js');
const ui = require('../extension/ui-i18n.js');
const markdown = require('../extension/markdown-renderer.js');

// No HTML parser or user profile is available to this fixture. Unsafe HTML
// sinks throw, so untrusted saved posts and model responses must stay inert.
class Node {
  constructor(document,tag = '',value = '') {
    this.ownerDocument = document;this.tagName = tag.toUpperCase();this.nodeType = tag ? 1 : 3;this.value = value;
    this.childNodes = [];this.attributes = new Map();this.dataset = {};this.events = new Map();this.hidden = false;this.disabled = false;this.checked = false;
    this.style = {setProperty() {}};
    this.classList = {add:(...names) => {this.className = [this.className || '',...names].join(' ').trim();}};
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.nodeType === 11) this.append(...node.childNodes);
      else {const child = typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node;child.parentNode = this;this.childNodes.push(child);}
    }
  }
  appendChild(node) {this.append(node);return node;}
  insertBefore(node,reference) {
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = reference === null ? this.childNodes.length : this.childNodes.indexOf(reference);
    if (index < 0) throw new Error('Unknown insertion reference');this.childNodes.splice(index,0,node);node.parentNode = this;return node;
  }
  removeChild(node) {const index = this.childNodes.indexOf(node);if (index < 0) throw new Error('Unknown child');this.childNodes.splice(index,1);node.parentNode = null;return node;}
  contains(node) {return node === this || descendants(this).includes(node);}
  replaceChildren(...nodes) {this.childNodes = [];this.value = '';this.append(...nodes);}
  setAttribute(name,value) {this.attributes.set(name,String(value));}
  getAttribute(name) {return this.attributes.get(name) ?? null;}
  matches(selector) {return selector.split(',').some(part => {const match = part.trim().match(/^(?:([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);return match && (!match[1] || this.tagName === match[1].toUpperCase()) && (!match[2] || this.attributes.has(match[2]) && (match[3] === undefined || this.getAttribute(match[2]) === match[3]));});}
  querySelectorAll(selector) {return descendants(this).filter(node => node.nodeType === 1 && node.matches(selector));}
  addEventListener(type,listener) {const list = this.events.get(type) || [];list.push(listener);this.events.set(type,list);}
  async trigger(type,event = {}) {for (const listener of this.events.get(type) || []) await listener({target:this,...event});}
  focus() {this.ownerDocument.activeElement = this;}
  get textContent() {return this.value + this.childNodes.map(node => node.textContent).join('');}
  set textContent(value) {this.childNodes = [];this.value = String(value);}
  set innerHTML(value) {throw new Error('Unsafe innerHTML: ' + value);}
  set outerHTML(value) {throw new Error('Unsafe outerHTML: ' + value);}
  insertAdjacentHTML() {throw new Error('Unsafe HTML insertion');}
}
function descendants(node) {return node.childNodes.flatMap(child => [child,...descendants(child)]);}
function nodes(node,tag) {return descendants(node).filter(child => child.nodeType === 1 && (!tag || child.tagName === tag.toUpperCase()));}
const current = 1791320000000;
const post = (id = '1',overrides = {}) => ({id,url:`https://x.com/test/status/${id}`,author:'Test · @test',text:'Visible post text',lastViewedAt:current-1000,...overrides});
const snapshot = (entries,enabled = true) => ({ok:true,entries,enabled,limits:{ttlMs:86400000},epoch:0});
const deferred = () => {let resolve;const promise = new Promise(done => {resolve = done;});return {promise,resolve};};
function fixture({entries = [post()],send,locale = 'en',interfaceLanguage = 'auto'} = {}) {
  const created = [],ids = new Map(),document = {
    title:'',activeElement:null,
    createElement(tag) {const node = new Node(document,tag);created.push(node);return node;},
    createTextNode(text) {return new Node(document,'',String(text));},
    createDocumentFragment() {const node = new Node(document);node.nodeType = 11;return node;},
    getElementById(id) {return ids.get(id);},
    querySelectorAll(selector) {return document.documentElement.querySelectorAll(selector);},
    addEventListener(type,listener) {document.documentElement.addEventListener(type,listener);},
  };
  document.documentElement = document.createElement('html');document.body = document.createElement('body');document.documentElement.append(document.body);
  const tags = {'history-search':'input','history-enabled':'input','history-status':'p','history-count':'p','history-empty':'div','empty-title':'h2','empty-help':'p','history-list':'section','clear-confirmation':'section','history-more':'div'};
  for (const id of ['clear-history','history-status','history-enabled','refresh-history','history-search','history-count','history-empty','empty-title','empty-help','history-list','clear-confirmation','confirm-clear','cancel-clear','history-more','more-history']) {
    const element = document.createElement(tags[id] || 'button');element.id = id;element.setAttribute('id',id);element.value = '';ids.set(id,element);document.body.append(element);
  }
  ids.get('clear-confirmation').hidden = true;
  ids.get('history-search').setAttribute('data-i18n-placeholder','history.search');
  const heading = document.createElement('h1');heading.setAttribute('data-i18n','history.title');document.body.append(heading);
  let state = snapshot(entries),clock = current,timerId = 0;
  const calls = [],runtimeListeners = [],storageListeners = [],timers = new Map(),copies = [];
  const chrome = {
    runtime:{onMessage:{addListener:fn => runtimeListeners.push(fn)},async sendMessage(message) {
      calls.push(structuredClone(message));
      const intercepted = send ? await send(message) : undefined;if (intercepted !== undefined) return intercepted;
      if (message.type === 'GET_CONFIG') return {ok:true,ready:false,settings:core.normalizeSettings({interfaceLanguage})};
      if (message.type === 'GET_UI_LANGUAGE') return {ok:true,language:locale};
      if (message.type === 'GET_HISTORY') return structuredClone(state);
      if (message.type === 'DELETE_HISTORY') state = snapshot(state.entries.filter(entry => entry.id !== message.id),state.enabled);
      else if (message.type === 'CLEAR_HISTORY') state = snapshot([],state.enabled);
      else if (message.type === 'SET_HISTORY_ENABLED') state = snapshot(state.entries,message.enabled);
      return structuredClone(state);
    }},
    storage:{local:{async get() {return {uiLanguage:locale};}},onChanged:{addListener:fn => storageListeners.push(fn)}},
  };
  const environment = {document,chrome,XGrokCore:core,GrokFirstUI:ui,GrokFirstMarkdown:markdown,
    navigator:{language:locale,clipboard:{async writeText(text) {copies.push(text);}}},
    setTimeout(fn,delay) {const id = ++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id) {timers.delete(id);},addEventListener() {},
  };
  const controller = history.create({environment,now:() => clock});
  return {document,created,environment,controller,calls,copies,timers,$:id => ids.get(id),setNow:value => {clock = value;},setSnapshot:value => {state = value;},
    runtime:async message => {for (const listener of runtimeListeners) await listener(message);},
    storage:async changes => {for (const listener of storageListeners) await listener(changes,'local');},
    articles:() => nodes(ids.get('history-list'),'article'),
    async openFirstAnswer() {const details = nodes(ids.get('history-list'),'details')[0];details.open = true;await details.trigger('toggle');return details;},
  };
}

test('history only opens canonical X posts and excludes credentials and active schemes',() => {
  assert.equal(history.safePostUrl('https://twitter.com/Example/status/123/photo/1?s=20'),'https://x.com/example/status/123');
  assert.equal(history.safePostUrl('https://x.com/i/status/456'),'https://x.com/i/status/456');
  assert.equal(history.safePostUrl('https://x.com/i/web/status/456'),'https://x.com/i/web/status/456');
  for (const value of ['javascript:alert(1)','data:text/html,x','https://evil.test/test/status/1','https://x.com.evil.test/test/status/1','https://user:pass@x.com/test/status/1','https://x.com/home','/test/status/1']) assert.equal(history.safePostUrl(value),null);
});

test('history filters exactly 24 hours, future anomalies and searches saved answers locally',() => {
  const records = [post('1',{lastViewedAt:current-86400000}),post('2',{author:'Alice',lastViewedAt:current-100}),post('3',{analysis:{text:'Unique answer'},lastViewedAt:current-300}),post('4',{lastViewedAt:current+61000}),post('5',{comments:['Useful phrase'],lastViewedAt:current-200})];
  assert.deepEqual(history.filterEntries(records,'',current).map(entry => entry.id),['2','5','3']);
  assert.deepEqual(history.filterEntries(records,'ALICE',current).map(entry => entry.id),['2']);
  assert.deepEqual(history.filterEntries(records,'unique ANSWER',current).map(entry => entry.id),['3']);
  assert.deepEqual(history.filterEntries(records,'phrase',current).map(entry => entry.id),['5']);
});

test('history normalizes untrusted DTOs, rejects invalid links and bounds render input',() => {
  const records = history.normalizeEntries([post('1',{text:'x'.repeat(13000),analysis:{text:'y'.repeat(31000),sources:[{url:'javascript:alert(1)'},{url:'https://user:pass@example.com'},{url:'https://example.com',title:'Source'}]},comments:['a','b','c','d']}),post('1'),post('2',{url:'https://evil.test/post'}),post('3',{lastViewedAt:NaN})]);
  assert.equal(records.length,1);assert.equal(records[0].text.length,12000);assert.equal(records[0].analysis.text.length,30000);assert.equal(records[0].analysis.sources.length,1);assert.deepEqual(records[0].comments,['a','b','c']);
});

test('history suppresses old tool-only answer pollution without filtering viewed posts or making API requests',async () => {
  const command='{"absolute_path":"web_search","query":"private tool progress"}';
  const normalized=history.normalizeEntries([post('1',{text:command,analysis:{text:command,verificationStatus:'completed',sources:[{url:'https://example.com/tool-progress',title:'Tool progress'}],usage:{total_tokens:17}}})]);
  assert.equal(normalized[0].text,command,'The actual viewed post remains unchanged');
  assert.equal(normalized[0].analysis.text,'');assert.equal(normalized[0].analysis.verificationStatus,'incomplete');assert.deepEqual(normalized[0].analysis.sources,[]);
  const page=fixture({entries:[post('1',{analysis:{text:command,verificationStatus:'completed',sources:[]}})]});await page.controller.start();
  assert.doesNotMatch(page.$('history-list').textContent,/absolute_path|private tool progress/);
  assert.match(page.$('history-list').textContent,/Fact check incomplete/);
  assert.equal(nodes(page.$('history-list'),'details').length,0);
  assert.deepEqual(page.calls.map(call=>call.type).sort(),['GET_CONFIG','GET_HISTORY','GET_UI_LANGUAGE'].sort());
});

test('history preserves legitimate JSON and code that accompanies saved evidence',async () => {
  for(const text of ['{"count":8,"status":"reported"}','```json\n{"count":8}\n```','Evidence notes:\n\n{"absolute_path":"web_search","query":"quoted diagnostic"}']) {
    const page=fixture({entries:[post('1',{analysis:{text,verificationStatus:'completed',sources:[]}})]});await page.controller.start();await page.openFirstAnswer();
    const answer=nodes(page.$('history-list'),'details')[0].textContent;
    if(text.includes('absolute_path'))assert.match(answer,/absolute_path/);else assert.match(answer,/8/);
    assert.doesNotMatch(answer,/Fact check incomplete/);
  }
});

test('posts and expanded model HTML stay inert, without images or network generation',async () => {
  const page = fixture({entries:[post('1',{author:'<img src=x>',text:'<img src=x onerror=alert(1)>',analysis:{text:'# **A heading**\n\n<img src="https://tracker.test/pixel" onerror=alert(1)>\n\n![track](https://tracker.test/image)\n\n[bad](javascript:alert(1))',sources:[],model:'<svg onload=alert(1)>'}})]});
  await page.controller.start();await page.openFirstAnswer();
  assert.match(page.$('history-list').textContent,/<img src=x onerror=alert\(1\)>/);
  assert.match(page.$('history-list').textContent,/<svg onload=alert\(1\)>/);
  assert.equal(nodes(page.$('history-list'),'img').length,0);assert.equal(nodes(page.$('history-list'),'svg').length,0);
  assert.equal(nodes(page.$('history-list'),'strong').length,1);
  assert.deepEqual(page.calls.map(call => call.type).sort(),['GET_CONFIG','GET_HISTORY','GET_UI_LANGUAGE'].sort());
});

test('history opens original posts safely and hides only duplicate sources',async () => {
  const page = fixture({entries:[post('1',{analysis:{text:'[Already cited](https://example.com/a)',sources:[{url:'https://example.com/a',title:'1'},{url:'https://example.org/report',title:'2'},{url:'https://example.net/report',title:'Named source'}]}})]});
  await page.controller.start();await page.openFirstAnswer();
  const links = nodes(page.$('history-list'),'a');
  assert.equal(links.filter(link => link.href === 'https://example.com/a').length,1);
  assert.ok(links.some(link => link.textContent === 'example.org'));assert.ok(links.some(link => link.textContent === 'Named source'));
  for (const link of links) {assert.equal(link.target,'_blank');assert.match(link.rel,/noopener/);assert.match(link.rel,/noreferrer/);}
});

test('records without analysis remain readable without an API Key',async () => {
  const page = fixture();await page.controller.start();
  assert.equal(page.articles().length,1);assert.match(page.$('history-list').textContent,/No saved answer/);
  assert.equal(page.$('history-enabled').disabled,false);assert.equal(nodes(page.$('history-list'),'details').length,0);
});

test('search includes answers and comments, changes no storage and sends no requests',async () => {
  const page = fixture({entries:[post('1',{analysis:{text:'Quantum phrase'}}),post('2',{comments:['Draft phrase']})]});await page.controller.start();const calls = page.calls.length;
  page.$('history-search').value = 'quantum';await page.$('history-search').trigger('input');assert.equal(page.articles()[0].dataset.entryId,'1');
  page.$('history-search').value = 'draft';await page.$('history-search').trigger('input');assert.equal(page.articles()[0].dataset.entryId,'2');
  page.$('history-search').value = 'absent';await page.$('history-search').trigger('input');assert.equal(page.$('history-empty').hidden,false);assert.match(page.$('empty-title').textContent,/No matching/);assert.equal(page.calls.length,calls);
});

test('an unavailable store shows a retryable load error and never a fake empty success',async () => {
  let fail = true;const page = fixture({send:message => message.type === 'GET_HISTORY' && fail ? {ok:false} : undefined});await page.controller.start();
  assert.equal(page.$('history-status').dataset.state,'error');assert.equal(page.$('history-empty').hidden,true);assert.equal(page.$('refresh-history').disabled,false);
  fail = false;await page.controller.refresh();assert.equal(page.articles().length,1);assert.equal(page.$('history-status').dataset.state,'success');
});

test('a failed delete preserves records and reports failure instead of success',async () => {
  const page = fixture({send:message => message.type === 'DELETE_HISTORY' ? {ok:false} : undefined});await page.controller.start();
  await nodes(page.$('history-list'),'button')[0].trigger('click');
  assert.equal(page.articles().length,1);assert.equal(page.$('history-status').dataset.state,'error');assert.match(page.$('history-status').textContent,/delete/i);
});

test('a malformed mutation acknowledgement never removes a record',async () => {
  const page = fixture({send:message => message.type === 'DELETE_HISTORY' ? {ok:true} : undefined});await page.controller.start();await nodes(page.$('history-list'),'button')[0].trigger('click');
  assert.equal(page.articles().length,1);assert.equal(page.$('history-status').dataset.state,'error');
});

test('delete applies the acknowledged snapshot and transfers keyboard focus',async () => {
  const page = fixture({entries:[post('1'),post('2')]});await page.controller.start();await nodes(page.$('history-list'),'button')[0].trigger('click');
  assert.deepEqual(page.articles().map(entry => entry.dataset.entryId),['2']);assert.equal(page.document.activeElement,page.$('history-search'));
});

test('an old refresh cannot resurrect a record deleted while it was loading',async () => {
  const pending = deferred();let delayed = false;
  const page = fixture({send:message => message.type === 'GET_HISTORY' && delayed ? pending.promise : undefined});await page.controller.start();
  delayed = true;const refreshing = page.controller.refresh();await nodes(page.$('history-list'),'button')[0].trigger('click');
  pending.resolve(snapshot([post()]));await refreshing;assert.equal(page.articles().length,0);assert.match(page.$('history-status').textContent,/Deleted/i);
});

test('clear uses a lightweight confirmation and cancellation sends no mutation',async () => {
  const page = fixture();await page.controller.start();const before = page.calls.length;await page.$('clear-history').trigger('click');
  assert.equal(page.$('clear-confirmation').hidden,false);assert.equal(page.document.activeElement,page.$('confirm-clear'));assert.equal(page.calls.length,before);
  await page.$('cancel-clear').trigger('click');assert.equal(page.$('clear-confirmation').hidden,true);assert.equal(page.articles().length,1);assert.equal(page.document.activeElement,page.$('clear-history'));
});

test('failed clear keeps saved records and confirmation for retry',async () => {
  const page = fixture({send:message => message.type === 'CLEAR_HISTORY' ? {ok:false} : undefined});await page.controller.start();await page.$('clear-history').trigger('click');await page.$('confirm-clear').trigger('click');
  assert.equal(page.articles().length,1);assert.equal(page.$('clear-confirmation').hidden,false);assert.equal(page.$('history-status').dataset.state,'error');assert.equal(page.$('confirm-clear').disabled,false);
});

test('successful clear acknowledges an empty list and closes confirmation',async () => {
  const page = fixture();await page.controller.start();await page.$('clear-history').trigger('click');await page.$('confirm-clear').trigger('click');
  assert.equal(page.articles().length,0);assert.equal(page.$('clear-confirmation').hidden,true);assert.equal(page.$('history-empty').hidden,false);assert.equal(page.$('clear-history').disabled,true);
});

test('turning recording off keeps existing records and failed updates restore the checkbox',async () => {
  let fail = false;const page = fixture({send:message => message.type === 'SET_HISTORY_ENABLED' && fail ? {ok:false} : undefined});await page.controller.start();
  page.$('history-enabled').checked = false;await page.$('history-enabled').trigger('change');assert.equal(page.$('history-enabled').checked,false);assert.equal(page.articles().length,1);
  fail = true;page.$('history-enabled').checked = true;await page.$('history-enabled').trigger('change');assert.equal(page.$('history-enabled').checked,false);assert.equal(page.$('history-status').dataset.state,'error');
});

test('copy uses saved drafts only and reports clipboard errors truthfully',async () => {
  const page = fixture({entries:[post('1',{comments:['Saved one-line comment']})]});await page.controller.start();const details = await page.openFirstAnswer(),button = nodes(details,'button')[0],calls = page.calls.length;
  await button.trigger('click');assert.deepEqual(page.copies,['Saved one-line comment']);assert.equal(page.calls.length,calls);assert.match(page.$('history-status').textContent,/Copied/i);
  page.environment.navigator.clipboard.writeText = async () => {throw new Error('Denied');};await button.trigger('click');assert.equal(page.$('history-status').dataset.state,'error');
});

test('interface language follows X automatically while a manual choice takes precedence',async () => {
  const page = fixture();await page.controller.start();await page.runtime({type:'UI_LANGUAGE_CHANGED',language:'zh-CN'});assert.equal(page.document.documentElement.lang,'zh-CN');assert.equal(page.document.title,'SuperX · 浏览历史');
  await page.storage({settings:{newValue:core.normalizeSettings({interfaceLanguage:'ja'})}});assert.equal(page.document.documentElement.lang,'ja');
  await page.runtime({type:'UI_LANGUAGE_CHANGED',language:'ar'});assert.equal(page.document.documentElement.lang,'ja');
  await page.storage({settings:{newValue:core.normalizeSettings({interfaceLanguage:'auto'})}});assert.equal(page.document.documentElement.lang,'ar');assert.equal(page.document.documentElement.dir,'rtl');
});

test('late initial locale results do not overwrite a newer X language event',async () => {
  const pending = deferred();const page = fixture({send:message => message.type === 'GET_UI_LANGUAGE' ? pending.promise : undefined});
  const starting = page.controller.start();await page.runtime({type:'UI_LANGUAGE_CHANGED',language:'zh-CN'});pending.resolve({ok:true,language:'en'});await starting;
  assert.equal(page.document.documentElement.lang,'zh-CN');
});

test('late initial config cannot overwrite a new manual interface language',async () => {
  const pending = deferred();const page = fixture({send:message => message.type === 'GET_CONFIG' ? pending.promise : undefined});const starting = page.controller.start();
  await page.storage({settings:{newValue:core.normalizeSettings({interfaceLanguage:'ja'})}});pending.resolve({ok:true,settings:core.normalizeSettings({interfaceLanguage:'en'})});await starting;assert.equal(page.document.documentElement.lang,'ja');
});

test('visible records expire without an API request when the history page stays open',async () => {
  const page = fixture({entries:[post('1',{lastViewedAt:current-86400000+100})]});await page.controller.start();const before = page.calls.length;assert.equal(page.articles().length,1);
  page.setNow(current+101);page.controller.render();assert.equal(page.articles().length,0);assert.equal(page.calls.length,before);
});

test('the newest refresh wins when two history reads finish out of order',async () => {
  const reads = [deferred(),deferred()];let delayed = false,index = 0;
  const page = fixture({send:message => message.type === 'GET_HISTORY' && delayed ? reads[index++].promise : undefined});await page.controller.start();delayed = true;
  const first = page.controller.refresh(),second = page.controller.refresh();reads[1].resolve(snapshot([post('2')]));await second;reads[0].resolve(snapshot([post('1')]));await first;assert.equal(page.articles()[0].dataset.entryId,'2');
});

test('storage and runtime history notifications debounce into one read',async () => {
  const page = fixture();await page.controller.start();const before = page.calls.filter(call => call.type === 'GET_HISTORY').length;
  await page.runtime({type:'HISTORY_CHANGED'});await page.storage({superxHistoryEnabled:{newValue:false}});await page.storage({superxHistory:{newValue:{}}});
  const pending = [...page.timers.values()].filter(timer => timer.delay === 250);assert.equal(pending.length,1);pending[0].fn();await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.calls.filter(call => call.type === 'GET_HISTORY').length,before+1);
});

test('a saved answer stays expanded through local search and language changes',async () => {
  const page = fixture({entries:[post('1',{analysis:{text:'**Saved answer**',sources:[]}})]});await page.controller.start();await page.openFirstAnswer();
  page.$('history-search').value = 'saved';await page.$('history-search').trigger('input');assert.equal(nodes(page.$('history-list'),'details')[0].open,true);assert.equal(nodes(page.$('history-list'),'strong')[0].textContent,'Saved answer');
  await page.runtime({type:'UI_LANGUAGE_CHANGED',language:'zh-CN'});assert.equal(nodes(page.$('history-list'),'details')[0].open,true);
});

test('a maximum-sized history initially builds only 100 rows and searches every record',async () => {
  const entries = Array.from({length:1000},(_,index) => post(String(index+1),{text:'x'.repeat(5800) + (index === 998 ? ' unique-last-page' : ''),lastViewedAt:current-index-1}));
  const page = fixture({entries});await page.controller.start();
  assert.equal(page.articles().length,100);assert.equal(page.$('history-more').hidden,false);assert.match(page.$('history-count').textContent,/1,000/);
  const calls = page.calls.length;await page.$('more-history').trigger('click');assert.equal(page.articles().length,200);assert.equal(page.calls.length,calls);
  page.$('history-search').value = 'unique-last-page';await page.$('history-search').trigger('input');assert.equal(page.articles().length,1);assert.equal(page.articles()[0].dataset.entryId,'999');assert.equal(page.$('history-more').hidden,true);assert.equal(page.calls.length,calls);
  page.$('history-search').value = '';await page.$('history-search').trigger('input');assert.equal(page.articles().length,100);
});

test('an unchanged history read preserves answer DOM and focused buttons',async () => {
  const page = fixture({entries:[post('1',{analysis:{text:'**Read this answer**',sources:[]},comments:['Saved draft']})]});await page.controller.start();
  const details = await page.openFirstAnswer(),answer = nodes(details,'strong')[0],button = nodes(details,'button')[0],row = page.articles()[0];button.focus();
  const created = page.created.length;await page.controller.refresh();
  assert.equal(page.articles()[0],row);assert.equal(nodes(page.$('history-list'),'details')[0],details);assert.equal(nodes(details,'strong')[0],answer);assert.equal(page.document.activeElement,button);assert.equal(page.created.length,created);
});

test('answer DOM survives language changes while labels translate in place',async () => {
  const page = fixture({entries:[post('1',{analysis:{text:'**Saved answer**',sources:[],model:'grok-4.3',usage:{total_tokens:1200},usageComplete:true}})]});await page.controller.start();
  const details = await page.openFirstAnswer(),strong = nodes(details,'strong')[0];await page.runtime({type:'UI_LANGUAGE_CHANGED',language:'zh-CN'});
  assert.equal(nodes(page.$('history-list'),'strong')[0],strong);assert.equal(nodes(page.$('history-list'),'details')[0],details);assert.match(nodes(details,'summary')[0].textContent,/收起/);
});

test('passive updates wait for a reader to finish selecting an answer',async () => {
  const page = fixture({entries:[post('1',{analysis:{text:'**First answer**',sources:[]}})]});await page.controller.start();const details = await page.openFirstAnswer(),strong = nodes(details,'strong')[0];
  let selection = {isCollapsed:false,anchorNode:strong.childNodes[0],focusNode:strong.childNodes[0]};page.environment.getSelection = () => selection;
  page.setSnapshot(snapshot([post('1',{analysis:{text:'**Updated answer**',sources:[]}})]));await page.controller.refresh({forceList:false});
  assert.equal(nodes(page.$('history-list'),'strong')[0],strong);assert.match(page.$('history-list').textContent,/First answer/);assert.doesNotMatch(page.$('history-list').textContent,/Updated answer/);
  selection = {isCollapsed:true};await page.document.documentElement.trigger('selectionchange');assert.match(page.$('history-list').textContent,/Updated answer/);
});

test('explicit clear still removes selected text after acknowledgement',async () => {
  const page = fixture({entries:[post('1',{analysis:{text:'**Saved answer**',sources:[]}})]});await page.controller.start();const details = await page.openFirstAnswer(),text = nodes(details,'strong')[0].childNodes[0];
  page.environment.getSelection = () => ({isCollapsed:false,anchorNode:text,focusNode:text});await page.$('clear-history').trigger('click');await page.$('confirm-clear').trigger('click');assert.equal(page.articles().length,0);
});

test('queued details toggles do not rebuild a restored answer or mutate its replacement',async () => {
  const page = fixture({entries:[post('1',{analysis:{text:'**Saved answer**',sources:[]}})]});await page.controller.start();const details = await page.openFirstAnswer(),strong = nodes(details,'strong')[0];
  await details.trigger('toggle');assert.equal(nodes(details,'strong')[0],strong);
  page.setSnapshot(snapshot([post('1',{analysis:{text:'**Replacement answer**',sources:[]}})]));await page.controller.refresh();const replacement = nodes(page.$('history-list'),'details')[0];assert.notEqual(replacement,details);assert.equal(replacement.open,true);
  details.open = false;await details.trigger('toggle');page.controller.render();assert.equal(replacement.open,true);assert.match(nodes(replacement,'summary')[0].textContent,/Hide/);
});

test('closed answers release rendered nodes and reopen safely on demand',async () => {
  const page = fixture({entries:[post('1',{analysis:{text:'**Saved answer**',sources:[]}})]});await page.controller.start();const details = await page.openFirstAnswer();assert.equal(nodes(details,'strong').length,1);
  details.open = false;await details.trigger('toggle');assert.equal(nodes(details,'strong').length,0);
  details.open = true;await details.trigger('toggle');assert.equal(nodes(details,'strong').length,1);
});

test('invalid usage and boundary metadata cannot break rendering a saved answer',async () => {
  const page = fixture({entries:[post('1',{analysis:{text:'**Available answer**',verificationStart:1n,usage:{total_tokens:1n,input_tokens:-1,output_tokens:Infinity},sources:[]}})]});await page.controller.start();await page.openFirstAnswer();assert.equal(nodes(page.$('history-list'),'strong')[0].textContent,'Available answer');assert.equal(page.$('history-status').dataset.state,'success');
});
