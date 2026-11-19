import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hostname } from 'node:os';
import { command, hash } from './sources.mjs';

export async function requireClean(directory) {
  if (await command('git', ['status', '--porcelain=v1'], directory)) throw new Error('Working tree has uncommitted changes; commit or preserve them before applying updates');
}

export async function acquireLock(directory, branch) {
  const common = resolve(directory, await command('git', ['rev-parse', '--git-common-dir'], directory));
  const lock = join(common, `super-code-updates-${hash(branch).slice(0, 16)}`);
  try { await mkdir(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8').catch(() => '{}'));
    if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid)) throw new Error(`Update lock needs inspection: ${lock}`);
    try { process.kill(owner.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') throw new Error(`Interrupted maintenance left a lock; inspect the candidate before removing ${lock}`); throw error; }
    throw new Error(`Maintenance is already running for ${branch} (PID ${owner.pid})`);
  }
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString(), branch }));
  return () => rm(lock, { recursive: true });
}

export async function updateCheckout(directory, options, runDirectory) {
  await requireClean(directory);
  await command('git', ['check-ref-format', '--branch', options.branch], directory);
  const current = await command('git', ['branch', '--show-current'], directory);
  if (options.branch === current) throw new Error('Choose a separate maintenance branch');
  const worktrees = await command('git', ['worktree', 'list', '--porcelain'], directory);
  const existing = worktrees.split('\n\n').find(record => record.split('\n').includes(`branch refs/heads/${options.branch}`));
  const refs = await command('git', ['for-each-ref', '--format=%(refname)', `refs/heads/${options.branch}`], directory);
  if (refs) await command('git', ['merge-base', '--is-ancestor', 'HEAD', options.branch], directory);
  if (existing) {
    const checkout = existing.split('\n')[0].slice('worktree '.length);
    await requireClean(checkout);
    return checkout;
  }
  const checkout = join(runDirectory, 'candidate');
  await command('git', ['worktree', 'add', ...(refs ? [] : ['-b', options.branch]), checkout, ...(refs ? [options.branch] : ['HEAD'])], directory);
  return checkout;
}
