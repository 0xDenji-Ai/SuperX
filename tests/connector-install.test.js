const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const { mkdtemp, mkdir, readFile, writeFile, rm, lstat, symlink, link, copyFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const installer = import(pathToFileURL(path.join(root, 'connector/install.mjs')).href);
const packager = import(pathToFileURL(path.join(root, 'tools/package-extension.mjs')).href);
const sha = (data, type = 'sha256', encoding = 'hex') => createHash(type).update(data).digest(encoding);
function tar(files) {
  const chunks = [];
  for (const { name, bytes = Buffer.from('fixture'), type = '0' } of files) {
    const header = Buffer.alloc(512); header.write(name); header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124); header.write(type, 156);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'superx-installer-test-'));
  t.after(async () => { assert.ok(path.basename(directory).startsWith('superx-installer-test-')); await rm(directory, { recursive: true, force: true }); });
  return directory;
}

test('connector pins a verified runtime for Windows and both Mac architectures', async () => {
  const { runtimeSpec, NODE_VERSION, GROK_VERSION } = await installer;
  for (const [platform, arch] of [['win32', 'x64'], ['darwin', 'arm64'], ['darwin', 'x64']]) {
    const spec = runtimeSpec(platform, arch);
    assert.equal(new URL(spec.nodeUrl).hostname, 'nodejs.org'); assert.ok(spec.nodeUrl.includes(`/v${NODE_VERSION}/`));
    assert.equal(new URL(spec.grokUrl).hostname, 'registry.npmjs.org'); assert.ok(spec.grokUrl.includes(GROK_VERSION));
    assert.match(spec.nodeSha256, /^[a-f0-9]{64}$/); assert.match(spec.grokIntegrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  }
  assert.throws(() => runtimeSpec('linux', 'x64'), /Supported systems/);
  assert.throws(() => runtimeSpec('win32', 'arm64'), /Supported systems/);
});
test('connector origin list is exact and rejects malformed or wildcard IDs', async () => {
  const { extensionIds, STORE_ID } = await installer;
  assert.deepEqual(extensionIds(STORE_ID), [STORE_ID]);
  assert.deepEqual(extensionIds('a'.repeat(32)), [STORE_ID, 'a'.repeat(32)]);
  for (const id of ['', '*', 'a'.repeat(31), 'q'.repeat(32), 'chrome-extension://' + 'a'.repeat(32) + '/', 'a'.repeat(32) + '\n']) assert.throws(() => extensionIds(id));
});
test('Windows plan uses per-user Chrome and Edge registrations and supports spaces and Unicode', async () => {
  const { installPlan } = await installer;
  const plan = installPlan({ platform: 'win32', arch: 'x64', home: 'C:\\FixturePeople\\Paul 魏', localAppData: 'C:\\FixturePeople\\Paul 魏\\AppData\\Local', version: '0.9.0', extensionId: 'a'.repeat(32) });
  assert.equal(plan.root, 'C:\\FixturePeople\\Paul 魏\\AppData\\Local\\SuperX\\Connector');
  assert.ok(plan.launcher.endsWith('releases\\0.9.0\\superx-host.bat'));
  assert.equal(plan.registrations.length, 2); assert.ok(plan.registrations.every(item => item.key.startsWith('HKCU\\Software\\')));
  assert.ok(plan.registrations[0].key.includes('Google\\Chrome')); assert.ok(plan.registrations[1].key.includes('Microsoft\\Edge'));
  assert.equal(plan.config.runtimeVersion, '1.0.60'); assert.equal(plan.manifest.type, 'stdio');
  assert.ok(plan.manifest.allowed_origins.every(origin => /^chrome-extension:\/\/[a-p]{32}\/$/.test(origin)));
});
test('macOS plans support native Intel and Apple Silicon without Rosetta', async () => {
  const { installPlan } = await installer;
  for (const arch of ['arm64', 'x64']) {
    const plan = installPlan({ platform: 'darwin', arch, home: '/FixturePeople/Paul 魏', version: '0.9.0' });
    assert.equal(plan.root, '/FixturePeople/Paul 魏/Library/Application Support/SuperX/Connector');
    assert.equal(plan.registrations[0].path, '/FixturePeople/Paul 魏/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.superx.grok.json');
    assert.equal(plan.registrations[1].path, '/FixturePeople/Paul 魏/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.superx.grok.json');
    assert.ok(plan.manifest.path.startsWith('/')); assert.ok(plan.grokPath.endsWith('/runtime/grok'));
  }
});
test('plans reject relative user locations, control characters and unsafe versions', async () => {
  const { installPlan } = await installer;
  const valid = { platform: 'darwin', arch: 'arm64', home: '/FixturePeople/test', version: '0.9.0' };
  for (const version of ['../x', '', 'latest', '0.9.0\n']) assert.throws(() => installPlan({ ...valid, version }));
  assert.throws(() => installPlan({ ...valid, home: 'relative' })); assert.throws(() => installPlan({ ...valid, home: '/FixturePeople/test\n' }));
  assert.throws(() => installPlan({ platform: 'win32', arch: 'x64', home: 'C:\\FixturePeople\\test', localAppData: 'relative', version: '0.9.0' }));
});
test('runtime bytes must match the pinned digest before use', async () => {
  const { verify } = await installer, data = Buffer.from('trusted fixture');
  assert.equal(verify(data, sha(data)), data); assert.equal(verify(data, 'sha512-' + sha(data, 'sha512', 'base64'), 'sha512'), data);
  assert.throws(() => verify(Buffer.from('changed'), sha(data)), /integrity/);
  assert.throws(() => verify(data, 'sha512-' + 'A'.repeat(86) + '==', 'sha512'), /integrity/);
});
test('tar extraction only returns explicitly selected regular files', async () => {
  const { tarEntries } = await installer;
  const result = tarEntries(tar([{ name: 'package/bin/grok.br', bytes: Buffer.from('selected') }, { name: 'package/secret.txt', bytes: Buffer.from('ignored') }]), new Set(['package/bin/grok.br']));
  assert.deepEqual([...result.keys()], ['package/bin/grok.br']); assert.equal(result.get('package/bin/grok.br').toString(), 'selected');
});
test('tar extraction rejects traversal, absolute paths, duplicate or symlink executables', async () => {
  const { tarEntries } = await installer;
  for (const name of ['../outside', '/outside', 'C:/outside', 'package\\outside']) assert.throws(() => tarEntries(tar([{ name }]), new Set()), /Unsafe archive/);
  assert.throws(() => tarEntries(tar([{ name: 'wanted', type: '2' }]), new Set(['wanted'])), /regular file/);
  assert.throws(() => tarEntries(tar([{ name: 'wanted' }, { name: 'wanted' }]), new Set(['wanted'])), /regular file/);
  assert.throws(() => tarEntries(tar([{ name: 'other' }]), new Set(['wanted'])), /missing/);
});
test('ZIP extraction only returns selected bytes and refuses unsafe paths', async () => {
  const { zipEntries } = await installer, { createArchive } = await packager;
  const archive = createArchive([{ name: 'node/bin/node', data: Buffer.from('selected') }, { name: 'node/other', data: Buffer.from('ignored') }]);
  assert.equal(zipEntries(archive, new Set(['node/bin/node'])).get('node/bin/node').toString(), 'selected');
  assert.throws(() => zipEntries(archive, new Set(['missing'])), /missing/);
  for (const name of ['../outside', '/outside', 'C:/outside', 'node\\outside']) assert.throws(() => zipEntries(createArchive([{ name, data: Buffer.from('x') }]), new Set()), /Unsafe archive/);
  assert.throws(() => zipEntries(Buffer.from('not zip'), new Set()), /Invalid/);
});
test('ZIP extraction rejects duplicate selected entries and truncated content', async () => {
  const { zipEntries } = await installer, { createArchive } = await packager;
  const archive = createArchive([{ name: 'node', data: Buffer.from('a') }, { name: 'node', data: Buffer.from('b') }]);
  assert.throws(() => zipEntries(archive, new Set(['node'])), /Invalid/);
  assert.throws(() => zipEntries(archive.subarray(0, archive.length - 10), new Set(['node'])), /Invalid/);
});
test('launchers clear injected Node options and preserve binary standard streams', async () => {
  const { launcherText } = await installer, windows = launcherText('win32'), mac = launcherText('darwin');
  assert.match(windows, /DisableDelayedExpansion/); assert.match(windows, /set "NODE_OPTIONS="/); assert.match(windows, /set "NODE_PATH="/);
  assert.match(windows, /"%~dp0runtime\\node\.exe" "%~dp0host\.cjs" %\*/); assert.doesNotMatch(windows, /powershell|echo [^o]|2>&1/);
  assert.match(mac, /unset NODE_OPTIONS NODE_PATH LD_PRELOAD DYLD_INSERT_LIBRARIES/);
  assert.match(mac, /exec "\$base\/runtime\/node" "\$base\/host\.cjs" "\$@"/); assert.doesNotMatch(mac, /eval|2>&1/);
});
test('login wrappers only invoke the official login command on explicit user action', async () => {
  const { loginText } = await installer;
  for (const platform of ['win32', 'darwin']) {
    const text = loginText(platform); assert.match(text, /grok(?:\.exe)?[" ]+.*login|grok" login/);
    assert.doesNotMatch(text, /auth\.json|session\/prompt|--prompt/i);
    assert.match(text, /XAI_\|GROK_|XAI_\*\|GROK_\*/);
  }
});
test('registry operations use fixed HKCU allowlist and structured arguments', async () => {
  const { registryArgs } = await installer;
  const reg = { kind: 'registry', key: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.superx.grok', manifestPath: 'C:\\FixturePeople\\Paul 魏\\connector.json' };
  assert.deepEqual(registryArgs('add', reg), ['add', reg.key, '/ve', '/t', 'REG_SZ', '/d', reg.manifestPath, '/f']);
  assert.deepEqual(registryArgs('delete', reg), ['delete', reg.key, '/f']);
  for (const key of ['HKLM\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.superx.grok', reg.key + '\\other', reg.key + '&whoami']) assert.throws(() => registryArgs('add', { ...reg, key }));
});
test('download refuses arbitrary runtime sources before network access', async () => {
  const { download } = await installer;
  for (const url of ['http://nodejs.org/runtime', 'https://example.com/runtime', 'file:///tmp/runtime']) await assert.rejects(download(url), /Unapproved/);
});
test('installer and package use fixed public source allowlists without credentials', async () => {
  const { CONNECTOR_FILES } = await installer;
  assert.ok(CONNECTOR_FILES.includes('host.cjs')); assert.ok(CONNECTOR_FILES.includes('install-macos.command'));
  for (const name of CONNECTOR_FILES) assert.doesNotMatch(name, /auth|config\.json|runtime\/|\.log|\.grok/);
  const source = await readFile(path.join(root, 'connector/install.mjs'), 'utf8');
  assert.doesNotMatch(source, /readFile\([^\n]*(?:auth\.json|\.grok|Cookies|Login Data)/);
  assert.match(source, /redirect: 'error'/); assert.match(source, /shell: false/);
});
test('bootstrap scripts pin the same Node checksums and never disable Mac security', async () => {
  const { RUNTIMES } = await installer;
  const windows = await readFile(path.join(root, 'connector/install-windows.ps1'), 'utf8');
  const mac = await readFile(path.join(root, 'connector/install-macos.command'), 'utf8');
  assert.ok(windows.includes(RUNTIMES['win32-x64'].nodeSha256));
  assert.ok(mac.includes(RUNTIMES['darwin-arm64'].nodeSha256)); assert.ok(mac.includes(RUNTIMES['darwin-x64'].nodeSha256));
  assert.doesNotMatch(mac.split('\n').filter(line => !line.trim().startsWith('#')).join('\n'), /spctl|xattr|sudo|curl[^\n]*\|\s*(?:sh|bash)/); assert.doesNotMatch(windows, /Invoke-Expression|\biex\b|HKLM|requireAdministrator/);
});
test('uninstall refuses to remove directories without its ownership marker', { skip: !['win32', 'darwin'].includes(process.platform) }, async t => {
  const directory = await fixture(t), { installPlan, uninstall } = await installer;
  const plan = installPlan({ platform: process.platform, arch: process.arch, home: directory, localAppData: directory, version: '0.9.0' });
  await mkdir(plan.root, { recursive: true }); await writeFile(path.join(plan.root, 'keep.txt'), 'keep');
  assert.deepEqual(await uninstall(plan), { removed: false }); assert.equal(await readFile(path.join(plan.root, 'keep.txt'), 'utf8'), 'keep');
  await writeFile(path.join(plan.root, 'installation.json'), JSON.stringify({ product: 'another product', root: plan.root, release: plan.release }));
  await assert.rejects(uninstall(plan), /ownership/); assert.ok((await lstat(plan.root)).isDirectory());
});
test('uninstall validates the resolved release boundary before deletion', { skip: !['win32', 'darwin'].includes(process.platform) }, async t => {
  const directory = await fixture(t), { installPlan, uninstall } = await installer;
  const plan = installPlan({ platform: process.platform, arch: process.arch, home: directory, localAppData: directory, version: '0.9.0' });
  await mkdir(plan.root, { recursive: true });
  for (const release of [directory, path.join(plan.root, '..', 'outside'), path.join(plan.root, 'nested', 'releases', '0.9.0')]) {
    await writeFile(path.join(plan.root, 'installation.json'), JSON.stringify({ product: 'SuperX Connector', root: plan.root, release }));
    await assert.rejects(uninstall(plan), /ownership/); assert.ok((await lstat(plan.root)).isDirectory());
  }
});
test('uninstall removes only its registration and preserves foreign registry values', { skip: !['win32', 'darwin'].includes(process.platform) }, async t => {
  const directory = await fixture(t), { installPlan, uninstall } = await installer;
  const plan = installPlan({ platform: process.platform, arch: process.arch, home: directory, localAppData: directory, version: '0.9.0' });
  await mkdir(plan.release, { recursive: true });
  await writeFile(path.join(plan.root, 'installation.json'), JSON.stringify({ product: 'SuperX Connector', root: plan.root, release: plan.release }));
  const actions = [];
  const registry = (action, entry) => { actions.push({ action, key: entry.key }); return { status: 0, stdout: `\n    (Default)    REG_SZ    ${entry.key.includes('Google') ? plan.manifestPath : 'C:\\Another\\host.json'}\n` }; };
  if (process.platform === 'darwin') for (const [i, entry] of plan.registrations.entries()) {
    await mkdir(path.dirname(entry.path), { recursive: true });
    await writeFile(entry.path, JSON.stringify(i ? { name: 'foreign', path: '/elsewhere/host' } : plan.manifest));
  }
  assert.deepEqual(await uninstall(plan, { registry }), { removed: true });
  await assert.rejects(lstat(plan.root), { code: 'ENOENT' });
  if (process.platform === 'win32') assert.deepEqual(actions.filter(item => item.action === 'delete').map(item => item.key), [plan.registrations[0].key]);
  if (process.platform === 'darwin') { await assert.rejects(lstat(plan.registrations[0].path), { code: 'ENOENT' }); assert.equal(JSON.parse(await readFile(plan.registrations[1].path, 'utf8')).name, 'foreign'); }
});
test('uninstall refuses a symlinked managed directory', { skip: !['win32', 'darwin'].includes(process.platform) }, async t => {
  const directory = await fixture(t), { installPlan, uninstall } = await installer;
  const plan = installPlan({ platform: process.platform, arch: process.arch, home: directory, localAppData: directory, version: '0.9.0' });
  const target = path.join(directory, 'keep'); await mkdir(target); await mkdir(path.dirname(plan.root), { recursive: true });
  try { await symlink(target, plan.root, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('OS denied a test-only symlink'); throw error; }
  await assert.rejects(uninstall(plan), /symbolic links/); assert.ok((await lstat(target)).isDirectory());
});
test('installation stops before registration when a runtime hash is wrong', { skip: !['win32', 'darwin'].includes(process.platform) }, async t => {
  const directory = await fixture(t), { installPlan, install } = await installer;
  const plan = installPlan({ platform: process.platform, arch: process.arch, home: directory, localAppData: directory, version: '0.9.0' });
  let registrations = 0, downloads = 0;
  await assert.rejects(install({ plan, fetchBytes: async () => { downloads++; return Buffer.from('modified runtime'); }, registry: () => { registrations++; } }), /integrity/);
  assert.equal(downloads, 1); assert.equal(registrations, 0);
  await assert.rejects(lstat(plan.manifestPath), { code: 'ENOENT' }); await assert.rejects(lstat(plan.release), { code: 'ENOENT' });
  assert.deepEqual(await require('node:fs/promises').readdir(plan.root), []);
});
test('first installation refuses to adopt a nonempty directory without its ownership marker', { skip: !['win32', 'darwin'].includes(process.platform) }, async t => {
  const directory = await fixture(t), { installPlan, install } = await installer;
  const plan = installPlan({ platform: process.platform, arch: process.arch, home: directory, localAppData: directory, version: '0.9.0' });
  await mkdir(plan.root, { recursive: true }); await writeFile(path.join(plan.root, 'unrelated.txt'), 'must survive');
  let downloaded = false;
  await assert.rejects(install({ plan, fetchBytes: async () => { downloaded = true; throw new Error('must not download'); } }), /not empty.*ownership/);
  assert.equal(downloaded, false); assert.equal(await readFile(path.join(plan.root, 'unrelated.txt'), 'utf8'), 'must survive');
  await assert.rejects(lstat(path.join(plan.root, 'installation.json')), { code: 'ENOENT' });
});
test('the installer dry run reports the plan without installing or querying authentication', { skip: !['win32', 'darwin'].includes(process.platform) }, async () => {
  const result = spawnSync(process.execPath, [path.join(root, 'connector/install.mjs'), '--dry-run', '--extension-id', 'a'.repeat(32)], { shell: false, encoding: 'utf8' });
  assert.equal(result.status, 0); const plan = JSON.parse(result.stdout);
  assert.equal(plan.action, 'install'); assert.ok(plan.config.extensionIds.includes('a'.repeat(32))); assert.equal(plan.config.runtimeVersion, '1.0.60');
  assert.doesNotMatch(result.stdout, /auth\.json|access.token|api.key/i);
});
test('portable connector packaging excludes generated config, auth and downloaded runtimes', async t => {
  const directory = await fixture(t), { CONNECTOR_FILES, zipEntries } = await installer;
  const { packageConnector } = await import(pathToFileURL(path.join(root, 'tools/package-connector.mjs')).href);
  await mkdir(path.join(directory, 'connector'), { recursive: true });
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ version: '0.9.0' })); await writeFile(path.join(directory, 'LICENSE'), 'MIT fixture');
  for (const name of CONNECTOR_FILES) { await mkdir(path.dirname(path.join(directory, 'connector', name)), { recursive: true }); await writeFile(path.join(directory, 'connector', name), '// reviewed public fixture\n'); }
  await writeFile(path.join(directory, 'connector', 'config.json'), 'private fixture must not ship');
  const outputDir = path.join(directory, 'output'), result = await packageConnector({ root: directory, outputDir, expectedVersion: '0.9.0' });
  const bytes = await readFile(path.join(outputDir, result.archiveName));
  assert.equal(result.sha256, sha(bytes)); assert.equal(result.count, CONNECTOR_FILES.length + 3);
  const metadata = JSON.parse(zipEntries(bytes, new Set(['package-info.json'])).get('package-info.json'));
  assert.equal(metadata.version, '0.9.0'); assert.equal(metadata.grokVersion, '1.0.60'); assert.ok(metadata.files.every(item => !/config\.json|auth|runtime\//.test(item.path)));
  assert.throws(() => zipEntries(bytes, new Set(['config.json'])), /missing/);
});
test('Windows batch launcher preserves the parent-window equals sign and clears Node injection', { skip: process.platform !== 'win32' }, async t => {
  const directory = await fixture(t), { launcherText, STORE_ID } = await installer;
  const installation = path.join(directory, 'Paul 魏 %token% & space'), runtime = path.join(installation, 'runtime');
  await mkdir(runtime, { recursive: true });
  try { await link(process.execPath, path.join(runtime, 'node.exe')); }
  catch (error) { if (!['EXDEV', 'EPERM', 'EACCES'].includes(error.code)) throw error; await copyFile(process.execPath, path.join(runtime, 'node.exe')); }
  await writeFile(path.join(installation, 'host.cjs'), 'process.stdout.write(JSON.stringify({args:process.argv.slice(2),injected:!!process.env.NODE_OPTIONS,pathInjected:!!process.env.NODE_PATH}));');
  const launcher = path.join(installation, 'superx-host.bat'); await writeFile(launcher, launcherText('win32'));
  const command = '""' + launcher + '" chrome-extension://' + STORE_ID + '/ --parent-window=0"';
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { windowsVerbatimArguments: true, shell: false, windowsHide: true, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--invalid-injected-superx-option', NODE_PATH: 'invalid-fixture-path' } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args: [`chrome-extension://${STORE_ID}/`, '--parent-window=0'], injected: false, pathInjected: false });
});
test('Windows login uses the default official environment instead of inherited Grok paths or Keys', { skip: process.platform !== 'win32' }, async t => {
  const { loginText } = await installer;
  const script = loginText('win32').replace('& (Join-Path $PSScriptRoot "runtime\\grok.exe") login\nexit $LASTEXITCODE', '$names = @(Get-ChildItem Env: | Where-Object { $_.Name -match "^(XAI_|GROK_)|API_?KEY$|^(NODE_OPTIONS|NODE_PATH)$" } | ForEach-Object { $_.Name }); ConvertTo-Json -Compress -InputObject $names');
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { shell: false, windowsHide: true, encoding: 'utf8', env: { ...process.env, GROK_HOME: 'fixture-only', GROK_AUTH_PATH: 'fixture-only', GROK_CONFIG_PATH: 'fixture-only', XAI_API_KEY: 'fixture-only', NODE_OPTIONS: 'fixture-only' } });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), []);
});
test('Mac login clears inherited overrides using only environment variable names', async () => {
  const { loginText } = await installer, text = loginText('darwin');
  assert.match(text, /compgen -e/); assert.match(text, /GROK_\*/); assert.match(text, /XAI_\*/); assert.match(text, /unset "\$name"/);
  assert.doesNotMatch(text, /env\s*\||printenv|cat |auth\.json|xattr|spctl/);
});
test('Mac launcher preserves arguments and clears injected Node loader settings', { skip: process.platform !== 'darwin' }, async t => {
  const directory = await fixture(t), { launcherText, STORE_ID } = await installer;
  const installation = path.join(directory, 'Paul 魏 %token% & space'), runtime = path.join(installation, 'runtime');
  await mkdir(runtime, { recursive: true });
  try { await link(process.execPath, path.join(runtime, 'node')); }
  catch (error) { if (!['EXDEV', 'EPERM', 'EACCES'].includes(error.code)) throw error; await copyFile(process.execPath, path.join(runtime, 'node')); await require('node:fs/promises').chmod(path.join(runtime, 'node'), 0o700); }
  await writeFile(path.join(installation, 'host.cjs'), 'process.stdout.write(JSON.stringify({args:process.argv.slice(2),injected:!!process.env.NODE_OPTIONS,pathInjected:!!process.env.NODE_PATH}));');
  const launcher = path.join(installation, 'superx-host'); await writeFile(launcher, launcherText('darwin'), { mode: 0o700 });
  const result = spawnSync('/bin/sh', [launcher, `chrome-extension://${STORE_ID}/`], { shell: false, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--invalid-injected-superx-option', NODE_PATH: 'invalid-fixture-path' } });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), { args: [`chrome-extension://${STORE_ID}/`], injected: false, pathInjected: false });
});
test('Mac login behavior clears Grok auth paths and API credentials before the login process', { skip: process.platform !== 'darwin' }, async t => {
  const directory = await fixture(t), { loginText } = await installer;
  const text = loginText('darwin').replace('exec "$base/runtime/grok" login', 'for name in GROK_HOME GROK_AUTH_PATH GROK_CONFIG_PATH XAI_API_KEY NODE_OPTIONS NODE_PATH; do if [[ -n "${!name+x}" ]]; then exit 9; fi; done\nprintf "environment-cleared\\n"');
  const script = path.join(directory, 'login-fixture.command'); await writeFile(script, text, { mode: 0o700 });
  const result = spawnSync('/bin/bash', [script], { shell: false, encoding: 'utf8', env: { ...process.env, GROK_HOME: 'fixture-only', GROK_AUTH_PATH: 'fixture-only', GROK_CONFIG_PATH: 'fixture-only', XAI_API_KEY: 'fixture-only', NODE_OPTIONS: 'fixture-only', NODE_PATH: 'fixture-only' } });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, 'environment-cleared\n');
});
test('the stable root login entry follows the current release after an upgrade', async t => {
  const directory = await fixture(t), { writeRootLogin } = await installer;
  for (const platform of ['win32', 'darwin']) {
    const target = path.join(directory, platform); await mkdir(target);
    const name = await writeRootLogin({ platform, root: target, version: '0.9.0' });
    const first = await readFile(path.join(target, name), 'utf8'); assert.ok(first.includes('0.9.0'));
    assert.equal(await writeRootLogin({ platform, root: target, version: '0.9.1' }), name);
    const upgraded = await readFile(path.join(target, name), 'utf8'); assert.ok(upgraded.includes('0.9.1')); assert.ok(!upgraded.includes('0.9.0'));
    assert.ok(upgraded.includes(platform === 'win32' ? 'login-windows.ps1' : 'login-macos.command'));
    assert.doesNotMatch(upgraded, /grok(?:\.exe)?[" ]+login|auth\.json/);
  }
});
test('root login versions cannot inject a command or escape the managed release', async () => {
  const { rootLoginText } = await installer;
  for (const version of ['../outside', 'latest', '0.9.0; whoami', '0.9.0/../../outside']) for (const platform of ['win32', 'darwin']) assert.throws(() => rootLoginText(platform, version));
});
test('Windows uninstall detects an active runtime before deleting browser registrations', { skip: process.platform !== 'win32' }, async t => {
  const directory = await fixture(t), { installPlan, uninstall } = await installer;
  const plan = installPlan({ platform: 'win32', arch: 'x64', home: directory, localAppData: directory, version: '0.9.0' });
  await mkdir(path.dirname(plan.nodePath), { recursive: true }); await copyFile(process.execPath, plan.nodePath);
  await writeFile(path.join(plan.root, 'installation.json'), JSON.stringify({ product: 'SuperX Connector', root: plan.root, release: plan.release }));
  const child = spawn(plan.nodePath, ['-e', 'process.stdout.write("ready"); setInterval(()=>{},1000)'], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  const { once } = require('node:events');
  try {
    await once(child.stdout, 'data');
    let registryCalls = 0;
    await assert.rejects(uninstall(plan, { registry: () => { registryCalls++; return { status: 1, stdout: '' }; } }), /Close Chrome and Edge completely/);
    assert.equal(registryCalls, 0); assert.ok((await lstat(plan.nodePath)).isFile());
  } finally {
    const closed = once(child, 'close'); child.kill(); await closed;
  }
});
