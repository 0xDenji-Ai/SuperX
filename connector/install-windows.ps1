# Windows 11 x64. Review this file before running. Installs only for the current user.
param([string]$ExtensionId = '', [switch]$DryRun, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'This connector installer requires Windows x64.' }
if ($ExtensionId -and $ExtensionId -notmatch '^[a-p]{32}$') { throw 'Invalid SuperX extension ID.' }
$installerPath = Join-Path $PSScriptRoot 'install.mjs'
$taskTemp = Join-Path ([IO.Path]::GetTempPath()) ('SuperX-Connector-' + [Guid]::NewGuid().ToString('N'))
$taskTempFull = [IO.Path]::GetFullPath($taskTemp)
$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if (-not $taskTempFull.StartsWith($tempParent, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe temporary directory.' }
New-Item -ItemType Directory -Path $taskTempFull | Out-Null
try {
  $archivePath = Join-Path $taskTempFull 'node.zip'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip' -OutFile $archivePath
  if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71') { throw 'Official Node runtime integrity check failed.' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    $entry = $zip.GetEntry('node-v22.23.3-win-x64/node.exe')
    if (-not $entry -or $entry.Length -gt 200MB) { throw 'Official Node executable is missing or too large.' }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $taskTempFull 'node.exe'))
  } finally { $zip.Dispose() }
  $env:NODE_OPTIONS = $null
  $env:NODE_PATH = $null
  $installerArgs = @($installerPath, '--node-archive', $archivePath)
  if ($ExtensionId) { $installerArgs += @('--extension-id', $ExtensionId) }
  if ($DryRun) { $installerArgs += '--dry-run' }
  if ($Uninstall) { $installerArgs += '--uninstall' }
  & (Join-Path $taskTempFull 'node.exe') @installerArgs
  $installerExit = $LASTEXITCODE
} finally {
  # This GUID child path is resolved and checked before recursive cleanup.
  $cleanupFull = [IO.Path]::GetFullPath($taskTempFull)
  if ($cleanupFull.StartsWith($tempParent, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($cleanupFull) -match '^SuperX-Connector-[a-f0-9]{32}$') { Remove-Item -LiteralPath $cleanupFull -Recurse -Force }
}
exit $installerExit
