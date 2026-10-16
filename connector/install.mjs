#!/usr/bin/env node
// Per-user installer. No API Key, browser profile or Grok authentication file is read.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { brotliDecompressSync, gunzipSync, inflateRawSync } from 'node:zlib';
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOST_NAME = 'com.superx.grok';
export const STORE_ID = 'clcflilaihhnnglfamdblhopokpnlioo';
export const NODE_VERSION = '22.23.3';
export const GROK_VERSION = '1.0.60';
export const HOST_FILES = Object.freeze([
  'host.cjs', 'lib/acp.cjs', 'lib/cli.cjs', 'lib/engine.cjs', 'lib/framing.cjs',
  'lib/policy.cjs', 'lib/process.cjs', 'lib/profiles.cjs', 'lib/updates.cjs',
  'profiles/none.md', 'profiles/web.md', 'profiles/x-web.md', 'profiles/x.md',
]);
export const CONNECTOR_FILES = Object.freeze([...HOST_FILES,
  'install.mjs', 'install-windows.ps1', 'install-macos.command',
].sort());
// Pinned on 2026-10-16 from nodejs.org SHASUMS256 and official npm dist.integrity.
// An upgrade requires a reviewed source change, never an unverified "latest" download.
export const RUNTIMES = Object.freeze({
  'win32-x64': Object.freeze({
    nodeArchive: `node-v${NODE_VERSION}-win-x64.zip`,
    nodeSha256: '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71',
    grokIntegrity: 'sha512-7kVo/cZygRwthz72styGkH/02T/kuAKtmL1KE69kevMCGIKVZDamF0pdzH4WfupLJc4ASHle0g0Mn04a7HVjrA==',
  }),
  'darwin-arm64': Object.freeze({
    nodeArchive: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    nodeSha256: '23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53',
    grokIntegrity: 'sha512-xbElk5O8udsHq1Pl8UB67E4JQK0h+qBRefm/0El9Giwbp3PJAHgzENSlg2OyQEClwa/Lg8NoKJ5pSLYcsrHkJg==',
  }),
  'darwin-x64': Object.freeze({
    nodeArchive: `node-v${NODE_VERSION}-darwin-x64.tar.gz`,
    nodeSha256: '8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8',
    grokIntegrity: 'sha512-DajdCkyrWA+5WhgsesSXZqWQoz3+cJV+bumjKgAEjzhtQQY5o42ZsEw4fxbDBalWco5qDqQ2DI/phVsSNzkVxQ==',
  }),
});
const MAX_ARCHIVE = 256 * 1024 * 1024, MAX_UNPACKED = 768 * 1024 * 1024;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
function fail(message) { throw new Error(message); }
export function extensionIds(extra) {
  if (extra !== undefined && !/^[a-p]{32}$/.test(extra)) fail('Extension ID must contain exactly 32 letters from a to p.');
  return [...new Set([STORE_ID, ...(extra ? [extra] : [])])];
}
export function runtimeSpec(platform, arch) {
  const key = `${platform}-${arch}`, item = RUNTIMES[key];
  if (!item) fail('Supported systems: Windows x64, macOS Apple Silicon and macOS Intel.');
  return { ...item, key, nodeUrl: `https://nodejs.org/dist/v${NODE_VERSION}/${item.nodeArchive}`,
    grokUrl: `https://registry.npmjs.org/@xai-official/grok-${key}/-/grok-${key}-${GROK_VERSION}.tgz` };
}
export function installPlan({ platform = process.platform, arch = process.arch, home = homedir(), localAppData = process.env.LOCALAPPDATA, extensionId, version } = {}) {
  runtimeSpec(platform, arch);
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) fail('A connector release version is required.');
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (!p.isAbsolute(home) || /[\0\r\n]/.test(home)) fail('The user home directory must be an absolute path.');
  if (platform === 'win32' && (!localAppData || !p.isAbsolute(localAppData) || /[\0\r\n]/.test(localAppData))) fail('LOCALAPPDATA must be an absolute path.');
  const root = platform === 'win32' ? p.join(localAppData, 'SuperX', 'Connector') : p.join(home, 'Library', 'Application Support', 'SuperX', 'Connector');
  const release = p.join(root, 'releases', version), launcher = p.join(release, platform === 'win32' ? 'superx-host.bat' : 'superx-host');
  const manifest = { name: HOST_NAME, description: 'SuperX local Grok Build connector', path: launcher, type: 'stdio',
    allowed_origins: extensionIds(extensionId).map(id => `chrome-extension://${id}/`) };
  const manifestPath = p.join(root, `${HOST_NAME}.json`);
  const registrations = platform === 'win32'
    ? ['Google\\Chrome', 'Microsoft\\Edge'].map(browser => ({ kind: 'registry', key: `HKCU\\Software\\${browser}\\NativeMessagingHosts\\${HOST_NAME}`, manifestPath }))
    : ['Google/Chrome', 'Microsoft Edge'].map(browser => ({ kind: 'file', path: p.join(home, 'Library', 'Application Support', browser, 'NativeMessagingHosts', `${HOST_NAME}.json`) }));
  return { platform, arch, version, root, release, launcher, manifest, manifestPath, registrations,
    nodePath: p.join(release, 'runtime', platform === 'win32' ? 'node.exe' : 'node'),
    grokPath: p.join(release, 'runtime', platform === 'win32' ? 'grok.exe' : 'grok'),
    config: { extensionIds: extensionIds(extensionId), grokPath: p.join(release, 'runtime', platform === 'win32' ? 'grok.exe' : 'grok'), runtimeVersion: GROK_VERSION } };
}
export function verify(bytes, expected, algorithm = 'sha256') {
  const actual = hash(bytes, algorithm, algorithm === 'sha512' ? 'base64' : 'hex');
  if (actual !== expected.replace(/^sha512-/, '')) fail('Official runtime integrity check failed. No runtime was installed.');
  return bytes;
}
function archiveName(name) {
  if (!name || /[\\\0\r\n]/.test(name) || name.startsWith('/') || /^[a-z]:/i.test(name)
    || name.split('/').some(part => part === '..')) fail('Unsafe archive path.');
  return name.replace(/^\.\//, '').replace(/\/$/, '');
}
// Read only selected regular files. Never invoke an archive-supplied program or extract paths.
export function tarEntries(compressed, wanted) {
  const bytes = gunzipSync(compressed, { maxOutputLength: MAX_UNPACKED }), out = new Map();
  let offset = 0, longName;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (at, length) => header.subarray(at, at + length).toString('utf8').split('\0')[0];
    const rawSize = field(124, 12).trim();
    if (!/^[0-7]+$/.test(rawSize)) fail('Invalid archive size.');
    const size = Number.parseInt(rawSize, 8), type = field(156, 1), prefix = field(345, 155);
    if (!Number.isSafeInteger(size) || size > MAX_UNPACKED || offset + 512 + size > bytes.length) fail('Truncated archive.');
    const data = bytes.subarray(offset + 512, offset + 512 + size);
    const name = archiveName(longName || (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100)));
    longName = undefined;
    if (type === 'L') { longName = archiveName(data.toString('utf8').split('\0')[0]); }
    else if (wanted.has(name)) {
      if ((type && type !== '0') || out.has(name)) fail('Runtime archive entry must be one regular file.');
      out.set(name, Buffer.from(data));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  for (const name of wanted) if (!out.has(name)) fail(`Official archive is missing an expected file: ${name}`);
  return out;
}
export function zipEntries(bytes, wanted) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) fail('Invalid runtime ZIP.');
  const count = bytes.readUInt16LE(end + 10), out = new Map();
  let cursor = bytes.readUInt32LE(end + 16);
  if (count > 20000) fail('Runtime ZIP has too many files.');
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail('Invalid runtime ZIP directory.');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), packed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24);
    const length = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32), local = bytes.readUInt32LE(cursor + 42);
    if (cursor + 46 + length + extra + comment > end) fail('Truncated runtime ZIP directory.');
    const name = archiveName(bytes.subarray(cursor + 46, cursor + 46 + length).toString('utf8'));
    if (wanted.has(name)) {
      if ((flags & 1) || ![0, 8].includes(method) || size > MAX_UNPACKED || out.has(name)
        || local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) fail('Invalid runtime ZIP entry.');
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + packed > bytes.length || (bytes.readUInt32LE(cursor + 38) >>> 16 & 0xf000) === 0xa000) fail('Unsafe runtime ZIP entry.');
      const data = bytes.subarray(start, start + packed), output = method === 8 ? inflateRawSync(data, { maxOutputLength: MAX_UNPACKED }) : Buffer.from(data);
      if (output.length !== size) fail('Invalid runtime ZIP output size.');
      out.set(name, output);
    }
    cursor += 46 + length + extra + comment;
  }
  for (const name of wanted) if (!out.has(name)) fail(`Official archive is missing an expected file: ${name}`);
  return out;
}
export async function download(url) {
  const approved = new URL(url);
  if (approved.protocol !== 'https:' || !['nodejs.org', 'registry.npmjs.org'].includes(approved.hostname)) fail('Unapproved runtime download host.');
  const response = await fetch(url, { signal: AbortSignal.timeout(180000), redirect: 'error' });
  if (!response.ok || Number(response.headers.get('content-length') || 0) > MAX_ARCHIVE) fail('Official runtime download failed.');
  const parts = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.length; if (length > MAX_ARCHIVE) fail('Runtime download exceeds its size limit.'); parts.push(chunk); }
  return Buffer.concat(parts);
}
export function launcherText(platform) {
  if (platform === 'win32') return '@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "NODE_OPTIONS="\r\nset "NODE_PATH="\r\n"%~dp0runtime\\node.exe" "%~dp0host.cjs" %*\r\n';
  if (platform !== 'darwin') fail('Unsupported launcher platform.');
  return '#!/bin/sh\nunset NODE_OPTIONS NODE_PATH LD_PRELOAD DYLD_INSERT_LIBRARIES\nbase=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || exit 1\nexec "$base/runtime/node" "$base/host.cjs" "$@"\n';
}
export function loginText(platform) {
  return platform === 'win32'
    ? '$ErrorActionPreference = "Stop"\nGet-ChildItem Env: | Where-Object { $_.Name -match "^(?:XAI_|GROK_)|(?:API_?KEY|ACCESS_?TOKEN|AUTH_?TOKEN|REFRESH_?TOKEN|ID_?TOKEN)$|^(?:NODE_OPTIONS|NODE_PATH|LD_PRELOAD|DYLD_INSERT_LIBRARIES)$" } | ForEach-Object { Remove-Item -LiteralPath ("Env:" + $_.Name) }\n& (Join-Path $PSScriptRoot "runtime\\grok.exe") login\nexit $LASTEXITCODE\n'
    : '#!/bin/bash\nwhile IFS= read -r name; do\n  case "$name" in XAI_*|GROK_*|*API_KEY|*APIKEY|*ACCESS_TOKEN|*ACCESSTOKEN|*AUTH_TOKEN|*AUTHTOKEN|*REFRESH_TOKEN|*REFRESHTOKEN|*ID_TOKEN|*IDTOKEN|NODE_OPTIONS|NODE_PATH|LD_PRELOAD|DYLD_INSERT_LIBRARIES) unset "$name" ;; esac\ndone < <(compgen -e)\nbase=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || exit 1\nexec "$base/runtime/grok" login\n';
}
export function rootLoginText(platform, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) fail('Invalid connector login release version.');
  if (platform === 'win32') return `$ErrorActionPreference = "Stop"\n& (Join-Path $PSScriptRoot "releases\\${version}\\login-windows.ps1")\nexit $LASTEXITCODE\n`;
  if (platform !== 'darwin') fail('Unsupported login platform.');
  return `#!/bin/sh\nbase=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || exit 1\nexec /bin/bash "$base/releases/${version}/login-macos.command"\n`;
}
export async function writeRootLogin(plan) {
  const filename = plan.platform === 'win32' ? 'login-windows.ps1' : 'login-macos.command';
  const content = rootLoginText(plan.platform, plan.version), target = path.join(plan.root, filename);
  await noSymlinks(target);
  await writeFile(target, content, { mode: 0o700 });
  return filename;
}
export async function checkWindowsRuntimeUnlocked(root) {
  const releases = path.join(root, 'releases');
  let entries;
  try { entries = await readdir(releases, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+\.\d+\.\d+$/.test(entry.name)) continue;
    for (const filename of ['node.exe', 'grok.exe']) {
      const target = path.join(releases, entry.name, 'runtime', filename); await noSymlinks(target);
      let handle;
      try { handle = await open(target, 'r+'); }
      catch (error) {
        if (error.code === 'ENOENT') continue;
        if (['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) fail('Close Chrome and Edge completely, including background processes, then run Uninstall again. The connector runtime is still in use.');
        throw error;
      } finally { await handle?.close(); }
    }
  }
}
async function noSymlinks(directory) {
  let current = path.resolve(directory);
  for (;;) {
    try { if ((await lstat(current)).isSymbolicLink()) fail('Managed connector paths cannot contain symbolic links.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
export function contained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
async function removeOwnedStage(root, stage) {
  if (!contained(root, stage) || !path.basename(stage).startsWith('.install-')) fail('Unsafe staging cleanup path.');
  await noSymlinks(stage); await rm(stage, { recursive: true, force: true });
}
export function registryArgs(action, registration) {
  if (registration.kind !== 'registry' || !/^HKCU\\Software\\(?:Google\\Chrome|Microsoft\\Edge)\\NativeMessagingHosts\\com\.superx\.grok$/.test(registration.key)) fail('Unapproved registry registration.');
  if (action === 'query') return ['query', registration.key, '/ve'];
  if (action === 'add') return ['add', registration.key, '/ve', '/t', 'REG_SZ', '/d', registration.manifestPath, '/f'];
  if (action === 'delete') return ['delete', registration.key, '/f'];
  fail('Invalid registry operation.');
}
function runReg(action, registration) {
  if (action === 'query') {
    // reg.exe's redirected output follows the active Windows code page. Read the
    // exact default value as UTF-8 so Unicode user-directory names compare safely.
    registryArgs(action, registration);
    const key = registration.key.replace(/^HKCU\\/, '');
    const script = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${key}'); if ($null -eq $key) { exit 3 }; try { $value = $key.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); if ($null -eq $value) { exit 3 }; [Console]::Write("REG_SZ    " + [string]$value) } finally { $key.Dispose() }`;
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, shell: false, encoding: 'utf8', maxBuffer: 65536 });
  }
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  const result = spawnSync(executable, registryArgs(action, registration), { windowsHide: true, shell: false, encoding: 'utf8', maxBuffer: 65536 });
  if (action !== 'query' && (result.error || result.status !== 0)) fail('Could not update the current-user browser connector registration.');
  return result;
}
async function bundleVersion(directory) {
  for (const candidate of [path.join(directory, 'package-info.json'), path.join(directory, '..', 'package.json')]) {
    try { const stat = await lstat(candidate); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) fail('Invalid connector package metadata.'); return JSON.parse(await readFile(candidate, 'utf8')).version; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  fail('Connector package metadata is missing.');
}
export async function install({ plan, sourceDirectory = HERE, nodeArchive, fetchBytes = download, register = true, registry = runReg } = {}) {
  if (!plan || plan.platform !== process.platform || plan.arch !== process.arch) fail('The installer must run on its target system.');
  const spec = runtimeSpec(plan.platform, plan.arch);
  await noSymlinks(plan.root);
  await mkdir(plan.root, { recursive: true, mode: 0o700 });
  const existingMarker = path.join(plan.root, 'installation.json');
  try {
    const stat = await lstat(existingMarker);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) fail('Installation ownership check failed.');
    let marker; try { marker = JSON.parse(await readFile(existingMarker, 'utf8')); } catch { fail('Installation ownership check failed.'); }
    if (marker.product !== 'SuperX Connector' || marker.root !== plan.root) fail('The target directory belongs to another installation.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if ((await readdir(plan.root)).length) fail('The connector target directory is not empty and has no ownership marker. Move those files before installing.');
  }
  const stage = await mkdtemp(path.join(plan.root, '.install-'));
  try {
    const nodeBytes = nodeArchive ? await readFile(nodeArchive) : await fetchBytes(spec.nodeUrl);
    verify(nodeBytes, spec.nodeSha256);
    const nodePrefix = `node-v${NODE_VERSION}-${spec.key === 'win32-x64' ? 'win-x64' : spec.key}`;
    const nodeName = plan.platform === 'win32' ? `${nodePrefix}/node.exe` : `${nodePrefix}/bin/node`;
    const nodeLicense = `${nodePrefix}/LICENSE`;
    const nodeFiles = (plan.platform === 'win32' ? zipEntries : tarEntries)(nodeBytes, new Set([nodeName, nodeLicense]));
    const grokBytes = verify(await fetchBytes(spec.grokUrl), spec.grokIntegrity, 'sha512');
    const grokName = `package/bin/grok${plan.platform === 'win32' ? '.exe' : ''}.br`;
    const grokFiles = tarEntries(grokBytes, new Set([grokName, 'package/THIRD_PARTY_NOTICES.md']));
    const grok = brotliDecompressSync(grokFiles.get(grokName), { maxOutputLength: MAX_UNPACKED });
    if (grok.length < 1024) fail('Official Grok executable is invalid.');
    await mkdir(path.join(stage, 'runtime'), { mode: 0o700 });
    await mkdir(path.join(stage, 'third-party'), { mode: 0o700 });
    for (const name of CONNECTOR_FILES) {
      const source = path.join(sourceDirectory, name), stat = await lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail('Connector package contains an unexpected source file.');
      await mkdir(path.dirname(path.join(stage, name)), { recursive: true, mode: 0o700 });
      await copyFile(source, path.join(stage, name));
    }
    await writeFile(path.join(stage, 'package-info.json'), JSON.stringify({ version: plan.version }) + '\n', { mode: 0o600 });
    await writeFile(path.join(stage, 'runtime', path.basename(plan.nodePath)), nodeFiles.get(nodeName), { mode: 0o700 });
    await writeFile(path.join(stage, 'runtime', path.basename(plan.grokPath)), grok, { mode: 0o700 });
    await writeFile(path.join(stage, 'third-party', 'Node-LICENSE.txt'), nodeFiles.get(nodeLicense), { mode: 0o600 });
    await writeFile(path.join(stage, 'third-party', 'Grok-THIRD_PARTY_NOTICES.md'), grokFiles.get('package/THIRD_PARTY_NOTICES.md'), { mode: 0o600 });
    let license;
    for (const filename of [path.join(sourceDirectory, 'LICENSE.txt'), path.join(sourceDirectory, '..', 'LICENSE')]) {
      try { license = await readFile(filename); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!license) fail('The connector package license is missing.');
    await writeFile(path.join(stage, 'LICENSE.txt'), license, { mode: 0o600 });
    await writeFile(path.join(stage, path.basename(plan.launcher)), launcherText(plan.platform), { mode: 0o700 });
    await writeFile(path.join(stage, plan.platform === 'win32' ? 'login-windows.ps1' : 'login-macos.command'), loginText(plan.platform), { mode: 0o700 });
    await writeFile(path.join(stage, 'config.json'), JSON.stringify(plan.config, null, 2) + '\n', { mode: 0o600 });
    await mkdir(path.dirname(plan.release), { recursive: true, mode: 0o700 });
    // Refuse an in-place overwrite: native hosts may still be running. A versioned
    // release is immutable; rerunning an installed version only refreshes registration.
    let sameRelease = false;
    try { await lstat(plan.release); sameRelease = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const loginFile = plan.platform === 'win32' ? 'login-windows.ps1' : 'login-macos.command';
    const marker = { product: 'SuperX Connector', root: plan.root, release: plan.release, version: plan.version, nodeVersion: NODE_VERSION, grokVersion: GROK_VERSION,
      ownedFiles: ['installation.json', `${HOST_NAME}.json`, loginFile, 'releases'], registrationComplete: false };
    if (sameRelease) {
      for (const name of [...CONNECTOR_FILES, 'runtime/' + path.basename(plan.nodePath), 'runtime/' + path.basename(plan.grokPath)]) {
        const installed = path.join(plan.release, name); await noSymlinks(installed);
        if (!(await readFile(installed)).equals(await readFile(path.join(stage, name)))) fail('This connector version differs from the installed copy. Install a new release version or uninstall it first.');
      }
      // Origin IDs are declarative, never copied from or discovered in browser profiles.
      const oldConfig = JSON.parse(await readFile(path.join(plan.release, 'config.json'), 'utf8'));
      plan.config.extensionIds = [...new Set([...extensionIds(), ...(oldConfig.extensionIds || []).filter(id => /^[a-p]{32}$/.test(id)), ...plan.config.extensionIds])];
      plan.manifest.allowed_origins = plan.config.extensionIds.map(id => `chrome-extension://${id}/`);
      await writeFile(path.join(plan.release, 'config.json'), JSON.stringify(plan.config, null, 2) + '\n', { mode: 0o600 });
    } else {
      // Claim only the previously empty/owned directory, before committing files.
      // If OS registration fails, the next install or uninstall remains recoverable.
      await writeFile(existingMarker, JSON.stringify(marker, null, 2) + '\n', { mode: 0o600 });
      await rename(stage, plan.release);
    }
    await writeFile(plan.manifestPath, JSON.stringify(plan.manifest, null, 2) + '\n', { mode: 0o600 });
    await writeRootLogin(plan);
    await writeFile(existingMarker, JSON.stringify(marker, null, 2) + '\n', { mode: 0o600 });
    if (register) for (const entry of plan.registrations) {
      if (entry.kind === 'registry') registry('add', entry);
      else { await noSymlinks(entry.path); await mkdir(path.dirname(entry.path), { recursive: true }); await writeFile(entry.path, JSON.stringify(plan.manifest, null, 2) + '\n', { mode: 0o600 }); }
    }
    await writeFile(existingMarker, JSON.stringify({ ...marker, registrationComplete: register }, null, 2) + '\n', { mode: 0o600 });
    return plan;
  } finally { await removeOwnedStage(plan.root, stage); }
}
export async function uninstall(plan, { registry = runReg } = {}) {
  if (!plan || plan.platform !== process.platform) fail('Uninstall must run on its target system.');
  if (plan.platform === 'win32' && contained(plan.root, process.execPath)) fail('Run uninstall from the downloaded installer so its running Node executable can be removed safely.');
  await noSymlinks(plan.root);
  let marker;
  try {
    const markerPath = path.join(plan.root, 'installation.json'), stat = await lstat(markerPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) fail('Uninstall ownership check failed.');
    try { marker = JSON.parse(await readFile(markerPath, 'utf8')); } catch { fail('Uninstall ownership check failed.'); }
  }
  catch (error) { if (error.code === 'ENOENT') return { removed: false }; throw error; }
  if (marker.product !== 'SuperX Connector' || marker.root !== plan.root || !contained(plan.root, marker.release)
    || path.dirname(marker.release) !== path.join(plan.root, 'releases')) fail('Uninstall ownership check failed.');
  // The exact plan is recomputed from the OS user directory, never from marker data.
  const actual = await realpath(plan.root); if (actual !== path.resolve(plan.root)) fail('Uninstall target changed.');
  if (plan.platform === 'win32') await checkWindowsRuntimeUnlocked(plan.root);
  for (const entry of plan.registrations) {
    if (entry.kind === 'registry') {
      const result = registry('query', entry);
      if (result.status === 0) {
        const values = String(result.stdout || '').split(/\r?\n/).filter(line => /\bREG_SZ\s+/.test(line)).map(line => line.split(/\bREG_SZ\s+/)[1]?.trim());
        if (values.length === 1 && values[0].toLowerCase() === plan.manifestPath.toLowerCase()) registry('delete', entry);
      }
    } else {
      try { await noSymlinks(entry.path); const data = JSON.parse(await readFile(entry.path, 'utf8')); if (data.name === HOST_NAME && typeof data.path === 'string' && contained(plan.root, data.path)) await unlink(entry.path); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  try { await rm(plan.root, { recursive: true, force: false }); }
  catch (error) {
    if (plan.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) fail('Close Chrome and Edge completely, including background processes, then run Uninstall again to remove the remaining connector files.');
    throw error;
  }
  return { removed: true };
}
async function main(args) {
  let extensionId, nodeArchive, dryRun = false, remove = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--extension-id' || arg === '--node-archive') {
      const value = args.shift(); if (!value || value.startsWith('--')) fail(`Missing value for ${arg}.`);
      if (arg === '--extension-id') extensionId = value; else nodeArchive = path.resolve(value);
    } else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--uninstall') remove = true;
    else fail(`Unknown installer option: ${arg}`);
  }
  const plan = installPlan({ extensionId, version: await bundleVersion(HERE) });
  if (dryRun) { console.log(JSON.stringify({ action: remove ? 'uninstall' : 'install', ...plan }, null, 2)); return; }
  if (remove) { console.log((await uninstall(plan)).removed ? 'SuperX Connector removed. Official Grok login and extension settings were preserved.' : 'No managed SuperX Connector installation was found.'); return; }
  console.log(`Installing SuperX Connector ${plan.version} for ${plan.platform}-${plan.arch}…`);
  await install({ plan, nodeArchive });
  console.log(`Installed in ${plan.root}\nSign in using ${path.join(plan.root, plan.platform === 'win32' ? 'login-windows.ps1' : 'login-macos.command')}\nThen choose Grok CLI / ACP in SuperX Settings and Check connection.\nNo inference request was sent during installation.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(`SuperX Connector: ${error.message}`); process.exitCode = 1; });
