import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import LocalFS from '@deepseek-ai/dsh-fs-local'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import { SuperCodeWorkbench } from '../../src/dsh/workbench.js'
import { validationRoot } from '../validation-root.js'

async function fixture(t: any, efforts = ['off', 'high']) {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'workbench-quick-model-')), ctx = new Context(), requests: any[] = []
  new SessionStore(ctx)
  await ctx.plugin(LocalFS, { cwd: root, diffBasisMaxBytes: 1024 })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) })
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const text = 'const value = 1;'
  await writeFile(join(root, 'main.ts'), text)
  const session = ctx.sessions.create(SessionId('quick'), { meta: { cwd: root } })
  const selected = { provider: 'demo', model: 'current', reasoningEffort: ReasoningEffortId('high') }
  ctx.provide('agentDefaultModel', { currentSelection: () => selected })
  ctx.provide('llm', {
    resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: 'Demo', reasoning: { efforts: efforts.map(id => ({ id: ReasoningEffortId(id), name: id })) } }),
    async *stream(options: any) { requests.push(options); yield { type: 'text-delta', index: 0, text: options.system.includes('只返回') ? 'count' : '这是变量名。' }; yield { type: 'finish', reason: { kind: 'stop' } } },
  })
  const service = new SuperCodeWorkbench(ctx), signal = new AbortController().signal
  const input = { file: 'main.ts', text, from: 6, to: 11, mode: 'ask', instruction: '解释选区', history: [] }
  return { ctx, requests, selected, session, service, signal, input }
}

test('快速对话提问与修改默认关闭思考，保持主对话模型和会话记录', async t => {
  const f = await fixture(t), before = f.session.snapshotEvents()
  for (const mode of ['ask', 'edit']) {
    const results = await Array.fromAsync(f.service.assist(f.session.id, JSON.stringify({ ...f.input, mode }), f.signal))
    assert.equal(results.length, 1)
    assert.equal(f.requests.at(-1).reasoningEffort, 'off')
    assert.equal(f.requests.at(-1).model, 'current')
    assert.equal(f.requests.at(-1).tools, undefined)
  }
  assert.deepEqual(f.session.snapshotEvents(), before)
  assert.equal(f.selected.reasoningEffort, 'high')
})

test('快速对话不能关闭思考时明确报错，非法或已取消的请求不调用模型', async t => {
  const f = await fixture(t, ['high'])
  const consume = (value: unknown, signal = f.signal) => Array.fromAsync(f.service.assist(f.session.id, JSON.stringify(value), signal))
  await assert.rejects(consume(f.input), /WORKBENCH_TRANSLATION_THINKING/)
  await assert.rejects(consume({ ...f.input, from: -1 }))
  const abort = new AbortController(); abort.abort()
  await assert.rejects(consume(f.input, abort.signal), { name: 'AbortError' })
  assert.equal(f.requests.length, 0)
})

test('快速对话模型与思考选择实际用于提问和修改，不写回主会话', async t => {
  const f = await fixture(t), before = f.session.snapshotEvents()
  for (const mode of ['ask', 'edit']) {
    await Array.fromAsync(f.service.assist(f.session.id, JSON.stringify({ ...f.input, mode, model: { provider: 'other', model: 'configured' }, reasoningEffort: 'high' }), f.signal))
    assert.equal(f.requests.at(-1).provider, 'other')
    assert.equal(f.requests.at(-1).model, 'configured')
    assert.equal(f.requests.at(-1).reasoningEffort, 'high')
  }
  await assert.rejects(Array.fromAsync(f.service.assist(f.session.id, JSON.stringify({ ...f.input, reasoningEffort: 'unknown' }), f.signal)), /WORKBENCH_MODEL_SETTING/)
  assert.equal(f.requests.length, 2)
  assert.deepEqual(f.session.snapshotEvents(), before)
  assert.equal(f.selected.model, 'current')
})

test('模型能力解析期间取消或卸载不继续发送快速请求', async t => {
  for (const unload of [false, true]) {
    const f = await fixture(t), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), abort = new AbortController()
    f.ctx.llm.resolveModelInfo = async () => { entered.resolve(); await release.promise; return { provider: 'demo', id: 'current', name: 'Demo' } }
    const running = Array.fromAsync(f.service.assist(f.session.id, JSON.stringify(f.input), abort.signal))
    await entered.promise
    if (unload) await f.ctx.fiber.dispose()
    else abort.abort()
    release.resolve()
    await assert.rejects(running, { name: 'AbortError' })
    assert.equal(f.requests.length, 0)
  }
})
