/* SuperX: credentials and provider calls stay in the extension worker. */
importScripts('feed-core.js', 'api-provider.js', 'build-acp.js', 'build-transport.js', 'build-provider.js', 'build-setup.js', 'ui-i18n.js', 'key-store.js', 'history-store.js');
const Core = XGrokCore;
const UI = GrokFirstUI;
const KeyStore = SuperXKeyStore;
const BuildKeyStore = SuperXBuildConnectionStore;
const history = SuperXHistoryStore.create(chrome.storage.local);
const HISTORY_ALARM = 'SUPERX_HISTORY_CLEANUP';
const clients = new Set();
const jobs = new Map();
const runningJobs = new Set();
const apiSlots = new Set();
let queue = [], pumping = false, settings, cache = {}, quotas = {}, railStates = {}, revision = 0, cacheEpoch = 0;
let ratePaused = false, queuePause, apiAccountPause, uiLanguage = UI.browserLanguage(globalThis);
let budgetPauseWrites = Promise.resolve(), budgetPauseWriteVersion = 0, budgetPauseMayExist = false;
let apiCapacityPause, capacityPauseWrites = Promise.resolve(), capacityPauseMayExist = false, capacityPauseWriteVersion = 0;
let apiDiagnostics = [], apiDiagnosticsEpoch = 0, apiDiagnosticsReady = Promise.resolve(), apiDiagnosticsWrites = Promise.resolve();
let quotaWrites = Promise.resolve(), cacheWrites = Promise.resolve(), railStateWrites = Promise.resolve(), uiLanguageWrites = Promise.resolve();
let securityWrites = Promise.resolve(), securityPending = 0, securityGeneration = 0;
let hasSavedKey = false, rememberApiKey = true, credentialReady = false, securityFault = false, sealAttempted = false;
let buildStatus = {connected:false,installed:false,available:false,errorCode:'BUILD_NOT_CONNECTED'}, buildStatusAt = 0, buildStatusPending;
let buildSecret='',buildConnectionGeneration=0,buildConnectionPending=0;
const CACHE_TTL = 24 * 60 * 60 * 1000;
const ready = initialize();

