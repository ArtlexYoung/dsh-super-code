import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { command, readJson } from './sources.mjs';
import { developmentInstall } from './install.mjs';

export const acceptedLicense = license => /^(?:MIT|MIT-0|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|CC0-1\.0|BlueOak-1\.0\.0|\(MIT OR Apache-2\.0\))$/.test(license);
export function newestVersion(versions) {
  return (Array.isArray(versions) ? versions : [versions]).filter(version => typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version))
    .sort((a, b) => { const left = a.split('.').map(Number), right = b.split('.').map(Number); return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]; }).at(-1);
}

export async function inspectDependencies(root, selected = []) {
  const manifest = await readJson(join(root, 'package.json')), lock = await readJson(join(root, 'package-lock.json'));
  const records = [];
  for (const name of selected) if (![...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)].includes(name) || name.startsWith('@deepseek-ai/')) throw new Error(`Unknown or host-managed dependency: ${name}`);
  for (const group of ['dependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(manifest[group])) {
      // Host compatibility versions are a release matrix, not generic npm updates.
      if (name.startsWith('@deepseek-ai/')) continue;
      if (selected.length && !selected.includes(name)) continue;
      const record = await inspectDependency({ name, group, range, current: lock.packages[`node_modules/${name}`]?.version });
      if (record) records.push(record);
    }
  }
  return records;
}


function dependencyBlock(name, info) {
  if (name === '@fission-ai/openspec') return 'Upgrade the OpenSpec CLI and Skills together';
  if (!acceptedLicense(info.license)) return `License needs review: ${info.license}`;
  if (!/^sha512-[A-Za-z0-9+/=]+$/.test(info['dist.integrity'])) return 'Registry integrity is missing';
  if (!Number.isSafeInteger(info['dist.unpackedSize']) || info['dist.unpackedSize'] > 30 * 1024 * 1024) return 'Package size is unknown or exceeds 30 MiB unpacked';
  return undefined;
}

async function inspectDependency({ name, group, range, current }) {
  if (!current || !/^\d+\.\d+\.\d+$/.test(current)) throw new Error(`Unrecognized locked version: ${name}`);
  const versions = JSON.parse(await command('npm', ['view', `${name}@^${current}`, 'version', '--json']));
  const version = newestVersion(versions);
  if (!version) throw new Error(`Invalid registry version: ${name}`);
  if (version === current) return null;
  const info = JSON.parse(await command('npm', ['view', `${name}@${version}`, 'license', 'dist.unpackedSize', 'dist.integrity', '--json']));
  const blocked = dependencyBlock(name, info);
  return { name, group, range, current, version, license: info.license, unpackedBytes: info['dist.unpackedSize'], integrity: info['dist.integrity'], ...(blocked ? { blocked } : {}) };
}

export async function updateDependencies(root, records) {
  if (!records.length) return;
  const manifest = await readJson(join(root, 'package.json'));
  const previous = await readJson(join(root, 'package-lock.json'));
  for (const record of records) {
    if (record.blocked) throw new Error(`${record.name}: ${record.blocked}`);
    manifest[record.group][record.name] = record.range.startsWith('^') ? `^${record.version}` : record.version;
  }
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  await developmentInstall(root, ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
  const lock = await readJson(join(root, 'package-lock.json'));
  for (const record of records) {
    const installed = lock.packages[`node_modules/${record.name}`];
    if (installed?.version !== record.version || installed.integrity !== record.integrity) throw new Error(`Registry changed during update: ${record.name}`);
  }
  return auditLock(previous, lock);
}

export function auditLock(previous, next) {
  const changes = [];
  for (const [path, entry] of Object.entries(next.packages)) {
    if (!path) continue;
    const before = previous.packages[path];
    if (before?.version === entry.version && before?.integrity === entry.integrity) continue;
    if (!acceptedLicense(entry.license)) throw new Error(`Transitive license needs review: ${path}: ${entry.license}`);
    if (!entry.resolved?.startsWith('https://registry.npmjs.org/') || !/^sha512-[A-Za-z0-9+/=]+$/.test(entry.integrity)) throw new Error(`Unexpected package source: ${path}`);
    if (entry.hasInstallScript) throw new Error(`New or changed lifecycle script needs review: ${path}`);
    changes.push({ path, from: before?.version, to: entry.version, license: entry.license });
  }
  return changes;
}
