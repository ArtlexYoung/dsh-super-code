import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTranslation, translationRequest } from '../../src/workbench/translation.js'
import { resolveWorkbenchModel } from '../../src/workbench/model.js'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'

const signal = new AbortController().signal
const input = { instruction: '翻译“Calculate the total.”为中文', history: [] }

test('翻译只发送简单用户文本，不携带系统提示、源码、工具或主会话', () => {
  const request = translationRequest(parseTranslation(input), { provider: 'demo', model: 'small', reasoningEffort: ReasoningEffortId('off') }, signal)
  assert.equal(request.messages.length, 1)
  assert.deepEqual(request.messages[0]?.content, [{ type: 'text', text: input.instruction }])
  for (const field of ['system', 'tools', 'sessionId']) assert.equal(request[field as keyof typeof request], undefined)
  assert.equal(request.reasoningEffort, 'off')
})

test('翻译追问只包含该翻译历史，不修改当前会话的模型', () => {
  const history = [{ role: 'user', text: input.instruction }, { role: 'assistant', text: '计算总额。' }]
  const request = translationRequest(parseTranslation({ instruction: '更口语一点', history, model: { provider: 'demo', model: 'configured' } }), { provider: 'demo', model: 'configured' }, signal)
  assert.equal(request.model, 'configured')
  assert.equal(request.messages.length, 3)
  assert.deepEqual(request.messages.at(-1)?.content, [{ type: 'text', text: '更口语一点' }])
})

test('翻译拒绝空输入、额外上下文、非法模型和过长历史', () => {
  for (const patch of [{ instruction: '' }, { instruction: ' ' }, { text: 'private source' }, { system: 'injected' }, { model: { provider: '', model: 'x' } }, { model: { provider: 'demo', model: 'x', secret: 'no' } }, { reasoningEffort: '' }, { reasoningEffort: 'x'.repeat(257) }, { history: Array(41).fill({ role: 'user', text: 'x' }) }]) assert.throws(() => parseTranslation({ ...input, ...patch }))
})

test('根据宿主能力关闭思考，不把低思考冒充关闭', async () => {
  const current = { provider: 'demo', model: 'current', reasoningEffort: ReasoningEffortId('high') }
  const resolveModelInfo = async (_provider: string, model: string) => ({ provider: 'demo', id: model, name: model, reasoning: { efforts: [ReasoningEffortId(model === 'none-model' ? 'none' : 'off')].map(id => ({ id, name: id })) } })
  assert.deepEqual(await resolveWorkbenchModel({ resolveModelInfo }, current, signal), { provider: 'demo', model: 'current', reasoningEffort: 'off' })
  assert.equal(current.reasoningEffort, 'high')
  assert.equal((await resolveWorkbenchModel({ resolveModelInfo }, { provider: 'demo', model: 'none-model' }, signal)).reasoningEffort, 'none')
  assert.deepEqual(await resolveWorkbenchModel({ resolveModelInfo: async () => ({ provider: 'demo', id: 'plain', name: 'Plain' }) }, { provider: 'demo', model: 'plain' }, signal), { provider: 'demo', model: 'plain' })
  await assert.rejects(resolveWorkbenchModel({ resolveModelInfo: async () => ({ provider: 'demo', id: 'fixed', name: 'Fixed', reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] } }) }, current, signal), /WORKBENCH_TRANSLATION_THINKING/)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(resolveWorkbenchModel({ resolveModelInfo }, current, abort.signal))
})

test('明确选择思考等级时只接受该模型的真实能力，无思考模型不接受高等级', async () => {
  const current = { provider: 'demo', model: 'fixed' }
  const llm = { resolveModelInfo: async () => ({ ...current, id: 'fixed', name: 'Fixed', reasoning: { efforts: [{ id: ReasoningEffortId('custom-deep'), name: 'Deep' }] } }) }
  assert.deepEqual(await resolveWorkbenchModel(llm, current, signal, 'custom-deep'), { ...current, reasoningEffort: 'custom-deep' })
  await assert.rejects(resolveWorkbenchModel(llm, current, signal, 'high'), /WORKBENCH_MODEL_SETTING/)
  await assert.rejects(resolveWorkbenchModel({ resolveModelInfo: async () => ({ ...current, id: 'fixed', name: 'Plain' }) }, current, signal, 'high'), /WORKBENCH_MODEL_SETTING/)
})
