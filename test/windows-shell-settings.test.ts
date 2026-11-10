import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function client() {
  let plugin: any
  runInNewContext(readFileSync(new URL('../client/index.js', import.meta.url), 'utf8'), {
    setTimeout, clearTimeout,
    __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((id: string) => id === 'react' ? { forwardRef: () => 'button' } : {}) } },
  })
  return plugin
}
const editor = (api: object, section: string) => client().createBudgetAutosave(api, section)

test('a retained invalid or failed budget draft can save after another local tab writes without losing either change', async () => {
  for (const failure of ['invalid', 'save-failed']) {
    let stored = { revision: 1, writable: true, configuration: { budgets: { summaryMaxTokens: 8192 } } as Record<string, any> }
    let unavailable = failure === 'save-failed'
    const settings = client().createBudgetEditors({
      readConfig: async () => ({ ok: true, value: structuredClone(stored) }),
      saveConfig: async (content: string, expected: string) => {
        if (unavailable) return { ok: false }
        if (expected !== String(stored.revision)) return { ok: true, value: { ok: false, error: 'conflict' } }
        stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }
        return { ok: true, value: { ok: true, snapshot: structuredClone(stored) } }
      },
    })
    const { context, skills } = settings.editors
    context.receive((await settings.readConfig()).value)
    context.change({ summaryMaxTokens: failure === 'invalid' ? 'bad input' : '4096' }); await context.flush()
    assert.equal(context.getSnapshot().error, failure)
    unavailable = false
    skills.receive((await settings.readConfig()).value)
    skills.change({ openspecSkills: true }); await skills.flush()
    assert.equal(context.getSnapshot().draft.summaryMaxTokens, failure === 'invalid' ? 'bad input' : '4096')
    if (failure === 'invalid') context.change({ summaryMaxTokens: '4096' })
    else await context.retry()
    await context.flush()
    assert.equal(context.getSnapshot().error, '')
    assert.equal(stored.configuration.budgets.summaryMaxTokens, 4096)
    assert.equal(stored.configuration.openspecSkills, true)
  }
})

test('an older read waits for every queued local Skill save and cannot regress its revision', async () => {
  let stored = { revision: 1, writable: true, configuration: {} as Record<string, unknown> }
  let release!: () => void, finishSave!: () => void, hold = false, writes = 0
  const settings = client().createBudgetEditors({
    readConfig: async () => {
      const captured = structuredClone(stored)
      if (hold) { hold = false; await new Promise<void>(resolve => { release = resolve }) }
      return { ok: true, value: captured }
    },
    saveConfig: async (content: string, expected: string) => {
      if (++writes === 2) await new Promise<void>(resolve => { finishSave = resolve })
      if (expected !== String(stored.revision)) return { ok: true, value: { ok: false, error: 'conflict' } }
      stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }
      return { ok: true, value: { ok: true, snapshot: structuredClone(stored) } }
    },
  })
  const { skills } = settings.editors
  skills.receive((await settings.readConfig()).value)
  hold = true
  const oldRead = settings.readConfig()
  while (!release) await Promise.resolve()
  skills.change({ openspecSkills: true }); skills.change({ mattpocockSkills: true })
  while (!finishSave) await Promise.resolve()
  let settled = false
  void oldRead.then(() => { settled = true })
  release()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false, 'a delayed read must also wait for writes started while it was in flight')
  finishSave(); await skills.flush()
  const response = await oldRead
  assert.equal(response.value.revision, 3)
  assert.equal(response.value.configuration.openspecSkills, true)
  assert.equal(response.value.configuration.mattpocockSkills, true)
})

