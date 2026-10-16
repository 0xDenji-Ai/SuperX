'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const Setup=require('../extension/build-setup.js');
const secret='superx_'+ 'a1'.repeat(32),input={platform:'windows',port:2419,secret};

test('startup builder validates ports, platforms and connection-code injection before producing shell code',()=>{
  for(const changed of [{platform:'linux'},{platform:null},{port:1023},{port:65536},{port:'2419'},{port:Infinity},{secret:''},{secret:'a'.repeat(23)},{secret:'a'.repeat(257)},{secret:'xai-'+ 'a'.repeat(30)},{secret:'sk-'+ 'a'.repeat(30)},{secret:'safeCode;$(touch injected)'},{secret:"a'.repeat(40)"},{secret:'a'.repeat(30)+'\nwhoami'},{secret:'a'.repeat(30)+'&'}])assert.throws(()=>Setup.command({...input,...changed}),/Invalid local Grok launch/);
  for(const value of [undefined,null,[],42,'windows'])assert.throws(()=>Setup.command(value),TypeError);
  assert.deepEqual(Setup.validate({...input,platform:'win32'}),input);
  assert.deepEqual(Setup.validate({...input,platform:'darwin'}),{...input,platform:'macos'});
  assert.doesNotThrow(()=>Setup.command({...input,port:1024}));assert.doesNotThrow(()=>Setup.command({...input,port:65535}));
});

test('both official commands keep secrets out of Grok arguments and retain hosted web search',()=>{
  for(const platform of ['windows','macos']){
    const command=Setup.command({...input,platform});assert.equal(command.split(secret).length-1,1);assert.match(command,/GROK_AGENT_SECRET/);assert.match(command,/127\.0\.0\.1:2419/);
    for(const unwanted of ['--secret','--always-approve','--yolo','--agent-profile','--disable-web-search','curl ','irm ','Invoke-WebRequest','npm install','auth.json\' -Raw','Get-Content','cat '])assert.equal(command.includes(unwanted),false,platform+' contains '+unwanted);
    for(const name of ['GROK_HOME','GROK_AUTH_PATH','GROK_SUBAGENTS','GROK_WORKFLOWS','GROK_AGENT_DASHBOARD','GROK_MANAGED_MCPS_ENABLED','GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED'])assert.ok(command.includes(name));
    for(const vendor of ['CLAUDE','CURSOR','CODEX'])for(const surface of ['SKILLS','RULES','AGENTS','MCPS','HOOKS','SESSIONS'])assert.ok(command.includes(`GROK_${vendor}_${surface}_ENABLED`));
    assert.match(command,/--permission-mode/);assert.match(command,/dontAsk/);assert.match(command,/--no-subagents/);assert.match(command,/--no-leader/);assert.match(command,/MCPTool/);assert.match(command,/1\\?\.0\\?\.60/);
  }
});

test('Windows cleanup restores the launching shell and validates its own temporary directory before deletion',()=>{
  const command=Setup.command(input);assert.match(command,/finally/);assert.match(command,/Set-Location -LiteralPath \$superxPreviousLocation\.Path/);assert.match(command,/SetEnvironmentVariable\(\$superxName, \$superxPreviousEnvironment\[\$superxName\], 'Process'\)/);
  assert.ok(command.indexOf('[IO.Path]::GetDirectoryName($superxResolved) -eq $superxTemp')<command.indexOf('Remove-Item -LiteralPath $superxResolved -Recurse -Force'));
  assert.match(command,/ReparsePoint/);assert.match(command,/superxLinks\.Count -eq 0/);assert.match(command,/superx-grok-\[a-f0-9\]\{32\}/);assert.match(command,/Get-Item -LiteralPath \$superxWork/);
});

