import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import { SuperCodeWorkbench } from '../../src/dsh/workbench.js'

async function fixture(t: any) {
  const ctx = new Context(), requests: any[] = []
  new SessionStore(ctx)
  const session = ctx.sessions.create(SessionId('translation'), {})
  const selected = { provider: 'demo', model: 'current', reasoningEffort: ReasoningEffortId('high') }
  ctx.provide('fs', { readText() { throw new Error('translation must not read source') } })
  ctx.provide('agentDefaultModel', { currentSelection: () => selected })
  ctx.provide('llm', {
    listProviders: () => [{ id: 'demo', name: 'Demo' }],
    listModels: async () => [{ id: 'small', name: 'Small' }],
    resolveModelInfo: async (_provider: string, model: string) => ({ provider: 'demo', id: model, name: model, reasoning: { efforts: ['off', 'high'].map(id => ({ id: ReasoningEffortId(id), name: id })), defaultEffort: ReasoningEffortId('high') }, privateConfig: 'must not escape' }),
    async *stream(options: any) { requests.push(options); yield { type: 'text-delta', index: 0, text: '计算总额。' }; yield { type: 'finish', reason: { kind: 'stop' } } },
  })
  const service = new SuperCodeWorkbench(ctx), signal = new AbortController().signal
  t.after(() => ctx.fiber.dispose())
  return { ctx, requests, session, selected, service, signal }
}

test('翻译 Remote 默认使用当前模型并关闭思考，不读取文件或修改会话', async t => {
  const { requests, session, selected, service, signal } = await fixture(t)
  const before = session.seq, input = { instruction: '翻译“Calculate total.”为中文', history: [] }
  for await (const result of service.translate(session.id, JSON.stringify(input), signal)) assert.deepEqual(result, { kind: 'ask', text: '计算总额。' })
  assert.equal(requests[0].model, 'current'); assert.equal(requests[0].reasoningEffort, 'off')
  assert.equal(requests[0].system, undefined); assert.equal(requests[0].tools, undefined)
  assert.equal(requests[0].messages.length, 1)
  assert.equal(session.seq, before); assert.equal(selected.reasoningEffort, 'high')
})

test('翻译 Remote 使用明确配置的模型，模型菜单只返回展示字段', async t => {
  const { requests, session, service, signal } = await fixture(t)
  for await (const _result of service.translate(session.id, JSON.stringify({ instruction: '翻译“Total”为中文', history: [], model: { provider: 'demo', model: 'small' } }), signal)) {}
  assert.equal(requests[0].model, 'small')
  assert.deepEqual(await service.models(session.id, signal), [
    { provider: 'demo', model: 'small', name: 'Demo · Small', current: false, efforts: [{ id: 'off', name: 'off' }, { id: 'high', name: 'high' }] },
    { provider: 'demo', model: 'current', name: 'Demo · current', current: true, efforts: [{ id: 'off', name: 'off' }, { id: 'high', name: 'high' }] },
  ])
})

test('翻译允许独立选择思考等级，非法等级不发送请求，仍无源码和系统提示', async t => {
  const { requests, session, selected, service, signal } = await fixture(t)
  const input = { instruction: '翻译“Total”为中文', history: [], model: { provider: 'demo', model: 'small' }, reasoningEffort: 'high' }
  await Array.fromAsync(service.translate(session.id, JSON.stringify(input), signal))
  assert.equal(requests[0].model, 'small'); assert.equal(requests[0].reasoningEffort, 'high')
  assert.equal(requests[0].system, undefined); assert.equal(requests[0].tools, undefined)
  await assert.rejects(Array.fromAsync(service.translate(session.id, JSON.stringify({ ...input, reasoningEffort: 'unknown' }), signal)), /WORKBENCH_MODEL_SETTING/)
  assert.equal(requests.length, 1); assert.equal(selected.model, 'current')
})

test('全局模型目录无需对话，返回真实等级并标识当前默认模型，不创建或修改会话', async t => {
  const { ctx, session, selected, service, signal } = await fixture(t)
  const before = session.snapshotEvents()
  selected.model = 'small'
  const result = await service.models('', signal)
  assert.deepEqual(result, [{ provider: 'demo', model: 'small', name: 'Demo · Small', current: true, efforts: [{ id: 'off', name: 'off' }, { id: 'high', name: 'high' }] }])
  assert.equal(ctx.sessions.list().length, 1)
  assert.deepEqual(session.snapshotEvents(), before)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(service.models('', abort.signal), { name: 'AbortError' })
})

test('模型目录取消或卸载后不再解析其他模型，错误可重试', async t => {
  for (const unload of [false, true]) {
    const f = await fixture(t), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), abort = new AbortController()
    let calls = 0
    f.ctx.llm.listModels = async () => [{ provider: 'demo', id: 'first', name: 'First' }, { provider: 'demo', id: 'second', name: 'Second' }]
    f.ctx.llm.resolveModelInfo = async (_provider, model) => { calls++; entered.resolve(); await release.promise; return { provider: 'demo', id: model, name: model } }
    const running = f.service.models('', abort.signal)
    await entered.promise
    if (unload) await f.ctx.fiber.dispose()
    else abort.abort()
    release.resolve()
    await assert.rejects(running, { name: 'AbortError' })
    assert.equal(calls, 1)
    if (!unload) assert.equal((await f.service.models('', f.signal)).length, 3)
  }
})

test('翻译 Remote 验证会话、输入及取消，不把错误请求发给模型', async t => {
  const { requests, service, session, signal } = await fixture(t)
  async function consume(id: string, input: string, cancel = signal) { for await (const _result of service.translate(id, input, cancel)) {} }
  await assert.rejects(consume('missing', JSON.stringify({ instruction: 'hello', history: [] })), /WORKBENCH_SESSION/)
  for (const input of ['bad json', '{}', JSON.stringify({ instruction: 'hello', history: [], context: 'injected' })]) await assert.rejects(consume(session.id, input))
  const abort = new AbortController(); abort.abort()
  await assert.rejects(consume(session.id, JSON.stringify({ instruction: 'hello', history: [] }), abort.signal))
  assert.equal(requests.length, 0)
})
