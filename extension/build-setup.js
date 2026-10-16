(function(root){
  'use strict';
  const VERSION='1.0.60';
  const DISABLED=Object.freeze(['GROK_SUBAGENTS','GROK_WORKFLOWS','GROK_AGENT_DASHBOARD','GROK_MANAGED_MCPS_ENABLED','GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED',...['CLAUDE','CURSOR','CODEX'].flatMap(vendor=>['SKILLS','RULES','AGENTS','MCPS','HOOKS','SESSIONS'].map(surface=>`GROK_${vendor}_${surface}_ENABLED`))]);
  const LOADERS=Object.freeze(['NODE_OPTIONS','NODE_PATH','PYTHONPATH','PYTHONHOME','NPM_CONFIG_USERCONFIG','NPM_CONFIG_GLOBALCONFIG','BASH_ENV','ENV','ZDOTDIR','LD_PRELOAD','DYLD_INSERT_LIBRARIES','DYLD_LIBRARY_PATH','DYLD_FRAMEWORK_PATH']);
  const ARGS=Object.freeze(['--permission-mode','dontAsk','--no-subagents','--deny','Bash','--deny','Read','--deny','Edit','--deny','Write','--deny','Grep','--deny','MCPTool','agent','--no-leader','serve','--bind']);
  function validate(value){
    if(!value||typeof value!=='object')throw new TypeError('Invalid local Grok launch configuration.');
    const platform=['windows','win32'].includes(value.platform)?'windows':['macos','mac','darwin'].includes(value.platform)?'macos':null;
    if(!platform||!Number.isInteger(value.port)||value.port<1024||value.port>65535||typeof value.secret!=='string'||!/^[-_A-Za-z0-9]{24,256}$/.test(value.secret)||/^(?:xai|sk)-/i.test(value.secret))throw new TypeError('Invalid local Grok launch configuration.');
    return {platform,port:value.port,secret:value.secret};
  }
  function windows({port,secret}){
    const loaderPattern=LOADERS.join('|');
    return `& {
  $superxPreviousLocation = Get-Location
  $superxPreviousEnvironment = @{}
  $superxRoot = $null
  $superxTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $superxNames = @(Get-ChildItem Env: | Where-Object { $_.Name -match '^(XAI_|GROK_)|(?:API_?KEY|ACCESS_?TOKEN|AUTH_?TOKEN|REFRESH_?TOKEN|ID_?TOKEN)$|^(${loaderPattern})$' } | ForEach-Object { $_.Name })
  $superxNames += @('GROK_HOME', 'GROK_AUTH_PATH', 'GROK_AGENT_SECRET', ${DISABLED.map(name=>`'${name}'`).join(', ')})
  $superxNames = @($superxNames | Select-Object -Unique)
  foreach ($superxName in $superxNames) { $superxPreviousEnvironment[$superxName] = [Environment]::GetEnvironmentVariable($superxName, 'Process') }
  try {
    $superxGrok = (Get-Command grok -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    if (-not [IO.Path]::IsPathRooted($env:USERPROFILE)) { throw 'Your user home is unavailable. Use API Key mode until it is restored.' }
    $superxAuthPath = Join-Path $env:USERPROFILE '.grok\\auth.json'
    foreach ($superxName in $superxNames) { [Environment]::SetEnvironmentVariable($superxName, $null, 'Process') }
    $superxRoot = Join-Path $superxTemp ('superx-grok-' + [Guid]::NewGuid().ToString('N'))
    if (Test-Path -LiteralPath $superxRoot) { throw 'Could not create a private temporary Grok folder.' }
    $null = New-Item -ItemType Directory -Path $superxRoot -ErrorAction Stop
    $superxWork = Join-Path $superxRoot 'work'
    $superxHome = Join-Path $superxRoot 'grok-home'
    $null = New-Item -ItemType Directory -Path $superxWork, $superxHome -ErrorAction Stop
    for ($superxAncestor = Get-Item -LiteralPath $superxWork; $null -ne $superxAncestor; $superxAncestor = $superxAncestor.Parent) {
      if (Test-Path -LiteralPath (Join-Path $superxAncestor.FullName '.git')) { throw 'This temporary folder inherits a Git project. Use API Key mode or move your temporary folder outside the project.' }
    }
    $env:GROK_HOME = $superxHome
    $env:GROK_AUTH_PATH = $superxAuthPath
    $env:GROK_AGENT_SECRET = '${secret}'
${DISABLED.map(name=>`    $env:${name} = '0'`).join('\n')}
    Set-Location -LiteralPath $superxWork -ErrorAction Stop
    $superxVersion = (& $superxGrok --version 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $superxVersion -notmatch '^grok\\s+${VERSION.replace(/\./g,'\\.')}(\\s|$)') { throw 'SuperX currently supports official Grok ${VERSION}. Keep API Key mode if your installed version differs; no version was changed.' }
    Write-Host 'SuperX: official Grok is starting on this computer only. Keep this window open. Press Ctrl+C to stop. Do not share the connection code printed by Grok.'
    & $superxGrok ${ARGS.map(arg=>`'${arg}'`).join(' ')} '127.0.0.1:${port}'
    if ($LASTEXITCODE -ne 0) { throw 'The official Grok service stopped. Review its message above or use API Key mode.' }
  } finally {
    foreach ($superxName in $superxNames) { [Environment]::SetEnvironmentVariable($superxName, $superxPreviousEnvironment[$superxName], 'Process') }
    try { Set-Location -LiteralPath $superxPreviousLocation.Path -ErrorAction Stop }
    catch { Set-Location -LiteralPath $superxTemp -ErrorAction SilentlyContinue; Write-Warning 'The original terminal folder is unavailable. Its environment has been restored.' }
    if ($null -ne $superxRoot -and (Test-Path -LiteralPath $superxRoot)) {
      $superxResolved = [IO.Path]::GetFullPath($superxRoot)
      $superxItem = Get-Item -LiteralPath $superxRoot -Force
      if ([IO.Path]::GetDirectoryName($superxResolved) -eq $superxTemp -and [IO.Path]::GetFileName($superxResolved) -match '^superx-grok-[a-f0-9]{32}$' -and -not ($superxItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        $superxLinks = @(Get-ChildItem -LiteralPath $superxRoot -Force -Recurse -ErrorAction Stop | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
        if ($superxLinks.Count -eq 0) { Remove-Item -LiteralPath $superxResolved -Recurse -Force }
        else { Write-Warning 'Temporary Grok files were retained because a symbolic link was found. Your personal Grok login was not removed.' }
      }
    }
  }
}`;
  }
  function macos({port,secret}){
    // Only environment-variable names cross this pipe. No eval, source, shell
    // interpolation of supplied text, or credential-file reads are performed.
    const names=`(${LOADERS.join('|')})`;
    return `(
  set -eu
  umask 077
  sx_root=''
  sx_base=$(cd "\${TMPDIR:-/tmp}" && pwd -P)
  sx_cleanup() {
    sx_status=$?
    trap - 0 1 2 15
    if [ -n "$sx_root" ] && [ -d "$sx_root" ] && [ ! -L "$sx_root" ] && [ "$(dirname "$sx_root")" = "$sx_base" ]; then
      sx_suffix=\${sx_root##*/superx-grok.}
      case "$sx_suffix" in
        ????????) case "$sx_suffix" in *[!A-Za-z0-9]*) ;; *) rm -rf -- "$sx_root" ;; esac ;;
      esac
    fi
    exit "$sx_status"
  }
  trap sx_cleanup 0 1 2 15
  sx_grok=$(command -v grok) || { printf '%s\\n' 'Install official Grok first using the link in SuperX.' >&2; exit 1; }
  case "$sx_grok" in /*) ;; *) printf '%s\\n' 'Use the official Grok executable on your PATH.' >&2; exit 1 ;; esac
  case "$HOME" in /*) ;; *) printf '%s\\n' 'Your user home is unavailable. Use API Key mode.' >&2; exit 1 ;; esac
  sx_auth="$HOME/.grok/auth.json"
  sx_user=$(/usr/bin/id -un)
  case "$sx_user" in ''|*/*) printf '%s\\n' 'Could not verify the local user. Use API Key mode.' >&2; exit 1 ;; esac
  for sx_policy in '/etc/grok/managed_config.toml' '/etc/grok/requirements.toml' '/Library/Application Support/ClaudeCode/managed-settings.json' '/Library/Managed Preferences/ai.x.grok.plist' "/Library/Managed Preferences/$sx_user/ai.x.grok.plist"; do
    if [ -e "$sx_policy" ] || [ -L "$sx_policy" ]; then printf '%s\\n' 'A managed configuration is present. SuperX cannot isolate it safely; use API Key mode. No configuration was read or changed.' >&2; exit 1; fi
  done
  for sx_name in $(/usr/bin/env | /usr/bin/sed -nE 's/^((XAI_|GROK_)[A-Za-z0-9_]*|([A-Za-z_][A-Za-z0-9_]*)?(API_?KEY|ACCESS_?TOKEN|AUTH_?TOKEN|REFRESH_?TOKEN|ID_?TOKEN)|${names})=.*/\\1/p'); do unset "$sx_name"; done
  sx_root=$(mktemp -d "$sx_base/superx-grok.XXXXXXXX")
  mkdir -m 700 "$sx_root/work" "$sx_root/grok-home"
  sx_ancestor="$sx_root/work"
  while :; do
    if [ -e "$sx_ancestor/.git" ] || [ -L "$sx_ancestor/.git" ]; then printf '%s\\n' 'This temporary folder inherits a Git project. Use API Key mode or move your temporary folder outside the project.' >&2; exit 1; fi
    [ "$sx_ancestor" = / ] && break
    sx_ancestor=$(dirname "$sx_ancestor")
  done
  GROK_HOME="$sx_root/grok-home"
  GROK_AUTH_PATH="$sx_auth"
  GROK_AGENT_SECRET='${secret}'
  export GROK_HOME GROK_AUTH_PATH GROK_AGENT_SECRET
${DISABLED.map(name=>`  ${name}=0; export ${name}`).join('\n')}
  cd "$sx_root/work"
  sx_version=$("$sx_grok" --version) || { printf '%s\\n' 'Could not check official Grok. Use API Key mode.' >&2; exit 1; }
  case "$sx_version" in 'grok ${VERSION}'|'grok ${VERSION} '*) ;; *) printf '%s\\n' 'SuperX currently supports official Grok ${VERSION}. Keep API Key mode if your installed version differs; no version was changed.' >&2; exit 1 ;; esac
  printf '%s\\n' 'SuperX: official Grok is starting on this computer only. Keep this window open. Press Ctrl+C to stop. Do not share the connection code printed by Grok.'
  "$sx_grok" ${ARGS.map(arg=>`'${arg}'`).join(' ')} '127.0.0.1:${port}'
)`;
  }
  function command(input){const value=validate(input);return value.platform==='windows'?windows(value):macos(value);}
  const api=Object.freeze({command,validate,VERSION});
  root.SuperXBuildSetup=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
