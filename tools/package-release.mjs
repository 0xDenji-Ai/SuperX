// Build one installation candidate for GitHub downloads and store submission.
// The fixed download name is an alias of the same ZIP, never a separate build.
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageExtension } from './package-extension.mjs';
import { packageSource } from './package-source.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function packageRelease({ root = projectRoot, outputDir = resolve(root, 'artifacts'), expectedVersion } = {}) {
  const source = await packageSource({ root, outputDir, expectedVersion });
  const installation = await packageExtension({ root, outputDir, expectedVersion });
  const aliasName = 'SuperX.zip';
  await copyFile(resolve(installation.outputDir, installation.archiveName), resolve(installation.outputDir, aliasName));
  const sumsPath = resolve(installation.outputDir, installation.sumsName);
  const sums = await readFile(sumsPath, 'utf8');
  await writeFile(sumsPath, `${sums}${installation.sha256}  ${aliasName}\n`);
  return { version: installation.version, installation, source, aliasName };
}

async function main(args) {
  let expectedVersion, outputDir;
  while (args.length) {
    const arg = args.shift();
    if (arg !== '--expected-version' && arg !== '--output-dir') throw new Error(`Unknown argument: ${arg}`);
    const value = args.shift();
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    if (arg === '--expected-version') expectedVersion = value;
    else outputDir = resolve(value);
  }
  const result = await packageRelease({ expectedVersion, outputDir });
  console.log(`Release candidate: ${result.installation.archiveName} / ${result.aliasName} (identical SHA256 ${result.installation.sha256})`);
  console.log(`Public source: ${result.source.archiveName}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(`Release packaging failed: ${error.message}`); process.exitCode = 1; });
}