test('fresh reads accept a restarted settings service and its lower revision', async () => {
  let stored = { revision: 4, writable: true, configuration: {} as Record<string, unknown> }
  const settings = client().createBudgetEditors({
    readConfig: async () => ({ ok: true, value: structuredClone(stored) }),
    saveConfig: async (content: string) => {
      stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }
      return { ok: true, value: { ok: true, snapshot: structuredClone(stored) } }
    },
  })
  const { skills } = settings.editors
  skills.receive((await settings.readConfig()).value)
  skills.change({ openspecSkills: true }); await skills.flush()
  stored = { revision: 0, writable: false, configuration: { mattpocockSkills: true } }
  const response = await settings.readConfig()
  assert.equal(response.value.revision, 0)
  assert.equal(response.value.writable, false)
  assert.equal(response.value.configuration.mattpocockSkills, true)
  assert.equal(response.value.configuration.openspecSkills, undefined)
})

test('local saves do not silently rebase a draft across an external budget revision', async () => {
  let stored = { revision: 1, writable: true, configuration: { budgets: { summaryMaxTokens: 8192 } } as Record<string, any> }
  const settings = client().createBudgetEditors({
    readConfig: async () => ({ ok: true, value: structuredClone(stored) }),
    saveConfig: async (content: string, expected: string) => {
      if (expected !== String(stored.revision)) return { ok: true, value: { ok: false, error: 'conflict' } }
      stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }
      return { ok: true, value: { ok: true, snapshot: structuredClone(stored) } }
    },
  })
  const { context, skills } = settings.editors
  context.receive((await settings.readConfig()).value)
  context.change({ summaryMaxTokens: 'bad input' }); await context.flush()
  stored = { ...stored, revision: 2, configuration: { budgets: { summaryMaxTokens: 2048 } } }
  skills.receive((await settings.readConfig()).value)
  skills.change({ openspecSkills: true }); await skills.flush()
  context.change({ summaryMaxTokens: '4096' }); await context.flush()
  assert.equal(context.getSnapshot().error, 'conflict')
  assert.equal(context.getSnapshot().draft.summaryMaxTokens, '4096')
  assert.equal(stored.configuration.budgets.summaryMaxTokens, 2048)
  assert.equal(stored.configuration.openspecSkills, true)
})

test('switching budget tabs waits for all local Skill saves, including edits queued during a save', async () => {
  let stored = { revision: 1, writable: true, configuration: { windowsBash: true } as Record<string, unknown> }
  let finish!: () => void, writes = 0
  const api = { readConfig: async () => ({ ok: true, value: structuredClone(stored) }),
    saveConfig: async (content: string, revision: string) => {
      if (++writes === 1) await new Promise<void>(resolve => { finish = resolve })
      if (revision !== String(stored.revision)) return { ok: true, value: { ok: false, error: 'conflict' } }
      stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }
      return { ok: true, value: { ok: true, snapshot: structuredClone(stored) } }
    } }
  const settings = client().createBudgetEditors(api), { skills, shell } = settings.editors
  skills.receive((await settings.readConfig()).value)
  skills.change({ openspecSkills: true })
  skills.change({ mattpocockSkills: true })
  let loaded = false
  const visit = settings.readConfig().then((response: any) => { loaded = true; shell.receive(response.value) })
  await Promise.resolve()
  assert.equal(loaded, false, 'the next tab cannot read a revision that is still being saved')
  finish(); await visit
  assert.equal(shell.getSnapshot().snapshot.revision, 3)
  shell.change({ windowsBash: false }); await shell.flush()
  assert.equal(shell.getSnapshot().error, '')
  assert.equal(stored.configuration.windowsBash, false)
  assert.equal(stored.configuration.openspecSkills, true)
  assert.equal(stored.configuration.mattpocockSkills, true)
})

test('budget tab reads wait for direct reset/home saves and recover from a rejected write', async () => {
  let release!: () => void, reject = false, reads = 0
  const settings = client().createBudgetEditors({
    readConfig: async () => { reads++; return { ok: true, value: { revision: 2, writable: true, configuration: {} } } },
    saveConfig: async () => { await new Promise<void>(resolve => { release = resolve }); if (reject) throw new Error('offline'); return { ok: true } },
  })
  for (const fail of [false, true]) {
    reject = fail
    const writing = settings.saveConfig('{}', '1').catch(() => {})
    const before = reads, reading = settings.readConfig()
    await Promise.resolve(); assert.equal(reads, before)
    release(); await writing; await reading
    assert.equal(reads, before + 1)
  }
})

