import test from 'node:test'
import assert from 'node:assert/strict'
import { longMemoryEntrySchema } from '../../src/long-memory.js'
import { taskMemoryPatchSchema } from '../../src/core/task-memory.js'

for (const kind of ['memory', 'task'] as const) test(`${kind} 摘要保留码点、空白和非法输入的边界`, () => {
  const parse = (summary: unknown) => kind === 'memory'
    ? longMemoryEntrySchema.safeParse({ id: 'item', kind: 'constraint', summary, detail: '保留修改',
      source: { kind: 'user', sessionId: 'source', eventSeq: 0, quote: '保留修改' } })
    : taskMemoryPatchSchema.safeParse({ keyPoints: [{ kind: 'fact', summary }] })
  for (const summary of ['中'.repeat(30), '😀'.repeat(30), 'e\u0301'.repeat(15), '\ud800'.repeat(30), ' '.repeat(15000) + '保留']) {
    assert.equal(parse(summary).success, true)
  }
  for (const summary of ['', ' \n\t ', '中'.repeat(31), '😀'.repeat(31), 'e\u0301'.repeat(16), '\ud800'.repeat(31), 'x'.repeat(15000), null, 30]) {
    assert.equal(parse(summary).success, false)
  }
})
