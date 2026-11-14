import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import LocalFS from '@deepseek-ai/dsh-fs-local'
import { SuperCodeWorkbench } from '../../src/dsh/workbench.js'
import { validationRoot } from '../validation-root.js'

test('文件 Remote 使用所选会话目录及访问策略，拒绝坏请求和已取消请求', async t => {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'workbench-remote-')), ctx = new Context()
  new SessionStore(ctx)
  await ctx.plugin(LocalFS, { cwd: root, diffBasisMaxBytes: 1024 })
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  let readonly = false
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: readonly ? 'read-only' : 'workspace-write', workspaceRoot: root }) })
  const session = ctx.sessions.create(SessionId('files'), { meta: { cwd: root } })
  const api = new SuperCodeWorkbench(ctx), signal = new AbortController().signal
  const input = JSON.stringify({ action: 'createFile', path: '中文 文件.ts' })
  assert.deepEqual(await api.fileOperation(session.id, input, signal), { path: '中文 文件.ts' })
  assert.equal(await readFile(join(root, '中文 文件.ts'), 'utf8'), '')
  readonly = true
  await assert.rejects(api.fileOperation(session.id, JSON.stringify({ action: 'createDirectory', path: 'blocked' }), signal), /WORKBENCH_FILES_READONLY/)
  await assert.rejects(stat(join(root, 'blocked')), { code: 'ENOENT' })
  await assert.rejects(api.fileOperation('missing', input, signal), /WORKBENCH_SESSION/)
  await assert.rejects(api.fileOperation(session.id, '{}', signal))
  await assert.rejects(api.fileOperation(session.id, 'invalid json', signal))
  const abort = new AbortController(); abort.abort()
  await assert.rejects(api.fileOperation(session.id, input, abort.signal))
})