async function initialize() {
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  // Diagnostic storage is optional. Its reads/writes never gate credentials,
  // analysis, the account-spending pause or normal extension startup.
  apiDiagnosticsReady=loadAPIDiagnostics();
  const local = await chrome.storage.local.get(['settings','uiLanguage','apiKey','apiKeyEncrypted','apiKeyVault','rememberApiKey','buildConnectionEncrypted']);
  const session = await chrome.storage.session.get(['quotas','railStates','uiLanguage','apiKey','cache','securityFault','apiBudgetPause','apiCapacityPause']);
  settings = Core.normalizeSettings(local.settings);
  budgetPauseMayExist=session.apiBudgetPause!==undefined;
  const restoredPause=budgetPauseFromRecord(session.apiBudgetPause);
  if(restoredPause)apiAccountPause=restoredPause;
  capacityPauseMayExist=session.apiCapacityPause!==undefined;
  apiCapacityPause=capacityPauseFromRecord(session.apiCapacityPause);
  if(BuildKeyStore.envelopePresent(local.buildConnectionEncrypted)){
    try{const secret=await BuildKeyStore.open(local.buildConnectionEncrypted);if(validBuildSecret(secret))buildSecret=secret;}catch{/* Reconnect locally; API Key remains independent. */}
  }
  securityFault = session.securityFault === true;
  const storedCredential=KeyStore.envelopePresent(local.apiKeyEncrypted)||validKey(local.apiKey)||local.apiKeyVault!==undefined;
  rememberApiKey = typeof local.rememberApiKey === 'boolean' ? local.rememberApiKey : Boolean(storedCredential) || !validKey(session.apiKey);
  try {
    // A saved cipher decrypts automatically. Missing/corrupt durable keys never
    // fall back to a stale plaintext copy or create a new decryption key.
    const encrypted=KeyStore.envelopePresent(local.apiKeyEncrypted);
    const available=encrypted?await KeyStore.open(local.apiKeyEncrypted):validKey(local.apiKey)?local.apiKey.trim():validKey(session.apiKey)?session.apiKey.trim():'';
    if(encrypted&&!validKey(available))throw new Error('Invalid stored credential.');
    if(encrypted||validKey(local.apiKey)||local.apiKeyVault!==undefined&&available){
      if(rememberApiKey) {
        if(!encrypted)await persistEncryptedKey(available);
        else await chrome.storage.local.remove(['apiKey','apiKeyVault']);
      } else {
        await chrome.storage.local.remove(['apiKey','apiKeyEncrypted','apiKeyVault']);
        await KeyStore.clear();
      }
      await chrome.storage.session.set({apiKey:available});session.apiKey=available;
    }
  } catch {
    securityFault=true;
    session.apiKey=undefined;
    try{await chrome.storage.session.remove('apiKey');}catch{/* The fault gate prevents stale session use if deletion fails. */}
    try{await chrome.storage.session.set({securityFault:true});}catch{/* Keep this worker closed if storage cannot record the fault. */}
  }
  const stored=await chrome.storage.local.get(['apiKey','apiKeyEncrypted','apiKeyVault']);
  hasSavedKey=KeyStore.envelopePresent(stored.apiKeyEncrypted)||validKey(stored.apiKey)||stored.apiKeyVault!==undefined;
  credentialReady=validKey(session.apiKey);
  cache = pruneCache(session.cache); quotas = session.quotas || {};railStates = session.railStates || {};
  // Delete the old persistent post cache without reading or migrating its data.
  await chrome.storage.local.remove('cache');
  // Browser-session data expires after 24 hours, without a provider call.
  if(session.cache!==undefined&&(!session.cache||typeof session.cache!=='object'||Array.isArray(session.cache)||Object.keys(session.cache).length!==Object.keys(cache).length)) {
    try{await persistCache(cacheEpoch);}catch{/* Clean memory stays usable if session cleanup fails; later cache writes retry. */}
  }
  // Only X reports are persisted; browser locale remains a fresh-install fallback.
  uiLanguage = UI.normalizeLanguage(session.uiLanguage || local.uiLanguage || uiLanguage);
  // Persist the supported selection while keeping credentials in their existing storage.
  if(JSON.stringify(local.settings)!==JSON.stringify(settings))await chrome.storage.local.set({settings});
  // Remember the preference separately; existing session-only keys stay in session storage.
  if(typeof local.rememberApiKey!=='boolean')await chrome.storage.local.set({rememberApiKey});
  // History has its own storage queue. A failed cleanup cannot block Key restore
  // or paid work, and no credential is passed to this store.
  void history.prune().then(()=>broadcastHistoryConfig()).catch(()=>{});
  try{await chrome.alarms?.create(HISTORY_ALARM,{periodInMinutes:60});}catch{/* Reads and writes still remove expired records. */}
}
function validKey(value) { return typeof value==='string' && Boolean(value.trim()) && value.length<=500 && !/[\r\n]/.test(value); }
function securityAllowsCalls() { return !securityFault && credentialReady && securityPending===0; }
function buildReady() { return buildConnectionPending===0&&validBuildSecret(buildSecret)&&buildStatus.connected===true&&buildStatus.installed===true&&buildStatus.available===true&&buildStatus.authenticated===true&&buildStatus.permission!==false; }
function providerAllowsCalls(s=settings) { return s?.provider==='build'?buildReady():securityAllowsCalls(); }
function validBuildSecret(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{24,256}$/.test(value)&&! /^(?:xai|sk)-/i.test(value);}
function buildConnection(input={}){
  const port=input.port===undefined?settings.buildPort:input.port,secret=input.secret===undefined?buildSecret:input.secret;
  if(!Number.isInteger(port)||port<1024||port>65535||!validBuildSecret(secret))throw Object.assign(new Error('Invalid local connection settings.'),{code:'BUILD_CONNECTION_REQUIRED'});
  return {port,secret};
}
async function probeBuild(connection){
  if(chrome.permissions?.contains&&!await chrome.permissions.contains({origins:['http://127.0.0.1/*']}))return {connected:false,installed:false,available:false,errorCode:'BUILD_PERMISSION_REQUIRED'};
  return SuperXBuild.status({connection});
}
function sameBuildConnection(value){return value.port===settings.buildPort&&value.secret===buildSecret;}
async function checkBuildDraft(message){
  let connection;
  try{connection=buildConnection(message);}catch(error){return {ok:true,connected:false,available:false,ready:false,errorCode:error.code};}
  if([...runningJobs].some(job=>job.settings.provider==='build')){
    if(sameBuildConnection(connection))return {ok:true,...buildStatus,ready:buildReady(),busy:true};
    return {ok:true,connected:false,available:false,ready:false,errorCode:'BUILD_BUSY'};
  }
  if(sameBuildConnection(connection)){const status=await refreshBuildStatus(true);void broadcastConfig();return {ok:true,...status,ready:buildReady()};}
  const status=await probeBuild(connection);
  return {ok:true,...status,ready:status.available===true&&status.authenticated===true&&status.connected===true};
}
function newBuildSecret(){const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return 'superx_'+[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');}
function buildStorageError(){return {ok:false,errorKey:'build.storageError'};}
function queueBuildConnection(message,clear=false){
  let connection;
  try{if(!clear)connection=buildConnection(message);}catch{return Promise.resolve({ok:false,errorKey:'build.codeRequired'});}
  const next=message.settings===undefined?undefined:Core.normalizeSettings({...message.settings,buildPort:connection?.port??settings.buildPort});
  if(next&&!next.webSearch&&!next.xSearch)return Promise.resolve({ok:false,errorKey:'options.urlSearchRequired'});
  if(!clear&&sameBuildConnection(connection))return queueSettingsMutation(next??settings);
  const generation=++buildConnectionGeneration;buildConnectionPending++;
  for(const job of [...jobs.values()].filter(job=>job.settings.provider==='build'))abortJob(job);
  buildStatusAt=0;buildStatus={connected:false,available:false,installed:false,errorCode:'BUILD_CONNECTION_REQUIRED'};
  void broadcastConfig();
  const operation=securityWrites.catch(()=>{}).then(async()=>{
    let failure;
    try{
      await SuperXBuild.close?.();
      if(clear){await chrome.storage.local.remove('buildConnectionEncrypted');await BuildKeyStore.clear();buildSecret='';}
      else{
        const envelope=await BuildKeyStore.seal(connection.secret);
        if(!BuildKeyStore.isEnvelope(envelope)||await BuildKeyStore.open(envelope)!==connection.secret)throw 0;
        await chrome.storage.local.set({buildConnectionEncrypted:envelope});
        const saved=await chrome.storage.local.get('buildConnectionEncrypted');
        if(!BuildKeyStore.isEnvelope(saved.buildConnectionEncrypted)||await BuildKeyStore.open(saved.buildConnectionEncrypted)!==connection.secret)throw 0;
        buildSecret=connection.secret;
        await saveSettings(next??{...settings,buildPort:connection.port});
      }
      cache=Object.fromEntries(Object.entries(cache).filter(([key])=>{try{return JSON.parse(key)[1]!=='build';}catch{return true;}}));cacheEpoch++;await persistCache(cacheEpoch);
    }catch{failure=buildStorageError();buildSecret='';}
    finally{buildConnectionPending--;}
    if(generation===buildConnectionGeneration){buildStatusAt=0;buildStatus={connected:false,installed:false,available:false,errorCode:'BUILD_CONNECTION_REQUIRED'};}
    await broadcastConfig();return failure??{ok:true,configured:validBuildSecret(buildSecret),port:settings.buildPort};
  });securityWrites=operation;return operation;
}
async function refreshBuildStatus(force=false) {
  // A second WebSocket would steal official streaming notifications. Reuse
  // timeout. Reuse the last authenticated status while this worker has an
  // accepted Build task; probing must not cancel or hide paid work.
  if(buildReady()&&[...runningJobs].some(job=>job.settings.provider==='build')){buildStatusAt=Date.now();return {...buildStatus,busy:true};}
  if(buildConnectionPending)return buildStatus;
  if(buildStatusPending)return buildStatusPending;
  if(!force&&Date.now()-buildStatusAt<10000)return buildStatus;
  const generation=buildConnectionGeneration;
  const pending=(async()=>{
    try {const status=await probeBuild(buildConnection());if(generation===buildConnectionGeneration)buildStatus=status;}
    catch(error){if(generation===buildConnectionGeneration)buildStatus={connected:false,installed:false,available:false,errorCode:SuperXBuild.publicError(error).code};}
    if(generation===buildConnectionGeneration)buildStatusAt=Date.now();return buildStatus;
  })();
  buildStatusPending=pending;
  try{await pending;}finally{if(buildStatusPending===pending)buildStatusPending=undefined;}
  if(generation!==buildConnectionGeneration&&!buildConnectionPending)return refreshBuildStatus(force);
  return buildStatus;
}
function ensureBuildStatus(){
  if(!buildStatusPending&&(!buildStatusAt||Date.now()-buildStatusAt>10000))void refreshBuildStatus().then(()=>broadcastConfig()).then(()=>pump()).catch(()=>{});
}
function securityStatus() {
  return {keyState:securityAllowsCalls()?'ready':hasSavedKey&&!credentialReady?'migration':'missing',
    remember:rememberApiKey,hasSavedKey};
}
function isX(url) { try { return ['x.com','twitter.com'].includes(new URL(url).hostname) && new URL(url).protocol === 'https:'; } catch { return false; } }
function isFeed(url) { return isX(url) && !/^\/(?:messages|i\/(?:chat|grok|flow|premium|settings))\b/.test(new URL(url).pathname); }
function trustedUI(sender) { try { const url=new URL(sender.url),base=new URL(chrome.runtime.getURL(''));return sender.id===chrome.runtime.id&&url.protocol===base.protocol&&url.host===base.host&&['/options.html','/popup.html','/history.html','/setup.html'].includes(url.pathname); }catch{return false;} }
function trustedFeed(sender) { return sender.id===chrome.runtime.id && sender.frameId===0 && Number.isInteger(sender.tab?.id) && isFeed(sender.url); }
function send(port, message) { try { port.postMessage(message); } catch { /* Tab closed. */ } }
async function publicConfig() {
  const generation=securityGeneration,canRefresh=securityPending===0;
  const session = settings.provider==='build'?{}:await chrome.storage.session.get('apiKey');
  // A lookup started before a Key change or while a mutation was pending cannot
  // overwrite the newer operation's readiness with an old storage snapshot.
  if(settings.provider!=='build'&&canRefresh && generation===securityGeneration && securityPending===0)credentialReady = validKey(session.apiKey);
  const status=securityStatus();
  const historyConfig=history.config();
  if(settings.provider==='build')ensureBuildStatus();
  const apiBudgetPaused=settings.provider==='api'&&Boolean(apiAccountPause);
  const apiCapacityPaused=capacityPausedFor(settings);
  return {settings,ready:providerAllowsCalls(),keyState:status.keyState,apiBudgetPaused,apiCapacityPaused,...(apiBudgetPaused?{apiBudgetFailure:apiAccountPause.verificationFailure}:{}),...(settings.provider==='build'?{buildStatus:{...buildStatus,ready:buildReady()}}:{}),buildConnection:{configured:validBuildSecret(buildSecret),port:settings.buildPort},historyEnabled:historyConfig.enabled,historyEpoch:historyConfig.epoch};
}
async function notifyHistoryChanged(){await chrome.runtime.sendMessage({type:'HISTORY_CHANGED',...history.config()}).catch(()=>{});}
async function broadcastHistoryConfig(){
  const config=history.config();
  for(const client of clients)send(client.port,{type:'HISTORY_CONFIG',...config});
  await notifyHistoryChanged();
}
function historyTicket(post){return history.capture(post.id).catch(()=>null);}
function rememberHistoryResult(ticket,result,comments=false,language=''){
  if(!comments&&Core.readerOutput(result?.text,{final:true}).kind!=='content')return;
  void Promise.resolve(ticket).then(value=>comments?history.comments(value,{...result,language}):history.analysis(value,{...result,language})).then(()=>notifyHistoryChanged()).catch(()=>{});
}
async function broadcastConfig() {
  const config=await publicConfig();
  for(const client of clients)send(client.port,{type:'CONFIG',...config,used:quotas[client.tabId]||0,collapsed:Boolean(railStates[client.tabId]),uiLanguage:client.uiLanguage});
  void chrome.runtime.sendMessage({type:'CONFIG',...config}).catch(()=>{});
}
async function currentUILanguage() {
  try {
    const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});
    const active=tabs.find(tab=>isFeed(tab.pendingUrl||tab.url));
    const client=active&&[...clients].find(value=>value.tabId===active.id);
    if(client)return client.uiLanguage;
  } catch { /* The last reported public UI locale remains available. */ }
  return uiLanguage;
}
function updateUILanguage(client,value) {
  client.uiLanguage=UI.normalizeLanguage(value);uiLanguage=client.uiLanguage;
  const language=uiLanguage;
  for(const peer of clients)if(peer.tabId===client.tabId)peer.uiLanguage=language;
  // UI locale never enters paid-task settings or increments their revision.
  uiLanguageWrites=uiLanguageWrites.catch(()=>{}).then(async()=>{
    await Promise.all([chrome.storage.session.set({uiLanguage:language}),chrome.storage.local.set({uiLanguage:language})]);
    await chrome.runtime.sendMessage({type:'UI_LANGUAGE_CHANGED',language}).catch(()=>{});
  });
  return uiLanguageWrites;
}
function sanitizePost(raw) {
  const url = Core.canonicalPostUrl(raw?.url);
  const id = url?.match(/\/status\/(\d+)$/)?.[1];
  if (!id || id !== String(raw?.id)) throw new Error('无法识别帖子地址。');
  const text = value => typeof value === 'string' ? value.slice(0,12000) : '';
  const language = value => { const hint=Core.resolvePostLanguage('auto',{language:value,text:''});return hint==='auto'?'':hint; };
  const context = p => ({id:text(p.id),url:Core.canonicalPostUrl(p.url),text:text(p.text),language:language(p.language),author:text(p.author).slice(0,200),timestamp:text(p.timestamp).slice(0,60),hasMedia:Boolean(p.hasMedia),images:(Array.isArray(p.images)?p.images:[]).slice(0,4).map(img=>({url:GrokFirstAPI.safeUrl(img.url),alt:text(img.alt).slice(0,500)})).filter(img=>img.url && new URL(img.url).hostname === 'pbs.twimg.com')});
  return {...context(raw),id,url,quotedContext:(Array.isArray(raw.quotedContext)?raw.quotedContext:[]).slice(0,2).map(context)};
}
function cacheKey(post, s, inputFingerprint) {
  const mode=Core.explanationMode(s);
  const prompts=['fact-check-prompts-v1',mode==='preset'?Core.DEFAULT_PROMPTS.verify:s.verifyPrompt];
  return JSON.stringify(['GrokFirst-v1',s.provider,s.provider==='build'?['official-ws-v1',s.buildPort,s.buildModel]:s.apiModel,s.language,s.webSearch,s.xSearch,
    'api-v10-model-reasoning',mode,'only',
    Core.apiPostIdentity(post,s),...prompts,s.provider==='build'?s.buildReasoningEffort:Core.reasoningEffort(s.apiModel,s.apiReasoningEffort)]);
}
function sanitizeAnalysis(raw) {
  const value=typeof raw==='string'?{text:raw}:raw&&typeof raw==='object'?raw:{};
  return {text:Core.readerOutput(value.text,{final:true}).text.slice(0,30000),
    verificationStatus:typeof value.verificationStatus==='string'?value.verificationStatus.slice(0,40):'',
    warning:typeof value.warning==='string'?value.warning.slice(0,1000):'',
    sources:(Array.isArray(value.sources)?value.sources:[]).slice(0,20).map(source=>({url:GrokFirstAPI.safeUrl(source?.url),title:typeof source?.title==='string'?source.title.slice(0,200):''})).filter(source=>source.url)};
}
function commentCacheKey(post,s,inputFingerprint,analysis) {
  const prompts=['comments-prompt-v1',s.commentsPrompt];
  return JSON.stringify(['GrokFirst-comments-v2-language',s.provider,s.provider==='build'?['official-ws-v1',s.buildPort,s.buildModel]:s.apiModel,s.language,Core.postFingerprint(post),analysis,...prompts,s.provider==='build'?s.buildReasoningEffort:Core.reasoningEffort(s.apiModel,s.apiReasoningEffort)]);
}
function commentsJob(job) { return job.settings.task==='comments'; }
function billingMetadata(value,provider) { return ['api','build'].includes(provider)?GrokFirstAPI.sanitizedMetadata(value):{}; }
function requestMetadata(value,provider) {
  if(provider!=='api')return {};
  let diagnostics;
  try{diagnostics=(Core.sanitizedRequestDiagnostics||GrokFirstAPI.sanitizedRequestDiagnostics)?.(value?.requestDiagnostics);}catch{/* Invalid diagnostic data is never forwarded. */}
  return diagnostics?{requestDiagnostics:diagnostics}:{};
}
const API_DIAGNOSTIC_CODES=new Set(['API_INCOMPLETE','API_STREAM_INTERRUPTED','API_STREAM_ERROR','API_LANGUAGE_MISMATCH','RATE_LIMIT','API_CAPACITY','API_ERROR','CANCELED','TIMEOUT','COMMENTS_INVALID_RESPONSE']);
function pruneAPIDiagnostics(input,now=Date.now()) {
  return (Array.isArray(input)?input:[]).slice(0,1000).flatMap(entry=>{
    if(!entry||!API_DIAGNOSTIC_CODES.has(entry.code)||!Number.isSafeInteger(entry.recordedAt)||entry.recordedAt<0||entry.recordedAt>now||now-entry.recordedAt>=CACHE_TTL)return [];
    const diagnostics=requestMetadata(entry,'api').requestDiagnostics;
    const verificationFailure=GrokFirstAPI.sanitizedVerificationFailure(entry.verificationFailure);
    return diagnostics?[{recordedAt:entry.recordedAt,code:entry.code,requestDiagnostics:diagnostics,...(verificationFailure?{verificationFailure}:{})}]:[];
  }).sort((a,b)=>b.recordedAt-a.recordedAt).slice(0,30);
}
async function loadAPIDiagnostics() {
  const epoch=apiDiagnosticsEpoch;
  try{
    const stored=await chrome.storage.session.get('apiRequestDiagnostics');
    if(epoch!==apiDiagnosticsEpoch)return;
    apiDiagnostics=pruneAPIDiagnostics(stored.apiRequestDiagnostics);
    if(stored.apiRequestDiagnostics!==undefined&&JSON.stringify(stored.apiRequestDiagnostics)!==JSON.stringify(apiDiagnostics))await chrome.storage.session.set({apiRequestDiagnostics:apiDiagnostics});
  }catch{/* Diagnostics must not prevent normal requests or account safety. */}
}
function rememberAPIDiagnostics(job,value,code) {
  if(job.settings.provider!=='api'||job.diagnosticsRecorded||!API_DIAGNOSTIC_CODES.has(code))return;
  const diagnostics=requestMetadata(value,'api').requestDiagnostics;
  if(!diagnostics)return;
  job.diagnosticsRecorded=true;
  const verificationFailure=GrokFirstAPI.sanitizedVerificationFailure(value?.verificationFailure);
  const epoch=apiDiagnosticsEpoch,entry={recordedAt:Date.now(),code,requestDiagnostics:diagnostics,...(verificationFailure?{verificationFailure}:{})};
  apiDiagnosticsWrites=apiDiagnosticsWrites.catch(()=>{}).then(async()=>{
    await apiDiagnosticsReady;
    if(epoch!==apiDiagnosticsEpoch)return;
    apiDiagnostics=pruneAPIDiagnostics([entry,...apiDiagnostics]);
    try{await chrome.storage.session.set({apiRequestDiagnostics:apiDiagnostics});}catch{/* The bounded in-memory log remains available for this worker. */}
  });
}
function pruneStoredAPIDiagnostics() {
  const epoch=apiDiagnosticsEpoch;
  const operation=apiDiagnosticsWrites.catch(()=>{}).then(async()=>{
    await apiDiagnosticsReady;
    if(epoch!==apiDiagnosticsEpoch)return;
    const kept=pruneAPIDiagnostics(apiDiagnostics),changed=JSON.stringify(kept)!==JSON.stringify(apiDiagnostics);
    apiDiagnostics=kept;
    if(changed)try{await chrome.storage.session.set({apiRequestDiagnostics:apiDiagnostics});}catch{/* Expired records stay hidden if optional cleanup fails. */}
  });
  apiDiagnosticsWrites=operation;return operation;
}
async function getAPIDiagnostics() {
  await pruneStoredAPIDiagnostics();
  return {ok:true,entries:apiDiagnostics,retentionHours:24,maxEntries:30};
}
function clearAPIDiagnostics() {
  apiDiagnosticsEpoch++;apiDiagnostics=[];
  const operation=apiDiagnosticsWrites.catch(()=>{}).then(async()=>{
    await apiDiagnosticsReady;
    try{await chrome.storage.session.remove('apiRequestDiagnostics');return {ok:true};}
    catch{return {ok:false,errorKey:'diagnostics.storageError'};}
  });
  apiDiagnosticsWrites=operation;return operation;
}
function verificationMetadata(value,mode,text=String(value?.text||'').slice(0,30000)) {
  const start=value?.verificationStart;
  const failure=['only','background'].includes(mode)?GrokFirstAPI.sanitizedVerificationFailure(value?.verificationFailure):undefined;
  return {...(mode==='background'&&Number.isSafeInteger(start)&&start>=2&&start<=text.length&&text.slice(start-2,start)==='\n\n'?{verificationStart:start}:{}),
    ...(failure?{verificationFailure:failure}:{})};
}
function withBillingMetadata(value,provider,verificationMode) {
  const result={...value};
  for(const field of ['usage','usageComplete','usageByStage','model','modelByStage','verificationStart','verificationFailure','requestDiagnostics'])delete result[field];
  return {...result,...billingMetadata(value,provider),...verificationMetadata(value,verificationMode),...requestMetadata(value,provider)};
}
function jobError(job,error,code,extra={}) { send(job.client.port,{type:commentsJob(job)?'COMMENT_ERROR':'ERROR',requestId:job.requestId,error,code,...extra}); }
function freshCacheEntry(entry,now) {
  return entry&&typeof entry==='object'&&!Array.isArray(entry)&&Number.isFinite(entry.completedAt)&&entry.completedAt>=0&&entry.completedAt<=now&&now-entry.completedAt<CACHE_TTL
    &&(typeof entry.text!=='string'||Core.readerOutput(entry.text,{final:true}).kind==='content');
}
function pruneCache(input,now=Date.now()) {
  const entries=input&&typeof input==='object'&&!Array.isArray(input)?Object.entries(input):[];
  const recent=entries.filter(([,value])=>freshCacheEntry(value,now)).sort((a,b)=>b[1].completedAt-a[1].completedAt).slice(0,160);
  const kept=[];let bytes=0;
  for(const entry of recent){bytes+=new TextEncoder().encode(JSON.stringify(entry)).byteLength;if(bytes>4_000_000)break;kept.push(entry);}
  return Object.fromEntries(kept);
}
function cachedResult(key) { const entry = cache[key]; if (freshCacheEntry(entry,Date.now())) return entry; delete cache[key]; return null; }
function persistQuotas() {
  // Concurrent reservations and resets must not leave an older storage snapshot
  // behind a newer one. Read the latest counters when this write starts.
  quotaWrites=quotaWrites.catch(()=>{}).then(()=>chrome.storage.session.set({quotas:{...quotas}}));
  return quotaWrites;
}
function persistCache(epoch) {
  cacheWrites=cacheWrites.catch(()=>{}).then(()=>epoch===cacheEpoch?chrome.storage.session.set({cache:{...cache}}):undefined);
  return cacheWrites;
}
function clearStoredCache() {
  cache={};cacheEpoch++;
  cacheWrites=cacheWrites.catch(()=>{}).then(async()=>{
    const results=await Promise.allSettled([chrome.storage.session.remove('cache'),chrome.storage.local.remove('cache')]);
    const failed=results.find(value=>value.status==='rejected');
    if(failed)throw failed.reason;
  });
  return cacheWrites;
}
function persistRailStates() {
  railStateWrites=railStateWrites.catch(()=>{}).then(()=>chrome.storage.session.set({railStates:{...railStates}}));
  return railStateWrites;
}
function removeJob(job) { if(jobs.get(job.key)===job)jobs.delete(job.key); }
function abortJob(job) { job.controller.abort(); removeJob(job); queue = queue.filter(j=>j!==job); pump(); }
function cancelClient(client) { client.cancelEpoch++; for (const job of [...jobs.values()]) if(job.client===client) abortJob(job); }
// Browser message promises do not reject when an AbortSignal is cancelled.
// Keep the UI await interruptible; paid calls retain their separate slot until
// the actual provider promise (including transport cleanup) has settled.
function waitForAbort(promise, signal) {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(ok,value)=>{
      if(settled)return;settled=true;signal.removeEventListener('abort',cancel);
      if(ok)resolve(value);else reject(value);
    };
    const cancel=()=>finish(false,signal.reason || new DOMException('Cancelled','AbortError'));
    Promise.resolve(promise).then(value=>finish(true,value),error=>finish(false,error));
    if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
  });
}

