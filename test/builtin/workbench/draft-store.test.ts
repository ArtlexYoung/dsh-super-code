import test from 'node:test'
import assert from 'node:assert/strict'
import { draftRecord, MAX_DRAFT_BYTES } from '../../../builtin/workbench/draft-store.js'

const entry = { path: 'src/main.ts', text: '草稿', original: 'original', diskVersion: 'v1' }
test('恢复副本保留正文和磁盘基线，容量按 UTF-8 字节计算', () => {
  const record = draftRecord([entry], 2)
  assert.equal(record.revision, 3)
  assert.deepEqual(record.entries, [entry])
  assert.equal(record.bytes, new TextEncoder().encode(JSON.stringify(record.entries)).length)
})
test('拒绝非项目路径、重复路径、损坏正文及过量副本', () => {
  for (const path of ['/etc/test', '../test', 'a/../test', 'C:\\test', 'a\\b', 'a\0b']) assert.throws(() => draftRecord([{ ...entry, path }], 0), /WORKBENCH_DRAFT_INVALID/)
  assert.throws(() => draftRecord([entry, entry], 0), /WORKBENCH_DRAFT_INVALID/)
  assert.throws(() => draftRecord([{ ...entry, text: null }], 0), /WORKBENCH_DRAFT_INVALID/)
  assert.throws(() => draftRecord(Array.from({ length: 101 }, (_, index) => ({ ...entry, path: `${index}.ts` })), 0), /WORKBENCH_DRAFT_SIZE/)
  assert.throws(() => draftRecord([{ ...entry, text: '中'.repeat(Math.ceil(MAX_DRAFT_BYTES / 3)) }], 0), /WORKBENCH_DRAFT_SIZE/)
})
