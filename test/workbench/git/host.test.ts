import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import LocalFS from '@deepseek-ai/dsh-fs-local'
import { SuperCodeWorkbench } from '../../../src/dsh/workbench.js'
import { validationRoot } from '../../validation-root.js'

test('宿主批量暂存接受合法的长路径清单，不被过小的请求长度限制拒绝', async t => {
  await fs.mkdir(validationRoot, { recursive: true })
  const root = await fs.mkdtemp(join(validationRoot, 'git-host-paths-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  new SessionStore(ctx)
  await ctx.plugin(LocalFS, { cwd: root, diffBasisMaxBytes: 10485760 })
  ctx.provide('sessionProjections', { stateOf: () => undefined } as any)
  const session = ctx.sessions.create(SessionId('long-paths'), { meta: { cwd: root } })
  const api = new SuperCodeWorkbench(ctx), signal = new AbortController().signal
  t.after(() => ctx.fiber.dispose())
  const request = async (input: object) => {
    const values = await Array.fromAsync(api.git(session.id, JSON.stringify(input), signal))
    const result = values[0]
    if (!result || result.kind !== 'state') throw new Error('state')
    return result.state
  }
  await request({ action: 'init', branch: 'main' })
  const paths = Array.from({ length: 200 }, (_, i) => `${'file-'.repeat(44)}${i}.txt`)
  await Promise.all(paths.map(path => fs.writeFile(join(root, path), 'content\n')))
  const state = await request({ action: 'status' })
  const input = { action: 'stage', paths, version: state.version }
  assert.ok(JSON.stringify(input).length > 40000)
  const staged = await request(input)
  assert.equal(staged.changes.filter(file => file.head !== file.stage).length, paths.length)
})