test('macOS uses a subshell, private temporary folders, managed-policy guards and bounded cleanup',()=>{
  const command=Setup.command({...input,platform:'macos'});assert.ok(command.startsWith('(\n'));assert.ok(command.endsWith('\n)'));assert.match(command,/umask 077/);assert.match(command,/trap sx_cleanup 0 1 2 15/);assert.match(command,/mktemp -d/);assert.match(command,/\[ ! -L "\$sx_root" \]/);assert.match(command,/dirname "\$sx_root"/);
  for(const filename of ['/etc/grok/managed_config.toml','/etc/grok/requirements.toml','/Library/Application Support/ClaudeCode/managed-settings.json','/Library/Managed Preferences/ai.x.grok.plist','/Library/Managed Preferences/$sx_user/ai.x.grok.plist'])assert.ok(command.includes(filename));
  assert.match(command,/unset "\$sx_name"/);assert.equal(command.includes('eval '),false);assert.equal(command.includes('env -i'),false);assert.match(command,/GROK_AGENT_SECRET='superx_/);
});

test('the startup builder loads without Node or DOM APIs in an extension worker',()=>{
  const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/build-setup.js'),'utf8'),context);assert.equal(context.SuperXBuildSetup.command(input),Setup.command(input));
});

function withFixture(callback){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'superx-setup-test-'));
  try{return callback(root);}finally{const full=path.resolve(root),temp=path.resolve(os.tmpdir());if(path.dirname(full)!==temp||!path.basename(full).startsWith('superx-setup-test-'))throw Error('Unsafe test cleanup path');fs.rmSync(full,{recursive:true,force:true});}
}
function powershell(){for(const name of ['pwsh.exe','powershell.exe']){const probe=spawnSync(name,['-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.Major'],{encoding:'utf8',windowsHide:true});if(probe.status===0)return name;}return null;}
const ps=process.platform==='win32'?powershell():null;
function windowsFixture(root,{version='1.0.60',exitCode=0}={}){
  const bin=path.join(root,'bin with spaces'),home=path.join(root,'home with spaces'),temp=path.join(root,'temp with spaces'),observed=path.join(root,'observed.json');for(const dir of [bin,home,temp])fs.mkdirSync(dir);
  const recorder=path.join(root,'fake-grok.cjs');fs.writeFileSync(recorder,`const fs=require('node:fs'); fs.writeFileSync(${JSON.stringify(observed)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),home:process.env.GROK_HOME,auth:process.env.GROK_AUTH_PATH,secret:process.env.GROK_AGENT_SECRET,disabled:Object.fromEntries(Object.entries(process.env).filter(([k])=>/^GROK_.*(?:ENABLED|SUBAGENTS|WORKFLOWS|DASHBOARD)$/.test(k))),unsafe:['XAI_API_KEY','OPENAI_API_KEY','GROK_EXISTING','NODE_OPTIONS','PYTHONPATH'].filter(k=>process.env[k])}));process.exit(${exitCode});`);
  fs.writeFileSync(path.join(bin,'grok.cmd'),`@echo off\r\nif "%~1"=="--version" (\r\n echo grok ${version}\r\n exit /b 0\r\n)\r\n"${process.execPath}" "${recorder}" %*\r\nexit /b %errorlevel%\r\n`);
  return {bin,home,temp,observed};
}
function runWindows(root,fixture,command){
  const quote=value=>"'"+value.replace(/'/g,"''")+"'";
  const script=path.join(root,'launch-test.ps1'),result=path.join(root,'parent.json');
  fs.writeFileSync(script,`$ErrorActionPreference='Stop'\n$env:PATH=${quote(fixture.bin)}+';'+$env:PATH\n$env:USERPROFILE=${quote(fixture.home)}\n$env:TEMP=${quote(fixture.temp)}\n$env:TMP=${quote(fixture.temp)}\n$env:GROK_EXISTING='prior'\n$env:XAI_API_KEY='unused-test-value'\n$env:OPENAI_API_KEY='unused-test-value'\n$env:NODE_OPTIONS='--require missing-setup-test-loader'\n$env:PYTHONPATH='unused-test-path'\nSet-Location -LiteralPath ${quote(root)}\ntry {\n${command}\n} catch { $launchError=$_.Exception.Message }\n@{grok=$env:GROK_EXISTING;xai=$env:XAI_API_KEY;loader=$env:NODE_OPTIONS;cwd=(Get-Location).Path;launchError=$launchError} | ConvertTo-Json | Set-Content -LiteralPath ${quote(result)} -Encoding UTF8\n`);
  const run=spawnSync(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(run.status,0,run.stderr||run.stdout);
  return {parent:JSON.parse(fs.readFileSync(result,'utf8').replace(/^\uFEFF/,'')),observed:fs.existsSync(fixture.observed)?JSON.parse(fs.readFileSync(fixture.observed,'utf8')):null};
}

test('Windows actual shell isolates the official invocation and restores environment/CWD without retaining a temp tree',{skip:!ps},()=>withFixture(root=>{
  const fixture=windowsFixture(root),result=runWindows(root,fixture,Setup.command(input));assert.equal(result.parent.launchError,null);assert.equal(result.parent.grok,'prior');assert.equal(result.parent.xai,'unused-test-value');assert.equal(result.parent.loader,'--require missing-setup-test-loader');assert.equal(result.parent.cwd,root);
  assert.equal(result.observed.secret,secret);assert.equal(result.observed.auth,path.join(fixture.home,'.grok','auth.json'));assert.deepEqual(result.observed.unsafe,[]);assert.ok(Object.values(result.observed.disabled).length>=23);assert.ok(Object.values(result.observed.disabled).every(value=>value==='0'));
  assert.deepEqual(result.observed.args,['--permission-mode','dontAsk','--no-subagents','--deny','Bash','--deny','Read','--deny','Edit','--deny','Write','--deny','Grep','--deny','MCPTool','agent','--no-leader','serve','--bind','127.0.0.1:2419']);assert.equal(result.observed.args.includes(secret),false);assert.equal(path.dirname(result.observed.cwd),path.dirname(result.observed.home));assert.equal(fs.existsSync(path.dirname(result.observed.home)),false);assert.deepEqual(fs.readdirSync(fixture.temp),[]);
}));

test('Windows rejects an unvalidated official runtime before starting the server and still restores the shell',{skip:!ps},()=>withFixture(root=>{
  const fixture=windowsFixture(root,{version:'1.0.99'}),result=runWindows(root,fixture,Setup.command(input));assert.equal(result.observed,null);assert.match(result.parent.launchError,/supports official Grok 1\.0\.60/);assert.equal(result.parent.grok,'prior');assert.equal(result.parent.cwd,root);assert.deepEqual(fs.readdirSync(fixture.temp),[]);
}));

test('Windows runtime failures retain cleanup and do not repeat a server launch',{skip:!ps},()=>withFixture(root=>{
  const fixture=windowsFixture(root,{exitCode:2}),result=runWindows(root,fixture,Setup.command(input));assert.match(result.parent.launchError,/service stopped/);assert.ok(result.observed);assert.equal(result.parent.grok,'prior');assert.deepEqual(fs.readdirSync(fixture.temp),[]);
}));

const posixShell=process.platform==='win32'?(fs.existsSync('C:/Program Files/Git/bin/bash.exe')?'C:/Program Files/Git/bin/bash.exe':null):'/bin/sh';
const posixPath=value=>process.platform==='win32'?value.replace(/^([a-z]):/i,(_,drive)=>'/'+drive.toLowerCase()).replace(/\\/g,'/'):value;
const shellArgs=process.platform==='win32'?['--noprofile','--norc']:[];
test('macOS command is valid POSIX shell syntax',{skip:!posixShell},()=>withFixture(root=>{
  const script=path.join(root,'launch.sh');fs.writeFileSync(script,Setup.command({...input,platform:'macos'}));const result=spawnSync(posixShell,[...shellArgs,'-n',posixPath(script)],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}));

test('POSIX shell isolates the macOS invocation, clears bare and prefixed tokens, restores parent state and removes only its own tree',{skip:!posixShell},()=>withFixture(root=>{
  const bin=path.join(root,'posix bin'),home=path.join(root,'posix home'),temp=path.join(root,'posix temp'),observed=path.join(root,'posix-observed.json');for(const dir of [bin,home,temp])fs.mkdirSync(dir);
  const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
  const recorder=path.join(root,'posix-recorder.cjs');fs.writeFileSync(recorder,`require('node:fs').writeFileSync(${JSON.stringify(observed)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),grokHome:process.env.GROK_HOME,authPath:process.env.GROK_AUTH_PATH,secret:process.env.GROK_AGENT_SECRET,unsafe:['API_KEY','AUTH_TOKEN','OPENAI_API_KEY','XAI_API_KEY','GROK_EXISTING','NODE_OPTIONS','PYTHONPATH'].filter(k=>process.env[k])}));`);
  const grok=path.join(bin,'grok');fs.writeFileSync(grok,`#!/bin/sh\nif [ "$1" = --version ]; then printf '%s\\n' 'grok 1.0.60'; exit 0; fi\n${quote(posixPath(process.execPath))} ${quote(posixPath(recorder))} "$@"\n`);fs.chmodSync(grok,0o700);
  const script=path.join(root,'posix-test.sh'),parent=path.join(root,'posix-parent.txt');
  fs.writeFileSync(script,`#!/bin/sh\nPATH=${quote(posixPath(bin))}:"$PATH"; export PATH\nHOME=${quote(posixPath(home))}; export HOME\nTMPDIR=${quote(posixPath(temp))}; export TMPDIR\nGROK_EXISTING=prior; API_KEY=unused; AUTH_TOKEN=unused; OPENAI_API_KEY=unused; XAI_API_KEY=unused; NODE_OPTIONS='--require missing-loader'; PYTHONPATH=unused\nexport GROK_EXISTING API_KEY AUTH_TOKEN OPENAI_API_KEY XAI_API_KEY NODE_OPTIONS PYTHONPATH\ncd ${quote(posixPath(root))}\n${Setup.command({...input,platform:'macos'})}\nsx_exit=$?\nprintf '%s\\n' "$GROK_EXISTING" "$NODE_OPTIONS" "$PWD" "$sx_exit" > ${quote(posixPath(parent))}\n`);
  const result=spawnSync(posixShell,[...shellArgs,posixPath(script)],{encoding:'utf8',timeout:20000});assert.equal(result.status,0,result.stderr||result.stdout);const parentValues=fs.readFileSync(parent,'utf8').trim().split(/\r?\n/);assert.deepEqual(parentValues,['prior','--require missing-loader',posixPath(root),'0']);
  const actual=JSON.parse(fs.readFileSync(observed,'utf8'));assert.deepEqual(actual.unsafe,[]);assert.equal(posixPath(actual.authPath),posixPath(home)+'/.grok/auth.json');assert.equal(actual.secret,secret);assert.equal(actual.args.includes(secret),false);assert.equal(actual.args.at(-1),'127.0.0.1:2419');assert.match(actual.grokHome,/\/superx-grok\.[A-Za-z0-9]{8}\/grok-home$/);assert.deepEqual(fs.readdirSync(temp),[]);
}));