test('a real external budget conflict retains the draft without blind retries or overwriting it on another tab', async () => {
  let writes = 0
  const settings = client().createBudgetEditors({
    readConfig: async () => ({ ok: true, value: { revision: 2, writable: true, configuration: { openspecSkills: false } } }),
    saveConfig: async () => { writes++; return { ok: true, value: { ok: false, error: 'conflict' } } },
  })
  const { skills } = settings.editors
  skills.receive({ revision: 1, writable: true, configuration: {} })
  skills.change({ openspecSkills: true }); await skills.flush()
  assert.equal((await settings.readConfig()).value.revision, 2)
  assert.equal(skills.getSnapshot().error, 'conflict')
  assert.equal(skills.getSnapshot().draft.openspecSkills, true)
  assert.equal(writes, 1)
})

test('whole Skill package choices autosave and survive all other settings tabs', async () => {
  let stored = { revision: 1, writable: true, configuration: {
    oilUiSkill: true, openspecSkills: false, mattpocockSkills: false,
    windowsBash: true, deletionProtection: 'strict', budgets: { summaryMaxTokens: 8192 },
  } }
  const api = { saveConfig: async (content: string, revision: string) => {
    assert.equal(revision, String(stored.revision))
    stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }
    return { ok: true, value: { ok: true, snapshot: stored } }
  } }
  const skills = editor(api, 'skills'); skills.receive(stored)
  assert.equal(skills.getSnapshot().draft.oilUiSkill, true)
  assert.equal(skills.getSnapshot().draft.openspecSkills, false)
  assert.equal(skills.getSnapshot().draft.mattpocockSkills, false)
  skills.change({ oilUiSkill: false, openspecSkills: true, mattpocockSkills: true }); await skills.flush()
  assert.equal(stored.configuration.budgets.summaryMaxTokens, 8192)
  assert.equal(stored.configuration.deletionProtection, 'strict')
  for (const [section, patch] of [['shell', { windowsBash: false }], ['protection', { deletionProtection: 'relaxed' }], ['context', { summaryMaxTokens: '4096' }]] as const) {
    const save = editor(api, section); save.receive(stored); save.change(patch); await save.flush()
    assert.equal(stored.configuration.oilUiSkill, false)
    assert.equal(stored.configuration.openspecSkills, true)
    assert.equal(stored.configuration.mattpocockSkills, true)
  }
  const reopened = editor(api, 'skills'); reopened.receive(stored)
  assert.equal(reopened.getSnapshot().draft.mattpocockSkills, true)
  reopened.change({ openspecSkills: false }); await reopened.flush()
  assert.equal(stored.configuration.budgets.summaryMaxTokens, 4096)
  assert.equal(stored.configuration.windowsBash, false)
})

test('invalid, failed and stale Skill package writes retain the last accepted configuration', async () => {
  for (const failure of ['conflict', 'save-failed']) {
    let writes = 0
    const save = editor({ saveConfig: async () => { writes++; return { ok: true, value: { ok: false, error: failure } } } }, 'skills')
    save.receive({ configuration: {}, revision: 1, writable: true })
    save.change({ mattpocockSkills: 'true' }); await save.flush()
    assert.equal(writes, 0)
    save.change({ mattpocockSkills: true }); await save.flush()
    assert.equal(writes, 1)
    assert.equal(save.getSnapshot().draft.mattpocockSkills, true)
    assert.equal(save.getSnapshot().snapshot.configuration.mattpocockSkills, undefined)
    assert.equal(save.getSnapshot().error, failure)
    await save.flush(); assert.equal(writes, 1)
  }
})

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
