import { mkdir, mkdtemp, writeFile, rename, cp, lstat, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { sources, command, inspectSource, prepareSource } from './sources.mjs';
import { inspectDependencies, updateDependencies } from './dependencies.mjs';
import { acquireLock, updateCheckout } from './checkout.mjs';
import { developmentInstall } from './install.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const usage = 'npm run updates:check [-- --only oil-ui,mattpocock,pstack,openspec,dependencies]\n'
  + 'npm run updates:apply -- --branch chore/bundled-updates [--only oil-ui]\n'
  + 'Creates an isolated local branch, validates it and commits successful updates. Never pushes or publishes.';

export function parseOptions(args) {
  const { values } = parseArgs({ args, options: { apply: { type: 'boolean' }, branch: { type: 'string' }, only: { type: 'string' }, report: { type: 'string' }, help: { type: 'boolean' } }, strict: true });
  const only = values.only ? values.only.split(',') : [...sources.map(source => source.id), 'dependencies'];
  if (only.some(id => ![...sources.map(source => source.id), 'dependencies'].includes(id) && !/^dependencies:(?:@[a-z0-9-]+\/)?[a-z0-9._-]+$/.test(id))) throw new Error('Unknown update target');
  if (values.apply && (!values.branch || !/^(?:chore|feat)\/[a-z0-9][a-z0-9./-]+$/.test(values.branch) || values.branch.includes('..'))) throw new Error('--apply requires an explicit chore/... or feat/... local branch');
  return { ...values, only };
}

export async function inspectUpdates(directory, only) {
  const skills = [], failures = [];
  for (const source of sources.filter(source => only.includes(source.id))) {
    try { skills.push(await inspectSource(directory, source)); }
    catch (error) { failures.push({ id: source.id, error: error.message }); }
  }
  let dependencies = [];
  if (only.some(id => id.startsWith('dependencies'))) {
    try { dependencies = await inspectDependencies(directory, only.includes('dependencies') ? [] : only.filter(id => id.startsWith('dependencies:')).map(id => id.slice(13))); }
    catch (error) { failures.push({ id: 'dependencies', error: error.message }); }
  }
  return { skills, dependencies, failures };
}

export async function verifyCandidate(directory, logDirectory) {
  // Fixtures must not discover the parent project's Git or node_modules.
  const testRoot = await realpath(await mkdtemp(join(tmpdir(), 'super-code-maintenance-tests-')));
  await writeFile(join(logDirectory, 'test-root.txt'), testRoot + '\n');
  const checks = [
    ['build', ['run', 'build']], ['typecheck', ['run', 'typecheck']],
    ['tests', ['test']], ['distribution', ['run', 'pack:check']],
  ];
  for (const [name, args] of checks) {
    try { await writeFile(join(logDirectory, `${name}.log`), await command('npm', args, directory, { timeout: 600000, env: { ...process.env, SUPER_CODE_TEST_ROOT: testRoot } })); }
    catch (error) { await writeFile(join(logDirectory, `${name}.log`), `${error.stdout || ''}\n${error.stderr || ''}`); throw new Error(`${name} failed; see ${name}.log`); }
  }
  await rm(testRoot, { recursive: true, force: true });
}

async function prepareDependencies(directory, checkout, changed) {
  // A macOS clone shares immutable blocks while writes remain independent.
  const modules = join(checkout, 'node_modules'), installed = await lstat(modules).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (installed?.isSymbolicLink()) throw new Error('Candidate dependencies must not be a shared symbolic link');
  if (!installed) {
    if (process.platform === 'darwin') await command('cp', ['-cR', join(directory, 'node_modules'), modules]);
    else await cp(join(directory, 'node_modules'), modules, { recursive: true });
  }
  if (changed) await developmentInstall(checkout, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline']);
}

export async function applyUpdates(directory, options, inspection, runDirectory, checkout) {
  const skipped = [...inspection.failures, ...inspection.skills.filter(skill => skill.changed && skill.blocked).map(skill => ({ id: skill.id, error: skill.blocked })),
    ...inspection.dependencies.filter(record => record.blocked).map(record => ({ id: record.name, error: record.blocked }))];
  const changed = inspection.skills.filter(skill => skill.changed && !skill.blocked), dependencies = inspection.dependencies.filter(record => !record.blocked);
  const applied = [];
  for (const source of changed) {
    let prepared;
    try { prepared = await prepareSource(checkout, source, join(runDirectory, 'upstream'), join(directory, '.development/updates/blobs')); }
    catch (error) { skipped.push({ id: source.id, error: error.message }); continue; }
    const target = join(checkout, 'builtin/skills', source.id), backup = join(runDirectory, `${source.id}-before`);
    await rename(target, backup);
    await rename(prepared.directory, target);
    applied.push({ id: source.id, from: source.currentVersion, to: source.version, ...prepared, directory: undefined });
  }
  if (!applied.length && !dependencies.length) return { status: skipped.length ? 'blocked' : 'unchanged', branch: options.branch, checkout, skipped };
  // Only the candidate owns these dependencies; never install through a shared link.
  const transitive = await updateDependencies(checkout, dependencies);
  await prepareDependencies(directory, checkout, dependencies.length > 0);
  await verifyCandidate(checkout, runDirectory);
  const allowed = ['builtin/skills', 'builtin/workflows/catalog.json', 'package.json', 'package-lock.json'];
  await command('git', ['add', '--', ...allowed], checkout);
  if (!await command('git', ['diff', '--cached', '--name-only'], checkout)) return { status: 'unchanged', branch: options.branch, checkout };
  await command('git', ['diff', '--cached', '--check'], checkout);
  // Git retains the caller's date configuration and local commit hooks.
  const hooks = await command('git', ['config', '--get', 'core.hooksPath'], directory).catch(error => { if (error.code === 1) return ''; throw error; });
  await command('git', [...(hooks ? ['-c', `core.hooksPath=${resolve(directory, hooks)}`] : []), '-c', 'user.name=super-code-maintenance', '-c', 'user.email=super-code-maintenance@users.noreply.github.com', 'commit', '-m', 'chore(依赖): 更新内置技能和兼容依赖'], checkout);
  const commit = await command('git', ['rev-parse', 'HEAD'], checkout);
  return { status: skipped.length ? 'updated-with-blocked-targets' : 'updated', branch: options.branch, checkout, commit, skills: applied, dependencies, transitive, skipped };
}

export async function main(args) {
  const options = parseOptions(args);
  if (options.help) { console.log(usage); return; }
  const state = join(root, '.development/updates');
  await mkdir(state, { recursive: true });
  const runDirectory = await mkdtemp(join(state, 'run-'));
  const reportPath = options.report ? resolve(options.report) : join(runDirectory, 'report.json');
  const report = { startedAt: new Date().toISOString(), base: await command('git', ['rev-parse', 'HEAD'], root), mode: options.apply ? 'apply' : 'check', runDirectory };
  let release;
  try {
    if (options.apply) release = await acquireLock(root, options.branch);
    const checkout = options.apply ? await updateCheckout(root, options, runDirectory) : root;
    report.inspection = await inspectUpdates(checkout, options.only);
    report.result = options.apply ? await applyUpdates(root, options, report.inspection, runDirectory, checkout) : { status: report.inspection.failures.length ? 'blocked' : 'checked' };
  } catch (error) { report.result = { status: 'failed', error: error.message }; process.exitCode = 1; }
  finally {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    if (release) await release();
  }
  console.log(JSON.stringify({ report: reportPath, result: report.result, skills: report.inspection?.skills.map(({ id, currentVersion, version, changed }) => ({ id, currentVersion, version, changed })), dependencies: report.inspection?.dependencies, failures: report.inspection?.failures }, null, 2));
  if ((!options.apply && report.inspection?.failures.length) || report.result.status === 'blocked') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
