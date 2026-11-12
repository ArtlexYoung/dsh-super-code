import { validationRoot as scratch } from '../../../validation-root.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { join, posix, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as yaml } from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { apply } from '../../../../src/dsh/bundled-skills.js'
import { convertedFiles, build, generatedPath } from '../../../../runtime/skills/pstack/convert.mjs'
import { auditWorktrees } from '../../../../runtime/skills/pstack/overrides/skills/poteto-mode/scripts/worktree-audit.mjs'

const root = fileURLToPath(new URL('../../../../builtin/skills/', import.meta.url))

test('generated paths accept Windows and POSIX Unicode paths while rejecting traversal and other drives', () => {
  for (const [paths, root] of [[posix, '/tmp/中文 目录/dsh'], [win32, 'C:\\中文 目录\\dsh']] as const) {
    assert.equal(generatedPath(root, 'skills/how/SKILL.md', paths), paths.join(root, 'skills', 'how', 'SKILL.md'))
    for (const unsafe of ['', '.', '../outside', '../dsh-other/file.md', paths.parse(root).root]) {
      assert.throws(() => generatedPath(root, unsafe, paths), /Invalid output path/)
    }
  }
  assert.throws(() => generatedPath('C:\\bundle\\dsh', 'D:\\other\\file.md', win32), /Invalid output path/)
})

test('the reproducible DSH distribution retains all Skills, playbooks and relative resources', async () => {
  const files = await convertedFiles()
  const checked = await build(true)
  assert.equal(checked.skills, 58)
  assert.equal(checked.files, files.size)
  const manifest = JSON.parse(files.get('adaptation.json').toString())
  assert.equal(manifest.minimumDshVersion, '0.2.1-alpha.1')
  assert.equal([...files.keys()].filter(path => /^skills\/poteto-mode\/playbooks\/[^/]+\.md$/.test(path)).length, 23)
  assert.equal(manifest.files['skills/statechart/scripts/worker.ts'].mode, 'unchanged')
  assert.equal(manifest.files['skills/poteto-mode/scripts/worktree-audit.sh'].mode, 'host-workflow')
  assert.equal(manifest.files['skills/poteto-mode/scripts/worktree-audit.mjs'].mode, 'host-addition')
  for (const name of ['setup-pstack', 'recall', 'reflect', 'automate-me', 'make-bot-ui']) {
    assert.equal(manifest.files[`skills/${name}/SKILL.md`].mode, 'host-workflow')
  }
  const plan = files.get('skills/poteto-mode/playbooks/multi-phase-plan.md').toString()
  assert.match(plan, /<PSTACK_ROOT>\/skills\/poteto-mode\/scripts\/check-plan\.mjs/)
  assert.doesNotMatch(plan, /git show origin\/main:(?:pstack|<PSTACK_ROOT>)|\/loop 1h/)
  assert.match(files.get('skills/poteto-mode/playbooks/babysit.md').toString(), /<PSTACK_TOOLS>\/watch-pr\/watch-pr/)
  const guide = files.get('docs/harness/claude-code.md').toString()
  assert.ok(guide.startsWith('> Upstream background reference.'))
  assert.match(guide, /\[PStack on DSH\]\(\.\.\/\.\.\/DSH\.md\)/)
})

test('the installed statechart helper runs directly under node_modules with Unicode and spaces', async t => {
  await mkdir(scratch, { recursive: true })
  const directory = await mkdtemp(join(scratch, '已安装 空格-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const installed = join(directory, 'node_modules', 'pstack')
  const files = await convertedFiles()
  for (const [path, bytes] of files) {
    if (!path.startsWith('skills/statechart/scripts/') || !path.endsWith('.mjs')) continue
    const target = join(installed, path)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, bytes)
  }
  const run = spawnSync(process.execPath, [join(installed, 'skills/statechart/scripts/statechart.mjs')], { encoding: 'utf8' })
  assert.equal(run.status, 2, run.stderr)
  assert.match(run.stderr, /Give one SPEC\.tla/)
  assert.doesNotMatch(run.stderr, /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING|ERR_MODULE_NOT_FOUND/)
})

test('the native provider loads the DSH workflows and original invocation flags, not the Cursor originals', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  ctx.provide('superCodeConfiguration', { get: () => ({ oilUiSkill: false, pstackSkills: true }) })
  const registry = new SkillRegistry(ctx)
  await ctx.plugin({ apply, inject: ['skills', 'superCodeConfiguration'] }, { bundledSkillDir: root, layout: 'builtin' })
  const catalog = await registry.list()
  assert.equal(catalog.length, 58)
  assert.deepEqual(catalog.filter(item => item.invocation.modelInvocable).map(item => item.name), ['setup-pstack'])
  for (const item of catalog) {
    const loaded = await registry.get(item.name)
    assert.ok(loaded?.content.includes('[DSH host operations](../../DSH.md)'), item.name)
    assert.doesNotMatch(loaded.content, /~\/\.cursor|subagent_type|run_in_background|`Task`/, item.name)
  }
  const setup = await registry.get('setup-pstack')
  assert.match(setup!.content, /<workspace>\/\.dsh\/pstack\.md/)
  const bot = await registry.get('make-bot-ui')
  assert.match(bot!.content, /dsh_sessions/)
  assert.match(bot!.content, /stable requestId/)
  assert.doesNotMatch(bot!.content, /update_state|secret-request|api2\.cursor/)
  const original = await readFile(join(root, 'pstack/skills/setup-pstack/SKILL.md'), 'utf8')
  assert.match(original, /~\/\.cursor\/rules/)
})

