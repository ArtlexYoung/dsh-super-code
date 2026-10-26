import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function editor(api: object) {
  let plugin: any
  runInNewContext(readFileSync(new URL('../client/index.js', import.meta.url), 'utf8'), {
    setTimeout, clearTimeout,
    __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((id: string) => id === 'react' ? { forwardRef: () => 'button' } : {}) } },
  })
  return plugin.createConnectionAutosave(api)
}
const initial = () => ({ revision: 1, writable: true, state: 'disabled', configuration: {
  enabled: false, port: 23457, maxConnections: 4, maxConcurrent: 4,
  allowedDirectories: ['/project'], knownDirectories: [], directoriesConfigured: true,
} })

test('automatic connection writes serialize and retain edits made during an earlier save', async () => {
  let finish!: (value: object) => void
  const calls: any[] = []
  const save = editor({ saveConfig: async (content: string, revision: string) => {
    const configuration = JSON.parse(content); calls.push({ configuration, revision })
    if (calls.length === 1) await new Promise(resolve => { finish = resolve })
    return { ok: true, value: { ok: true, snapshot: { ...initial(), revision: Number(revision) + 1, configuration } } }
  } })
  save.receive(initial())
  save.change({ enabled: true })
  save.change({ maxConnections: '8' })
  save.change({ allowedDirectories: ['/project', '/second'] })
  assert.equal(calls.length, 1)
  finish({})
  await save.flush()
  assert.equal(calls.length, 2)
  assert.equal(calls[1].revision, '2')
  assert.equal(calls[1].configuration.enabled, true)
  assert.equal(calls[1].configuration.maxConnections, 8)
  assert.equal(calls[1].configuration.maxConcurrent, 8)
  assert.deepEqual(calls[1].configuration.allowedDirectories, ['/project', '/second'])
  assert.equal(save.getSnapshot().snapshot.revision, 3)
  assert.equal(save.getSnapshot().notice, 'saved')
  assert.equal(save.hasChanges(), false)
})

test('invalid connection input never writes and delayed number edits flush on departure', async () => {
  const calls: any[] = []
  const save = editor({ saveConfig: async (content: string, revision: string) => {
    const configuration = JSON.parse(content); calls.push(configuration)
    return { ok: true, value: { ok: true, snapshot: { ...initial(), revision: Number(revision) + 1, configuration } } }
  } })
  save.receive(initial())
  save.change({ port: '' }); await save.flush()
  assert.equal(calls.length, 0)
  assert.equal(save.getSnapshot().error, 'invalid')
  save.change({ port: '24567' }, 10000)
  assert.equal(calls.length, 0)
  await save.flush()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].port, 24567)
  assert.equal(save.getSnapshot().error, '')
  save.change({ allowedDirectories: [], enabled: true }); await save.flush()
  assert.equal(calls.length, 1)
  assert.equal(save.getSnapshot().error, 'invalid')
})

test('save conflicts and failed writes retain input without reporting success or retrying blindly', async () => {
  for (const failure of ['conflict', 'save-failed', 'transport']) {
    let calls = 0
    const save = editor({ saveConfig: async () => {
      calls++
      if (failure === 'transport') throw new Error('offline')
      return { ok: true, value: { ok: false, error: failure } }
    } })
    save.receive(initial())
    save.change({ enabled: true }); await save.flush()
    await save.flush()
    assert.equal(calls, 1)
    assert.equal(save.getSnapshot().draft.enabled, true)
    assert.equal(save.getSnapshot().snapshot.configuration.enabled, false)
    assert.equal(save.getSnapshot().error, failure === 'transport' ? 'save-failed' : failure)
    assert.equal(save.getSnapshot().notice, '')
    assert.equal(save.getSnapshot().saving, false)
  }
})
