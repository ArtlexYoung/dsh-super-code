import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safePath, blobHash, mappings, adaptOil, command } from '../../scripts/updates/sources.mjs';
import { parseOptions, applyUpdates } from '../../scripts/updates/run.mjs';
import { acquireLock, updateCheckout } from '../../scripts/updates/checkout.mjs';
import { auditLock, newestVersion } from '../../scripts/updates/dependencies.mjs';
import { developmentInstall } from '../../scripts/updates/install.mjs';

test('maintenance requires a separate explicit branch and known targets', () => {
  for (const args of [['--apply'], ['--apply', '--branch', 'main'], ['--apply', '--branch', 'feat/../main'], ['--only', 'unknown']]) assert.throws(() => parseOptions(args));
  assert.deepEqual(parseOptions(['--only', 'oil-ui,dependencies:marked']).only, ['oil-ui', 'dependencies:marked']);
});

test('upstream paths cannot escape or alias the candidate on Unix or Windows', () => {
  for (const path of ['../outside', '/tmp/a', 'C:/a', 'a\\b', 'a/.git/config', 'a/.GIT/config', 'a\nname', 'a/./b', 'a//b', 'a/CON.txt', 'a/file.']) assert.throws(() => safePath(path), path);
  assert.equal(safePath('skills/research/SKILL.md'), 'skills/research/SKILL.md');
  assert.equal(blobHash(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('distribution includes official resources and excludes standalone oil updates', () => {
  const files = ['LICENSE', 'SKILL.md', 'scripts/check_update.py', 'scripts/shoot.mjs', 'assets/readme/a.png', 'assets/fonts/OFL.txt'];
  assert.deepEqual(mappings({ id: 'oil-ui' }, files, {}), [['LICENSE', 'LICENSE'], ['SKILL.md', 'SKILL.md'], ['scripts/shoot.mjs', 'scripts/shoot.mjs'], ['assets/fonts/OFL.txt', 'assets/fonts/OFL.txt']]);
  assert.throws(() => mappings({ id: 'mattpocock' }, [], { skills: ['./a/tdd', './b/tdd'] }), /Duplicate/);
  const content = adaptOil('---\nname: oil-ui\nallowed-tools:\n  - shell\n---\n## 开始前\nrun updater\n## 使用\nKeep this\n');
  assert.ok(!content.includes('run updater') && !content.includes('allowed-tools'));
  assert.match(content, /Keep this/);
  assert.throws(() => adaptOil('## Changed layout'), /needs review/);
});

test('dependency selection sorts numeric versions; changed transitive sources, licenses and scripts are checked', () => {
  assert.equal(newestVersion(['1.9.0', '1.11.0', '1.10.4', '2.0.0-beta.1']), '1.11.0');
  const entry = { version: '1.2.3', license: 'MIT', resolved: 'https://registry.npmjs.org/example/-/example-1.2.3.tgz', integrity: 'sha512-YWJj' };
  assert.equal(auditLock({ packages: {} }, { packages: { 'node_modules/example': entry } }).length, 1);
  for (const patch of [{ license: 'AGPL-3.0-only' }, { resolved: 'https://example.com/package.tgz' }, { hasInstallScript: true }]) assert.throws(() => auditLock({ packages: {} }, { packages: { 'node_modules/example': { ...entry, ...patch } } }));
});

test('development install uses the locked test host and restores public metadata after npm failure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-peer-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = { name: 'fixture', peerDependencies: { '@deepseek-ai/dsh-agent': '0.2.2-rc.5' } };
  const lock = { packages: { '': { peerDependencies: manifest.peerDependencies }, 'node_modules/@deepseek-ai/dsh-agent': { version: '0.1.5-rc.2', integrity: 'sha512-fixture' } } };
  const original = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(join(root, 'package.json'), original);
  await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  const fake = join(root, 'npm-fixture.cjs');
  await writeFile(fake, `const fs=require('node:fs');const p=JSON.parse(fs.readFileSync('package.json'));if(p.peerDependencies['@deepseek-ai/dsh-agent']!=='0.1.5-rc.2')process.exit(8);fs.writeFileSync('observed','locked');process.exit(7);`);
  const previous = process.env.npm_execpath;
  process.env.npm_execpath = fake;
  try { await assert.rejects(developmentInstall(root, ['install']), /Command failed/); }
  finally { if (previous === undefined) delete process.env.npm_execpath; else process.env.npm_execpath = previous; }
  assert.equal(await readFile(join(root, 'observed'), 'utf8'), 'locked');
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), original);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')), lock);
});

test('update worktrees preserve dirty work, reuse clean branches and block concurrent writers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-update-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await command('git', ['init', '--quiet', '--initial-branch=main', root]);
  await writeFile(join(root, 'package.json'), '{}\n');
  await command('git', ['add', 'package.json'], root);
  await command('git', ['-c', 'user.name=Maintenance test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'test fixture'], root);
  const run = join(root, '.run'); await mkdir(run);
  await writeFile(join(root, '.git/info/exclude'), '.run\n');
  await writeFile(join(root, 'uncommitted.txt'), 'keep me');
  await assert.rejects(updateCheckout(root, { branch: 'chore/test-updates' }, run), /uncommitted/);
  assert.equal(await command('git', ['branch', '--list', 'chore/test-updates'], root), '');
  assert.equal(await readFile(join(root, 'uncommitted.txt'), 'utf8'), 'keep me');
  await rm(join(root, 'uncommitted.txt'));
  const release = await acquireLock(root, 'chore/test-updates');
  try { await assert.rejects(acquireLock(root, 'chore/test-updates'), /already running/); }
  finally { await release(); }
  const candidate = await updateCheckout(root, { branch: 'chore/test-updates' }, run);
  assert.equal(await realpath(await updateCheckout(root, { branch: 'chore/test-updates' }, run)), await realpath(candidate));
  const inspection = { skills: [], dependencies: [], failures: [] };
  assert.equal((await applyUpdates(root, { branch: 'chore/test-updates' }, inspection, run, candidate)).status, 'unchanged');
  assert.equal(await command('git', ['status', '--porcelain=v1'], root), '');
  assert.equal(await command('git', ['rev-parse', 'HEAD'], root), await command('git', ['rev-parse', 'HEAD'], candidate));
  await writeFile(join(candidate, 'owned.txt'), 'preserve candidate');
  await assert.rejects(updateCheckout(root, { branch: 'chore/test-updates' }, run), /uncommitted/);
});
