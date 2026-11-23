import test from 'node:test'
import assert from 'node:assert/strict'
import { createDraftRecovery } from '../../../builtin/workbench/draft-recovery.js'
import { createBuffer } from '../../../builtin/workbench/buffer.js'
import { draftRecord } from '../../../builtin/workbench/draft-store.js'

test('退出时正在写入的备份完成后仍保留最后输入，不被清空的项目缓冲覆盖', async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: new EventTarget() })
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window')
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document')
  })
  const owner = Symbol(), documents = new Map(), doc = createBuffer({ path: 'a.ts', text: 'original', version: 'v1' })
  doc.text = 'first draft'; doc.writers.add(owner); documents.set('a.ts', doc)
  let release: (() => void) | undefined, writes = 0, saved: ReturnType<typeof draftRecord> | null = null
  const store = {
    read: async () => null,
    async save(_root: string, entries: Parameters<typeof draftRecord>[0], revision: number) {
      if (++writes === 1) await new Promise<void>(resolve => { release = resolve })
      saved = draftRecord(entries, revision); return saved
    },
  }
  const recovery = createDraftRecovery(store, (key: string) => key)
  recovery.bind('/project', { documents, subscribe: () => () => {} }, owner)
  await new Promise(resolve => setImmediate(resolve))
  const pending = recovery.flush('/project')
  await new Promise(resolve => setImmediate(resolve))
  doc.text = 'last draft'; recovery.dispose(); documents.clear(); release!(); await pending
  const deadline = Date.now() + 2000
  while (writes < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(writes, 2)
  assert.equal(saved?.entries[0].text, 'last draft')
})
