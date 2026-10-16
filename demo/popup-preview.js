(function () {
  'use strict';
  // Local UI fixture only. No extension data, real Key, paid request or reload.
  const query = new URLSearchParams(location.search);
  const listeners = [];
  const runtimeListeners = [];
  const state = {
    settings: XGrokCore.normalizeSettings({...XGrokCore.DEFAULT_SETTINGS,apiVerification:'only',apiConcurrency:Number(query.get('count')) || 4,interfaceLanguage:query.get('interface') || 'auto',language:query.get('answer') || 'auto'}),
    uiLanguage: GrokFirstUI.normalizeLanguage(query.get('lang') || 'en'),
  };
  const receipt = document.createElement('output');
  receipt.id = 'preview-receipt';
  receipt.hidden = true;
  document.body.append(receipt);
  const pick = keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys])
    .filter(key => Object.hasOwn(state,key)).map(key => [key,state[key]]));
  window.chrome = {
    runtime: {
      getManifest: () => ({version:'0.8.1-preview'}),
      onMessage: {addListener: fn => runtimeListeners.push(fn)},
      async sendMessage(message) {
        if (message.type === 'GET_UI_LANGUAGE') return {ok:true,language:state.uiLanguage};
        if (message.type === 'GET_CONFIG') return {ok:true,settings:state.settings,keyState:query.get('security')==='migration'?'migration':query.get('security')==='missing'?'missing':'ready',ready:!['missing','migration'].includes(query.get('security'))};
        if (message.type === 'OPEN_SETTINGS') { await this.openOptionsPage('api-key');return {ok:true}; }
        if (message.type === 'OPEN_HISTORY') {location.assign('/demo/history.html?lang='+encodeURIComponent(state.uiLanguage));return {ok:true};}
        if (message.type === 'SAVE_SETTINGS') {
          receipt.dataset.saveRequests = String(Number(receipt.dataset.saveRequests || 0) + 1);
          if (query.get('failure') === 'save') return {ok:false,error:'Local preview save error'};
          const previous = state.settings;
          state.settings = XGrokCore.normalizeSettings(message.settings);
          receipt.textContent = JSON.stringify({type:message.type,settings:state.settings});
          for (const listener of listeners) listener({settings:{oldValue:previous,newValue:state.settings}},'local');
          return {ok:true};
        }
        return {ok:false,error:'This local preview supports popup settings only.'};
      },
      async openOptionsPage(focus) {
        if (query.get('failure') === 'options') throw new Error('Local preview options error');
        const destination = new URL('/demo/options.html',location.origin);
        destination.searchParams.set('lang',state.uiLanguage);
        destination.searchParams.set('focus','api-key');
        if (query.get('security')==='migration') destination.searchParams.set('security','migration');
        if (query.get('scheme') === 'light') destination.searchParams.set('scheme','light');
        location.assign(destination.href);
      },
    },
    storage: {
      local: {async get(keys) {
        if (query.get('failure') === 'load') throw new Error('Local preview load error');
        return pick(keys);
      }},
      onChanged: {addListener: fn => listeners.push(fn)},
    },
  };
})();
