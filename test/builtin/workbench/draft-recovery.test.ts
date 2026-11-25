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

test('移动同步待恢复副本和脏缓冲路径，在途旧备份完成后写入新路径且拒绝副本冲突', async t => {
  const { createProject } = await import('../../../builtin/workbench/editing/project.js')
  const { checkProjectMove, moveProjectFile } = await import('../../../builtin/workbench/editing/move.js')
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: new EventTarget() })
  const owner = Symbol(), project = createProject({ fileOperation: async () => ({}) }, () => {}, undefined)
  const entry = { path: 'old.ts', text: 'recovered draft', original: 'original', diskVersion: 'v1' }
  const doc = createBuffer({ path: 'live.ts', text: 'original', version: 'v1' }); doc.text = 'live draft'; doc.writers.add(owner)
  let saved = draftRecord([entry], 0), writes = 0
  const started = Promise.withResolvers<void>(), pending = Promise.withResolvers<void>()
  const store = { read: async () => saved, async save(_root: string, entries: Parameters<typeof draftRecord>[0], revision: number) {
    if (++writes === 1) { started.resolve(); await pending.promise }
    saved = draftRecord(entries, revision); return saved
  } }
  const recovery = createDraftRecovery(store, (key: string) => key)
  t.after(() => {
    pending.resolve(); recovery.dispose(); project.dispose()
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window')
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document')
  })
  recovery.bind('/project', project, owner)
  assert.throws(() => checkProjectMove(project, 'x.ts', 'y.ts'), /WORKBENCH_MOVE_RECOVERY/)
  await new Promise(resolve => setImmediate(resolve))
  assert.throws(() => checkProjectMove(project, 'x.ts', 'old.ts'), /WORKBENCH_MOVE_RECOVERY/)
  project.documents.set('live.ts', doc)
  const writing = recovery.flush('/project'); await started.promise
  checkProjectMove(project, 'old.ts', 'moved.ts')
  moveProjectFile(project, { previousPath: 'old.ts', path: 'moved.ts', version: 'v2' })
  checkProjectMove(project, 'live.ts', 'live-new.ts')
  moveProjectFile(project, { previousPath: 'live.ts', path: 'live-new.ts', version: 'v2' })
  pending.resolve(); await writing
  const deadline = Date.now() + 2000
  while (writes < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(writes, 2)
  assert.deepEqual(saved.entries.map(item => item.path), ['moved.ts', 'live-new.ts'])
  assert.equal(saved.entries[0].text, 'recovered draft'); assert.equal(saved.entries[0].diskVersion, 'v1')
  assert.equal(saved.entries[1].text, 'live draft'); assert.equal(saved.entries[1].diskVersion, 'v2')
  assert.equal(recovery.entry('/project', 'old.ts'), undefined)
  assert.deepEqual(recovery.snapshot('/project')?.candidates, ['moved.ts'])
})
