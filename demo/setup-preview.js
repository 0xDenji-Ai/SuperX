// Local UI fixture only. No real Grok connection, account or credential.
(()=>{
  const query=new URLSearchParams(location.search),listeners=[];
  let settings=XGrokCore.normalizeSettings({provider:'api',interfaceLanguage:query.get('interface')||'auto'}),configured=query.get('saved')==='1';
  const receipt=document.createElement('output');receipt.id='preview-receipt';receipt.hidden=true;document.body.append(receipt);
  window.chrome={permissions:{request:()=>Promise.resolve(query.get('permission')!=='denied')},runtime:{async sendMessage(message){
    if(message.type==='GET_UI_LANGUAGE')return {ok:true,language:query.get('lang')||'en'};
    if(message.type==='GET_BUILD_CONNECTION')return {ok:true,configured,port:2419};
    if(message.type==='GET_BUILD_LAUNCH'){await import('/extension/build-setup.js');receipt.textContent=JSON.stringify({type:message.type,platform:message.platform});const secret='preview-local-code-not-real';return {ok:true,command:SuperXBuildSetup.command({platform:message.platform,port:message.port,secret}),port:message.port,secret};}
    if(message.type==='GET_BUILD_STATUS'){receipt.textContent=JSON.stringify({type:message.type,port:message.port,codePresent:typeof message.secret==='string'});return {ok:true,ready:query.get('build')==='ready',modelCatalog:query.get('models')==='legacy'?[{id:'grok-4.6',efforts:['minimal','low','high']},{id:'grok-4.5',efforts:['low','high']}]:[{id:'grok-4.7',efforts:['minimal','low','medium','high','xhigh']}],errorCode:query.get('build')==='login'?'BUILD_LOGIN_REQUIRED':'BUILD_UNAVAILABLE'};}
    if(message.type==='SAVE_BUILD_CONNECTION'){settings=XGrokCore.normalizeSettings(message.settings);configured=true;receipt.textContent=JSON.stringify({type:message.type,settings,codePresent:typeof message.secret==='string'});return {ok:true};}
    if(message.type==='OPEN_SETTINGS'){location.assign('/demo/options.html?provider=build&lang='+encodeURIComponent(query.get('lang')||'en'));return {ok:true};}
    return {ok:false};
  }},storage:{local:{async get(){return {settings};}},onChanged:{addListener:listener=>listeners.push(listener)}}};
})();