async function openSettings(focus) {
  // Replace stale focus requests even when the caller uses a generic Settings
  // entry point or sends an unlock target from an older content script.
  try { await chrome.storage.session.set({superxOptionsFocus:{id:focus==='build'||settings.provider==='build'?'build':'api-key',nonce:crypto.randomUUID()}}); }
  catch { /* The settings page remains reachable when session storage fails. */ }
  await chrome.runtime.openOptionsPage();
}
async function openHistory(){await chrome.tabs.create({url:chrome.runtime.getURL('history.html')});}
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'GROKFIRST_FEED' || port.sender?.frameId !== 0 || !isFeed(port.sender?.url)) { port.disconnect(); return; }
  const client = {port,tabId:port.sender.tab.id,cancelEpoch:0,uiLanguage:null,requestCancellations:new Map()}; clients.add(client);
  ready.then(async()=>{client.uiLanguage=UI.normalizeLanguage(client.uiLanguage || uiLanguage);send(port,{type:'CONFIG',...await publicConfig(),used:quotas[client.tabId] || 0,collapsed:Boolean(railStates[client.tabId]),uiLanguage:client.uiLanguage});}).catch(()=>send(port,{type:'FATAL',error:'扩展初始化失败，请重新加载扩展。'}));
  port.onMessage.addListener(message=>{
    const receivedEpoch=client.cancelEpoch,receivedRevision=revision,receivedCredentialGeneration=securityGeneration,receivedBuildGeneration=buildConnectionGeneration;
    const messageRequestId=String(message.requestId || '').slice(0,80);
    // Cancellation can arrive before an asynchronous readiness lookup has
    // created a job. Capture a receipt generation so it cannot dispatch later;
    // an explicit new request with the same ID captures the new generation.
    if(['CANCEL','CANCEL_IF_QUEUED'].includes(message.type)&&messageRequestId)client.requestCancellations.set(messageRequestId,Symbol());
    const receivedCancellation=client.requestCancellations.get(messageRequestId);
    ready.then(async()=>{
      if(!clients.has(client))return;
      if(message.type==='PING') { send(port,{type:'PONG'}); return; }
      if(message.type==='UI_LANGUAGE') { await updateUILanguage(client,message.language);return; }
      if(message.type==='CANCEL_ALL') { cancelClient(client); return; }
      if(message.type==='OPEN_SETTINGS') { await openSettings(message.focus); return; }
      if(message.type==='OPEN_HISTORY'&&trustedFeed(port.sender)){await openHistory();return;}
      if(message.type==='HISTORY_VISIT'){
        // No Key, provider call or dwell timer is required to record visibility.
        // Epochs reject batches sent before Clear/Delete/recording changes.
        if(!trustedFeed(port.sender))return;
        const batchId=String(message.batchId||'').slice(0,80),ack=ok=>{if(batchId)send(port,{type:'HISTORY_ACK',batchId,ok,epoch:history.config().epoch});};
        if(!settings.enabled||!Array.isArray(message.posts)||message.posts.length>30||message.historyEpoch!==history.config().epoch){ack(false);return;}
        const posts=[];for(const raw of message.posts){try{posts.push(sanitizePost(raw));}catch{/* An invalid record cannot make a trusted batch fail. */}}
        try{const status=await history.visit(posts,message.historyEpoch);ack(status.enabled&&message.historyEpoch===status.epoch&&posts.length>0);}catch{ack(false);/* History failure never affects the analysis queue. */}return;
      }
      if(message.type==='SET_ENABLED') { await queueSettingsMutation(()=>({...settings,enabled:Boolean(message.enabled)})); return; }
      if(message.type==='SET_LANGUAGE') { await queueSettingsMutation(()=>({...settings,language:message.language})); return; }
      if(message.type==='SET_RAIL_COLLAPSED') {
        railStates[client.tabId]=Boolean(message.collapsed);
        if(railStates[client.tabId]) {
          for(const waiting of queue.filter(job=>job.client.tabId===client.tabId)) {
            removeJob(waiting);jobError(waiting,'右栏已收起，未开始的分析已暂停。','RAIL_COLLAPSED');
          }
          queue=queue.filter(job=>job.client.tabId!==client.tabId);pump();
        }
        for(const peer of clients)if(peer.tabId===client.tabId)send(peer.port,{type:'RAIL_VISIBILITY',collapsed:Boolean(railStates[client.tabId])});
        await persistRailStates();return;
      }
      if(message.type==='CANCEL') { const job=jobs.get(`${client.tabId}:${message.requestId}`); if(job?.client===client) abortJob(job); return; }
      if(message.type==='CANCEL_IF_QUEUED') {
        const job=jobs.get(`${client.tabId}:${messageRequestId}`);
        if(job?.client===client && runningJobs.has(job))return;
        if(job?.client===client)abortJob(job);
        send(port,{type:'ERROR',requestId:messageRequestId,error:'未开始的分析已暂停。',code:'CANCELLED'});return;
      }
      if(!['ANALYZE','GENERATE_COMMENTS'].includes(message.type)) return;
      const comments=message.type==='GENERATE_COMMENTS';
      const report=(error,code,extra={})=>send(port,{type:comments?'COMMENT_ERROR':'ERROR',requestId,error,code,...extra});
      const requestId=messageRequestId;
      if(!requestId) return;
      if(client.requestCancellations.get(requestId)!==receivedCancellation)return;
      if(client.cancelEpoch!==receivedEpoch || receivedRevision!==revision||(settings.provider==='build'?receivedBuildGeneration!==buildConnectionGeneration:receivedCredentialGeneration!==securityGeneration)){report('任务已取消。','CANCELLED');return;}
      if(settings.provider!=='build'&&(securityPending || securityFault)) { report('API Key 设置需要重新确认，请在设置中重试。','NEEDS_KEY');return; }
      const snapshot={...settings,...(comments?{task:'comments'}:{})};
      if(!settings.enabled&&!comments) { report('已暂停自动分析。','PAUSED'); return; }
      if(railStates[client.tabId]){report('右栏已收起。','RAIL_COLLAPSED');return;}
      let post,inputFingerprint;
      try { inputFingerprint=Core.postFingerprint(message.post);post=sanitizePost(message.post); } catch(e) { report(e.message,'POST_INVALID'); return; }
      if(!comments&&!snapshot.webSearch&&!snapshot.xSearch) { report('通过帖子链接读取全文需要启用 X 搜索或网页搜索。','URL_SEARCH_REQUIRED');return; }
      const analysis=comments?sanitizeAnalysis(message.analysis):undefined;
      const fingerprint=comments?commentCacheKey(post,snapshot,inputFingerprint,analysis):cacheKey(post,snapshot,inputFingerprint);
      const ticket=historyTicket(post),historyLanguage=Core.resolvePostLanguage(snapshot.language,post);
      const cached=message.force ? null : cachedResult(fingerprint);
      if(cached) { rememberHistoryResult(ticket,cached,comments,historyLanguage);send(port,comments?{type:'COMMENT_RESULT',requestId,comments:cached.comments,cached:true,...billingMetadata(cached,snapshot.provider)}:{type:'RESULT',requestId,result:withBillingMetadata(cached,snapshot.provider,snapshot.apiVerification),cached:true}); return; }
      const config=await publicConfig();
      if(!clients.has(client)||client.cancelEpoch!==receivedEpoch||receivedRevision!==revision||client.requestCancellations.get(requestId)!==receivedCancellation||(snapshot.provider==='build'?receivedBuildGeneration!==buildConnectionGeneration:receivedCredentialGeneration!==securityGeneration))return;
      if(railStates[client.tabId]){report('右栏已收起。','RAIL_COLLAPSED');return;}
      if(!config.ready) { report(settings.provider==='build'?'请在设置中连接 Grok Build。':'请打开设置并输入 xAI API Key。',settings.provider==='build'?(buildStatus.errorCode||'BUILD_NOT_CONNECTED'):'NEEDS_KEY'); return; }
      const key=`${client.tabId}:${requestId}`;
      if(jobs.has(key)) return;
      const budgetProbe=snapshot.provider==='api'&&apiAccountPause&&message.force===true?apiAccountPause:undefined;
      const capacityProbe=capacityPausedFor(snapshot)&&message.force===true?apiCapacityPause:undefined;
      if(queuePausedFor(snapshot) && (message.force!==true||(budgetProbe||capacityProbe)&&[...jobs.values(),...apiSlots].some(job=>(job.budgetProbe||job.capacityProbe)&&job.settings.provider===snapshot.provider))) { const paused=queuePauseError(snapshot);report(paused.error,paused.code,paused.verificationFailure?{verificationFailure:paused.verificationFailure}:{});return; }
      if(message.force===true)clearQueuePause(snapshot.provider);
      const job={key,requestId,post,inputFingerprint,analysis,client,clientEpoch:receivedEpoch,settings:snapshot,revision:receivedRevision,fingerprint,historyTicket:ticket,historyLanguage,budgetProbe,capacityProbe,controller:new AbortController()};
      jobs.set(key,job);
      const before=comments?queue.findIndex(waiting=>!commentsJob(waiting)):-1;
      if(before>=0)queue.splice(before,0,job);else queue.push(job);
      if(!comments)send(port,{type:'QUEUED',requestId});pump();
    }).catch(()=>send(port,{type:message.type==='GENERATE_COMMENTS'?'COMMENT_ERROR':'ERROR',requestId:message.requestId,error:'处理失败，请重新加载扩展。'}));
  });
  port.onDisconnect.addListener(()=>{clients.delete(client);cancelClient(client);});
});

