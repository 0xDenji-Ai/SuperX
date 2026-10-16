import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONNECTOR_FILES, GROK_VERSION, NODE_VERSION } from '../connector/install.mjs';
import { createArchive } from './package-extension.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const publicText = data => Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'));
export async function packageConnector({ root = ROOT, outputDir = resolve(root, 'artifacts'), expectedVersion } = {}) {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || (expectedVersion && expectedVersion !== pkg.version)) throw new Error('Connector release version mismatch.');
  const files = [];
  for (const name of CONNECTOR_FILES) {
    const file = resolve(root, 'connector', name), stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error(`Invalid connector source: ${name}`);
    const data = publicText(await readFile(file));
    if (/\b(?:xai|sk)-[A-Za-z0-9_-]{24,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(data.toString('utf8'))) throw new Error(`Possible credential in connector source: ${name}`);
    files.push({ name, data });
  }
  files.push({ name: 'LICENSE.txt', data: publicText(await readFile(resolve(root, 'LICENSE'))) });
  files.push({ name: 'README.txt', data: Buffer.from(`SuperX Connector ${pkg.version}\n\nOptional: API Key mode does not need this connector.\n\nWindows 11 x64: review install-windows.ps1, then run it in PowerShell:\n  powershell.exe -NoProfile -File .\\install-windows.ps1\nmacOS (Apple Silicon or Intel): review install-macos.command, then run in Terminal:\n  bash ./install-macos.command\n\nFor an unpacked development extension, use the exact Extension ID command shown\nin SuperX Settings > Grok CLI / ACP > Setup guide. The Chrome Web Store ID is\nauthorized by default. Chrome and Edge registrations are current-user only.\n\nThe installer downloads pinned official Node and Grok Build runtimes and verifies\ntheir hashes. It does not send an inference request or read authentication files.\nAfter installation, run the printed login command to sign in with official Grok\nBuild, then use Check connection in SuperX Settings. Usage and limits depend on\nyour Grok account. No API fallback or automatic paid retry is enabled.\n\nTo uninstall this optional connector (Grok login and extension settings remain):\nFirst quit Chrome and Edge completely, including their background processes.\n  Windows: powershell.exe -NoProfile -File .\\install-windows.ps1 -Uninstall\n  macOS: bash ./install-macos.command --uninstall\n\nThese installer scripts are not code-signed. Respect your device's security\npolicy; review the source before running. Do not disable system protections.\n`) });
  files.push({ name: 'package-info.json', data: Buffer.from(JSON.stringify({ name: 'SuperX Connector', version: pkg.version, nodeVersion: NODE_VERSION, grokVersion: GROK_VERSION, files: files.map(item => ({ path: item.name, sha256: sha256(item.data) })) }, null, 2) + '\n') });
  files.sort((a, b) => a.name.localeCompare(b.name));
  const archiveName = `SuperX-Connector-${pkg.version}.zip`, archive = createArchive(files);
  // Preserve executable mode for the macOS installer when Finder unpacks the ZIP.
  const end = archive.length - 22;
  let central = archive.readUInt32LE(end + 16);
  for (let i = 0; i < files.length; i++) {
    const nameLength = archive.readUInt16LE(central + 28), extraLength = archive.readUInt16LE(central + 30), commentLength = archive.readUInt16LE(central + 32);
    const name = archive.subarray(central + 46, central + 46 + nameLength).toString('utf8');
    if (name.endsWith('.command')) archive.writeUInt32LE(0x81ed0000, central + 38);
    central += 46 + nameLength + extraLength + commentLength;
  }
  const checksum = sha256(archive);
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, archiveName), archive);
  await writeFile(resolve(outputDir, `SuperX-Connector-${pkg.version}-SHA256SUMS.txt`), `${checksum}  ${archiveName}\n`);
  return { version: pkg.version, archiveName, outputDir, count: files.length, sha256: checksum };
}
async function main(args) {
  let expectedVersion, outputDir;
  while (args.length) {
    const option = args.shift(), value = args.shift();
    if (!value || !['--expected-version', '--output-dir'].includes(option)) throw new Error('Use --expected-version and/or --output-dir.');
    if (option === '--expected-version') expectedVersion = value; else outputDir = resolve(value);
  }
  const result = await packageConnector({ expectedVersion, outputDir });
  console.log(`Packaged ${result.archiveName} (${result.count} files). SHA256 ${result.sha256}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
