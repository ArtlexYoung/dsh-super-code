import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { actionHelp, prepareMemoryRecord } from '../../src/dsh/tool-contracts.js'

test('memory help describes source variants accepted by the actual tool', () => {
  const help = JSON.parse(actionHelp('super_code_memory', 'remember'))
  const declared = z.fromJSONSchema(help.recordSchema)
  const cases = [
    { kind: 'user', eventSeq: 1, quote: '保留用户改动' },
    { kind: 'user', eventSeq: 1 },
    { kind: 'user', eventSeq: 1, quote: '保留用户改动', callSeq: 0 },
    { kind: 'tool', eventSeq: 2, callSeq: 1 },
    { kind: 'tool', eventSeq: 2, callSeq: 1, quote: 'VALUE=42' },
    { kind: 'tool', eventSeq: 2 },
    { kind: 'manual' },
    { kind: 'unknown', eventSeq: 2 },
    null, [], undefined,
  ]
  for (const source of cases) {
    const record = { expectedRevision: 0, entries: [{ id: 'observed',
      kind: source?.kind === 'user' ? 'constraint' : 'fact', summary: '观察值', detail: 'VALUE=42',
      sourceVersion: 'input-v1', source }] }
    let accepted = false
    try { accepted = Boolean(prepareMemoryRecord({ action: 'remember', record }, 'session').remember) } catch {}
    assert.equal(declared.safeParse(record).success, accepted, JSON.stringify(source))
  }
})
