import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function editor(api: object, section: string) {
  let plugin: any
  runInNewContext(readFileSync(new URL('../client/index.js', import.meta.url), 'utf8'), {
    setTimeout, clearTimeout,
    __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((id: string) => id === 'react' ? { forwardRef: () => 'button' } : {}) } },
  })
  return plugin.createBudgetAutosave(api, section)
}

test('new command environment settings default to bundled Bash on and official scope off', () => {
  const shell = editor({}, 'shell')
  shell.receive({ configuration: {}, revision: 1, writable: true })
  assert.equal(shell.getSnapshot().draft.windowsBash, true)
  assert.equal(shell.getSnapshot().draft.windowsBashForOfficialPresets, false)
  shell.receive({ configuration: { windowsBash: false, windowsBashForOfficialPresets: true }, revision: 2, writable: true })
  assert.equal(shell.getSnapshot().draft.windowsBash, false)
  assert.equal(shell.getSnapshot().draft.windowsBashForOfficialPresets, true)
})

test('shell, protection and budget autosaves preserve each other across visits', async () => {
  let stored = { revision: 1, writable: true, defaults: {}, shell: { platform: 'win32', state: 'pending' },
    configuration: { windowsBash: true, deletionProtection: 'strict', deletionProtectionForOfficialPresets: true,
      applyToOfficialPresets: false, budgets: { summaryMaxTokens: 8192 } } }
  let writes = 0
  const api = { saveConfig: async (content: string, revision: string) => {
    writes++
    assert.equal(String(stored.revision), revision)
    stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }
    return { ok: true, value: { ok: true, snapshot: stored } }
  } }
  const shell = editor(api, 'shell'); shell.receive(stored)
  shell.change({ windowsBash: false }); await shell.flush()
  assert.equal(stored.configuration.windowsBash, false)
  assert.equal(stored.configuration.deletionProtection, 'strict')
  assert.equal(stored.configuration.budgets.summaryMaxTokens, 8192)
  assert.equal(shell.getSnapshot().snapshot.shell.platform, 'win32')
  const context = editor(api, 'context'); context.receive(stored)
  context.change({ summaryMaxTokens: '4096' }); await context.flush()
  assert.equal(stored.configuration.windowsBash, false)
  assert.equal(stored.configuration.deletionProtection, 'strict')
  assert.equal(stored.configuration.budgets.summaryMaxTokens, 4096)
  const protection = editor(api, 'protection'); protection.receive(stored)
  protection.change({ deletionProtection: 'relaxed' }); await protection.flush()
  assert.equal(stored.configuration.windowsBash, false)
  assert.equal(stored.configuration.budgets.summaryMaxTokens, 4096)
  const reopened = editor(api, 'shell'); reopened.receive(stored)
  assert.equal(reopened.getSnapshot().draft.windowsBash, false)
  reopened.change({ windowsBash: true }); await reopened.flush()
  assert.equal(stored.configuration.windowsBash, true)
  assert.equal(stored.configuration.deletionProtection, 'relaxed')
  assert.equal(writes, 4)
})

test('shell setting rejects invalid drafts and preserves failed or conflicting edits', async () => {
  for (const failure of ['conflict', 'save-failed']) {
    let writes = 0
    const save = editor({ saveConfig: async () => { writes++; return { ok: true, value: { ok: false, error: failure } } } }, 'shell')
    save.receive({ configuration: {}, revision: 1, writable: true })
    save.change({ windowsBash: 'true' }); await save.flush()
    assert.equal(writes, 0)
    assert.equal(save.getSnapshot().error, 'invalid')
    save.change({ windowsBash: false }); await save.flush()
    assert.equal(writes, 1)
    assert.equal(save.getSnapshot().error, failure)
    assert.equal(save.getSnapshot().draft.windowsBash, false)
    await save.flush()
    assert.equal(writes, 1)
  }
})

test('official shell scope autosaves independently and survives other tabs and a disabled master switch', async () => {
  let stored = { revision: 1, writable: true, configuration: { windowsBash: true,
    windowsBashForOfficialPresets: false, applyToOfficialPresets: false, budgets: { summaryMaxTokens: 8192 } } }
  const api = { saveConfig: async (content: string) => {
    stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }
    return { ok: true, value: { ok: true, snapshot: stored } }
  } }
  const shell = editor(api, 'shell'); shell.receive(stored)
  assert.equal(shell.getSnapshot().draft.windowsBashForOfficialPresets, false)
  shell.change({ windowsBashForOfficialPresets: true }); await shell.flush()
  assert.equal(stored.configuration.windowsBashForOfficialPresets, true)
  assert.equal(stored.configuration.applyToOfficialPresets, false)
  const context = editor(api, 'context'); context.receive(stored)
  context.change({ summaryMaxTokens: '4096' }); await context.flush()
  assert.equal(stored.configuration.windowsBashForOfficialPresets, true)
  const reopened = editor(api, 'shell'); reopened.receive(stored)
  reopened.change({ windowsBash: false }); await reopened.flush()
  assert.equal(stored.configuration.windowsBashForOfficialPresets, true)
  assert.equal(stored.configuration.windowsBash, false)
  assert.equal(stored.configuration.budgets.summaryMaxTokens, 4096)
  reopened.change({ windowsBashForOfficialPresets: 'true' }); await reopened.flush()
  assert.equal(reopened.getSnapshot().error, 'invalid')
})
