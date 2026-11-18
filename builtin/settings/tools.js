import React, { useEffect, useState, useSyncExternalStore } from '../ui/react.js'
import { ActionButton } from '../ui/controls.js'
import { Callout, ConnectionSwitch, SaveIndicator, SettingRow, SettingsSection } from './controls.js'
import { autosaveState, createAutosave, settingsRevision } from './editors.js'
import { text } from '../ui/locale.js'

function createToolAutosave(api) {
  return createAutosave(api, { draft: { version: 1, activeId: 'builtin:ptc', custom: [] },
    toDraft: value => structuredClone(value),
    toConfiguration: draft => ({ ok: draft.custom.every(profile => profile.name.trim().length > 0 && profile.name.trim().length <= 60), configuration: draft }),
  })
}
function toolConfiguration(configuration, operation) {
  const next = structuredClone(configuration)
  if (operation.type === 'use') next.activeId = operation.id
  if (operation.type === 'edit') next.custom = next.custom.map(profile => profile.id === operation.id ? { ...profile, ...operation.patch } : profile)
  if (operation.type === 'delete') {
    next.custom = next.custom.filter(profile => profile.id !== operation.id)
    if (next.activeId === operation.id) next.activeId = 'builtin:ptc'
  }
  return next
}

function ToolSettings({ api, editor, t, active }) {
  const editing = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot)
  const [selected, setSelected] = useState(''), [sessions, setSessions] = useState([]), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [confirmation, setConfirmation] = useState('')
  const reload = async () => {
    setBusy(true)
    try {
      const response = await api.readConfig()
      if (!response.ok) throw new Error('Remote unavailable')
      editor.receive(response.value); setSessions(response.value.sessions); setError('')
    } catch { setError('connection') }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!active) return undefined
    let disposed = false, timer
    const read = async () => {
      try {
        await editor.flush()
        if (editor.hasChanges()) return
        const response = await api.readConfig()
        if (disposed) return
        if (!response.ok) throw new Error('Remote unavailable')
        editor.receive(response.value)
        setSessions(response.value.sessions)
        setError('')
      } catch { if (!disposed) setError('connection') }
    }
    const status = async () => {
      try {
        const result = await api.status()
        if (!result.ok) throw new Error('Remote unavailable')
        if (!disposed) setSessions(result.value)
      }
      catch { if (!disposed) setError('connection') }
      finally { if (!disposed) timer = setTimeout(status, 2000) }
    }
    void read()
    timer = setTimeout(status, 2000)
    return () => { disposed = true; clearTimeout(timer) }
  }, [active, api, editor])
  const snapshot = editing.snapshot
  if (!snapshot) return React.createElement(Callout, { tone: error ? 'error' : 'info',
    action: error && React.createElement(ActionButton, { disabled: busy, onClick: reload }, t('budget.reload')) }, t(error ? 'tools.error.connection' : 'tools.loading'))
  const configuration = editing.draft
  const profiles = [...snapshot.builtins, ...configuration.custom]
  const profile = profiles.find(value => value.id === (selected || configuration.activeId)) ?? profiles[0]
  const builtin = profile.id.startsWith('builtin:')
  const editable = !builtin && snapshot.writable && !busy
  const title = value => value.id.startsWith('builtin:') ? t(`tools.mode.${value.name}`) : value.name
  const change = operation => editor.change(toolConfiguration(configuration, operation), operation.type === 'edit' ? 350 : 0)
  const edit = patch => change({ type: 'edit', id: profile.id, patch })
  const use = async () => {
    await editor.flush()
    if (!editor.hasChanges()) change({ type: 'use', id: profile.id })
  }
  const copy = async sourceId => {
    setBusy(true); setError('')
    try {
      await editor.flush()
      if (editor.hasChanges()) return
      const response = await api.copyProfile(sourceId, settingsRevision(editor.getSnapshot().snapshot))
      if (!response.ok) throw new Error('Remote unavailable')
      if (!response.value.ok) { setError(response.value.error); return }
      editor.receive(response.value.snapshot)
      setSelected(response.value.snapshot.configuration.custom.at(-1).id)
    } catch { setError('connection') }
    finally { setBusy(false) }
  }
  const pending = sessions.filter(session => session.state === 'pending' || session.state === 'applying').length
  const failed = sessions.filter(session => session.state === 'error')
  const groups = [...new Set(snapshot.catalog.map(tool => tool.group))]
  return React.createElement(React.Fragment, null,
    React.createElement(SettingsSection, { id: 'super-code-tools', title: t('tools.title'), description: t('tools.description'),
      actions: React.createElement('span', null, text(t, 'tools.count', { count: profiles.length })) },
      React.createElement(SettingRow, { id: 'super-code-tool-profile', label: t('tools.profile'), hint: text(t, 'tools.current', { name: title(profiles.find(value => value.id === configuration.activeId)) }) },
        React.createElement('select', { id: 'super-code-tool-profile', value: profile.id, onChange: event => setSelected(event.target.value) },
          ...profiles.map(value => React.createElement('option', { key: value.id, value: value.id }, title(value))))),
      React.createElement('div', { className: 'dsh-super-code-settings-actions' },
        React.createElement(ActionButton, { disabled: !snapshot.writable || busy || configuration.activeId === profile.id, onClick: use }, t('tools.use')),
        React.createElement(ActionButton, { disabled: !snapshot.writable || busy || profiles.length >= 30, onClick: () => copy(profile.id) }, t('tools.copy')),
        React.createElement(ActionButton, { disabled: !snapshot.writable || busy || profiles.length >= 30, onClick: () => copy('') }, t('tools.new')),
        !builtin && React.createElement(ActionButton, { disabled: !editable, onClick: () => setConfirmation(profile.id) }, t('tools.delete'))),
      builtin ? React.createElement(Callout, {}, t('tools.builtin'))
        : React.createElement(SettingRow, { id: 'super-code-tools-name', label: t('tools.name') },
          React.createElement('input', { id: 'super-code-tools-name', maxLength: 60, value: profile.name, disabled: !editable, onChange: event => edit({ name: event.target.value }) })),
      ...['execution', 'shell'].map(field => React.createElement(SettingRow, { key: field, id: `super-code-tools-${field}`, label: t(`tools.${field}`) },
        React.createElement('select', { id: `super-code-tools-${field}`, value: profile[field], disabled: !editable, onChange: event => edit({ [field]: event.target.value }) },
          ...(field === 'execution' ? ['native', 'ptc'] : ['standard', 'persistent']).map(value =>
            React.createElement('option', { key: value, value }, t(`tools.${field}.${value}`)))))),
      pending > 0 && React.createElement(Callout, {}, text(t, 'tools.pending', { count: pending })),
      ...sessions.filter(session => session.reason).map(session => React.createElement(Callout, { key: session.sessionId },
        React.createElement('code', null, session.sessionId), ' ', t(`tools.reason.${session.reason}`))),
      failed.length > 0 && React.createElement(Callout, { tone: 'error' }, text(t, 'tools.failed', { count: failed.length }),
        ...failed.map(session => React.createElement('p', { key: session.sessionId }, React.createElement('code', null, session.sessionId), ' ', session.error))),
      React.createElement(SaveIndicator, { state: autosaveState(editing), t }),
      !snapshot.writable && React.createElement(Callout, {}, t('tools.readonly')),
      (error || editing.error) && React.createElement(Callout, { tone: 'error',
        action: React.createElement(ActionButton, { disabled: busy, onClick: error === 'connection' || editing.error === 'conflict'
          ? () => setConfirmation('reload') : () => editor.retry() }, t(error === 'connection' || editing.error === 'conflict' ? 'budget.reload' : 'save.retry')) },
      t(`tools.error.${error || editing.error}`))),
    ...groups.map(group => React.createElement(SettingsSection, { key: group, id: `super-code-tools-${group}`, title: t(`tools.group.${group}`) },
      ...snapshot.catalog.filter(tool => tool.group === group).map(tool => React.createElement(SettingRow, {
        key: tool.name, id: `super-code-tool-${tool.name}`, label: tool.name,
        hint: group === 'external' ? t('tools.external') : tool.reason === 'not-loaded' ? t('tools.notLoaded')
          : !tool.available ? [t('tools.unavailable'), tool.reason].filter(Boolean).join(' ') : undefined,
      }, React.createElement(ConnectionSwitch, { id: `super-code-tool-${tool.name}`, checked: group === 'external' || profile.tools.includes(tool.name), disabled: group === 'external' || !editable,
        onChange: checked => edit({ tools: checked ? [...profile.tools, tool.name] : profile.tools.filter(name => name !== tool.name) }) }))))),
    confirmation && React.createElement('div', { role: 'alertdialog', 'aria-label': t(confirmation === 'reload' ? 'budget.reload' : 'tools.delete'), className: 'dsh-super-code-callout' },
      React.createElement('p', null, t(confirmation === 'reload' ? 'tools.reloadConfirm' : confirmation === configuration.activeId ? 'tools.deleteActive' : 'tools.deleteConfirm')),
      React.createElement(ActionButton, { onClick: () => {
        if (confirmation === 'reload') void reload()
        else { change({ type: 'delete', id: confirmation }); setSelected('') }
        setConfirmation('')
      } }, t(confirmation === 'reload' ? 'budget.reload' : 'tools.delete')),
      React.createElement(ActionButton, { onClick: () => setConfirmation('') }, t('tools.cancel'))))
}

export { ToolSettings, createToolAutosave, toolConfiguration }
