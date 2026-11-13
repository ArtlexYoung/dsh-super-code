import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import type { Session, CreateSessionOptions } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LocalFS from '@deepseek-ai/dsh-fs-local'
import { WorkbenchDirectory } from '../../src/dsh/workbench-directory.js'
import { SuperCodeWorkbench } from '../../src/dsh/workbench.js'
import { validationRoot } from '../validation-root.js'

async function fixture(t: test.TestContext) {
  await fs.mkdir(validationRoot, { recursive: true })
  const root = await fs.mkdtemp(join(validationRoot, 'directory-recovery-')), missing = join(root, 'removed'), target = join(root, '中文 目录')
  await fs.mkdir(target)
  const ctx = new Context(); new SessionStore(ctx)
  await ctx.plugin(LocalFS, { cwd: root, diffBasisMaxBytes: 1024 })
  t.after(async () => { await ctx.fiber.dispose(); await fs.rm(root, { recursive: true, force: true }) })
  const source = ctx.sessions.create(SessionId('original'), { meta: { cwd: missing, agentPreset: 'demo' } })
  source.append('turn/start', { turn: 1 })
  source.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '保留的历史问题' }] }), { surfaceOp: 'append' })
  source.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  source.append('sandbox/mode', { mode: 'read-only' })
  const model = { provider: 'fixture', model: 'fixture', reasoningEffort: 'high' }
  const created: Session[] = [], mounted: string[] = [], attached: string[] = [], selected: unknown[] = [], disposed: string[] = []
  let running = false, beforeMount = async () => {}, disposeReads = 0
  ctx.provide('sessionQuery', { async observeSession(id: string) {
    const session = ctx.sessions.get(SessionId(id)); if (!session) throw new Error('missing session')
    return { header: session.header, events: session.snapshotEvents(), projections: { values: { agentPreset: 'demo', modelSelection: { pending: model } } }, [Symbol.dispose]() { disposeReads++ } }
  } })
  ctx.provide('agents', { get: (id: string) => id === source.id ? { status: running ? 'running' : 'idle' } : undefined,
    async create(options: CreateSessionOptions & { sessionId: Session['id']; setup: (owner: Context) => Promise<void> }) {
      await options.setup(ctx)
      const session = ctx.sessions.create(options.sessionId, options); created.push(session)
      return { agent: { session }, async dispose() { disposed.push(session.id) } }
    } })
  ctx.provide('agentPresets', { resolve: async (id: string) => ({ id }), async mount(_owner: Context, id: string) { await beforeMount(); mounted.push(id) } })
  ctx.provide('agentDefaultModel', { currentSelection: () => model })
  ctx.provide('sessionController', { async selectModel(value: unknown) { selected.push(value) } })
  ctx.provide('workspaceRegistry', { list: () => [{ path: target, async attachSession(id: string) { attached.push(id) } }] })
  const service = new WorkbenchDirectory(ctx), signal = new AbortController().signal
  const input = () => ({ path: target, sequence: source.seq })
  return { service, ctx, source, root, missing, target, model, created, mounted, attached, selected, disposed, signal, input,
    running: (value: boolean) => { running = value }, mount: (callback: () => Promise<void>) => { beforeMount = callback }, reads: () => disposeReads }
}

test('缺失目录续聊保留完成历史、预设、模型与只读设置，不改原会话、不启动回答，重复确认只创建一次', async t => {
  const f = await fixture(t), original = f.source.snapshotEvents(), header = f.source.header
  assert.equal((await f.service.status(f.source.id, f.signal)).state, 'missing')
  const [a, b] = await Promise.all([f.service.recover(f.source.id, f.input(), f.signal), f.service.recover(f.source.id, f.input(), f.signal)])
  assert.deepEqual(a, b); assert.equal(f.created.length, 1)
  const session = f.created[0]!
  assert.equal(session.header.cwd, f.target); assert.equal(session.header.agentPreset, 'demo')
  const inherited = original.findLastIndex(event => event.type === 'turn/end') + 1
  assert.equal(session.header.parentSession, f.source.id); assert.equal(session.inheritedEventCount, inherited)
  assert.deepEqual(session.snapshotEvents().slice(0, inherited), original.slice(0, inherited))
  assert.equal(session.snapshotEvents().at(-1)?.type, 'sandbox/mode')
  assert.deepEqual(f.source.snapshotEvents(), original); assert.equal(f.source.header, header)
  assert.deepEqual(f.attached, [session.id]); assert.deepEqual(f.mounted, ['demo'])
  assert.deepEqual(f.selected, [{ sessionId: session.id, ...f.model }]); assert.equal(f.disposed.length, 0)
  assert.ok(f.reads() >= 2)
})

