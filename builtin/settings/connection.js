import { createAutosave } from './editors.js'
import React, { useState, useRef, useEffect, useSyncExternalStore } from '../ui/react.js'
import { ActionButton, Glyph } from '../ui/controls.js'
import { ConnectionSwitch } from './controls.js'

function connectionDraft(config) {
  return { enabled: config.enabled, allowNewConversations: config.allowNewConversations !== false, allowCallerApproval: config.allowCallerApproval === true, port: String(config.port), allowedDirectories: [...config.allowedDirectories], knownDirectories: [...config.knownDirectories ?? []],
    maxConcurrent: config.maxConnections ?? 3, maxConnections: String(config.maxConnections ?? 3), directoriesConfigured: config.directoriesConfigured ?? false }
}
function connectionConfiguration(draft) {
  const port = Number(draft.port), maxConnections = Number(draft.maxConnections)
  const allowedDirectories = [...new Set(draft.allowedDirectories)]
  if (typeof draft.enabled !== 'boolean' || typeof draft.allowNewConversations !== 'boolean' || typeof draft.allowCallerApproval !== 'boolean' || !Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 32 || allowedDirectories.length > 32 || allowedDirectories.some(path => typeof path !== 'string' || !path) || (draft.enabled && !allowedDirectories.length)) return { ok: false }
  return { ok: true, configuration: { enabled: draft.enabled, allowNewConversations: draft.allowNewConversations, allowCallerApproval: draft.allowCallerApproval, port, allowedDirectories, maxConcurrent: maxConnections, maxConnections, directoriesConfigured: true, knownDirectories: draft.knownDirectories } }
}
function createConnectionAutosave(api) {
  return createAutosave(api, { draft: connectionDraft({ enabled: false, port: 23457, allowedDirectories: [] }),
    toDraft: connectionDraft, toConfiguration: draft => connectionConfiguration(draft) })
}
function DirectoryBrowser({ api, t, onSelect, onClose }) {
  const [listing, setListing] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(false)
  const dialog = useRef(null), generation = useRef(0), lastPath = useRef('')
  const browse = async path => {
    const version = ++generation.current; lastPath.current = path; setBusy(true); setError(false)
    try { const result = await api.browseDirectory(path); if (!result.ok) throw new Error(); if (version === generation.current) setListing(result.value) }
    catch { if (version === generation.current) setError(true) }
    finally { if (version === generation.current) setBusy(false) }
  }
  useEffect(() => {
    const element = dialog.current; element.showModal(); browse('')
    return () => { generation.current++; if (element.open) element.close() }
  }, [api])
  return React.createElement('dialog', { ref: dialog, className: 'dsh-super-code-confirm', 'aria-labelledby': 'super-code-directory-title',
    onCancel: event => { event.preventDefault(); event.stopPropagation(); onClose() }, onKeyDown: event => event.stopPropagation() },
    React.createElement('h3', { id: 'super-code-directory-title' }, t('connection.directoryBrowser')),
    React.createElement('nav', { className: 'dsh-super-code-directory-crumbs', 'aria-label': t('connection.directoryBrowser') },
      listing?.crumbs.map((row, index) => React.createElement(ActionButton, { key: `${row.path}-${index}`, type: 'button', disabled: busy, onClick: () => browse(row.path) }, row.name || row.path))),
    listing && React.createElement('code', { className: 'dsh-super-code-directory-path' }, listing.path),
    React.createElement('div', { className: 'dsh-super-code-directory-browser', 'aria-busy': busy },
      listing && listing.crumbs.length > 1 && React.createElement(ActionButton, { type: 'button', disabled: busy, onClick: () => browse(listing.crumbs[listing.crumbs.length - 2].path) }, '↑ ', t('connection.parentDirectory')),
      listing?.entries.map(row => React.createElement(ActionButton, { key: row.path, type: 'button', disabled: busy, onClick: () => browse(row.path) }, React.createElement(Glyph, { type: 'folder' }), row.name)),
      listing && !listing.entries.length && React.createElement('p', null, t('connection.emptyDirectory'))),
    error && React.createElement('p', { role: 'alert' }, t('connection.browserError')),
    React.createElement('div', { className: 'dsh-super-code-confirm-actions' },
      error && React.createElement(ActionButton, { type: 'button', disabled: busy, onClick: () => browse(lastPath.current) }, t('connection.reload')),
      React.createElement(ActionButton, { type: 'button', onClick: onClose }, t('preset.cancel')),
      React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-primary-button', disabled: busy || error || !listing,
        onClick: () => onSelect(listing.path) }, t('connection.selectDirectory'))))
}
function connectionSessions(overview) {
  const online = new Set(overview.connections.map(row => row.id)), connected = [], history = []
  for (const row of overview.sessions) (row.connectionId && online.has(row.connectionId) ? connected : history).push(row)
  return { connected, history }
}
function ConnectionActivity({ api, t, active, openSession }) {
  const [overview, setOverview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(false)
  const alive = useRef(false), pending = useRef(false), disconnecting = useRef(false)
  const load = () => {
    if (pending.current || disconnecting.current) return pending.current
    pending.current = (async () => {
      try { const result = await api.overview(); if (!result.ok) throw new Error(); if (alive.current) { setOverview(result.value); setError(false) } }
      catch { if (alive.current) setError(true) }
    })().finally(() => { pending.current = false })
    return pending.current
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [api])
  useEffect(() => { if (!active) return; load(); const timer = setInterval(load, 2000); return () => clearInterval(timer) }, [active, api])
  const disconnect = async id => {
    if (disconnecting.current) return
    disconnecting.current = true; setBusy(true)
    try {
      await pending.current
      if (!alive.current) return
      const result = await api.disconnectClient(id); if (!result.ok) throw new Error()
    }
    catch { if (alive.current) setError(true); return }
    finally { disconnecting.current = false; if (alive.current) setBusy(false) }
    if (alive.current) load()
  }
  const groups = overview ? connectionSessions(overview) : { connected: [], history: [] }
  return React.createElement('section', { className: 'dsh-super-code-connection-activity', 'aria-label': t('home.sessions') },
    React.createElement('h3', null, t('home.connections')),
    !overview ? React.createElement('p', { role: 'status' }, t('connection.state.loading'))
      : overview.connections.length ? React.createElement('ul', { className: 'dsh-super-code-connection-list' }, overview.connections.map(row => React.createElement('li', { key: row.id },
        React.createElement('span', null, React.createElement('strong', null, row.name), React.createElement('small', null, row.version, ' · ', t('home.lastSeen'), ' ', new Date(row.lastSeen).toLocaleTimeString())),
        React.createElement(ActionButton, { type: 'button', disabled: busy, onClick: () => disconnect(row.id) }, t('home.disconnect'))))) : React.createElement('p', null, t('home.noConnections')),
    React.createElement('h3', null, t('home.sessions')),
    ...['connected', 'history'].map(kind => React.createElement('div', { key: kind, 'data-session-group': kind },
      React.createElement('h4', null, t(kind === 'connected' ? 'home.connectedSessions' : 'home.historySessions'), ' · ', overview ? groups[kind].length : '—'),
      groups[kind].length ? React.createElement('ul', { className: 'dsh-super-code-connection-list' }, groups[kind].map(row => React.createElement('li', { key: row.taskId },
        React.createElement('span', null, React.createElement('strong', null, row.client || row.sessionId), React.createElement('small', null, t(`taskStatus.${row.status}`), ' · ', row.cwd), React.createElement('code', null, row.sessionId)),
        React.createElement(ActionButton, { type: 'button', onClick: () => openSession(row.sessionId) }, t('home.openSession'))))) : overview && React.createElement('p', null, t('home.noSessions')))),
    error && React.createElement('p', { role: 'alert' }, t('home.error')))
}

function ConnectionSettings({ api, settings, t, active, openSession, onSaved = () => {} }) {
  const editor = settings.editors.connection
  const editing = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot)
  const { snapshot, draft, saving } = editing
  const [catalog, setCatalog] = useState({ items: [], picker: 'unavailable' }), [browser, setBrowser] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [token, setToken] = useState('')
  const alive = useRef(false), pending = useRef(false), visible = useRef(active)
  visible.current = active
  const dirty = editor.hasChanges()
  const receive = (value, directories = catalog) => {
    const next = connectionDraft(value.configuration)
    if (!next.directoriesConfigured && !next.allowedDirectories.length) next.allowedDirectories = directories.items.filter(row => row.workspace && row.available).slice(0, 32).map(row => row.path)
    editor.receive(value, next)
  }
  const load = async (discard = false) => {
    if (pending.current || (discard && editor.getSnapshot().saving)) return
    pending.current = true; setBusy(true); setError('')
    try {
      const [config, directories, credential] = await Promise.all([
        settings.readConfig(), api.directories().catch(() => ({ ok: false })), api.revealToken().catch(() => ({ ok: false })),
      ])
      if (!config.ok) throw new Error()
      if (!alive.current) return
      if (directories.ok) setCatalog(directories.value)
      else setError('unavailable')
      if (discard || !editor.hasChanges()) receive(config.value, directories.ok ? directories.value : catalog)
      else editor.permissions(config.value.writable)
      if (visible.current) {
        setToken(credential.ok ? credential.value.token : '')
        if (!credential.ok && config.value.url) setError('unavailable')
      }
    } catch { if (alive.current) setError('unavailable') }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  const action = async kind => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(''); setNotice('')
    if (kind === 'rotate') setToken('')
    try {
      const response = kind === 'rotate' ? await api.rotateToken(String(snapshot.revision)) : await api.revealToken()
      if (!response.ok) throw new Error()
      if (!alive.current) return
      if (kind === 'token') { if (visible.current) setToken(response.value.token) }
      else if (response.value.ok) {
        editor.revision(response.value.snapshot)
        onSaved()
        const credential = await api.revealToken()
        if (!credential.ok) throw new Error()
        if (!alive.current) return
        if (visible.current) setToken(credential.value.token)
        setNotice('rotated')
      } else setError(response.value.error)
    } catch { if (alive.current) setError('unavailable') }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; void editor.flush() } }, [editor])
  useEffect(() => { if (editing.saveCount) onSaved() }, [editing.saveCount])
  useEffect(() => { if (active) load(); else { setToken(''); setBrowser(false) } }, [api, active])
  useEffect(() => {
    if (!active) return
    const changed = () => { if (dirty) setError('conflict'); else load(true) }
    window.addEventListener('super-code-directories-changed', changed)
    return () => window.removeEventListener('super-code-directories-changed', changed)
  }, [active, dirty, api])
  const disabled = busy || !snapshot?.writable
  const change = (patch, delay = 0) => {
    // Revoking the last directory also stops admission instead of retaining its old grant.
    editor.change(patch.allowedDirectories?.length === 0 ? { ...patch, enabled: false } : patch, delay)
    setNotice(''); setError('')
  }
  const edit = (key, value) => change({ [key]: value }, ['port', 'maxConnections'].includes(key) ? 350 : 0)
  const choose = path => {
    if (!draft.allowedDirectories.includes(path) && draft.allowedDirectories.length >= 32) { setError('directory-limit'); return }
    change({ allowedDirectories: [...new Set([...draft.allowedDirectories, path])], knownDirectories: [...new Set([...draft.knownDirectories, path])].slice(-128) }); setNotice(''); setError(''); setBrowser(false)
  }
  const addDirectory = async () => {
    if (pending.current) return
    if (catalog.picker !== 'native' && !globalThis.__DSH_DIRECTORY_PICKER__?.pick) { setBrowser(true); return }
    pending.current = true; setBusy(true)
    try {
      const result = globalThis.__DSH_DIRECTORY_PICKER__?.pick ? await globalThis.__DSH_DIRECTORY_PICKER__.pick()
        : await api.pickDirectory().then(result => { if (!result.ok) throw new Error(); return result.value.kind === 'selected' ? result.value.path : null })
      if (alive.current && result) choose(result)
    } catch { if (alive.current) setError('picker-unavailable') }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  const rows = [...catalog.items]
  for (const path of [...draft.knownDirectories, ...draft.allowedDirectories]) if (!rows.some(row => row.path === path)) rows.push({ path, title: '', available: true, workspace: false })
  const copy = async value => {
    try { await navigator.clipboard.writeText(value); if (alive.current) { setNotice('copied'); setError('') } }
    catch { if (alive.current) setError('clipboard') }
  }
  const command = snapshot?.url ? t('connection.prompt', { url: snapshot.url }) : ''
  return React.createElement('section', { className: 'dsh-super-code-connection' },
    React.createElement('div', { className: 'dsh-super-code-settings-status-row' },
      React.createElement('p', { className: 'dsh-super-code-preset-status', role: 'status', 'data-available': snapshot?.state === 'listening' },
        React.createElement('i', { 'aria-hidden': true }), t(`connection.state.${snapshot?.state || 'loading'}`)),
      React.createElement('div', { className: 'dsh-super-code-settings-actions' }, React.createElement(ActionButton, { type: 'button', disabled: busy, onClick: () => load(true) }, t('connection.reload')))),
    snapshot?.error && React.createElement('div', { className: 'dsh-super-code-settings-actions' },
      React.createElement('p', { role: 'alert' }, t(`connection.error.${snapshot.error}`)),
      snapshot.state === 'error' && React.createElement(ActionButton, { type: 'button', disabled: disabled || dirty,
        onClick: () => { if (!disabled && !editor.hasChanges()) change({}) } }, t('save.retry'))),
    React.createElement(ConnectionActivity, { api, t, active, openSession }),
    React.createElement('form', { 'aria-label': t('connection.title'), 'aria-busy': saving, onSubmit: event => { event.preventDefault(); void editor.flush() } },
      React.createElement(ConnectionSwitch, { checked: draft.enabled, disabled, onChange: value => edit('enabled', value) }, t('connection.enabled')),
      React.createElement('p', { className: 'dsh-super-code-connection-hint' }, t('connection.scope')),
      React.createElement(ConnectionSwitch, { checked: draft.allowNewConversations, disabled, onChange: value => edit('allowNewConversations', value) }, t('connection.allowNewConversations')),
      React.createElement('small', null, t('connection.allowNewConversationsHint')),
      React.createElement(ConnectionSwitch, { checked: draft.allowCallerApproval, disabled, onChange: value => edit('allowCallerApproval', value) }, t('connection.allowCallerApproval')),
      React.createElement('small', null, t('connection.allowCallerApprovalHint')),
      React.createElement('div', { className: 'dsh-super-code-connection-grid' },
        ...[['port', 1024, 65535], ['maxConnections', 1, 32]].map(([key, min, max]) => React.createElement('div', { key, className: 'dsh-super-code-settings-field' },
          React.createElement('label', { htmlFor: `super-code-connection-${key}` }, t(`connection.${key}`)),
          React.createElement('input', { id: `super-code-connection-${key}`, type: 'number', min, max, step: 1, required: true, value: draft[key], disabled, onChange: event => edit(key, event.target.value), onBlur: () => { void editor.flush() } })))),
      React.createElement('small', null, t('connection.connectionsHint')),
      React.createElement('fieldset', { className: 'dsh-super-code-directory-fieldset' },
        React.createElement('legend', null, t('connection.directories')),
        React.createElement('div', { className: 'dsh-super-code-directory-list' },
          ...rows.map(row => React.createElement('div', { key: row.path, className: 'dsh-super-code-directory-row' },
            React.createElement('label', null,
              React.createElement('input', { type: 'checkbox', checked: draft.allowedDirectories.includes(row.path), disabled: disabled || (!row.available && !draft.allowedDirectories.includes(row.path)),
                onChange: event => {
                  if (event.target.checked && draft.allowedDirectories.length >= 32) { setError('directory-limit'); return }
                  edit('allowedDirectories', event.target.checked ? [...draft.allowedDirectories, row.path] : draft.allowedDirectories.filter(path => path !== row.path))
                } }),
              React.createElement('span', null, row.title && React.createElement('strong', null, row.title), React.createElement('code', null, row.path),
                React.createElement('small', { 'data-unavailable': !row.available }, t(!row.available ? 'connection.directoryUnavailable' : row.workspace ? 'connection.workspaceDirectory' : 'connection.customDirectory')))),
            !row.workspace && React.createElement(ActionButton, { type: 'button', disabled, 'aria-label': `${t('connection.removeDirectory')}: ${row.path}`,
              onClick: () => { setCatalog(value => ({ ...value, items: value.items.filter(item => item.path !== row.path) })); change({ knownDirectories: draft.knownDirectories.filter(path => path !== row.path), allowedDirectories: draft.allowedDirectories.filter(path => path !== row.path) }) } }, t('preset.remove')))),
          !rows.length && React.createElement('p', null, t('connection.noDirectories'))),
        React.createElement('div', { className: 'dsh-super-code-settings-actions' },
          React.createElement(ActionButton, { type: 'button', disabled: disabled || catalog.picker === 'unavailable', onClick: addDirectory }, t('connection.addDirectory'))),
        React.createElement('small', null, t('connection.directoriesHint'))),
      React.createElement('p', { role: 'status', className: 'dsh-super-code-connection-hint', 'data-connection-save': saving ? 'saving' : editing.error ? 'error' : editing.notice === 'saved' ? 'saved' : 'idle' },
        t(saving ? 'connection.saving' : editing.notice === 'saved' ? 'connection.saved' : 'connection.autosave'))),
    snapshot?.url && React.createElement('div', { className: 'dsh-super-code-connection-client' },
      React.createElement('h3', null, t('connection.client')), React.createElement('code', null, snapshot.url), React.createElement('pre', null, command),
      React.createElement('div', { className: 'dsh-super-code-settings-actions' },
        React.createElement(ActionButton, { type: 'button', disabled: busy, onClick: () => copy(command) }, t('connection.copyCommand')),
        React.createElement(ActionButton, { type: 'button', disabled, onClick: () => token ? setToken('') : action('token') }, t(token ? 'connection.hideToken' : 'connection.showToken')),
        active && token && React.createElement(ActionButton, { type: 'button', onClick: () => copy(token) }, t('connection.copyToken')),
        React.createElement(ActionButton, { type: 'button', disabled: disabled || dirty, onClick: () => action('rotate') }, t('connection.rotate'))),
      active && token && React.createElement('input', { className: 'dsh-super-code-connection-token', 'aria-label': t('connection.token'), value: token, readOnly: true, autoComplete: 'off', spellCheck: false }),
      React.createElement('small', null, t('connection.tokenHint'))),
    notice && React.createElement('p', { role: 'status' }, t(`connection.${notice}`)),
    (error || editing.error) && React.createElement('div', { className: 'dsh-super-code-settings-actions' },
      React.createElement('p', { role: 'alert' }, t(`connection.error.${error || editing.error}`)),
      !error && editing.error === 'save-failed' && React.createElement(ActionButton, { type: 'button', disabled: disabled || saving,
        onClick: () => { if (!disabled && !editor.getSnapshot().saving) void editor.retry() } }, t('save.retry'))),
    browser && React.createElement(DirectoryBrowser, { api, t, onSelect: choose, onClose: () => setBrowser(false) }))
}
function ConnectionConsent({ api, remote, t }) {
  const [requests, setRequests] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState(false)
  const dialog = useRef(null), alive = useRef(false), resolving = useRef(false), settled = useRef(new Set())
  const current = requests[0]
  useEffect(() => {
    alive.current = true
    let stream, disposed = false
    void (async () => {
      stream = remote.$stream({ name: 'Super Code directory consent', open: signal => api.watchDirectories(signal),
        ended: () => new Error('Directory consent stream ended'), carrierFailed: () => { if (!disposed) setRequests([]) } })
      for await (const item of stream) {
        if (disposed || stream.signal.aborted) return
        setError(false)
        setRequests(item.value.filter(row => !settled.current.has(row.id)))
        item.accept()
      }
    })().catch(error => { if (!disposed) { setRequests([]); setError(true); console.warn('Super Code directory consent:', error) } })
    return () => {
      alive.current = false; disposed = true
      void (async () => { await stream?.dispose() })().catch(error => console.warn('Super Code directory consent cleanup:', error))
    }
  }, [api, remote])
  const resolve = async decision => {
    if (resolving.current || !current) return
    resolving.current = true; setBusy(true); setError(false)
    try {
      const result = await api.resolveDirectory(current.id, decision)
      if (!result.ok) throw new Error()
      if (alive.current) { settled.current.add(current.id); setRequests(rows => rows.filter(row => row.id !== current.id)); window.dispatchEvent(new Event('super-code-directories-changed')) }
    } catch { if (alive.current) setError(true) }
    finally { resolving.current = false; if (alive.current) setBusy(false) }
  }
  useEffect(() => {
    if (!current || !dialog.current) return
    setError(false)
    const element = dialog.current; element.showModal(); element.querySelector('[data-consent-reject]')?.focus()
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!resolving.current) resolve('rejected') } }
    window.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('keydown', escape, true); if (element.open) element.close() }
  }, [current?.id])
  if (!current) return error ? React.createElement('p', { role: 'alert', className: 'dsh-super-code-connection-hint' }, t('connection.requestUnavailable')) : null
  return React.createElement('dialog', { ref: dialog, className: 'dsh-super-code-confirm', 'aria-labelledby': 'super-code-consent-title',
    onCancel: event => { event.preventDefault(); event.stopPropagation(); resolve('rejected') } },
    React.createElement('h3', { id: 'super-code-consent-title' }, t('connection.requestTitle')),
    React.createElement('p', null, t('connection.requestHint')),
    React.createElement('dl', { className: 'dsh-super-code-directory-request' },
      ...[['requestClient', current.client], ['requestPath', current.path], ['requestReason', current.reason]].map(([key, value]) => React.createElement('div', { key }, React.createElement('dt', null, t(`connection.${key}`)), React.createElement('dd', null, value)))),
    error && React.createElement('p', { role: 'alert' }, t('connection.requestError')),
    React.createElement('div', { className: 'dsh-super-code-confirm-actions' },
      React.createElement(ActionButton, { type: 'button', disabled: busy, 'data-consent-reject': true, onClick: () => resolve('rejected') }, t('connection.rejectDirectory')),
      React.createElement(ActionButton, { type: 'button', disabled: busy, className: 'dsh-super-code-primary-button', onClick: () => resolve('approved') }, t('connection.approveDirectory'))))
}

export { ConnectionConsent, ConnectionSettings, connectionConfiguration, connectionDraft, connectionSessions, createConnectionAutosave }
