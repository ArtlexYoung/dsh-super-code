import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { validationRoot } from '../../validation-root.js'
import { GitRepository } from '../../../src/workbench/git/repository.js'

test('只读状态读取也经过宿主沙箱，不能在沙箱外执行 Git filter', async t => {
  await fs.mkdir(validationRoot, { recursive: true })
  const root = await fs.mkdtemp(join(validationRoot, 'git-filter-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const exec = promisify(execFile), signal = new AbortController().signal
  const git = (args: string[]) => exec('git', ['-C', root, ...args])
  await git(['init', '-b', 'main'])
  await fs.writeFile(join(root, '.gitattributes'), 'file.txt filter=check\n')
  await fs.writeFile(join(root, 'file.txt'), 'base\n')
  await git(['add', '.'])
  await git(['-c', 'user.name=Developer', '-c', 'user.email=developer@example.invalid', 'commit', '-m', 'base'])
  await fs.writeFile(join(root, 'filter.cjs'), "require('node:fs').writeFileSync('filter-ran', 'ran');process.stdin.pipe(process.stdout)")
  await git(['config', 'filter.check.clean', 'node filter.cjs'])
  await fs.writeFile(join(root, 'file.txt'), 'edit\n')
  const repository = new GitRepository(root, 'git', (_argv, policy) => {
    assert.equal(policy.mode, 'read-only')
    throw new Error('fixture sandbox denied')
  })
  await assert.rejects(repository.execute({ action: 'status' }, { mode: 'read-only', workspaceRoot: root }, signal), /fixture sandbox denied/)
  assert.equal(await fs.stat(join(root, 'filter-ran')).catch(() => null), null)
})

for (const asynchronous of [false, true]) {
  test(`原生 Git 支持${asynchronous ? '异步' : '同步'}宿主沙箱，并在准备后检查取消`, async t => {
    await fs.mkdir(validationRoot, { recursive: true })
    const root = await fs.mkdtemp(join(validationRoot, 'git-sandbox-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const abort = new AbortController(), signal = abort.signal
    let cancelPreparation = false, writes = 0
    const repo = new GitRepository(root, 'git', (argv, _policy, operationSignal) => {
      if (['init', 'add', 'commit'].some(command => argv.includes(command))) writes++
      assert.equal(operationSignal, signal)
      if (cancelPreparation && argv.includes('commit')) abort.abort(new Error('cancel preparing sandbox'))
      return asynchronous ? Promise.resolve(argv) : argv
    })
    const policy = { mode: 'workspace-write', workspaceRoot: root } as const
    const request = (input: unknown) => repo.execute(input, policy, signal)
    const state = async () => { const value = await request({ action: 'status' }); if (value.kind !== 'state') throw Error('state'); return value.state }
    await request({ action: 'init', branch: 'main' })
    await fs.writeFile(join(root, 'file'), 'content')
    await request({ action: 'stage', paths: ['file'], version: (await state()).version })
    assert.equal((await state()).changes[0]?.stage, 2)
    cancelPreparation = true
    await assert.rejects(request({ action: 'commit', message: 'not committed', author: { name: 'Developer', email: 'developer@example.invalid' }, version: (await state()).version }), /cancel preparing sandbox/)
    assert.equal(writes, 3)
    assert.equal(await fs.stat(join(root, '.git/refs/heads/main')).catch(() => null), null)
  })
}
