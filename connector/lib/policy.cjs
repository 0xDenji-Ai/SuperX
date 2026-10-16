'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VERSION = '1.0.60';
const HOST_NAME = 'com.superx.grok';
const MAX_FRAME = 1024 * 1024;
const MAX_TEXT = 200000;
const COMMENTS_SCHEMA = Object.freeze({type:'array',minItems:3,maxItems:3,items:{type:'string',minLength:1,maxLength:280}});
const ERRORS = Object.freeze({
  BUILD_UNAVAILABLE:'The official Grok Build runtime is unavailable.',
  BUILD_VERSION_UNSUPPORTED:'This connector requires Grok Build 1.0.60.',
  BUILD_CONFIG_UNSUPPORTED:'The isolated Grok profile or a system policy prevents this connection. Reconnect to reset the isolated profile. Managed enterprise devices require administrator review or API mode.',
  BUILD_LOGIN_REQUIRED:'Sign in with the official Grok Build login command, then check again.',
  BUILD_MODEL_UNSUPPORTED:'The selected model is unavailable in the installed Grok Build runtime.',
  BUILD_EFFORT_UNSUPPORTED:'The selected reasoning effort could not be confirmed.',
  BUILD_TOOL_POLICY:'The restricted tool policy could not be confirmed.',
  BUILD_PROTOCOL_ERROR:'The local Grok connection returned an invalid response.',
  BUILD_TIMEOUT:'The local Grok request timed out.',
  BUILD_CANCELLED:'The local Grok request was cancelled.',
  BUILD_OUTPUT_INVALID:'Grok did not return a complete valid answer.',
  BUILD_LIMIT:'The local connector request or output exceeded its limit.',
  BUILD_SEARCH_NOT_PERFORMED:'Grok completed without an observed search. Verification is incomplete.',
  BUILD_RATE_LIMIT:'Grok reported a usage or rate limit. Check the official dashboard.',
  BUILD_ACCESS_DENIED:'Grok denied access. Check the official account dashboard.',
});
function failure(code, metadata) {
  const e = new Error(ERRORS[code] || ERRORS.BUILD_PROTOCOL_ERROR);
  e.code = Object.hasOwn(ERRORS,code) ? code : 'BUILD_PROTOCOL_ERROR';
  if (metadata) Object.assign(e,metadata);
  return e;
}
function publicError(error, requestId) {
  const code = Object.hasOwn(ERRORS,error?.code) ? error.code : 'BUILD_PROTOCOL_ERROR';
  const result = {type:'ERROR',requestId,code,error:ERRORS[code]};
  if (error?.usage) result.usage = usage(error.usage,'normalized').usage;
  if (typeof error?.usageComplete === 'boolean') result.usageComplete = error.usageComplete;
  if (modelId(error?.model)) result.model = error.model;
  return result;
}
function classifyError(error, defaultCode='BUILD_PROTOCOL_ERROR') {
  if (Object.hasOwn(ERRORS,error?.code)) return error;
  // Raw upstream messages are inspected only in memory, never returned or logged.
  const message = String(error?.message || '');
  if (/unauthenticated|not authenticated|login required|sign.in|401|cached.token/i.test(message)) return failure('BUILD_LOGIN_REQUIRED');
  if (/rate.limit|429|quota|usage.limit|spending.limit|402/i.test(message)) return failure('BUILD_RATE_LIMIT');
  if (/forbidden|403|access.denied/i.test(message)) return failure('BUILD_ACCESS_DENIED');
  return failure(defaultCode);
}
function modelId(value) { return typeof value === 'string' && /^grok-[a-z0-9][a-z0-9._-]{0,95}$/.test(value); }
function validRequestId(value) { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value); }
function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function validateRequest(message) {
  if (!message || Array.isArray(message) || typeof message !== 'object' || !validRequestId(message.requestId)) throw failure('BUILD_PROTOCOL_ERROR');
  if (message.protocolVersion !== undefined && message.protocolVersion !== 1) throw failure('BUILD_PROTOCOL_ERROR');
  if (!['STATUS','RUN','CANCEL'].includes(message.type)) throw failure('BUILD_PROTOCOL_ERROR');
  const allowed = new Set(['protocolVersion','type','requestId','task','transport','model','effort','webSearch','xSearch','prompt','outputSchema']);
  if (Object.keys(message).some(key=>!allowed.has(key))) throw failure('BUILD_PROTOCOL_ERROR');
  if (message.type !== 'RUN') return {type:message.type,requestId:message.requestId};
  if (!['verify','comments'].includes(message.task) || !['acp','cli'].includes(message.transport) || !modelId(message.model)) throw failure('BUILD_PROTOCOL_ERROR');
  if (!['minimal','low','medium','high','xhigh'].includes(message.effort)) throw failure('BUILD_EFFORT_UNSUPPORTED');
  if (typeof message.prompt !== 'string' || !message.prompt.trim() || message.prompt.length > 60000 || message.prompt.includes('\0')) throw failure('BUILD_LIMIT');
  if (typeof message.webSearch !== 'boolean' || typeof message.xSearch !== 'boolean') throw failure('BUILD_PROTOCOL_ERROR');
  if (message.task === 'verify' && !message.webSearch && !message.xSearch) throw failure('BUILD_TOOL_POLICY');
  if (message.task === 'comments' && (message.webSearch || message.xSearch)) throw failure('BUILD_TOOL_POLICY');
  if (message.outputSchema !== undefined && (message.task !== 'comments' || canonical(message.outputSchema) !== canonical(COMMENTS_SCHEMA))) throw failure('BUILD_PROTOCOL_ERROR');
  return {...message,outputSchema:message.task === 'comments' ? COMMENTS_SCHEMA : undefined};
}
function loadConfig(filename) {
  let raw;
  try { const stat=fs.statSync(filename); if (!stat.isFile() || stat.size>16384) throw failure('BUILD_UNAVAILABLE'); raw=JSON.parse(fs.readFileSync(filename,'utf8')); }
  catch { throw failure('BUILD_UNAVAILABLE'); }
  if (!raw || !Array.isArray(raw.extensionIds) || !raw.extensionIds.length || raw.extensionIds.length>20 || raw.extensionIds.some(id=>typeof id!=='string'||!/^[a-p]{32}$/.test(id))) throw failure('BUILD_UNAVAILABLE');
  if (raw.runtimeVersion!==VERSION) throw failure('BUILD_VERSION_UNSUPPORTED');
  if (typeof raw.grokPath!=='string' || !path.isAbsolute(raw.grokPath) || !fs.existsSync(raw.grokPath) || !fs.statSync(raw.grokPath).isFile() || /\.(?:cmd|bat|ps1|sh)$/i.test(raw.grokPath)) throw failure('BUILD_UNAVAILABLE');
  return {extensionIds:[...new Set(raw.extensionIds)],grokPath:raw.grokPath,runtimeVersion:VERSION};
}
function authorizedOrigin(argv, config) {
  // Chromium appends --parent-window=... on Windows. It is never an identity.
  return typeof argv[0]==='string' && config.extensionIds.some(id=>argv[0]===`chrome-extension://${id}/`) && argv.slice(1).every(arg=>/^--parent-window=\d+$/.test(arg));
}
const ISOLATION_MARKERS=Object.freeze(['GROK_AUTH_PATH','GROK_CLAUDE_MCPS_ENABLED','GROK_CURSOR_MCPS_ENABLED','GROK_MANAGED_MCPS_ENABLED','GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED']);
function cleanEnvironment(source=process.env,{grokHome,authPath=path.join(os.homedir(),'.grok','auth.json')}={}) {
  if(typeof grokHome!=='string'||!path.isAbsolute(grokHome)||!path.isAbsolute(authPath))throw failure('BUILD_TOOL_POLICY');
  const env={...source};
  for (const key of Object.keys(env)) if (/^(?:XAI_|GROK_)/i.test(key) || /(?:API_?KEY|ACCESS_?TOKEN|AUTH_?TOKEN|REFRESH_?TOKEN|ID_?TOKEN)$/i.test(key) || /^(?:NODE_OPTIONS|NODE_PATH|LD_PRELOAD|DYLD_INSERT_LIBRARIES)$/i.test(key)) delete env[key];
  Object.assign(env,{GROK_HOME:grokHome,GROK_AUTH_PATH:authPath,GROK_SUBAGENTS:'0',GROK_WORKFLOWS:'0',GROK_AGENT_DASHBOARD:'0',GROK_MANAGED_MCPS_ENABLED:'0',GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED:'0'});
  // Compatibility discovery is process-wide and can start before session policy.
  for(const vendor of ['CLAUDE','CURSOR','CODEX'])for(const surface of ['SKILLS','RULES','AGENTS','MCPS','HOOKS','SESSIONS'])env[`GROK_${vendor}_${surface}_ENABLED`]='0';
  return env;
}
function present(file) {try{fs.lstatSync(file);return true;}catch(error){if(['ENOENT','ENOTDIR'].includes(error?.code))return false;throw failure('BUILD_CONFIG_UNSUPPORTED');}}
function systemConfigPaths(platform=process.platform,username) {
  if(platform==='win32')return [];
  const files=['/etc/grok/managed_config.toml','/etc/grok/requirements.toml'];
  if(platform==='darwin') {
    files.push('/Library/Application Support/ClaudeCode/managed-settings.json','/Library/Managed Preferences/ai.x.grok.plist');
    const user=username??os.userInfo().username;
    if(typeof user==='string'&&user&&!/[\\/]/.test(user))files.push(`/Library/Managed Preferences/${user}/ai.x.grok.plist`);
  }
  return files;
}
function checkConfiguration(cwd, home,exists=present,{platform=process.platform,username}={}) {
  if(typeof home!=='string'||!path.isAbsolute(home))throw failure('BUILD_TOOL_POLICY');
  // Stat only: the connector never opens configuration that might contain a key.
  const candidates=['config.toml','managed_config.toml','requirements.toml'].map(n=>path.join(home,n));
  // Fixed-version project discovery reads only cwd when it is outside a Git repo.
  // Reject a repository ancestor rather than inheriting any project configuration.
  for(let dir=cwd;;dir=path.dirname(dir)) { if(exists(path.join(dir,'.git')))throw failure('BUILD_CONFIG_UNSUPPORTED');if(path.dirname(dir)===dir)break; }
  candidates.push(path.join(cwd,'.grok','config.toml'),path.join(cwd,'.mcp.json'),...systemConfigPaths(platform,username));
  if(candidates.some(file=>exists(file)))throw failure('BUILD_CONFIG_UNSUPPORTED');
}
function configurationWarning(stderr) { return /\b(?:unknown|unmappable|unrecognized)(?:\b|[_-])|\bkeeping\s+(?:the\s+)?full\b/i.test(String(stderr).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')); }
function whole(n) { return Number.isSafeInteger(n)&&n>=0; }
function usage(raw, route) {
  if(!raw || typeof raw!=='object')return {usage:{},usageComplete:false};
  if(route==='normalized') { const out={};for(const k of ['input_tokens','output_tokens','total_tokens'])if(whole(raw[k]))out[k]=raw[k];return {usage:out,usageComplete:whole(out.total_tokens)}; }
  const cli=route==='cli', input=raw[cli?'input_tokens':'inputTokens'], output=raw[cli?'output_tokens':'outputTokens'], total=raw[cli?'total_tokens':'totalTokens'];
  const cached=raw[cli?'cache_read_input_tokens':'cachedReadTokens'], creation=raw[cli?'cache_creation_input_tokens':'cacheCreationTokens']??raw.cachedCreationTokens;
  const out={};
  const includedInput=cli&&whole(input)?input+(whole(cached)?cached:0)+(whole(creation)?creation:0):input;
  if(whole(includedInput))out.input_tokens=includedInput;
  if(whole(output))out.output_tokens=output;
  if(whole(total))out.total_tokens=total;
  if(whole(cached))out.input_tokens_details={cached_tokens:cached};
  const reasoning=raw[cli?'reasoning_tokens':'reasoningTokens'];if(whole(reasoning))out.output_tokens_details={reasoning_tokens:reasoning};
  const consistent=whole(total)&&(!whole(includedInput)||!whole(output)||includedInput+output===total);
  return {usage:out,usageComplete:consistent};
}
function validateComments(value) {
  let data=value;
  if(typeof data==='string')try{data=JSON.parse(data);}catch{throw failure('BUILD_OUTPUT_INVALID');}
  if(!Array.isArray(data)||data.length!==3||data.some(s=>typeof s!=='string'||s!==s.trim()||!s||Array.from(s).length>280||/[\r\n\u2028\u2029\x00-\x1f]/.test(s))||new Set(data).size!==3)throw failure('BUILD_OUTPUT_INVALID');
  return JSON.stringify(data);
}
module.exports={VERSION,HOST_NAME,MAX_FRAME,MAX_TEXT,COMMENTS_SCHEMA,ERRORS,ISOLATION_MARKERS,failure,publicError,classifyError,modelId,validRequestId,canonical,validateRequest,loadConfig,authorizedOrigin,cleanEnvironment,checkConfiguration,systemConfigPaths,configurationWarning,usage,validateComments};
