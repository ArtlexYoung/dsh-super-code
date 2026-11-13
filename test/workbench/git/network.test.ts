import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { validationRoot } from '../../validation-root.js'
import { GitRepository } from '../../../src/workbench/git/repository.js'
import { gitHttpServer } from './fixtures/http-server.js'
const exec = promisify(execFile)
const author = { name: 'Test Developer', email: 'developer@example.invalid' }, auth = { username: 'tester', password: 'fixture-token' }
for (const backend of ['builtin', 'native'] as const) {
  test(`${backend}：真实 HTTP 远程的推送、获取、拉取、分叉拒绝、认证和取消`, { timeout: 90000 }, async t => {
    await fs.mkdir(validationRoot, { recursive: true })
    const root = await fs.mkdtemp(join(validationRoot, `git-http-${backend}-`))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    await exec('git', ['init', '--bare', '--initial-branch=main', join(root, 'remote.git')])
    await exec('git', ['--git-dir=' + join(root, 'remote.git'), 'config', 'http.receivepack', 'true'])
    const server = await gitHttpServer(root, t)
    function client(dir: string) {
      const repo = new GitRepository(dir, backend === 'native' ? 'git' : join(dir, 'no-git'))
      const request = (input: unknown, signal = new AbortController().signal) => repo.execute(input, undefined, signal)
      const state = async () => { const value = await request({ action: 'status' }); if (value.kind !== 'state') throw new Error('state'); return value.state }
      const act = async (input: object) => request({ ...input, version: (await state()).version })
      const commit = async (text: string) => {
        await fs.writeFile(join(dir, 'file.txt'), text)
        await act({ action: 'stage', paths: ['file.txt'] })
        await act({ action: 'commit', message: text, author })
      }
      return { repo, request, state, act, commit }
    }
    const firstDir = join(root, 'first'), secondDir = join(root, 'second')
    await fs.mkdir(firstDir); await fs.mkdir(secondDir)
    const first = client(firstDir), second = client(secondDir)
    for (const item of [first, second]) {
      await item.request({ action: 'init', branch: 'main' })
      await item.act({ action: 'remote', remote: 'origin', url: server.url })
    }
    await first.commit('initial\n')
    await first.act({ action: 'push', remote: 'origin', auth })
    const head = (await first.state()).head
    assert.equal((await exec('git', ['--git-dir=' + join(root, 'remote.git'), 'rev-parse', 'main'])).stdout.trim(), head)
    await second.act({ action: 'fetch', remote: 'origin', auth })
    await second.act({ action: 'pull', remote: 'origin', auth })
    assert.equal(await fs.readFile(join(secondDir, 'file.txt'), 'utf8'), 'initial\n')
    await first.commit('remote update\n')
    await first.act({ action: 'push', remote: 'origin', auth })
    await second.act({ action: 'pull', remote: 'origin', auth })
    assert.equal(await fs.readFile(join(secondDir, 'file.txt'), 'utf8'), 'remote update\n')
    await second.commit('local diverged\n')
    await first.commit('remote diverged\n')
    await first.act({ action: 'push', remote: 'origin', auth })
    await assert.rejects(second.act({ action: 'pull', remote: 'origin', auth }), /WORKBENCH_GIT_DIVERGED/)
    await assert.rejects(second.act({ action: 'push', remote: 'origin', auth }), /WORKBENCH_GIT_PUSH_REJECTED/)
    const calls = server.requests.length
    await assert.rejects(first.act({ action: 'fetch', remote: 'origin', auth: { username: 'tester', password: 'wrong-fixture-token' } }), /WORKBENCH_GIT_AUTH/)
    assert.ok(server.requests.length > calls)
    assert.ok(server.requests.some(request => request.path.endsWith('/git-receive-pack') && request.authenticated))
    for (const dir of [firstDir, secondDir]) assert.equal((await fs.readFile(join(dir, '.git/config'), 'utf8')).includes(auth.password), false)
    server.stall()
    const abort = new AbortController()
    const pending = first.request({ action: 'fetch', remote: 'origin', auth, version: (await first.state()).version }, abort.signal)
    const timer = setTimeout(() => abort.abort(new Error('test cancellation')), 1000)
    try { await assert.rejects(pending, /test cancellation/) } finally { clearTimeout(timer) }
  })
}
