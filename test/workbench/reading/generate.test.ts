import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { generateReading } from '../../../src/workbench/reading/generate.js'
import { parseReadingRequest } from '../../../src/workbench/reading/types.js'
import { readingFixture } from './fixture.js'

const model = { provider: 'fixture', model: 'chosen' }, signal = new AbortController().signal
const planInput = parseReadingRequest({ kind: 'plan', goal: '读懂金额计算', locale: 'zh', buffers: [] })
const ref = { source: 'S1', fromLine: 1, toLine: 1 }
const plan = { kind: 'plan', title: '金额', summary: '入口调用计算函数', steps: [{ title: '计算', reason: '看金额变化', refs: [ref] }] }
const section = { kind: 'section', title: '计算', text: '返回含税金额。', refs: [ref] }
function response(value: unknown, stop = true) {
  return (async function* (): AsyncGenerator<StreamChunk> {
    const text = JSON.stringify(value)
    yield { type: 'text-delta', index: 0, text: text.slice(0, 12) }
    yield { type: 'text-delta', index: 0, text: text.slice(12) + '\n' }
    if (stop) yield { type: 'finish', reason: { kind: 'stop' } }
  })()
}

test('目标规划按请求补读实际文件，并保持所选模型及主会话隔离', async t => {
  const { root, files } = await readingFixture(t)
  await writeFile(join(root, 'price.ts'), 'export const price = 1;\n')
  const requests: GenerateOptions[] = []
  const llm = (request: GenerateOptions) => {
    requests.push(request)
    return response(requests.length === 1 ? { kind: 'read', ranges: [{ file: 'price.ts', fromLine: 1, toLine: 1 }], queries: [] } : plan)
  }
  const result = await Array.fromAsync(generateReading(files, 's', planInput, model, llm, signal))
  assert.equal(requests.length, 2)
  assert.equal(requests[0]!.model, 'chosen'); assert.equal(requests[0]!.sessionId, undefined); assert.equal(requests[0]!.tools, undefined)
  const event = result.find(event => event.kind === 'plan')
  assert.ok(event?.kind === 'plan')
  assert.equal(event.plan.steps[0]!.refs[0]!.quote, 'export const price = 1;')
  assert.equal(result.at(-1)!.kind, 'done')
})

test('分段解释在模型结束前逐段出现，结束异常不能成为完整结果', async t => {
  const { root, files } = await readingFixture(t)
  await writeFile(join(root, 'price.ts'), 'export const price = 1;\n')
  const input = parseReadingRequest({ ...planInput, kind: 'explain', file: 'price.ts' })
  const iterator = generateReading(files, 's', input, model, () => response(section, false), signal)
  let seen = false
  await assert.rejects(async () => { for await (const event of iterator) { if (event.kind === 'section') seen = true; assert.notEqual(event.kind, 'done') } }, /WORKBENCH_MODEL_INCOMPLETE/)
  assert.equal(seen, true)
})

test('未读、越界引用和错误任务类型均拒绝，不展示虚构路径', async t => {
  const { root, files } = await readingFixture(t)
  await writeFile(join(root, 'price.ts'), 'export const price = 1;\n')
  const input = parseReadingRequest({ ...planInput, kind: 'explain', file: 'price.ts' })
  for (const invalid of [{ ...section, refs: [{ ...ref, source: 'S99' }] }, { ...section, refs: [{ ...ref, toLine: 99 }] }, plan]) {
    await assert.rejects(Array.fromAsync(generateReading(files, 's', input, model, () => response(invalid), signal)), /READING_REFERENCE|READING_FORMAT/)
  }
})

test('空项目、空输出、循环读取和取消均明确失败', async t => {
  const { root, files } = await readingFixture(t)
  await assert.rejects(Array.fromAsync(generateReading(files, 's', planInput, model, () => response(plan), signal)), /READING_EMPTY/)
  await writeFile(join(root, 'price.ts'), 'const price = 1;')
  const empty = async function* (): AsyncGenerator<StreamChunk> { yield { type: 'finish', reason: { kind: 'stop' } } }
  await assert.rejects(Array.fromAsync(generateReading(files, 's', planInput, model, empty, signal)), /WORKBENCH_MODEL_EMPTY/)
  const repeat = () => response({ kind: 'read', ranges: [{ file: 'price.ts', fromLine: 1, toLine: 1 }], queries: [] })
  await assert.rejects(Array.fromAsync(generateReading(files, 's', planInput, model, repeat, signal)), /READING_CONTEXT_LIMIT/)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(Array.fromAsync(generateReading(files, 's', planInput, model, repeat, abort.signal)))
})

test('解释已读段落后可以补读再继续，后续请求保留已讲内容', async t => {
  const { root, files } = await readingFixture(t)
  await writeFile(join(root, 'price.ts'), 'export const price = 1;\nconst next = price;\n')
  const input = parseReadingRequest({ ...planInput, kind: 'explain', file: 'price.ts' })
  let calls = 0
  const stream = async function* (options: GenerateOptions): AsyncGenerator<StreamChunk> {
    calls++
    if (calls === 1) {
      yield { type: 'text-delta', index: 0, text: JSON.stringify(section) + '\n' + JSON.stringify({ kind: 'read', ranges: [{ file: 'price.ts', fromLine: 2, toLine: 2 }], queries: [] }) + '\n' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } else {
      assert.match(JSON.stringify(options.messages), /completedSections/)
      yield* response({ ...section, title: '使用', refs: [{ source: 'S2', fromLine: 2, toLine: 2 }] })
    }
  }
  const events = await Array.fromAsync(generateReading(files, 's', input, model, stream, signal))
  assert.equal(events.filter(event => event.kind === 'section').length, 2)
  assert.equal(events.at(-1)!.kind, 'done')
})

test('无效 JSON、输出超限和结束后的额外内容都不能成为完整结果', async t => {
  const { root, files } = await readingFixture(t)
  await writeFile(join(root, 'price.ts'), 'const value = 1;')
  const input = parseReadingRequest({ ...planInput, kind: 'explain', file: 'price.ts' })
  for (const text of ['{ invalid json', 'x'.repeat(128 * 1024 + 1)]) {
    const stream = async function* (): AsyncGenerator<StreamChunk> { yield { type: 'text-delta', index: 0, text }; yield { type: 'finish', reason: { kind: 'stop' } } }
    await assert.rejects(Array.fromAsync(generateReading(files, 's', input, model, stream, signal)), /READING_FORMAT|WORKBENCH_OUTPUT_SIZE/)
  }
  const late = async function* (): AsyncGenerator<StreamChunk> { yield* response(section); yield { type: 'text-delta', index: 0, text: JSON.stringify(section) } }
  await assert.rejects(Array.fromAsync(generateReading(files, 's', input, model, late, signal)), /READING_FORMAT/)
})
