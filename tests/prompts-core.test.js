'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../extension/feed-core.js');

test('legacy settings gain shared task prompts and migrate to API without changing model or language',()=>{
  const old=core.normalizeSettings({provider:'native',apiModel:'grok-custom',language:'ja'});
  assert.equal(old.provider,'api');assert.equal(old.apiModel,'grok-custom');assert.equal(old.language,'ja');
  for(const [task,field] of [['verify','verifyPrompt'],['comments','commentsPrompt']]){
    assert.equal(old[field],core.DEFAULT_PROMPTS[task]);assert.equal(core.DEFAULT_SETTINGS[field],core.DEFAULT_PROMPTS[task]);
    assert.ok(old[field].trim());
  }
  assert.equal(Object.isFrozen(core.DEFAULT_PROMPTS),true);
  assert.equal(Object.hasOwn(core.DEFAULT_PROMPTS,'explain'),false);
  assert.equal(Object.hasOwn(core.DEFAULT_SETTINGS,'explainPrompt'),false);
  assert.equal(Object.hasOwn(old,'explainPrompt'),false);
  assert.equal(old.apiVerification,'only');
});

test('custom task prompts preserve multilingual content and intentional whitespace independently',()=>{
  const explain='  用中文说明含义。\n保留关键术语。  ',verify='一次情報を確認してください。',comments='Ask one useful question.';
  const result=core.normalizeSettings({explainPrompt:explain,verifyPrompt:verify,commentsPrompt:comments});
  assert.equal(result.explainPrompt,explain);assert.equal(result.verifyPrompt,verify);assert.equal(result.commentsPrompt,comments);
});

test('empty, non-text and oversized prompt settings resolve to defaults while the exact limit is accepted',()=>{
  for(const field of ['verifyPrompt','commentsPrompt']){
    for(const value of [null,undefined,7,{},' \n\t ','x'.repeat(core.MAX_PROMPT_LENGTH+1)]){
      assert.equal(core.normalizeSettings({[field]:value})[field],core.DEFAULT_SETTINGS[field]);
    }
    const limit='x'.repeat(core.MAX_PROMPT_LENGTH);
    assert.equal(core.normalizeSettings({[field]:limit})[field],limit);
  }
});

test('retired explanation drafts are preserved only when valid without adding a default or restoring live explanation modes',()=>{
  for(const apiVerification of [undefined,'background','inline','off','only','invalid']){
    const result=core.normalizeSettings({apiVerification,explainPrompt:'  My saved draft.\n',verifyPrompt:'Saved check.',commentsPrompt:'Saved replies.'});
    assert.equal(result.apiVerification,'only');assert.equal(result.explainPrompt,'  My saved draft.\n');assert.equal(result.verifyPrompt,'Saved check.');assert.equal(result.commentsPrompt,'Saved replies.');
  }
  for(const value of [undefined,null,7,{},' \n\t ','x'.repeat(core.MAX_PROMPT_LENGTH+1)])assert.equal(Object.hasOwn(core.normalizeSettings({explainPrompt:value}),'explainPrompt'),false);
});
