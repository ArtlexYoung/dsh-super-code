import test from 'node:test'
import assert from 'node:assert/strict'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { parseAssistant, assistantRequest, assistantResponse } from '../../src/workbench/assistant.js'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { SuperCodeWorkbench } from '../../src/dsh/workbench.js'

const input = { file: 'main.ts', text: 'const value = 1;', from: 6, to: 11, mode: 'edit', instruction: '改名为 count', history: [] }
const signal = new AbortController().signal
async function* stream(...chunks: StreamChunk[]) { yield* chunks }

test('宿主把选区助手公开为可取消的逻辑流', async () => {
  const ctx = new Context()
  ctx.provide('fs', {})
  const remote = new SuperCodeWorkbench(ctx)
  assert.equal(remoteMethods(remote).find(method => method.method === 'assist')?.mode, 'stream')
  await ctx.fiber.dispose()
})

test('选区助手验证边界、空白要求和未知字段', () => {
  for (const patch of [{ from: -1 }, { to: 99 }, { to: 6 }, { instruction: ' ' }, { mode: 'execute' }, { provider: 'injected' }]) {
    assert.throws(() => parseAssistant({ ...input, ...patch }))
  }
})

test('选区助手复用给定路由，只传显式源码与消息，不提供工具或改变主会话', () => {
  const request = assistantRequest(parseAssistant(input), { provider: 'fixture', model: 'selected' }, signal)
  assert.equal(request.provider, 'fixture'); assert.equal(request.model, 'selected')
  assert.equal(request.tools, undefined); assert.equal(request.sessionId, undefined)
  const text = request.messages.at(-1)!.content[0]
  assert.equal(text?.type, 'text')
  if (text?.type === 'text') assert.equal(JSON.parse(text.text).selection.text, 'value')
})

test('助手仅在完整正常结束时接受修改，空替换允许删除选区', async () => {
  assert.deepEqual(await assistantResponse(stream({ type: 'finish', reason: { kind: 'stop' } }), 'edit', signal), { kind: 'edit', replacement: '' })
  assert.deepEqual(await assistantResponse(stream({ type: 'text-delta', index: 0, text: '```ts\ncount\n```' }, { type: 'finish', reason: { kind: 'stop' } }), 'edit', signal), { kind: 'edit', replacement: 'count' })
  for (const tail of [[], [{ type: 'finish', reason: { kind: 'max-tokens' } }]]) {
    await assert.rejects(assistantResponse(stream({ type: 'text-delta', index: 0, text: 'partial' }, ...tail as StreamChunk[]), 'edit', signal), /WORKBENCH_MODEL_INCOMPLETE/)
  }
  await assert.rejects(assistantResponse(stream({ type: 'finish', reason: { kind: 'stop' } }), 'ask', signal), /WORKBENCH_MODEL_EMPTY/)
})

test('取消请求和过长输出均不会成为有效修改', async () => {
  const abort = new AbortController(); abort.abort()
  await assert.rejects(assistantResponse(stream({ type: 'finish', reason: { kind: 'stop' } }), 'edit', abort.signal))
  await assert.rejects(assistantResponse(stream({ type: 'text-delta', index: 0, text: 'x'.repeat(256 * 1024 + 1) }), 'edit', signal), /WORKBENCH_OUTPUT_SIZE/)
})
