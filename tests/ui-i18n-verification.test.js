'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../extension/ui-i18n.js');
const core = require('../extension/feed-core.js');

const reasons = ['outputLimit','incomplete','connection','languageMismatch','rateLimit','access','server','unknown','timeout'];
test('API failure statuses explain recovery in every interface language without requiring raw provider prose',()=>{
  const keys=['apiKeyRejected','apiUsage','apiAccess','apiRequest','apiServer','apiConnection','apiTimeout','apiOutputLimit','apiIncomplete','apiFailed'];
  for(const language of ui.SUPPORTED_LANGUAGES)for(const suffix of keys){const key='error.'+suffix,value=ui.catalog[language][key];assert.ok(value?.trim(),`${language}: ${key}`);if(language!=='en')assert.notEqual(value,ui.catalog.en[key]);assert.ok(Array.from(value).length<180);assert.doesNotMatch(value,/\{(?:error|message|body)\}/);}
  assert.match(ui.t('error.apiUsage','en'),/budget or usage/);assert.match(ui.t('error.apiServer','zh-CN'),/xAI 服务/);
  for(const language of ui.SUPPORTED_LANGUAGES){assert.ok(ui.catalog[language]['note.accountLimit']?.trim());if(language!=='en')assert.notEqual(ui.t('note.accountLimit',language),ui.t('note.accountLimit','en'));}
  assert.match(ui.t('note.accountLimit','en'),/paused.*manually/);assert.match(ui.t('note.accountLimit','zh-CN'),/暂停.*预算.*手动/);
});

test('English UI consistently names the feature fact check while internal localization keys stay compatible', () => {
  assert.equal(ui.t('common.verification','en'),'Fact check');
  assert.equal(ui.t('status.verifying','en'),'Fact-checking…');
  assert.equal(ui.t('status.verificationQueued','en'),'Fact check queued');
  assert.equal(ui.t('status.inline','en'),'Fact-checking…');
  assert.equal(ui.t('status.explaining','en'),'Fact-checking…');
  assert.equal(ui.t('status.unverified','en'),'Not fact-checked');
  assert.equal(ui.t('options.verification','en'),'Fact check');
  assert.equal(ui.t('options.verifyPrompt','en'),'Fact-check prompt');
  assert.equal(ui.t('options.explanationMode','en'),'Fact-check style');
  assert.match(ui.t('options.verificationHelp','en'),/Fact checks read the full linked post/);
  for (const key of ['options.background','options.inline','options.off','options.explainPrompt']) assert.equal(ui.catalog.en[key],undefined);
  for (const [key,value] of Object.entries(ui.catalog.en)) {
    assert.doesNotMatch(value,/\b(?:verify|verifies|verified|verifying|verification|unverified)\b/i,`${key}: English UI should use fact check`);
  }
  assert.equal(ui.t('status.verifying','zh-CN'),'正在求证…');
  assert.equal(ui.t('options.verifyPrompt','zh-CN'),'事实求证');
});

test('incomplete verification describes the unfinished fact check without claiming an explanation was retained', () => {
  assert.equal(ui.t('status.incomplete','en'),'Fact check incomplete');
  assert.equal(ui.t('note.preserved','en'),'Partial result retained.');
  assert.equal(ui.t('status.incomplete','zh-CN'),'求证未完成');
  assert.equal(ui.t('note.preserved','zh-CN'),'已保留部分结果。');
  assert.equal(ui.t('verification.outputLimit','en'),'Response reached its output limit.');
  assert.equal(ui.t('verification.languageMismatch','en'),'Fact-check output did not match the requested language.');
  assert.equal(ui.t('verification.unknown','en'),'The service did not return a specific failure reason.');
  assert.equal(ui.t('verification.timeout','en'),'Fact-check request timed out.');
  assert.equal(ui.t('verification.timeout','zh-CN'),'求证请求超时。');
  assert.doesNotMatch(ui.t('status.incomplete','en'),/Partial answer/);
  assert.doesNotMatch(ui.t('note.preserved','en'),/previous/i);
});

test('all locales describe a single fact-check task and independent comment generation', () => {
  const keys=['options.providerAPI','options.verificationHelp','options.explanationMode','options.presetModeHelp','options.customModeHelp','popup.apiHint','comments.placeholder','comments.pending'];
  for(const language of ui.SUPPORTED_LANGUAGES) {
    for(const key of keys) {
      assert.ok(ui.catalog[language][key]?.trim(),`${language}: ${key}`);
      if(language!=='en')assert.notEqual(ui.catalog[language][key],ui.catalog.en[key],`${language}: ${key} should be localized`);
    }
    assert.equal(ui.t('status.explaining',language),ui.t('status.verifying',language));
    assert.equal(ui.t('status.inline',language),ui.t('status.verifying',language));
  }
  assert.doesNotMatch(keys.map(key=>ui.t(key,'en')).join(' '),/explain|second request|background fact-check/i);
  assert.doesNotMatch(keys.map(key=>ui.t(key,'zh-CN')).join(' '),/解释|第二次请求|后台求证/);
});

