import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

let plugin: any
runInNewContext(readFileSync(new URL('../../dist/client.js', import.meta.url), 'utf8'), {
  URL,
  __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((id: string) => id === 'react' ? { forwardRef: () => 'button' } : {}) } },
})
const record = (seq: number, type: string, data: object) => plugin.detailRecord({ event: { seq, type, data, time: 1700000000000 + seq } })
const call = (seq: number, name: string, callId: string, step = 1) => record(seq, 'tool/call', { turn: 1, step, name, callId, arguments: '{}' })
const result = (seq: number, callId: string, isError = false, step = 1) => record(seq, 'tool/result', { turn: 1, step, message: { role: 'tool', toolCallId: callId, isError, content: [] } })

test('连续工具记录归并成一行，调用和返回只计一次，失败与运行分别保留', () => {
  const rows = plugin.workbenchConversationRows([call(1, 'read', 'a'), result(2, 'a'), call(3, 'read', 'b'), result(4, 'b', true), call(5, 'bash', 'c')])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'tools')
  assert.equal(rows[0].items.length, 5)
  assert.equal(JSON.stringify(rows[0].tools), JSON.stringify([
    { tool: 'read', succeeded: 1, failed: 1, running: false }, { tool: 'bash', succeeded: 0, failed: 0, running: true },
  ]))
})

test('不同步骤的同名调用 ID 不混合，普通回复和问题保持原顺序', () => {
  const user = record(1, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '问题' }] })
  const assistant = record(6, 'assistant/message', { message: { content: [{ type: 'text', text: '回复' }] } })
  const rows = plugin.workbenchConversationRows([user, call(2, 'read', 'same'), result(3, 'same'), call(4, 'read', 'same', 2), result(5, 'same', true, 2), assistant])
  assert.equal(rows.map((row: any) => row.kind).join(','), 'message,tools,message')
  assert.equal(rows[0].record.seq, 1)
  assert.equal(rows[2].record.seq, 6)
  assert.equal(rows[1].tools[0].succeeded, 1)
  assert.equal(rows[1].tools[0].failed, 1)
})

test('PTC 子调用与批量工具返回按各自身份计数，空结果仍能结束运行状态', () => {
  const rows = plugin.workbenchConversationRows([
    call(1, 'bash', 'a'), call(2, 'read', 'b'),
    record(3, 'tool/result', { turn: 1, step: 1, message: { content: [
      { type: 'tool-result', toolCallId: 'a', isError: false, content: [] },
      { type: 'tool-result', toolCallId: 'b', isError: true, content: [] },
    ] } }),
    record(4, 'tool/ptc-dispatch-start', { turn: 1, step: 1, parentCallId: 'parent', subCallId: 'a', name: 'read', arguments: {} }),
    record(5, 'tool/ptc-dispatch', { turn: 1, step: 1, parentCallId: 'parent', subCallId: 'a', name: 'read', isError: false, content: [] }),
  ])
  assert.equal(JSON.stringify(rows[0].tools), JSON.stringify([
    { tool: 'bash', succeeded: 1, failed: 0, running: false }, { tool: 'read', succeeded: 1, failed: 1, running: false },
  ]))
})

test('只有返回的历史片段保留真实工具状态，不把一般错误折叠进工具', () => {
  const rows = plugin.workbenchConversationRows([result(1, 'unknown', true), record(2, 'turn/error', { message: 'broken' })])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].tools[0].failed, 1)
  assert.equal(rows[1].record.kind, 'error')
  assert.equal(plugin.workbenchConversationRows([]).length, 0)
})

test('跨回复的返回更新原调用，不重复计数；重复返回也不会增加次数', () => {
  const reply = record(2, 'assistant/message', { message: { content: [{ type: 'text', text: '等待结果' }] } })
  const rows = plugin.workbenchConversationRows([call(1, 'read', 'a'), reply, result(3, 'a'), result(4, 'a')])
  assert.equal(rows.length, 3)
  assert.equal(rows[0].tools[0].succeeded, 1)
  assert.equal(rows[0].tools[0].running, false)
  assert.equal(rows[2].tools.length, 0)
  assert.equal(rows[2].items.length, 2)
})

test('不同轮次复用调用 ID 不混合', () => {
  const rows = plugin.workbenchConversationRows([call(1, 'read', 'a'), result(2, 'a'),
    record(3, 'tool/call', { turn: 2, step: 1, name: 'read', callId: 'a', arguments: '{}' }),
    record(4, 'tool/result', { turn: 2, step: 1, message: { role: 'tool', toolCallId: 'a', content: [] } })])
  assert.equal(rows[0].tools[0].succeeded, 2)
})

test('日志检查器保留空工具返回，用于结束运行状态；无显示内容的其他事件仍跳过', () => {
  let publish: any
  const inspector = plugin.createAgentInspector((_address: unknown, options: any) => {
    publish = options.publish
    return { open: async () => {}, dispose: async () => {} }
  }, 'dsh-resource://super-agent/demo', async () => {})
  publish({ type: 'replace', entries: [call(1, 'read', 'a').entry], page: {}, hasMore: false })
  publish({ type: 'append', entry: result(2, 'a').entry })
  publish({ type: 'append', entry: { event: { type: 'assistant/chunk', data: {}, seq: 3 } } })
  assert.equal(inspector.getSnapshot().items.length, 2)
  assert.equal(plugin.workbenchConversationRows(inspector.getSnapshot().items)[0].tools[0].running, false)
  inspector.dispose()
})