test('the DSH setup preserves every upstream role and separates reasoning from panel count and concurrency', async () => {
  const original = await readFile(join(root, 'pstack/skills/setup-pstack/SKILL.md'), 'utf8')
  const files = await convertedFiles()
  const setup = files.get('skills/setup-pstack/SKILL.md').toString()
  const upstreamRoles = [...original.matchAll(/^([\w][\w ,\-]+): (?:grok|claude)-/gm)].map(match => match[1])
  const config = yaml(setup.match(/```yaml\n([^]*?)\n```/)![1]) as {
    budget: string, 'target-effort': string, parallelism: string, roles: Record<string, string | string[]>
  }
  assert.equal(upstreamRoles.length, 17)
  assert.deepEqual(Object.keys(config.roles), upstreamRoles)
  assert.equal(config.budget, 'large')
  assert.equal(config['target-effort'], 'xhigh')
  assert.equal(config.parallelism, 'host')
  for (const name of ['arena runners', 'architect runners', 'interrogate reviewers']) {
    assert.deepEqual(config.roles[name], ['inherit-parent', 'inherit-parent'])
  }
  assert.deepEqual(config.roles['arena cross-judge pool'], [])
  assert.deepEqual([...setup.matchAll(/^\| (unlimited|large|medium|small) \| (\w+) \|$/gm)].map(match => match.slice(1)),
    [['unlimited', 'max'], ['large', 'xhigh'], ['medium', 'high'], ['small', 'medium']])
  assert.equal([...setup.matchAll(/^## \d+\./gm)].length, 8)
  assert.match(setup, /create-verification-skill\/SKILL.md/)
  assert.match(setup, /create-formal-verification-skill\/SKILL.md/)
})

test('host translation retains upstream phase order and invocation contracts across the entire distribution', async () => {
  const files = await convertedFiles()
  const manifest = JSON.parse(files.get('adaptation.json').toString())
  const headings = (text: string) => text.match(/^#{1,6} .+$/gm) ?? []
  let compared = 0
  for (const [path, entry] of Object.entries(manifest.files) as [string, { mode: string }][]) {
    if (!path.endsWith('.md') || !path.startsWith('skills/')) continue
    const generated = files.get(path).toString()
    if (entry.mode === 'host-translation') {
      const original = await readFile(join(root, 'pstack', path), 'utf8')
      assert.deepEqual(headings(generated), headings(original), path)
      compared++
    }
    if (/^skills\/[^/]+\/SKILL.md$/.test(path)) {
      const original = await readFile(join(root, 'pstack', path), 'utf8')
      const front = (text: string) => yaml(text.match(/^---\n([^]*?)\n---/)![1]) as Record<string, unknown>
      assert.equal(front(generated).name, front(original).name, path)
      assert.equal(front(generated)['disable-model-invocation'], front(original)['disable-model-invocation'], path)
    }
  }
  assert.ok(compared > 70)
  const autonomous = files.get('skills/poteto-mode/playbooks/autonomous-run.md').toString()
  assert.match(autonomous, /unattended timed resumption is unavailable/)
  const cleanup = files.get('skills/poteto-mode/playbooks/worktree-cleanup.md').toString()
  assert.match(cleanup, /simctl --set testing list/)
  assert.match(cleanup, /DerivedData and iOS DeviceSupport/)
  const reflect = files.get('skills/reflect/SKILL.md').toString()
  assert.match(reflect, /separate synthesis delegate/)
  assert.match(reflect, /every reviewer's full findings/)
  for (const name of ['how/references/explorer-prompt', 'how/references/explainer-prompt', 'why/references/investigator-prompt', 'why/references/synthesizer-prompt']) {
    const path = `skills/${name}.md`
    const text = files.get(path).toString()
    assert.equal(text, await readFile(join(root, 'pstack', path), 'utf8'), path)
  }
})

test('MCP discovery translation preserves the separate code-anchor procedure and upstream role contracts', async () => {
  const files = await convertedFiles()
  const path = 'skills/why/SKILL.md'
  const original = await readFile(join(root, 'pstack', path), 'utf8')
  const section = (text: string) => text.split('## Step 2. Establish the Code Anchor\n')[1].split('## Step 3.')[0]
  assert.equal(section(files.get(path).toString()), section(original))
  for (const role of ['how/references/explorer-prompt', 'how/references/explainer-prompt', 'why/references/investigator-prompt', 'why/references/synthesizer-prompt']) {
    const template = files.get(`skills/${role}.md`).toString().split('\n---\n')[1]
    const originalTemplate = (await readFile(join(root, 'pstack', `skills/${role}.md`), 'utf8')).split('\n---\n')[1]
    assert.equal(template, originalTemplate, role)
  }
})

test('a decision-log snapshot remains verifiable after appends and detects earlier edits without claiming semantic proof', async () => {
  const { auditLog } = await import('../../../../runtime/skills/pstack/overrides/skills/show-me-your-work/scripts/audit-log.mjs')
  const header = 'ts\tphase\tdecision\twhy\tevidence\tresult\n'
  const first = '2026-11-11T12:00:00Z\tstart\tinspect\tbaseline\tbaseline.txt\tobserved\n'
  const second = '2026-11-11T12:01:00Z\taudit\tchecked first row\treview\taudit.json\t1 row checked\n'
  const initial = auditLog(header + first)
  const appended = auditLog(header + first + second, 1, initial.snapshotSha256)
  assert.equal(appended.snapshotSha256, initial.snapshotSha256)
  assert.equal(appended.totalRows, 2)
  assert.equal(appended.throughRow, 1)
  assert.equal(appended.claimsVerified, false)
  assert.throws(() => auditLog(header + first.replace('baseline.txt', 'invented.txt') + second, 1, initial.snapshotSha256), /Snapshot changed/)
  assert.throws(() => auditLog(header + first, 2), /row bound/)
  assert.throws(() => auditLog(header + first.replace('observed', '=IMPORTDATA(1)')), /formula/)
  assert.throws(() => auditLog(header + first + second.replace('12:01', '11:59')), /Timestamp/)
  assert.throws(() => auditLog(header + first.replace('\tbaseline\t', '\t\t')), /Empty/)
  assert.throws(() => auditLog((header + first).trimEnd()), /newline/)
  assert.throws(() => auditLog(header + first, 1, 'not-a-hash'), /hash/)
  const files = await convertedFiles()
  assert.ok(files.has('skills/show-me-your-work/scripts/audit-log.mjs'))
})

test('the worktree audit preserves Unicode paths and retains unknown, dirty, ignored and locked worktrees', async t => {
  await mkdir(scratch, { recursive: true })
  const directory = await mkdtemp(join(scratch, 'audit-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repo = join(directory, '中文 主目录'), clean = join(directory, 'clean tree'), dirty = join(directory, '中文 改动')
  await mkdir(repo)
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git('init', '-b', 'main')
  await writeFile(join(repo, '.gitignore'), '*.cache\n')
  await writeFile(join(repo, 'file.txt'), 'first\n')
  git('add', '.gitignore', 'file.txt')
  git('-c', 'user.name=DSH Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture')
  git('worktree', 'add', '-b', 'clean', clean)
  git('worktree', 'add', '-b', 'dirty', dirty)
  await writeFile(join(dirty, 'untracked.txt'), 'keep me')
  await writeFile(join(clean, 'build.cache'), 'ignored but still data')
  git('worktree', 'lock', '--reason', 'active DSH session', clean)
  const before = git('worktree', 'list', '--porcelain', '-z')
  const audited = auditWorktrees(repo, 'main')
  assert.equal(audited.worktrees.length, 3)
  const indexed = new Map(audited.worktrees.map(row => [resolve(row.path), row]))
  assert.equal(indexed.get(clean)!.locked, true)
  assert.equal(indexed.get(clean)!.dirty, true)
  assert.equal(indexed.get(dirty)!.dirty, true)
  for (const row of audited.worktrees) {
    assert.equal(row.activity, 'unknown')
    assert.equal(row.recommendation, 'retain-until-ownership-confirmed')
    assert.equal(row.merge, 'ancestor')
  }
  assert.equal(git('worktree', 'list', '--porcelain', '-z'), before)
  assert.equal(await readFile(join(dirty, 'untracked.txt'), 'utf8'), 'keep me')
  assert.throws(() => auditWorktrees(repo, 'missing-base'))
})
