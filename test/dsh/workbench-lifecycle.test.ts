import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import LocalFS from '@deepseek-ai/dsh-fs-local'
import { SuperCodeWorkbench } from '../../src/dsh/workbench.js'
import { validationRoot } from '../validation-root.js'

async function fixture(t: TestContext, action: 'list' | 'read' | 'save' | 'project' | 'assist' | 'root') {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'workbench-unload-')), ctx = new Context()
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  t.after(async () => { release.resolve(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  new SessionStore(ctx)
  await ctx.plugin(LocalFS, { cwd: root, diffBasisMaxBytes: 1024 })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) })
  await writeFile(join(root, 'main.ts'), 'const value = 1\n')
  const session = ctx.sessions.create(SessionId('unload'), { meta: { cwd: root } })
  let modelCalls = 0
  ctx.provide('llm', { async *stream() { modelCalls++; throw new Error('不得触发模型') } })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'fixture', model: 'fixture' }) })
  let api!: SuperCodeWorkbench
  const feature = ctx.plugin({ inject: ['fs', 'sessions', 'llm', 'agentDefaultModel'], apply(owner: Context) { api = new SuperCodeWorkbench(owner) } })
  await feature
  const caller = new AbortController(), signal = caller.signal, original = await api.read(session.id, 'main.ts', signal)
  let armed = true
  const wait = async () => {
    if (armed) { armed = false; entered.resolve(); await release.promise }
  }
  if (action === 'root') {
    const resolve = ctx.fs.resolve.bind(ctx.fs)
    ctx.fs.resolve = async (...args: Parameters<typeof resolve>) => { await wait(); return resolve(...args) }
  } else if (action === 'save') {
    const write = ctx.fs.writeText.bind(ctx.fs)
    ctx.fs.writeText = async (...args: Parameters<typeof write>) => { await wait(); return write(...args) }
  } else if (action === 'read' || action === 'assist') {
    const read = ctx.fs.readBytes.bind(ctx.fs)
    ctx.fs.readBytes = async (...args: Parameters<typeof read>) => { await wait(); return read(...args) }
  } else {
    const list = ctx.fs.listDir.bind(ctx.fs)
    ctx.fs.listDir = async (...args: Parameters<typeof list>) => { await wait(); return list(...args) }
  }
  return { root, session, api, feature, caller, signal, original, entered, release, modelCalls: () => modelCalls }
}

for (const action of ['list', 'read', 'save', 'project', 'assist', 'root'] as const) {
  for (const unload of [false, true]) test(`${unload ? '卸载工作台' : '调用方取消'}会取消正在执行的 ${action} 请求，不继续读取或保存`, async t => {
    const f = await fixture(t, action)
    const waiting = action === 'list' ? f.api.list(f.session.id, '', f.signal)
      : action === 'read' ? f.api.read(f.session.id, 'main.ts', f.signal)
      : action === 'save' ? f.api.save(f.session.id, JSON.stringify({ ...f.original, text: 'changed\n' }), f.signal)
      : action === 'project' ? f.api.project(f.session.id, f.signal)
      : action === 'root' ? f.api.list(f.session.id, '', f.signal)
      : (async () => {
        for await (const _result of f.api.assist(f.session.id, JSON.stringify({ file: 'main.ts', text: f.original.text,
          from: 0, to: 5, mode: 'ask', instruction: '解释选区', history: [] }), f.signal)) {}
      })()
    const result = waiting.then(value => ({ value }), error => ({ error }))
    await f.entered.promise
    if (unload) await f.feature.dispose()
    else f.caller.abort()
    f.release.resolve()
    const outcome = await result
    assert.equal(await readFile(join(f.root, 'main.ts'), 'utf8'), f.original.text)
    assert.ok('error' in outcome, `${action} 在取消后仍成功`)
    assert.ok(outcome.error?.name === 'AbortError' || outcome.error?.code === 'FS_ABORTED', String(outcome.error))
    assert.equal(f.session.seq, 0)
    assert.equal(f.modelCalls(), 0)
  })
}