test('运行中、记录更新、目标无效与原目录已恢复均不创建续聊或自动重建目录', async t => {
  const f = await fixture(t)
  f.running(true); await assert.rejects(f.service.recover(f.source.id, f.input(), f.signal), /WORKBENCH_DIRECTORY_BUSY/); f.running(false)
  await assert.rejects(f.service.recover(f.source.id, { ...f.input(), sequence: 0 }, f.signal), /WORKBENCH_DIRECTORY_STALE/)
  await assert.rejects(f.service.recover(f.source.id, { ...f.input(), path: join(f.root, 'invalid') }, f.signal), /WORKBENCH_DIRECTORY_TARGET/)
  await fs.writeFile(join(f.root, 'file'), 'text')
  await assert.rejects(f.service.recover(f.source.id, { ...f.input(), path: join(f.root, 'file') }, f.signal), /WORKBENCH_DIRECTORY_TARGET/)
  f.mount(async () => { f.source.append('sandbox/mode', { mode: 'read-only' }) })
  await assert.rejects(f.service.recover(f.source.id, f.input(), f.signal), /WORKBENCH_DIRECTORY_STALE/)
  assert.equal(f.created.length, 0)
  await assert.rejects(fs.stat(f.missing), { code: 'ENOENT' })
  await fs.mkdir(f.missing)
  assert.equal((await f.service.status(f.source.id, f.signal)).state, 'available')
  await assert.rejects(f.service.recover(f.source.id, f.input(), f.signal), /WORKBENCH_DIRECTORY_AVAILABLE/)
})

test('空会话切换目录不伪造历史，取消请求与开放轮次不创建会话', async t => {
  const f = await fixture(t)
  const empty = f.ctx.sessions.create(SessionId('empty'), { meta: { cwd: f.missing, agentPreset: 'demo' } })
  const abort = new AbortController(); abort.abort()
  await assert.rejects(f.service.recover(empty.id, { path: f.target, sequence: empty.seq }, abort.signal))
  assert.equal(f.created.length, 0)
  const result = await f.service.recover(empty.id, { path: f.target, sequence: empty.seq }, f.signal)
  assert.ok(result.sessionId); assert.equal(f.created[0]?.inheritedEventCount, 0)
  f.source.append('turn/start', { turn: 2 })
  await assert.rejects(f.service.recover(f.source.id, f.input(), f.signal), /WORKBENCH_DIRECTORY_BUSY/)
})

test('文件入口和 Git 入口把缺失、目录变文件和父级变文件转换为可恢复错误', async t => {
  const f = await fixture(t), api = new SuperCodeWorkbench(f.ctx)
  await assert.rejects(api.list(f.source.id, '', f.signal), /WORKBENCH_DIRECTORY_MISSING/)
  await assert.rejects(Array.fromAsync(api.git(f.source.id, JSON.stringify({ action: 'status' }), f.signal)), /WORKBENCH_DIRECTORY_MISSING/)
  await fs.writeFile(f.missing, 'no longer a directory')
  assert.equal((await f.service.status(f.source.id, f.signal)).state, 'missing')
  await assert.rejects(api.list(f.source.id, '', f.signal), /WORKBENCH_DIRECTORY_MISSING/)
  const nested = f.ctx.sessions.create(SessionId('nested-missing'), { meta: { cwd: join(f.missing, 'child') } })
  await assert.rejects(api.list(nested.id, '', f.signal), /WORKBENCH_DIRECTORY_MISSING/)
})
