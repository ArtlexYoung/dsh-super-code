
function settingsRevision(snapshot) {
  return snapshot.generation ? `${snapshot.revision}:${snapshot.generation}` : String(snapshot.revision)
}
function createSettingsEditors(api, factories) {
  let writing = Promise.resolve(), saved, saveCount = 0, readCount = 0, latestRead
  const saveConfig = (content, expected, origin) => {
    const result = api.saveConfig(content, expected).then(response => {
      if (response.ok && response.value.ok) {
        saved = response.value.snapshot; saveCount++
        // 发起保存的编辑器自行处理回执，避免覆盖保存期间的新输入。
        for (const [section, editor] of Object.entries(editors)) {
          if (section === origin) continue
          const previous = editor.getSnapshot().snapshot
          if (previous && settingsRevision(previous) === expected) editor.revision(saved)
        }
      }
      return response
    })
    writing = Promise.allSettled([writing, result]).then(() => {})
    return result
  }
  const editors = Object.fromEntries(Object.entries(factories)
    .map(([section, create]) => [section, create({ saveConfig: (content, expected) => saveConfig(content, expected, section) })]))
  const flush = async () => {
    await Promise.all(Object.values(editors).map(editor => editor.flush()))
    await writing
  }
  return { editors, saveConfig, readConfig: async () => {
    const sequence = ++readCount
    await flush()
    const before = saveCount, response = await api.readConfig()
    await flush()
    if (!response.ok) return response
    // A newer read may already belong to a restarted service. Never let an
    // older request bring the previous instance back into a form.
    if (!latestRead || sequence > latestRead.sequence) latestRead = { sequence, snapshot: response.value }
    const snapshot = latestRead.snapshot
    // A read already in flight must not undo a newer local save. A fresh read
    // still accepts a lower revision after the host restarts its settings service.
    return { ...response, value: saveCount !== before && saved.generation === snapshot.generation && saved.revision > snapshot.revision
      ? saved : snapshot }
  } }
}
const autosaveValidationErrors = ['invalid', 'retain', 'ptc-order']
function autosaveState(editing) {
  return editing.saving ? 'saving' : autosaveValidationErrors.includes(editing.error) ? 'invalid'
    : editing.error ? 'error' : editing.notice === 'saved' ? 'saved' : 'idle'
}
/**
 * Serialize writes and retain newer edits while an earlier revision is being saved.
 * `toConfiguration` returns `{ ok, configuration }` or `{ ok: false, error? }`; invalid drafts never write.
 */
function createAutosave(api, { draft: initialDraft, toDraft, toConfiguration }) {
  let state = { snapshot: false, draft: initialDraft, saving: false, error: '', notice: '', saveCount: 0 }
  let version = 0, acknowledged = 0, blocked = -1, timer = false, running = false
  const listeners = new Set()
  const update = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener() }
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = false }
    if (running) return running
    if (version === acknowledged || version === blocked || !state.snapshot) return Promise.resolve()
    running = (async () => {
      update({ saving: true, error: '', notice: '' })
      try {
        while (acknowledged < version) {
          const sent = version, parsed = toConfiguration(state.draft, state.snapshot)
          if (!parsed.ok) { blocked = version; update({ error: parsed.error || 'invalid' }); break }
          const result = await api.saveConfig(JSON.stringify(parsed.configuration), settingsRevision(state.snapshot))
          if (!result.ok) throw new Error('Remote unavailable')
          if (!result.value.ok) { blocked = version; update({ error: result.value.error }); break }
          acknowledged = sent
          update({ snapshot: result.value.snapshot, saveCount: state.saveCount + 1,
            ...(sent === version ? { draft: toDraft(result.value.snapshot.configuration), notice: 'saved' } : {}) })
        }
      } catch { blocked = version; update({ error: 'save-failed' }) }
      finally { update({ saving: false }) }
    })().finally(() => { running = false })
    return running
  }
  return {
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    hasChanges: () => version !== acknowledged || state.saving,
    receive: (snapshot, draft = toDraft(snapshot.configuration)) => {
      acknowledged = ++version
      update({ snapshot, draft, error: '', notice: '' })
    },
    permissions: writable => {
      // Keep the draft and its CAS baseline while reflecting current host permissions.
      if (state.snapshot && state.snapshot.writable !== writable) update({ snapshot: { ...state.snapshot, writable } })
    },
    revision: snapshot => {
      const previous = state.snapshot ? toDraft(state.snapshot.configuration) : initialDraft
      const next = toDraft(snapshot.configuration)
      // A local save may change an untouched field in this page (for example
      // the Home switch). Carry it forward while preserving actual edits.
      update({ snapshot, draft: Object.fromEntries(Object.entries(next).map(([key, value]) =>
        [key, JSON.stringify(state.draft[key]) === JSON.stringify(previous[key]) ? value : state.draft[key]])) })
    },
    change: (patch, delay = 0) => {
      version++
      update({ draft: { ...state.draft, ...patch }, error: '', notice: '' })
      if (timer) { clearTimeout(timer); timer = false }
      if (delay) timer = setTimeout(() => { timer = false; void flush() }, delay)
      else void flush()
    },
    /** Retry the last blocked or failed draft without requiring another edit. */
    retry: () => { blocked = -1; return flush() },
    flush,
  }
}

export { autosaveState, autosaveValidationErrors, createAutosave, createSettingsEditors, settingsRevision }
