import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Test fixtures intentionally pin a different host from the public support matrix.
// Resolve development installs against that lock, then restore the public metadata.
export async function developmentInstall(directory, args) {
  const manifestPath = join(directory, 'package.json'), lockPath = join(directory, 'package-lock.json');
  const original = await readFile(manifestPath, 'utf8'), manifest = JSON.parse(original);
  const previous = JSON.parse(await readFile(lockPath, 'utf8'));
  const peers = { ...manifest.peerDependencies };
  for (const name of Object.keys(peers)) {
    if (name.startsWith('@deepseek-ai/') && previous.packages[`node_modules/${name}`]) peers[name] = previous.packages[`node_modules/${name}`].version;
  }
  const rootPeers = previous.packages[''].peerDependencies;
  let result;
  try {
    await writeFile(manifestPath, JSON.stringify({ ...manifest, peerDependencies: peers }, null, 2) + '\n');
    await writeFile(lockPath, JSON.stringify({ ...previous, packages: { ...previous.packages, '': { ...previous.packages[''], peerDependencies: peers } } }, null, 2) + '\n');
    const file = process.env.npm_execpath ? process.execPath : 'npm';
    if (!process.env.npm_execpath && process.platform === 'win32') throw new Error('Run through npm run updates:install on Windows');
    const commandArgs = process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;
    result = (await promisify(execFile)(file, commandArgs, { cwd: directory, timeout: 300000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
  } finally {
    await writeFile(manifestPath, original);
    const next = JSON.parse(await readFile(lockPath, 'utf8'));
    next.packages[''].peerDependencies = rootPeers;
    await writeFile(lockPath, JSON.stringify(next, null, 2) + '\n');
  }
  const next = JSON.parse(await readFile(lockPath, 'utf8'));
  for (const [path, entry] of Object.entries(previous.packages)) {
    if (path.includes('node_modules/@deepseek-ai/') && (next.packages[path]?.version !== entry.version || next.packages[path]?.integrity !== entry.integrity)) throw new Error(`Development host changed unexpectedly: ${path}`);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await developmentInstall(fileURLToPath(new URL('../../', import.meta.url)), ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline']));
}
