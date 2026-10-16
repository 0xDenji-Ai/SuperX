(function() {
  'use strict';
  // Isolated local preview. These synthetic records never touch extension
  // storage, accounts, API Keys or the network.
  const query = new URLSearchParams(location.search),runtimeListeners = [],storageListeners = [];
  let language = GrokFirstUI.normalizeLanguage(query.get('lang') || 'en');
  let settings = XGrokCore.normalizeSettings({apiVerification:'only',interfaceLanguage:query.get('interface') || 'auto'});
  let enabled = query.get('history-state') !== 'off',epoch = 0;
  const current = Date.now();
  const factCheck = '**Insufficient evidence.** The chart omits its data source, sample and evaluation conditions. An original report and independent test results would be needed to support broader conclusions.\n\n*Saved local Fact Check preview; no sources were actually searched.*';
  let entries = query.get('history-state') === 'empty' ? [] : [
    {id:'10001',url:'https://x.com/example/status/10001',author:'Example · @example',text:'A useful idea deserves its full context.\n\nWhat does this chart actually show?',language:'en',firstViewedAt:current-720000,lastViewedAt:current-300000,visits:2,
      analysis:{text:factCheck,apiVerification:'only',verificationStatus:'unverified',model:'grok-4.3',usage:{input_tokens:850,output_tokens:384,total_tokens:1234},usageByStage:{verify:{input_tokens:850,output_tokens:384,total_tokens:1234}},usageComplete:true,sources:[],completedAt:current-280000},
      comments:['The original source would help clarify what this chart measures.','Which sample and time period does the chart cover?','I would separate the pattern in the chart from a claim about causation.']},
    {id:'10002',url:'https://x.com/sample/status/10002',author:'Sample · @sample',text:'刚发现一个有趣的工具，稍后分享完整体验。',language:'zh-CN',firstViewedAt:current-3600000,lastViewedAt:current-3600000,visits:1},
    {id:'10003',url:'https://x.com/demo/status/10003',author:'Demo · @demo',text:'Saved answers may contain code samples from a source.',language:'en',firstViewedAt:current-7200000,lastViewedAt:current-7200000,visits:1,
      analysis:{text:'**Check incomplete.** No independent source was reached before the simulated connection interruption. The following code is displayed as text and is not executed:\n\n```js\nconst message = "<img src=x onerror=alert(1)>";\n```\n\n*Local preview only; this is not a completed verification.*',apiVerification:'only',verificationStatus:'incomplete',verificationFailure:{code:'CONNECTION',stage:'verify',errorCode:'API_STREAM_INTERRUPTED'},model:'grok-4.3',usage:{input_tokens:460,output_tokens:220,total_tokens:680},usageComplete:false,sources:[],completedAt:current-7190000}},
  ];
  if (query.get('history-state') === 'large') entries = Array.from({length:1000},(_,index) => ({
    id:String(20000+index),url:`https://x.com/example/status/${20000+index}`,author:`Example ${index+1} · @example`,
    text:`Synthetic visible post ${index+1}. ` + 'A local history preview contains no real posts or credentials. '.repeat(35) + (index === 999 ? '\nUnique last-page phrase.' : ''),
    firstViewedAt:current-index*1000-1000,lastViewedAt:current-index*1000-1000,visits:1,
    analysis:{text:'**Synthetic saved answer.**\n\n' + 'Read the full context and original evidence before reaching a conclusion. '.repeat(48),sources:[],verificationStatus:'complete',model:'grok-4.3',usage:{total_tokens:1234},usageComplete:true},
  }));
  const snapshot = () => ({ok:true,entries:structuredClone(entries),enabled,limits:{ttlMs:86400000,maxEntries:1000,maxBytes:6000000},epoch});
  const changed = () => {epoch++;for (const listener of runtimeListeners) listener({type:'HISTORY_CHANGED',epoch,enabled});};
  window.SuperXHistoryPreview = {updateAnswer(id,text) {
    const entry=entries.find(value=>value.id===id);if(!entry)return;
    entry.analysis={...entry.analysis,text};changed();
  }};
  window.chrome = {
    runtime:{
      getManifest:() => ({version:'0.9.3-preview'}),
      onMessage:{addListener:listener => runtimeListeners.push(listener)},
      async sendMessage(message) {
        if (message.type === 'GET_UI_LANGUAGE') return {ok:true,language};
        if (message.type === 'GET_CONFIG') return {ok:true,ready:false,settings};
        if (message.type === 'GET_HISTORY') return snapshot();
        if (message.type === 'DELETE_HISTORY') { if (query.get('history-state') === 'error') return {ok:false};entries = entries.filter(entry => entry.id !== message.id);changed();return snapshot(); }
        if (message.type === 'CLEAR_HISTORY') { if (query.get('history-state') === 'error') return {ok:false};entries = [];changed();return snapshot(); }
        if (message.type === 'SET_HISTORY_ENABLED') { enabled = message.enabled;changed();return snapshot(); }
        return {ok:false};
      },
    },
    storage:{
      local:{async get() { return {uiLanguage:language}; }},
      onChanged:{addListener:listener => storageListeners.push(listener)},
    },
  };
  const banner = document.createElement('div');banner.id = 'preview-note';banner.textContent = 'Local history preview · Synthetic records · No API requests';
  banner.style.cssText = 'margin:0;padding:8px 16px;text-align:center;font:12px/1.5 system-ui;color:var(--muted,#71767b);background:var(--background,#000);border-bottom:1px solid var(--line,#2f3336)';
  document.body.prepend(banner);
})();
