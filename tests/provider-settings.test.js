'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../extension/feed-core.js');

test('API remains the default; retired page automation is not Grok Build',()=>{
  assert.equal(Core.DEFAULT_SETTINGS.provider,'api');
  for(const provider of [undefined,null,'native','invalid','API'])assert.equal(Core.normalizeSettings({provider}).provider,'api');
  assert.equal(Core.normalizeSettings({provider:'build'}).provider,'build');
  assert.equal(Core.normalizeSettings({provider:'api'}).provider,'api');
});

test('Build model, effort and transport have independent defaults',()=>{
  const settings=Core.normalizeSettings({});
  assert.equal(settings.buildTransport,'acp');assert.equal(settings.buildModel,'grok-4.7');assert.equal(settings.buildReasoningEffort,'low');
  assert.equal(settings.apiModel,'grok-4.3');assert.equal(settings.apiReasoningEffort,'none');
  assert.equal(Core.normalizeSettings({buildTransport:'cli'}).buildTransport,'acp');
  for(const buildTransport of ['',null,'shell','CLI'])assert.equal(Core.normalizeSettings({buildTransport}).buildTransport,'acp');
});

test('switching providers preserves each provider model and effort without copying credentials',()=>{
  const original={provider:'api',apiModel:'grok-4.6',apiReasoningEffort:'xhigh',buildModel:'grok-4.5',buildReasoningEffort:'medium',buildTransport:'cli',apiKey:'never part of settings'};
  const build=Core.normalizeSettings({...original,provider:'build'});
  assert.equal(build.apiModel,'grok-4.6');assert.equal(build.apiReasoningEffort,'xhigh');
  assert.equal(build.buildModel,'grok-4.5');assert.equal(build.buildReasoningEffort,'medium');assert.equal(build.buildTransport,'acp');
  assert.equal(Object.hasOwn(build,'apiKey'),false);assert.equal(original.apiKey,'never part of settings');
  const api=Core.normalizeSettings({...build,provider:'api'});
  assert.deepEqual({...api,provider:'build'},build);
});

test('Build preserves valid custom and API-only model IDs for explicit runtime negotiation',()=>{
  for(const buildModel of ['grok-4.3','custom-build-model','grok-4.7-latest']) {
    const settings=Core.normalizeSettings({provider:'build',buildModel,buildReasoningEffort:'high'});
    assert.equal(settings.buildModel,buildModel);
    assert.equal(settings.buildReasoningEffort,Core.buildReasoningEffort(buildModel,'high'));
  }
  for(const buildModel of ['',null,'bad model','grok;touch','../grok','x'.repeat(81)])assert.equal(Core.normalizeSettings({buildModel}).buildModel,'grok-4.7');
  assert.equal(Core.normalizeSettings({buildModel:'grok-4.3',buildReasoningEffort:'xhigh'}).buildReasoningEffort,'xhigh');
  assert.equal(Core.normalizeSettings({buildModel:'grok-4.7',buildReasoningEffort:'none'}).buildReasoningEffort,'low');
  assert.equal(Core.buildReasoningEffort('grok-4.3','minimal'),'minimal');
  assert.equal(Core.reasoningEffort('grok-4.7-build-fast','high'),'auto');
  assert.equal(Core.buildReasoningEffort('grok-4.7-build-fast','high'),'high');
  assert.equal(Core.normalizeSettings({buildModel:'grok-4.7-build-fast',buildReasoningEffort:'none'}).buildReasoningEffort,'low');
  assert.equal(Core.normalizeSettings({buildModel:'grok-4.7-build-fast'}).buildReasoningEffort,'low');
});

test('provider changes retain user language, editable task and API concurrency preferences',()=>{
  const settings=Core.normalizeSettings({provider:'build',language:'fr',interfaceLanguage:'zh-TW',explanationMode:'custom',verifyPrompt:'Check primary evidence.',commentsPrompt:'Offer useful questions.',apiConcurrency:7});
  assert.equal(settings.language,'fr');assert.equal(settings.interfaceLanguage,'zh-TW');assert.equal(settings.verifyPrompt,'Check primary evidence.');
  assert.equal(settings.commentsPrompt,'Offer useful questions.');assert.equal(settings.apiConcurrency,7);assert.equal(settings.apiVerification,'only');
});
