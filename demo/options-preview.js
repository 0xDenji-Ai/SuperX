(function () {
  'use strict';
  // Local preview only: production options UI with isolated mock storage. No
  // extension storage, real credential, network generation or runtime reload.
  const storageListeners=[],runtimeListeners=[];
  const query=new URLSearchParams(location.search);
  let state;
  try {state=JSON.parse(sessionStorage.getItem('grokfirst-options-preview')||'null');} catch {state=null;}
  state={settings:XGrokCore.normalizeSettings({...state?.settings,apiVerification:'only',
    ...(query.has('provider')?{provider:query.get('provider')}:{}),
    ...(query.has('interface')?{interfaceLanguage:query.get('interface')}:{}),
    ...(query.has('answer')?{language:query.get('answer')}:{})}),rememberApiKey:typeof state?.rememberApiKey==='boolean'?state.rememberApiKey:true,hasSavedKey:state?.hasSavedKey===true,migration:state?.migration===true,uiLanguage:GrokFirstUI.normalizeLanguage(query.get('lang')||'zh-CN')};
  if(query.get('security')==='migration'){state.hasSavedKey=true;state.migration=true;}
  if(query.get('security')==='saved'){state.hasSavedKey=true;state.migration=false;}
  let previewKey=state.hasSavedKey&&!state.migration?'preview-test-key-not-real':'';
  const previewSession={};
  let buildConfigured=query.get('saved')==='0'?false:query.get('build')==='ready',buildPort=2419;
  if(query.has('focus'))previewSession.superxOptionsFocus={id:query.get('focus')==='build'?'build':'api-key',nonce:'local-preview-focus'};
  const buildStatus=()=>({connected:query.get('build')==='ready',available:query.get('build')==='ready',authenticated:query.get('build')==='ready'?true:query.get('build')==='login'?false:undefined,ready:query.get('build')==='ready',errorCode:query.get('build')==='login'?'BUILD_LOGIN_REQUIRED':query.get('build')==='ready'?undefined:'BUILD_UNAVAILABLE',version:'preview',...(query.get('build')==='models'?{modelCatalog:[{id:'grok-4.7',available:true,efforts:['low','high']},{id:'grok-preview-fast',available:true,efforts:['low','high']}]}:{})});
  const security=()=>({keyState:previewKey?'ready':state.migration?'migration':'missing',remember:state.rememberApiKey,hasSavedKey:state.hasSavedKey});
  const banner=document.createElement('div');banner.id='preview-note';
  banner.style.cssText='display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px 16px;margin:0;padding:8px 16px;font:12px/1.5 system-ui;color:var(--muted,#71767b);background:var(--background,#000);border-bottom:1px solid var(--line,#2f3336)';
  const notice=document.createElement('span');notice.textContent='设置预览 · 模拟存储，无真实 Key 或 Grok 请求';
  const localeLabel=document.createElement('label');localeLabel.textContent='模拟 X 界面语言 ';
  localeLabel.style.cssText='display:flex;align-items:center;gap:6px;margin:0;font:inherit;color:inherit';
  const localeSelect=document.createElement('select');localeSelect.id='preview-locale';
  localeSelect.style.cssText='width:auto;min-height:28px;padding:3px 6px;font:inherit';
  for(const [value,label] of [['zh-CN','简体中文'],['en','English'],['ja','日本語'],['de','Deutsch'],['ar','العربية']]){
    const option=document.createElement('option');option.value=value;option.textContent=label;localeSelect.append(option);
  }
  localeSelect.value=state.uiLanguage;
  localeSelect.addEventListener('change',()=>{
    const previous=state.uiLanguage;state.uiLanguage=localeSelect.value;
    for(const listener of storageListeners)listener({uiLanguage:{oldValue:previous,newValue:state.uiLanguage}},'local');
    for(const listener of runtimeListeners)listener({type:'UI_LANGUAGE_CHANGED',language:state.uiLanguage});
  });
  localeLabel.append(localeSelect);banner.append(notice,localeLabel);
  document.body.prepend(banner);
  const receipt=document.createElement('output');receipt.id='preview-receipt';receipt.hidden=true;document.body.append(receipt);
  const persist=()=>sessionStorage.setItem('grokfirst-options-preview',JSON.stringify({settings:state.settings,rememberApiKey:state.rememberApiKey,hasSavedKey:state.hasSavedKey,migration:state.migration}));
  const pick=keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>Object.hasOwn(state,key)).map(key=>[key,state[key]]));
  window.chrome={
    permissions:{request:()=>Promise.resolve(query.get('permission')!=='denied')},
    runtime:{
      getManifest:()=>({version:'0.9.3-preview'}),reload:()=>location.reload(),
      onMessage:{addListener:fn=>runtimeListeners.push(fn)},
      async sendMessage(message){
        if(message.type==='GET_UI_LANGUAGE')return {ok:true,language:state.uiLanguage};
        if(message.type==='GET_SECURITY_STATUS')return {ok:true,...security()};
        if(message.type==='GET_CONFIG')return {ok:true,...state,ready:state.settings.provider==='build'?buildStatus().ready:Boolean(previewKey),buildStatus:buildStatus(),...security()};
        if(message.type==='GET_BUILD_STATUS'){receipt.textContent=JSON.stringify({type:message.type});return {ok:true,...buildStatus()};}
        if(message.type==='GET_BUILD_CONNECTION')return {ok:true,configured:buildConfigured,port:buildPort};
        if(message.type==='GET_BUILD_LAUNCH'){await import('/extension/build-setup.js');receipt.textContent=JSON.stringify({type:message.type,platform:message.platform});const secret='preview-local-code-not-real';return {ok:true,command:SuperXBuildSetup.command({platform:message.platform,port:message.port,secret}),port:message.port,secret};}
        if(message.type==='SAVE_BUILD_CONNECTION'){buildConfigured=true;buildPort=message.port;const previous=state.settings;state.settings=XGrokCore.normalizeSettings(message.settings||state.settings);persist();receipt.textContent=JSON.stringify({type:message.type,port:message.port,settings:state.settings,codePresent:typeof message.secret==='string'});for(const listener of storageListeners)listener({settings:{oldValue:previous,newValue:state.settings}},'local');return {ok:true};}
        if(message.type==='CLEAR_BUILD_CONNECTION'){buildConfigured=false;receipt.textContent=JSON.stringify({type:message.type});return {ok:true};}
        if(message.type==='OPEN_CONNECTOR_GUIDE'){receipt.textContent=JSON.stringify({type:message.type});location.assign('/extension/setup.html');return {ok:true};}
        if(message.type==='SAVE_SETTINGS'){
          const previous=state.settings;state.settings=XGrokCore.normalizeSettings(message.settings);persist();
          receipt.textContent=JSON.stringify({type:message.type,settings:state.settings,rememberApiKey:state.rememberApiKey});
          for(const listener of storageListeners)listener({settings:{oldValue:previous,newValue:state.settings}},'local');
          return {ok:true};
        }
        if(message.type==='CLEAR_CACHE')return {ok:true};
        if(message.type==='GET_HISTORY_STATUS')return {ok:true,enabled:state.superxHistoryEnabled!==false,count:0};
        if(message.type==='SET_HISTORY_ENABLED'){const previous=state.superxHistoryEnabled;state.superxHistoryEnabled=message.enabled;for(const listener of storageListeners)listener({superxHistoryEnabled:{oldValue:previous,newValue:message.enabled}},'local');return {ok:true,enabled:message.enabled};}
        if(message.type==='OPEN_HISTORY'){location.assign('/demo/history.html?lang='+encodeURIComponent(state.uiLanguage));return {ok:true};}
        if(message.type==='SAVE_KEY'){
          if(typeof message.remember==='boolean')state.rememberApiKey=message.remember;
          state.hasSavedKey=Boolean(message.apiKey&&state.rememberApiKey);state.migration=false;previewKey=message.apiKey?'preview-test-key-not-real':'';
          if(message.settings){const previous=state.settings;state.settings=XGrokCore.normalizeSettings(message.settings);for(const listener of storageListeners)listener({settings:{oldValue:previous,newValue:state.settings}},'local');}
          persist();
          receipt.textContent=JSON.stringify({type:message.type,rememberApiKey:state.rememberApiKey,keyPresent:Boolean(previewKey)});
          return {ok:true};
        }
        return {ok:false,error:'This local preview supports settings only.'};
      }
    },
    storage:{
      local:{async get(keys){return pick(keys);}},
      // Synthetic preview fixture: never use a real Key or persist credentials.
      session:{async get(keys){const all={apiKey:previewKey,...previewSession};return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>Object.hasOwn(all,key)).map(key=>[key,all[key]]));},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete previewSession[key];}},
      onChanged:{addListener:fn=>storageListeners.push(fn)}
    }
  };
})();