function liveJob(job) {
  return runningJobs.has(job) && jobs.get(job.key)===job && !job.controller.signal.aborted && job.revision===revision && job.clientEpoch===job.client.cancelEpoch && clients.has(job.client);
}
function apiLimit(s) { return s.provider==='build'?1:Math.max(1,Math.min(8,Math.trunc(Number(s.apiConcurrency))||4)); }
function rateLimitError() { return Object.assign(new Error('Grok 已限速，自动队列已暂停，请稍后手动重试。'),{code:'RATE_LIMIT'}); }
const API_BUDGET_CODES=new Set(['spending_limit','insufficient_credits','insufficient_quota','usage_limit_exceeded']);
function apiBudgetFailure(value) {
  const supplied=GrokFirstAPI.sanitizedVerificationFailure(value?.verificationFailure)||GrokFirstAPI.sanitizedVerificationFailure(value?.partialResult?.verificationFailure);
  const details=value?.failureDetails;
  const fallback=GrokFirstAPI.sanitizedVerificationFailure({stage:'verify',code:'ACCESS',errorCode:value?.code,
    httpStatus:value?.httpStatus??details?.httpStatus,providerCode:value?.providerCode??details?.providerCode});
  // Use structured, allowlisted diagnostics only. An upstream message, a
  // generic 403, or a network failure cannot pause every automatic request.
  return [supplied,fallback].find(failure=>failure&&(failure.httpStatus===402||API_BUDGET_CODES.has(failure.providerCode)));
}
function apiCapacityFailure(value) {
  return value?.code==='API_CAPACITY'||GrokFirstAPI.sanitizedVerificationFailure(value?.verificationFailure)?.errorCode==='API_CAPACITY'||GrokFirstAPI.sanitizedVerificationFailure(value?.partialResult?.verificationFailure)?.errorCode==='API_CAPACITY';
}
function capacityPausedFor(input) { return input.provider==='api'&&Boolean(apiCapacityPause)&&apiCapacityPause.model===input.apiModel; }
function capacityPauseRecord(pause) {
  const model=pause?.model;
  return pause?.provider==='api'&&typeof model==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(model)&&!/^(?:xai-|sk-)/i.test(model)?{version:1,reason:'api-capacity',model}:undefined;
}
function capacityPauseFromRecord(record) {
  const safe=record?.version===1&&record.reason==='api-capacity'?capacityPauseRecord({provider:'api',model:record.model}):undefined;
  return safe?{provider:'api',model:safe.model,code:'API_CAPACITY',error:GrokFirstAPI.publicError({code:'API_CAPACITY'}).error}:undefined;
}
function persistCapacityPause(record) {
  const writeVersion=++capacityPauseWriteVersion;
  if(record)capacityPauseMayExist=true;
  const operation=capacityPauseWrites.catch(()=>{}).then(async()=>{
    try{
      if(record)await chrome.storage.session.set({apiCapacityPause:record});else await chrome.storage.session.remove('apiCapacityPause');
      const stored=await chrome.storage.session.get('apiCapacityPause');
      const confirmed=record?JSON.stringify(capacityPauseRecord(capacityPauseFromRecord(stored.apiCapacityPause)))===JSON.stringify(record):stored.apiCapacityPause===undefined;
      if(confirmed&&!record&&writeVersion===capacityPauseWriteVersion)capacityPauseMayExist=false;
      return confirmed;
    }catch{return false;}
  });
  capacityPauseWrites=operation;return operation;
}
function clearAPICapacityPause(current=()=>true) {
  const previous=apiCapacityPause;
  if(!previous&&!capacityPauseMayExist)return Promise.resolve(true);
  const removalVersion=capacityPauseWriteVersion+1;
  return persistCapacityPause(undefined).then(async cleared=>{
    if(cleared&&apiCapacityPause===previous&&current()){apiCapacityPause=undefined;return true;}
    // Cancellation while optional storage confirms recovery cannot silently
    // reopen automatic work. Do not revive a pause after a newer model reset.
    if(cleared&&previous&&apiCapacityPause===previous&&removalVersion===capacityPauseWriteVersion)await persistCapacityPause(capacityPauseRecord(previous));
    return false;
  });
}
function queuePausedFor(input) { return input.provider==='api'&&Boolean(apiAccountPause)||capacityPausedFor(input)||ratePaused&&queuePause?.provider===input.provider; }
function budgetPauseRecord(pause) {
  const failure=apiBudgetFailure(pause);
  return pause?.provider==='api'&&failure?{version:1,reason:'api-budget',verificationFailure:failure}:undefined;
}
function budgetPauseFromRecord(record) {
  if(record?.version!==1||record.reason!=='api-budget')return undefined;
  const verificationFailure=apiBudgetFailure(record);
  return verificationFailure?{provider:'api',code:'API_ERROR',error:GrokFirstAPI.publicError({code:'API_ERROR'}).error,verificationFailure}:undefined;
}
function persistBudgetPause(record) {
  // Only a fixed reason and sanitized structured cause survive worker sleep.
  // Serialize readbacks with writes so an earlier pause cannot revive after
  // a Key/settings reset or a successful explicit recovery probe.
  const writeVersion=++budgetPauseWriteVersion;
  if(record)budgetPauseMayExist=true;
  const operation=budgetPauseWrites.catch(()=>{}).then(async()=>{
    try {
      if(record)await chrome.storage.session.set({apiBudgetPause:record});else await chrome.storage.session.remove('apiBudgetPause');
      const saved=await chrome.storage.session.get('apiBudgetPause');
      const confirmed=record?JSON.stringify(budgetPauseRecord(budgetPauseFromRecord(saved.apiBudgetPause)))===JSON.stringify(record):saved.apiBudgetPause===undefined;
      if(confirmed&&!record&&writeVersion===budgetPauseWriteVersion)budgetPauseMayExist=false;
      return confirmed;
    }catch{return false;}
  });
  budgetPauseWrites=operation;return operation;
}
function clearQueuePause(provider) {
  if(provider&&queuePause?.provider!==provider)return Promise.resolve(true);
  ratePaused=false;queuePause=undefined;return Promise.resolve(true);
}
function clearAPIBudgetPause() {
  const previous=apiAccountPause;
  if(!previous&&!budgetPauseMayExist)return Promise.resolve(true);
  // Keep the account gate closed until durable removal is confirmed. A full
  // result can still be displayed if storage fails; it must not resume auto.
  return persistBudgetPause(undefined).then(cleared=>{if(cleared&&apiAccountPause===previous){apiAccountPause=undefined;return true;}return false;});
}
function queuePauseError(input=settings) { return input.provider==='api'&&apiAccountPause?apiAccountPause:capacityPausedFor(input)?apiCapacityPause:queuePause??{code:'RATE_LIMIT',error:rateLimitError().message}; }
function clearAPIDeadline(job) { clearTimeout(job.deadline);job.deadline=undefined; }
function startAPIDeadline(job) {
  clearAPIDeadline(job);
  const stage=job.slotPhase;
  job.deadline=setTimeout(()=>job.controller.abort(Object.assign(new Error('分析超时，Grok 未能完成响应；可手动重试。'),{code:'TIMEOUT',
    ...(stage==='verify'?{verificationFailure:{code:'TIMEOUT',stage:'verify',errorCode:'TIMEOUT'}}:{})})),150000);
}
function releaseAPISlot(job) { clearAPIDeadline(job);apiSlots.delete(job);job.slotHeld=false;job.slotPhase=null; }
function trackedAPICall(job,onUpdate) {
  job.apiProviderPending=true;
  return runAPI(job,onUpdate).finally(()=>{
    job.apiProviderPending=false;
    // A canceled UI job may have finished long before fetch/reader cleanup.
    // It still owns its global slot until this actual provider call settles.
    if(job.executionFinished){releaseAPISlot(job);pump();}
  });
}
function pauseWaitingJobs(job,error) {
  const budget=job.settings.provider==='api'?apiBudgetFailure(error):undefined;
  const capacity=job.settings.provider==='api'&&apiCapacityFailure(error);
  if(!budget&&!capacity&&error?.code!=='RATE_LIMIT')return;
  const safe=budget?GrokFirstAPI.publicError({code:'API_ERROR'}):{code:'RATE_LIMIT',error:rateLimitError().message};
  // Account spending is independent of short-lived provider rate limiting.
  // Switching to Build or receiving a later 429 cannot erase an API cause.
  if(budget){apiAccountPause={provider:'api',...safe,verificationFailure:budget};void persistBudgetPause(budgetPauseRecord(apiAccountPause));void broadcastConfig();}
  else if(capacity){apiCapacityPause={provider:'api',model:job.settings.apiModel,code:'API_CAPACITY',error:GrokFirstAPI.publicError({code:'API_CAPACITY'}).error};void persistCapacityPause(capacityPauseRecord(apiCapacityPause));void broadcastConfig();}
  else{queuePause={provider:job.settings.provider,...safe};ratePaused=true;}
  const paused=queuePauseError(job.settings);
  const affected=value=>value.settings.provider===job.settings.provider&&(!capacity||budget||value.settings.apiModel===job.settings.apiModel);
  for(const waiting of queue.filter(affected)) {
    jobError(waiting,paused.error,paused.code,paused.verificationFailure?{verificationFailure:paused.verificationFailure}:{});
    removeJob(waiting);
  }
  queue=queue.filter(value=>!affected(value));
}
function stopUnavailableBuild(code) {
  buildStatus={...buildStatus,available:false,errorCode:code};buildStatusAt=Date.now();
  for(const waiting of [...queue].filter(job=>job.settings.provider==='build')){jobError(waiting,SuperXBuild.publicError({code}).error,code);removeJob(waiting);}
  queue=queue.filter(job=>job.settings.provider!=='build');void broadcastConfig();
}
function pump() {
  if(pumping || !providerAllowsCalls())return;
  pumping=true;
  try {
    queue=queue.filter(job=>jobs.get(job.key)===job && !job.controller.signal.aborted && job.revision===revision && job.clientEpoch===job.client.cancelEpoch && clients.has(job.client));
    while(queue.length) {
      const job=queue[0];
      if(apiSlots.size>=apiLimit(job.settings))break;
      queue.shift();runningJobs.add(job);
      // Every post now owns one Fact Check request; all configured slots can
      // serve visible posts instead of reserving capacity for a second stage.
      job.slotHeld=true;job.slotPhase=commentsJob(job)?'comments':'verify';apiSlots.add(job);
      void executeJob(job);
    }
  } finally { pumping=false; }
}
async function executeJob(job) {
  const {client,requestId}=job,signal=job.controller.signal;
  const epoch=cacheEpoch;
  try {
    // Legacy session counts are informational only, never a dispatch limit.
    // Manual comment drafts are a separate task and do not increment them.
    const used=commentsJob(job)?quotas[client.tabId]||0:quotas[client.tabId]=(quotas[client.tabId] || 0)+1;
    startAPIDeadline(job);
    if(!commentsJob(job))void persistQuotas().catch(()=>{});
    if(!liveJob(job))return;
    send(client.port,{type:commentsJob(job)?'COMMENT_START':'START',requestId,...(commentsJob(job)?{}:{used})});
    const onUpdate=update=>{
      job.billing=billingMetadata(update,job.settings.provider);
      const diagnostics=requestMetadata(update,job.settings.provider).requestDiagnostics;if(diagnostics)job.requestDiagnostics=diagnostics;
      const hasText=typeof update.text==='string';
      const text=hasText?Core.readerOutput(update.text).text.slice(0,30000):undefined;
      if(!commentsJob(job)&&hasText) {
        if(text.trim())job.retainedFactCheck={...sanitizeAnalysis({...update,text}),...job.billing,provider:job.settings.provider,apiVerification:'only',verified:false,searched:update.searched===true};
        else delete job.retainedFactCheck;
      }
      if(liveJob(job)&&!commentsJob(job))send(client.port,{type:'UPDATE',requestId,...(hasText?{text}:{}),phase:update.phase,
        verificationStatus:update.verificationStatus,warning:update.warning,sources:update.sources,...job.billing,...verificationMetadata(update,job.settings.apiVerification,text||'')});
    };
    const result=withBillingMetadata(await (job.settings.provider==='build'?runAPI(job,onUpdate):waitForAbort(trackedAPICall(job,onUpdate),signal)),job.settings.provider,commentsJob(job)?undefined:job.settings.apiVerification);
    if(!liveJob(job))return;
    job.billing=billingMetadata(result,job.settings.provider);
    if(result.requestDiagnostics)job.requestDiagnostics=result.requestDiagnostics;
    if(job.settings.provider==='api'&&apiBudgetFailure(result))pauseWaitingJobs(job,result);
    if(job.settings.provider==='api'&&apiCapacityFailure(result))throw Object.assign(new Error('Model capacity is temporarily unavailable.'),{code:'API_CAPACITY',partialResult:result,verificationFailure:result.verificationFailure,...job.billing,...requestMetadata(result,'api')});
    if(commentsJob(job))result.comments=GrokFirstAPI.validateComments(result.comments);
    else {
      const reader=Core.readerOutput(result.text,{final:true});
      if(reader.kind!=='content'){
        delete job.retainedFactCheck;
        send(client.port,{type:'UPDATE',requestId,text:'',phase:'verify',verificationStatus:'pending',...job.billing});
        throw Object.assign(new Error('Grok 未返回可显示的核查答案，可手动重试。'),{code:'API_INCOMPLETE',verificationFailure:{stage:'verify',code:'INCOMPLETE',errorCode:'API_INCOMPLETE'},...job.billing});
      }
      result.text=reader.text.slice(0,30000);
    }
    if(['incomplete','failed'].includes(result.verificationStatus))rememberAPIDiagnostics(job,result,result.verificationFailure?.errorCode||'API_INCOMPLETE');
    // A spending pause permits one explicitly requested probe at a time.
    // Incomplete/failed results never reopen automatic account spending.
    let budgetRecovered=Boolean(job.budgetProbe&&apiAccountPause===job.budgetProbe&&!apiBudgetFailure(result)&&!['incomplete','failed'].includes(result.verificationStatus));
    if(budgetRecovered)budgetRecovered=await clearAPIBudgetPause();
    if(budgetRecovered){for(const peer of clients)send(peer.port,{type:'API_BUDGET_RECOVERED'});void broadcastConfig();}
    let capacityRecovered=Boolean(job.capacityProbe&&apiCapacityPause===job.capacityProbe&&!apiBudgetFailure(result)&&!apiCapacityFailure(result)&&!GrokFirstAPI.sanitizedVerificationFailure(result.verificationFailure)&&!['incomplete','failed'].includes(result.verificationStatus));
    if(capacityRecovered)capacityRecovered=await waitForAbort(clearAPICapacityPause(()=>liveJob(job)),signal);
    capacityRecovered=capacityRecovered&&!capacityPausedFor(job.settings)&&liveJob(job);
    if(capacityRecovered){for(const peer of clients)send(peer.port,{type:'API_CAPACITY_RECOVERED'});void broadcastConfig();}
    releaseAPISlot(job);pump();
    result.completedAt=Date.now();
    rememberHistoryResult(job.historyTicket,result,commentsJob(job),job.historyLanguage);
    if(epoch===cacheEpoch && !['incomplete','failed'].includes(result.verificationStatus)) {
      cache[job.fingerprint]=result;
      cache=pruneCache(cache);
      // Display a completed answer immediately. Optional serialized cache I/O
      // must not leave finished requests looking as though they still run.
      void persistCache(epoch).catch(()=>{});
    }
    const recovered={...(budgetRecovered?{apiBudgetRecovered:true}:{}),...(capacityRecovered?{apiCapacityRecovered:true}:{})};
    if(liveJob(job))send(client.port,commentsJob(job)?{type:'COMMENT_RESULT',requestId,comments:result.comments,cached:false,...job.billing,...recovered}:{type:'RESULT',requestId,result,cached:false,...recovered});
  } catch(e) {
    if(job.settings.provider==='build'&&e.code==='BUILD_CANCEL_UNCONFIRMED'){stopUnavailableBuild(e.code);if(!liveJob(job)&&clients.has(client))jobError(job,SuperXBuild.publicError(e).error,e.code);}
    if(liveJob(job)) {
      const errorBilling={...job.billing,...billingMetadata(e.partialResult,job.settings.provider),...billingMetadata(e,job.settings.provider)};
      const diagnostics=requestMetadata(e,job.settings.provider).requestDiagnostics||requestMetadata(e.partialResult,job.settings.provider).requestDiagnostics||job.requestDiagnostics;
      const diagnosticMetadata=diagnostics?{requestDiagnostics:diagnostics}:{};
      const partialText=Core.readerOutput(e.partialResult?.text,{final:true}).text.slice(0,30000);
      const partialResult=partialText?withBillingMetadata({...e.partialResult,...errorBilling,...diagnosticMetadata,text:partialText,verificationStatus:'incomplete'},job.settings.provider,job.settings.apiVerification):undefined;
      const safeError=job.settings.provider==='build'?SuperXBuild.publicError(e):GrokFirstAPI.publicError(e);
      const budgetFailure=job.settings.provider==='api'?apiBudgetFailure(e):undefined;
      const capacityFailure=job.settings.provider==='api'&&apiCapacityFailure(e)?GrokFirstAPI.sanitizedVerificationFailure(e.verificationFailure)||GrokFirstAPI.sanitizedVerificationFailure({stage:'verify',code:'SERVER',...e.failureDetails,errorCode:'API_CAPACITY'}):undefined;
      if(partialResult)rememberHistoryResult(job.historyTicket,{...partialResult,completedAt:Date.now()},false,job.historyLanguage);
      rememberAPIDiagnostics(job,{...diagnosticMetadata,verificationFailure:e.verificationFailure||partialResult?.verificationFailure||budgetFailure||capacityFailure},safeError.code);
      jobError(job,safeError.error,safeError.code,{...errorBilling,...diagnosticMetadata,...(commentsJob(job)?(budgetFailure||capacityFailure?{verificationFailure:budgetFailure||capacityFailure}:{}):{...verificationMetadata({verificationFailure:e.verificationFailure||partialResult?.verificationFailure||budgetFailure||capacityFailure},job.settings.apiVerification),partialResult})});
      if(e.code==='RATE_LIMIT'||e.code==='API_CAPACITY'||budgetFailure)pauseWaitingJobs(job,e);
      if(job.settings.provider==='build'&&['BUILD_CONNECTION_REQUIRED','BUILD_CANCEL_UNCONFIRMED','BUILD_PERMISSION_REQUIRED','BUILD_LOGIN_REQUIRED','BUILD_VERSION_UNSUPPORTED','BUILD_CONFIG_UNSUPPORTED','BUILD_TOOL_POLICY','BUILD_DISCONNECTED','BUILD_UNAVAILABLE'].includes(safeError.code))stopUnavailableBuild(safeError.code);
    } else if(signal.aborted && clients.has(client) && job.revision===revision && (!jobs.has(job.key)||jobs.get(job.key)===job)) {
      const reason=signal.reason;
      const timedOut=reason?.code==='TIMEOUT';
      const partialResult=timedOut&&job.retainedFactCheck?withBillingMetadata({...job.retainedFactCheck,...job.billing,verificationStatus:'incomplete',
        ...verificationMetadata(reason,job.settings.apiVerification)},job.settings.provider,job.settings.apiVerification):undefined;
      if(partialResult)rememberHistoryResult(job.historyTicket,{...partialResult,completedAt:Date.now()},false,job.historyLanguage);
      jobError(job,timedOut?GrokFirstAPI.publicError(reason).error:'请求已取消；可手动重试。',timedOut?reason.code:'CANCELLED',
        {...job.billing,...(timedOut&&!commentsJob(job)?verificationMetadata(reason,job.settings.apiVerification):{}),...(partialResult?{partialResult}:{} )});
    }
  } finally {
    clearAPIDeadline(job);removeJob(job);runningJobs.delete(job);job.executionFinished=true;
    if(!job.apiProviderPending)releaseAPISlot(job);
    pump();
  }
}
async function runAPI(job,onUpdate) {
  const signal=job.controller.signal;
  if(job.settings.provider==='build'){
    const connection=buildConnection({port:job.settings.buildPort});
    if(chrome.permissions?.contains&&!await chrome.permissions.contains({origins:['http://127.0.0.1/*']}))throw Object.assign(new Error('Local connection access was removed.'),{code:'BUILD_PERMISSION_REQUIRED'});
    if(!liveJob(job))throw signal.reason||new DOMException('Cancelled','AbortError');
    if(commentsJob(job))return SuperXBuild.generateComments(job.post,job.settings,{analysis:job.analysis,signal,connection});
    return SuperXBuild.run(job.post,job.settings,{signal,onUpdate,connection});
  }
  const session=await waitForAbort(chrome.storage.session.get('apiKey'),signal);
  const key=session.apiKey;
  if(!liveJob(job))throw signal.reason || new DOMException('Cancelled','AbortError');
  if(!validKey(key))throw Object.assign(new Error('请打开设置并输入 API Key。'),{code:'NEEDS_KEY'});
  if(commentsJob(job))return GrokFirstAPI.generateComments(job.post,job.settings,key,{analysis:job.analysis,signal});
  return GrokFirstAPI.run(job.post,job.settings,key,{signal:job.controller.signal,onUpdate});
}
function invalidateSecurityJobs() {
  revision++;
  for(const job of [...jobs.values()])abortJob(job);
  return clearQueuePause();
}
function securityError() {
  return {ok:false,errorKey:'errors.keyStorage'};
}
async function refreshSecurityState() {
  const [local,session]=await Promise.all([
    chrome.storage.local.get(['apiKey','apiKeyEncrypted','apiKeyVault','rememberApiKey','settings']),
    chrome.storage.session.get('apiKey')
  ]);
  // A superseded write may already have committed its optional settings. Read
  // the committed value so a later Key-only clear or replacement cannot leave
  // this worker's configuration different from the next worker's startup.
  settings=Core.normalizeSettings(local.settings);
  rememberApiKey=typeof local.rememberApiKey==='boolean'?local.rememberApiKey:rememberApiKey;
  hasSavedKey=KeyStore.envelopePresent(local.apiKeyEncrypted)||validKey(local.apiKey)||local.apiKeyVault!==undefined;
  credentialReady=validKey(session.apiKey);
}
async function persistEncryptedKey(apiKey,values={},current=()=>true) {
  sealAttempted=true;
  const envelope=await KeyStore.seal(apiKey);
  if(!current())return false;
  if(!KeyStore.isEnvelope(envelope)||await KeyStore.open(envelope)!==apiKey)throw new Error('Key storage validation failed.');
  if(!current())return false;
  await chrome.storage.local.set({...values,apiKeyEncrypted:envelope});
  if(!current())return false;
  // Confirm the committed cipher decrypts before discarding migration sources.
  const stored=await chrome.storage.local.get('apiKeyEncrypted');
  if(!current())return false;
  if(!KeyStore.isEnvelope(stored.apiKeyEncrypted)||await KeyStore.open(stored.apiKeyEncrypted)!==apiKey)throw new Error('Key storage validation failed.');
  if(!current())return false;
  await chrome.storage.local.remove(['apiKey','apiKeyVault']);
  return current();
}
async function mutateSecurity(message,generation) {
  const current=()=>generation===securityGeneration;
  if(!current())return;
  const apiKey=message.apiKey,remember=typeof message.remember==='boolean'?message.remember:rememberApiKey;
  const values={rememberApiKey:remember,...(message.settings?{settings:message.settings}:{})};
  // Remove the old session credential before changing persisted configuration.
  // No intermediate state can issue paid work with mixed old/new settings.
  await chrome.storage.session.remove('apiKey');
  if(!current())return;
  if(apiKey&&remember) {
    if(!await persistEncryptedKey(apiKey,values,current))return;
  } else {
    // A fresh, explicitly session-only save needs no IndexedDB. Clear and real
    // demotion still wait for durable deletion; faults or an earlier seal may
    // indicate an orphaned durable key that must also be removed.
    const needsDurableDeletion=!apiKey||message.remember!==false||hasSavedKey||sealAttempted||securityFault;
    await chrome.storage.local.remove(['apiKey','apiKeyEncrypted','apiKeyVault']);
    if(!current())return;
    if(needsDurableDeletion)await KeyStore.clear();
    if(!current())return;
    await chrome.storage.local.set(values);
  }
  if(!current())return;
  if(message.settings)settings=message.settings;
  if(apiKey)await chrome.storage.session.set({apiKey});
}
function queueSecurityMutation(message) {
  const generation=++securityGeneration;
  securityPending++;
  let pauseReset;
  if(message.settings&&JSON.stringify(message.settings)!==JSON.stringify(settings))pauseReset=invalidateSecurityJobs();
  else {for(const job of [...jobs.values()].filter(job=>job.settings.provider!=='build'))abortJob(job);pauseReset=clearQueuePause('api');}
  cache={};cacheEpoch++;
  // Invalidate at receipt, before asynchronous storage or settings changes.
  void ready.then(()=>broadcastConfig()).catch(()=>{});
  const operation=securityWrites.catch(()=>{}).then(async()=>{
    await ready;
    await pauseReset;
    const previousModel=settings.apiModel;
    let failure,changedAccountKey=!message.apiKey;
    if(message.apiKey&&(apiAccountPause||budgetPauseMayExist)){
      // Compare only in trusted worker memory, after startup restored the Key.
      // If the previous credential cannot be read, retain the account pause
      // until an explicit successful probe rather than guessing it changed.
      try{const previous=await chrome.storage.session.get('apiKey');changedAccountKey=validKey(previous.apiKey)&&previous.apiKey.trim()!==message.apiKey.trim();}catch{/* A Key save may still succeed; no budget reset is inferred. */}
    }
    try {
      try { await clearStoredCache(); }
      catch(error) { failure=securityError(); }
      // Even when clearing post content failed, try the credential operation.
      try { await mutateSecurity(message,generation); }
      catch(error) { failure=securityError(); }
      try { await refreshSecurityState(); }
      catch(error) { failure=securityError();credentialReady=false; }
      if(failure) {
        securityFault=true;
        try { await chrome.storage.session.set({securityFault:true}); }catch{/* The in-memory gate stays closed even if this marker cannot be saved. */}
      } else if(generation===securityGeneration) {
        try { await chrome.storage.session.remove('securityFault');securityFault=false; }
        catch(error) {
          securityFault=true;failure=securityError();
          try { await chrome.storage.session.set({securityFault:true}); }catch{/* Readiness remains closed in this worker. */}
        }
      }
      if(!failure&&generation===securityGeneration&&changedAccountKey)await clearAPIBudgetPause();
      if(!failure&&generation===securityGeneration&&settings.apiModel!==previousModel)await clearAPICapacityPause();
    }
    finally {
      securityPending--;
    }
    await broadcastConfig();
    return failure || {ok:true,...securityStatus()};
  });
  securityWrites=operation;
  return operation;
}
async function saveSettings(input) {
  const next=Core.normalizeSettings(input);
  if(JSON.stringify(next)!==JSON.stringify(settings)) {
    const modelChanged=next.apiModel!==settings.apiModel;
    const jobSettings=value=>{
      const {explainPrompt,verifyPrompt,commentsPrompt,interfaceLanguage,...other}=value;
      return other;
    };
    const cancelsJobs=JSON.stringify(jobSettings(next))!==JSON.stringify(jobSettings(settings));
    // Prompts are frozen when a job is accepted. Saving a new instruction or
    // interface locale never discards an already paid generation.
    if(cancelsJobs){revision++;for(const job of [...jobs.values()])abortJob(job);}
    settings=next;
    if(cancelsJobs){await clearQueuePause();pump();}
    await chrome.storage.local.set({settings});
    if(modelChanged)await clearAPICapacityPause();
  }
  await broadcastConfig();
}
function queueSettingsMutation(input) {
  const operation=securityWrites.catch(()=>{}).then(async()=>{
    await ready;
    await saveSettings(typeof input==='function'?input():input);
    return {ok:true};
  });
  securityWrites=operation;
  return operation;
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(trustedUI(sender) && message?.type==='SAVE_KEY') {
    // Reject invalid input without cancelling a valid paid task or touching Key
    // storage. Optional settings join the same blocked credential transaction.
    const raw=message.apiKey,apiKey=typeof raw==='string'?raw.trim():raw==null?'':null;
    if(apiKey===null||typeof raw==='string'&&(/[\r\n]/.test(raw)||raw.trim()&&!validKey(raw))) {respond({ok:false,errorKey:'errors.keyInvalid'});return true;}
    if(message.remember!==undefined&&typeof message.remember!=='boolean') {respond({ok:false,errorKey:'errors.keyInvalid'});return true;}
    const next=message.settings===undefined?undefined:Core.normalizeSettings(message.settings);
    if(next&&!next.webSearch&&!next.xSearch) {respond({ok:false,errorKey:'options.urlSearchRequired'});return true;}
    queueSecurityMutation({apiKey,remember:message.remember,settings:next})
      .then(respond).catch(()=>respond(securityError()));
    return true;
  }
  if(trustedUI(sender) && message?.type==='SAVE_SETTINGS') {
    const next=Core.normalizeSettings(message.settings);
    if(!next.webSearch&&!next.xSearch) {respond({ok:false,errorKey:'options.urlSearchRequired'});return true;}
    // Join the credential chain at receipt so even same-tick saves apply in the
    // user's requested order and cannot overwrite a newer atomic Key save.
    queueSettingsMutation(next).then(respond).catch(()=>respond({ok:false,error:'扩展操作失败，请重新加载扩展。'}));
    return true;
  }
  (async()=>{
    await ready;
    if(message?.type==='OPEN_SETTINGS' && (trustedUI(sender)||trustedFeed(sender))) {await openSettings(message.focus);return {ok:true};}
    if(message?.type==='OPEN_HISTORY' && (trustedUI(sender)||trustedFeed(sender))) {await openHistory();return {ok:true};}
    if(!trustedUI(sender)) return {ok:false,error:'此操作仅允许在扩展设置页中执行。'};
    if(message.type==='GET_UI_LANGUAGE')return {ok:true,language:await currentUILanguage()};
    if(message.type==='GET_SECURITY_STATUS')return {ok:true,...securityStatus()};
    if(message.type==='OPEN_CONNECTOR_GUIDE'){await chrome.tabs.create({url:chrome.runtime.getURL('setup.html')});return {ok:true};}
    if(message.type==='GET_BUILD_CONNECTION')return {ok:true,configured:validBuildSecret(buildSecret),port:settings.buildPort};
    if(message.type==='GET_BUILD_LAUNCH'){
      if(!['/options.html','/setup.html'].includes(new URL(sender.url).pathname))return {ok:false,errorKey:'build.codeRequired'};
      const port=message.port??settings.buildPort,secret=validBuildSecret(buildSecret)?buildSecret:newBuildSecret();
      try{return {ok:true,command:SuperXBuildSetup.command({platform:message.platform,port,secret}),port,secret};}catch{return {ok:false,errorKey:'build.codeRequired'};}
    }
    if(message.type==='SAVE_BUILD_CONNECTION')return queueBuildConnection(message);
    if(message.type==='CLEAR_BUILD_CONNECTION')return queueBuildConnection(message,true);
    if(message.type==='GET_BUILD_STATUS')return checkBuildDraft(message);
    if(message.type==='GET_CONFIG'){if(settings.provider==='build')await refreshBuildStatus();return {ok:true,...await publicConfig()};}
    if(message.type==='GET_API_DIAGNOSTICS')return getAPIDiagnostics();
    if(message.type==='CLEAR_API_DIAGNOSTICS')return clearAPIDiagnostics();
    if(message.type==='GET_HISTORY'||message.type==='GET_HISTORY_STATUS'){
      try{return {ok:true,...await history[message.type==='GET_HISTORY'?'get':'status']()};}
      catch{return {ok:false,errorKey:'history.storageError'};}
    }
    if(['CLEAR_HISTORY','DELETE_HISTORY','SET_HISTORY_ENABLED'].includes(message.type)){
      if(message.type==='DELETE_HISTORY'&&!/^\d{1,25}$/.test(String(message.id||''))||message.type==='SET_HISTORY_ENABLED'&&typeof message.enabled!=='boolean')return {ok:false,errorKey:'history.storageError'};
      try{
        const result=await (message.type==='CLEAR_HISTORY'?history.clear():message.type==='DELETE_HISTORY'?history.delete(message.id):history.setEnabled(message.enabled));
        await broadcastHistoryConfig();return {ok:true,...result};
      }catch{return {ok:false,errorKey:'history.storageError'};}
    }
    if(message.type==='CLEAR_CACHE') { await clearStoredCache();return {ok:true}; }
    return {ok:false,error:'未知操作。'};
  })().then(respond).catch(()=>respond({ok:false,error:'扩展操作失败，请重新加载扩展。'}));
  return true;
});
chrome.alarms?.onAlarm.addListener(alarm=>{
  if(alarm.name===HISTORY_ALARM){
    void ready.then(()=>history.prune()).then(()=>notifyHistoryChanged()).catch(()=>{});
    void ready.then(()=>pruneStoredAPIDiagnostics()).catch(()=>{});
  }
});
chrome.permissions?.onRemoved?.addListener(removed=>{
  if(!removed.origins?.includes('http://127.0.0.1/*'))return;
  void ready.then(async()=>{
    buildConnectionGeneration++;stopUnavailableBuild('BUILD_PERMISSION_REQUIRED');
    for(const job of [...jobs.values()].filter(job=>job.settings.provider==='build'))abortJob(job);
    await SuperXBuild.close?.();
  }).catch(()=>{});
});
chrome.tabs.onRemoved.addListener(tabId=>{
  ready.then(async()=>{delete quotas[tabId];delete railStates[tabId];await Promise.all([persistQuotas(),persistRailStates()]);});
  for(const client of clients) if(client.tabId===tabId) cancelClient(client);
});
