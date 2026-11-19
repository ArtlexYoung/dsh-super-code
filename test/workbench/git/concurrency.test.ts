import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { GitRepository } from '../../../src/workbench/git/repository.js'
import { validationRoot } from '../../validation-root.js'

test('单文件读取不等待另一项统计，写入等待先前读取，后续读取等写入完成', { timeout: 15000 }, async t => {
  await fs.mkdir(validationRoot, { recursive: true })
  const root = await fs.mkdtemp(join(validationRoot, 'git-readers-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const paused = new AbortController(), waiting = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
  let hold = false, writes = 0
  const repo = new GitRepository(root, 'git', async (argv, _policy, signal) => {
    if (hold && signal === paused.signal && argv.includes('status')) { entered.resolve(); await waiting.promise }
    if (argv.includes('add')) writes++
    return argv
  })
  const policy = { mode: 'workspace-write', workspaceRoot: root } as const
  const run = (input: unknown, signal = new AbortController().signal) => repo.execute(input, policy, signal)
  await run({ action: 'init', branch: 'main' }); await fs.writeFile(join(root, 'file'), 'first\n')
  const base = await run({ action: 'status' }); if (base.kind !== 'state') throw new Error('state')
  hold = true
  const first = run({ action: 'stats', paths: ['file'], version: base.state.version }, paused.signal)
  await entered.promise
  const second = await run({ action: 'diff', path: 'file', side: 'total', version: base.state.version })
  assert.equal(second.kind === 'diff' && second.diff.after, 'first\n')
  const write = run({ action: 'stage', paths: ['file'], version: base.state.version })
  const after = run({ action: 'status' })
  assert.equal(writes, 0)
  waiting.resolve(); await first; await write
  const result = await after
  assert.equal(writes, 1)
  assert.equal(result.kind === 'state' && result.state.changes[0]?.stage, 2)
  await assert.rejects(run({ action: 'diff', path: 'file', side: 'total', version: base.state.version }), /STALE/)
  const fresh = await run({ action: 'status' }); if (fresh.kind !== 'state') throw new Error('state')
  await run({ action: 'unstage', paths: ['file'], version: fresh.state.version })
})

for (const backend of ['native', 'builtin'] as const) {
  test(`${backend}：共用缓存的并行读取保持结果，失败读取不阻断后续写入`, { timeout: 15000 }, async t => {
    await fs.mkdir(validationRoot, { recursive: true })
    const root = await fs.mkdtemp(join(validationRoot, 'git-concurrent-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const repo = new GitRepository(root, backend === 'native' ? 'git' : join(root, 'no-git'))
    const run = (input: unknown) => repo.execute(input, undefined, new AbortController().signal)
    const state = async (input: unknown) => {
      const result = await run(input)
      if (result.kind !== 'state') throw new Error('Expected state')
      return result.state
    }
    await state({ action: 'init', branch: 'main' }); await fs.writeFile(join(root, 'file'), 'base\n')
    let current = await state({ action: 'status' })
    current = await state({ action: 'stage', paths: ['file'], version: current.version })
    current = await state({ action: 'commit', message: 'base', author: { name: 'Developer', email: 'dev@example.invalid' }, version: current.version })
    await fs.writeFile(join(root, 'file'), 'next\n'); current = await state({ action: 'status' })
    const results = await Promise.all([
      run({ action: 'diff', path: 'file', side: 'total', version: current.version }),
      run({ action: 'stats', paths: ['file'], version: current.version }),
      run({ action: 'commitFiles', oid: current.head, version: current.version }),
      run({ action: 'historyDiff', oid: current.head, path: 'file', version: current.version }),
    ])
    assert.equal(results[0].kind === 'diff' && results[0].diff.after, 'next\n')
    assert.equal(results[1].kind === 'stats' && results[1].stats[0]?.added, 1)
    assert.deepEqual(results[2].kind === 'commitFiles' && results[2].files, ['file'])
    assert.equal(results[3].kind === 'diff' && results[3].diff.after, 'base\n')
    const failure = run({ action: 'diff', path: 'missing', side: 'total', version: current.version })
    const write = state({ action: 'stage', paths: ['file'], version: current.version })
    await assert.rejects(failure, /STALE/)
    const staged = await write
    assert.equal(staged.changes[0]?.stage, staged.changes[0]?.worktree)
  })
}
