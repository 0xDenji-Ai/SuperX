(async function(){
  'use strict';
  const UI=globalThis.GrokFirstUI,Core=globalThis.XGrokCore,$=id=>document.getElementById(id);
  let locale='en',settings=Core.normalizeSettings(Core.DEFAULT_SETTINGS),configured=false,secretChanged=false,busy=false,checkRevision=0,ready=false,catalog=[];
  const BUILD_EFFORTS=['none','minimal','low','medium','high','xhigh'];
  const t=(key,vars)=>UI.t(key,locale,vars),status=(key,vars)=>{$('status').textContent=t(key,vars);};
  async function send(message){const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw new Error(t(result?.errorKey||'errors.noResponse',result?.vars));return result;}
  function requestLocalAccess(){try{return chrome.permissions?.request({origins:['http://127.0.0.1/*']})||Promise.resolve(false);}catch{return Promise.resolve(false);}}
  function render(){
    UI.apply(document,locale);document.title=`SuperX · ${t('options.buildSetup')}`;
    $('secret').placeholder=t(configured?'build.savedCode':'build.codePlaceholder');
    $('address').textContent=`ws://127.0.0.1:${$('port').value || 2419}`;
    for(const id of ['generate','check','save','platform','port','secret','model','reasoning'])$(id).disabled=busy;
    $('model-choices').hidden=!ready||catalog.length===0;
    $('save').disabled=busy||!ready||Core.isNonTextGenerationModel($('model').value)||!catalog.some(entry=>entry.id===$('model').value)||!effortsFor($('model').value).includes($('reasoning').value);
  }
  function effortsFor(model){const entry=catalog.find(item=>item.id===model);return !entry?[]:Array.isArray(entry.efforts)?BUILD_EFFORTS.filter(value=>entry.efforts.includes(value)):BUILD_EFFORTS;}
  function populateReasoning(preferred,modelChanged=false){const select=$('reasoning'),model=$('model').value,efforts=effortsFor(model),fallback=Core.buildReasoningEffort(model);select.replaceChildren();for(const effort of efforts){const option=document.createElement('option');option.value=effort;option.textContent=t('options.reasoning.'+effort);select.append(option);}const selected=efforts.includes(preferred)?preferred:!modelChanged&&BUILD_EFFORTS.includes(preferred)?preferred:efforts.includes(fallback)?fallback:efforts[0]||'';if(selected&&!efforts.includes(selected)){const option=document.createElement('option');option.value=selected;option.textContent=t('options.reasoning.'+selected);option.disabled=true;select.append(option);}select.value=selected;}
  function populateModels(raw){
    const previousModel=$('model').value||settings.buildModel,previousEffort=$('reasoning').value||settings.buildReasoningEffort;
    catalog=Array.isArray(raw)?raw.flatMap(entry=>{const id=typeof entry==='string'?entry:entry?.id;return typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id)&&entry.available!==false?[{id,...(Array.isArray(entry?.efforts)?{efforts:entry.efforts}:{})}]:[];}):[];
    const choices=[...Core.API_MODELS];if(!choices.some(entry=>entry.value===settings.buildModel))choices.push({value:settings.buildModel,label:t(Core.isNonTextGenerationModel(settings.buildModel)?'options.unsupportedModel':'options.savedModel',{model:settings.buildModel})});
    const select=$('model');select.replaceChildren();for(const entry of choices){const option=document.createElement('option');option.value=entry.value;option.textContent=entry.label;option.disabled=Core.isNonTextGenerationModel(entry.value)||!catalog.some(item=>item.id===entry.value);select.append(option);}
    // Preserve an unavailable default/saved model instead of silently choosing
    // a more expensive model. A different choice requires a user action.
    select.value=previousModel||settings.buildModel;populateReasoning(previousEffort);
  }
  function selectionStatus(){
    if(Core.isNonTextGenerationModel($('model').value))status('error.modelUnsupported');
    else if(!catalog.some(entry=>entry.id===$('model').value))status('options.buildModelUnavailable',{model:$('model').value||settings.buildModel});
    else if(!effortsFor($('model').value).includes($('reasoning').value))status('options.reasoningInvalid');
    else status('build.ready');
  }
  function checkKey(result){if(result.ready)return 'build.ready';if(result.errorCode==='BUILD_CANCEL_UNCONFIRMED')return 'build.cancelUnconfirmed';if(result.errorCode==='BUILD_PERMISSION_REQUIRED')return 'build.permission';if(result.errorCode==='BUILD_CONNECTION_REQUIRED')return 'build.codeRequired';if(result.errorCode==='BUILD_AUTH_FAILED')return 'build.codeInvalid';if(result.errorCode==='BUILD_LOGIN_REQUIRED')return 'build.login';if(['BUILD_VERSION_UNSUPPORTED','BUILD_TOOL_POLICY'].includes(result.errorCode))return 'build.unsupported';return 'build.missing';}
  function reset(){checkRevision++;ready=false;catalog=[];$('launch').hidden=true;status('build.unknown');render();}
  try{
    const [local,language,connection]=await Promise.all([chrome.storage.local.get('settings'),send({type:'GET_UI_LANGUAGE'}),send({type:'GET_BUILD_CONNECTION'})]);
    settings=Core.normalizeSettings(local.settings);locale=UI.resolveLanguage(settings.interfaceLanguage,language.language||navigator.language);configured=connection.configured===true;$('port').value=connection.port||settings.buildPort;
  }catch{/* The guide remains usable before a local connection exists. */}
  $('platform').value=/Mac/i.test(navigator.userAgentData?.platform||navigator.platform||'')?'macos':'windows';render();status('build.unknown');
  $('settings').addEventListener('click',()=>chrome.runtime.sendMessage({type:'OPEN_SETTINGS',focus:'build'}));
  $('platform').addEventListener('change',()=>{$('launch').hidden=true;});
  $('model').addEventListener('change',()=>{populateReasoning($('reasoning').value,true);if(ready)selectionStatus();render();});
  $('reasoning').addEventListener('change',()=>{if(ready)selectionStatus();render();});
  for(const id of ['port','secret'])$(id).addEventListener('input',()=>{if(id==='secret')secretChanged=!configured||Boolean($(id).value.trim());reset();});
  $('generate').addEventListener('click',async()=>{
    if(busy)return;busy=true;render();
    try{const launch=await send({type:'GET_BUILD_LAUNCH',platform:$('platform').value,port:Number($('port').value)});if(typeof launch.command!=='string'||typeof launch.secret!=='string'||!launch.secret)throw Error('Invalid launch response');
      $('command').textContent=launch.command;$('secret').value=launch.secret;$('port').value=launch.port;secretChanged=true;checkRevision++;ready=false;$('launch').hidden=false;status('build.commandReady');
    }catch{status('build.unavailable');}finally{busy=false;render();}
  });
  $('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('command').textContent);status('build.commandCopied');}catch{status('common.copyFailed');}});
  $('check').addEventListener('click',async()=>{
    if(busy)return;const revision=++checkRevision;busy=true;render();status('build.checking');
    const permission=requestLocalAccess();
    try{if(await permission!==true){ready=false;status('build.permission');return;}const result=await send({type:'GET_BUILD_STATUS',port:Number($('port').value),...(secretChanged?{secret:$('secret').value.trim()}: {})});if(revision===checkRevision){ready=result.ready===true;populateModels(result.modelCatalog);if(ready)selectionStatus();else status(checkKey(result));}}
    catch{ready=false;status('build.unavailable');}finally{busy=false;render();}
  });
  $('save').addEventListener('click',async()=>{
    if(busy||!ready||Core.isNonTextGenerationModel($('model').value)||!catalog.some(entry=>entry.id===$('model').value)||!effortsFor($('model').value).includes($('reasoning').value))return;busy=true;render();
    const permission=requestLocalAccess();
    try{
      if(await permission!==true){ready=false;status('build.permission');return;}
      const local=await chrome.storage.local.get('settings');settings=Core.normalizeSettings({...local.settings,provider:'build',buildTransport:'acp',buildPort:Number($('port').value),buildModel:$('model').value,buildReasoningEffort:$('reasoning').value});
      await send({type:'SAVE_BUILD_CONNECTION',port:settings.buildPort,settings,...(secretChanged?{secret:$('secret').value.trim()}: {})});
      configured=true;secretChanged=false;$('secret').value='';$('launch').hidden=true;$('command').textContent='';status('options.saved');
    }catch{status('errors.noResponse');}finally{busy=false;render();}
  });
})();