test('all supported X UI languages supply distinct, concise verification failure reasons', () => {
  assert.equal(ui.SUPPORTED_LANGUAGES.length,12);
  for (const language of ui.SUPPORTED_LANGUAGES) {
    const values = reasons.map(reason => {
      const key = `verification.${reason}`;
      const value = ui.catalog[language][key];
      assert.equal(typeof value,'string',`${language}: ${key}`);
      assert.ok(value.trim(),`${language}: ${key}`);
      assert.equal(ui.t(key,language),value,`${language}: ${key}`);
      assert.ok(Array.from(value).length<=140,`${language}: ${key} should fit a compact tooltip`);
      assert.doesNotMatch(value,/\{[A-Za-z][A-Za-z0-9_]*\}/,`${language}: ${key} requires no raw error text`);
      assert.doesNotMatch(value,/Grok can make mistakes|Reanalyze|retry|重试|重新分析|再試行|إعادة المحاولة|повторите|फिर कोशिश/i,`${language}: ${key} should only explain the reason`);
      if(language!=='en')assert.notEqual(value,ui.catalog.en[key],`${language}: ${key} should be localized`);
      return value;
    });
    assert.equal(new Set(values).size,reasons.length,`${language}: reasons must remain distinguishable`);
    for (const key of ['status.incomplete','note.preserved']) {
      assert.ok(ui.catalog[language][key].trim(),`${language}: ${key}`);
      if(language!=='en')assert.notEqual(ui.catalog[language][key],ui.catalog.en[key],`${language}: ${key} should be localized`);
    }
  }
});

test('answer and interface languages default to Auto and preserve independent manual choices', () => {
  assert.equal(core.DEFAULT_SETTINGS.language,'auto');
  assert.equal(core.DEFAULT_SETTINGS.interfaceLanguage,'auto');
  assert.equal(core.normalizeSettings({language:'ja'}).interfaceLanguage,'auto');
  assert.equal(core.normalizeSettings({interfaceLanguage:'zh-CN'}).language,'auto');
  assert.deepEqual(ui.INTERFACE_LANGUAGES.map(item=>item.value).sort(),['auto',...ui.SUPPORTED_LANGUAGES].sort());
  assert.deepEqual(ui.INTERFACE_LANGUAGES.map(item=>item.value),core.LANGUAGES.map(item=>item.value));
  for(const language of ui.SUPPORTED_LANGUAGES) {
    const settings=core.normalizeSettings({language:'pt-BR',interfaceLanguage:language});
    assert.equal(settings.language,'pt-BR');
    assert.equal(settings.interfaceLanguage,language);
    assert.equal(ui.resolveLanguage(settings.interfaceLanguage,'ja'),language);
  }
  assert.equal(core.normalizeSettings({interfaceLanguage:' ZH-cn '}).interfaceLanguage,'zh-CN');
  for(const invalid of ['it','en-US','<script>','zh Hant','ja\n<script>',true,{},null]) {
    assert.equal(core.normalizeSettings({interfaceLanguage:invalid}).interfaceLanguage,'auto');
    assert.equal(ui.resolveLanguage(invalid,'de-DE'),'de');
  }
});

test('Auto interface language follows observed X locale without changing the answer language', () => {
  for(const observed of ['zh-TW','zh_HK','ja-JP','de-DE','en-US']) {
    assert.equal(ui.resolveLanguage('auto',observed),ui.normalizeLanguage(observed));
    assert.equal(ui.resolveLanguage(undefined,observed),ui.normalizeLanguage(observed));
  }
  assert.equal(ui.resolveLanguage('zh-CN','ja-JP'),'zh-CN');
  assert.equal(ui.resolveLanguage('auto',undefined),'en');
  const post={id:'42',url:'https://x.com/person/status/42',language:'en',text:'This is an English post.'};
  const automatic=core.normalizeSettings({language:'auto',interfaceLanguage:'zh-CN'});
  assert.equal(core.resolvePostLanguage(automatic.language,post),'en');
  assert.equal(core.apiPostIdentity(post,automatic),core.apiPostIdentity(post,{...automatic,interfaceLanguage:'ja'}));
});

test('all UI locales describe separate language controls and saved versus session-only Key states', () => {
  const keys=['options.languageTitle','options.answerLanguage','options.interfaceLanguage','options.interfaceLanguageHelp','lang.interfaceAuto','options.uiHint','options.keyReadySaved','options.keyReady'];
  for(const language of ui.SUPPORTED_LANGUAGES) {
    for(const key of keys) {
      assert.equal(typeof ui.catalog[language][key],'string',`${language}: ${key}`);
      assert.ok(ui.catalog[language][key].trim(),`${language}: ${key}`);
      assert.equal(ui.t(key,language),ui.catalog[language][key]);
      if(language!=='en') assert.notEqual(ui.catalog[language][key],ui.catalog.en[key],`${language}: ${key} should be localized`);
    }
    assert.notEqual(ui.t('options.keyReadySaved',language),ui.t('options.keyReady',language));
    assert.notEqual(ui.t('options.answerLanguage',language),ui.t('options.interfaceLanguage',language));
  }
  assert.equal(ui.t('options.keyReadySaved','zh-CN'),'已保存在本机，重启浏览器后可继续使用。');
  assert.match(ui.t('options.keyReady','en'),/only for this browser session.*not saved.*again after restarting/);
  assert.match(ui.t('options.keyReadySaved','en'),/Saved on this device.*restart/);
});
