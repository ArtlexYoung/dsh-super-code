import { featureView } from '../ui/boundary.js'
import React, { useState, useRef, useEffect, useLayoutEffect } from '../ui/react.js'
import { settingsRevision } from './editors.js'
import { BudgetSettings, budgetDraft } from './budgets.js'
import { ActionButton, Glyph, IconRefreshOutline16 } from '../ui/controls.js'
import { ConnectionSwitch, SegmentedControl } from './controls.js'
import { ConnectionSettings, connectionSessions } from './connection.js'
import { localeCode } from '../ui/locale.js'

// Old hosts render file metadata. Synchronize through our own Remote, then
// reload their cached roster only when a managed field actually changed.
function synchronizePresetDisplay(api, locale, reload, onError, preferenceScope) {
  let disposed = false, running = false, pending = '', last = '', needsReload = false
  let observed = locale.getSnapshot().active, awaitingPreference = false, settled = false
  const changed = () => {
    const language = locale.getSnapshot().active
    if (language !== observed) { observed = language; awaitingPreference = !!preferenceScope }
    const preference = preferenceScope?.getSnapshot()
    // Locale publishes optimistically, before its host write starts. A reload
    // must wait for that preference to appear in the accepted public snapshot.
    settled = preference?.status !== 'loading'
    if (preference?.status === 'ready' && preference.mode !== 'memory') {
      if (preference.value?.preference === language) awaitingPreference = false
      else if (awaitingPreference || preference.value?.preference !== undefined) settled = false
    }
    if (!settled) return
    pending = language
    if (running || (pending === last && !needsReload)) return
    running = true
    void (async () => {
      try {
        while (!disposed && settled && pending !== last) {
          const language = pending
          const result = await api.synchronize(language)
          if (!result.ok) throw new Error('Preset display synchronization failed')
          last = language
          needsReload ||= result.value.changed
        }
        if (!disposed && settled && needsReload && pending === last) { reload(); needsReload = false }
      } catch (error) { if (!disposed) onError(error) }
      finally { running = false }
    })()
  }
  const unsubscribe = locale.subscribe(changed)
  const unsubscribePreference = preferenceScope ? preferenceScope.subscribe(changed) : () => {}
  changed()
  return () => { disposed = true; unsubscribe(); unsubscribePreference() }
}
function SettingsHome({ budgetApi, connectionApi, connectionSettings, t, active, revision, navigate, children }) {
  const [budget, setBudget] = useState(null), [connection, setConnection] = useState(null), [overview, setOverview] = useState({ connections: [], sessions: [] })
  // Keep the choice visible until the save is acknowledged.
  const [saving, setSaving] = useState(null), [failure, setFailure] = useState('')
  const [refreshing, setRefreshing] = useState({})
  const alive = useRef(false), request = useRef(0), loading = useRef({}), writing = useRef(false)
  const sequences = useRef({ budget: 0, connection: 0, overview: 0 }), readErrors = useRef(new Set())
  const load = async (force = false, blockControls = false) => {
    if (!force && writing.current) return
    const generation = request.current
    await Promise.allSettled([
      ['budget', () => budgetApi.readConfig(), setBudget],
      ['connection', () => connectionSettings.readConfig(), setConnection],
      ['overview', () => connectionApi.overview(), setOverview],
    ].map(async ([key, read, accept]) => {
      if (!force && loading.current[key]) return
      const sequence = ++sequences.current[key]
      loading.current[key] = true
      if (blockControls) setRefreshing(value => ({ ...value, [key]: true }))
      const current = () => alive.current && sequence === sequences.current[key] && generation === request.current
      try {
        const response = await read()
        if (!response.ok) throw new Error('Remote unavailable')
        if (!current()) return
        accept(response.value)
        readErrors.current.delete(key)
      } catch {
        if (current()) readErrors.current.add(key)
      } finally {
        if (current()) {
          delete loading.current[key]
          setRefreshing(value => ({ ...value, [key]: false }))
          setFailure(value => readErrors.current.size ? 'load' : value === 'load' ? '' : value)
        }
      }
    }))
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [budgetApi, connectionApi])
  useLayoutEffect(() => { if (!active) return; load(true, true); const timer = setInterval(load, 2000); return () => clearInterval(timer) }, [active, revision, budgetApi, connectionApi])
  const change = async (kind, value) => {
    const current = kind === 'protection' ? budget : connection
    if (refreshing[kind === 'protection' ? 'budget' : 'connection'] || writing.current || !current?.writable) return
    // A save supersedes any poll in flight, so a stale read cannot undo the choice.
    writing.current = true; request.current++; loading.current = {}
    setSaving({ kind, value }); setFailure('')
    let saved = false
    try {
      const configuration = kind === 'protection' ? { ...current.configuration, deletionProtection: value } : { ...current.configuration, enabled: value }
      const response = await (kind === 'protection' ? budgetApi : connectionSettings).saveConfig(JSON.stringify(configuration), settingsRevision(current))
      saved = Boolean(response.ok && response.value.ok)
      if (saved && alive.current) {
        if (kind === 'protection') setBudget(response.value.snapshot)
        else setConnection(response.value.snapshot)
      }
    } catch { /* Reported on the row below. */ }
    if (saved && alive.current) void load(true)
    writing.current = false
    if (alive.current) { setSaving(null); if (!saved) setFailure(kind) }
  }
  const mode = saving?.kind === 'protection' ? saving.value : budget ? budgetDraft(budget.configuration).deletionProtection : ''
  const enabled = saving?.kind === 'connection' ? saving.value : Boolean(connection?.configuration.enabled)
  const state = !connection || saving?.kind === 'connection' ? 'loading' : connection.state
  const listening = enabled && state === 'listening'
  const needsSetup = Boolean(connection) && !enabled && !connection.configuration.allowedDirectories.length
  const placeholder = kind => React.createElement('span', { className: 'dsh-super-code-skeleton', 'data-skeleton': kind, 'aria-hidden': true })
  const row = ({ key, icon, title, target, on, body, control }) => React.createElement('section', { className: 'dsh-super-code-home-row',
    'data-home-row': key, 'data-active': on || undefined, 'aria-label': title, 'aria-busy': saving?.kind === key || undefined },
    React.createElement('span', { className: 'dsh-super-code-home-row-icon', 'aria-hidden': true }, React.createElement(Glyph, { type: icon })),
    React.createElement('div', { className: 'dsh-super-code-home-row-text' },
      React.createElement('h3', { className: 'dsh-super-code-home-row-title' },
        React.createElement('button', { type: 'button', 'aria-label': t('home.details', { title }), onClick: () => navigate(target) }, title, React.createElement(Glyph, { type: 'chevron' }))),
      body),
    React.createElement('div', { className: 'dsh-super-code-home-row-control' }, control),
    failure === key && React.createElement('p', { role: 'alert' }, t('home.error')))
  return React.createElement('section', { className: 'dsh-super-code-home' }, children,
    failure === 'load' && React.createElement('p', { role: 'alert' }, t('home.error')),
    React.createElement('div', { className: 'dsh-super-code-home-list' },
      row({ key: 'protection', icon: 'shield', title: t('delete.title'), target: 'protection', on: Boolean(mode) && mode !== 'off',
        body: budget ? React.createElement('p', { id: 'super-code-home-protection-hint', className: 'dsh-super-code-home-row-hint' }, t(`delete.hint.${mode}`)) : placeholder('text'),
        control: budget ? React.createElement(SegmentedControl, { label: t('delete.mode'), value: mode, describedBy: 'super-code-home-protection-hint',
          choices: ['off', 'relaxed', 'strict'].map(value => [value, t(`delete.${value}`)]), disabled: refreshing.budget || Boolean(saving) || !budget.writable, busy: saving?.kind === 'protection',
          onChange: value => change('protection', value) }) : placeholder('control') }),
      row({ key: 'connection', icon: 'plug', title: t('home.mcp'), target: 'connection', on: enabled,
        body: connection ? React.createElement('p', { className: 'dsh-super-code-home-row-status', 'data-tone': state === 'listening' ? 'success' : state === 'error' ? 'error' : 'idle' },
          React.createElement('i', { 'aria-hidden': true }),
          React.createElement('span', null, t(`connection.state.${state}`)),
          listening && React.createElement('span', null, t('home.connectionCount', { count: overview.connections.length, max: connection.configuration.maxConnections })),
          listening && React.createElement('span', null, t('home.activeSessions', { count: connectionSessions(overview).connected.length }))) : placeholder('text'),
        control: needsSetup ? React.createElement(ActionButton, { type: 'button', onClick: () => navigate('connection') }, t('home.setupConnection'))
          : connection ? React.createElement(ConnectionSwitch, { checked: enabled, disabled: refreshing.connection || Boolean(saving) || !connection.writable, 'aria-label': t('home.mcp'),
            onChange: value => value && !connection.configuration.allowedDirectories.length ? navigate('connection') : change('connection', value) })
          : placeholder('control') })))
}

function PresetSettings({ api, budgetApi: budgets, connectionApi, connectionSettings, openSession = () => {}, t }) {
  const [tab, setTab] = useState('home')
  const [status, setStatus] = useState(null), [customId, setCustomId] = useState(null)
  const reinstall = status?.reinstallable ?? status?.state === 'installed'
  const name = customId ?? (reinstall ? status.id : 'super-code')
  const [customDisplayName, setCustomDisplayName] = useState(null)
  const displayName = customDisplayName ?? (reinstall ? status.name || t('preset.title') : t('preset.title'))
  const [busy, setBusy] = useState(true), [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const dialog = useRef(null)
  const alive = useRef(false), pending = useRef(false)
  useEffect(() => {
    if (!confirmation || !dialog.current) return
    const element = dialog.current
    element.showModal()
    element.querySelector('[data-super-code-cancel]')?.focus()
    // Removing the focused list row can leave focus outside the native dialog.
    // Capture Escape before the host's document listener closes Settings too.
    const target = element.ownerDocument.defaultView
    const cancel = event => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      setConfirmation(null)
    }
    target.addEventListener('keydown', cancel, true)
    return () => {
      target.removeEventListener('keydown', cancel, true)
      if (element.open) element.close()
    }
  }, [confirmation !== null])
  const run = async (install, confirmed = null) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try {
      const installName = customDisplayName === null ? '' : displayName.trim()
      const response = !install ? await api.status() : confirmed
        ? await api.reinstallPreset(confirmed.previousId, confirmed.id, confirmed.name)
        : await api.installPreset(name.trim(), installName)
      if (!response.ok) throw new Error('Remote unavailable')
      if (!alive.current) return
      const value = response.value
      setStatus(install ? value.status : value)
      if (install && !value.ok) setError(`preset.error.${value.error}`)
      if (!install || value.ok) {
        const synced = await api.synchronize(localeCode(t))
        if (!synced.ok) throw new Error('Preset display synchronization failed')
        if (alive.current && (install || synced.value.changed)) window.location.reload()
      }
    } catch {
      if (alive.current) setError('preset.error.connection')
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  useEffect(() => { alive.current = true; run(false); return () => { alive.current = false } }, [api])
  const submit = () => {
    if (busy || pending.current || !displayName.trim() || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name.trim())) return
    if (reinstall) {
      setConfirmation([{ previousId: status.id, id: name.trim(),
        name: customDisplayName === null && displayName === t('preset.title') ? '' : displayName.trim(), label: displayName.trim() }])
    } else run(true)
  }
  const available = status && ['available', 'installed'].includes(status.state)
  const versionState = status?.presetVersion ? status.presetVersion === status.pluginVersion ? 'match' : 'mismatch' : 'unknown'
  const stateProblem = Boolean(status) && ['missing', 'broken', 'conflict'].includes(status.state)
  const versionProblem = Boolean(status) && status.state !== 'missing' && versionState !== 'match'
  const [overviewRevision, setOverviewRevision] = useState(0)
  const onSaved = () => setOverviewRevision(value => value + 1)
  const tabs = ['home', 'preset', 'skills', 'context', 'protection', 'connection']
  return React.createElement('section', { className: 'dsh-super-code-settings' },
    React.createElement('div', { className: 'dsh-super-code-settings-tabs', role: 'tablist', 'aria-label': t('settings.tabs'), onKeyDown: event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const selected = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
      setTab(selected)
      event.currentTarget.querySelector(`#super-code-tab-${selected}`)?.focus()
    } }, ...tabs.map(value => React.createElement('button', { key: value, type: 'button', role: 'tab',
      id: `super-code-tab-${value}`, 'aria-selected': tab === value, 'aria-controls': `super-code-panel-${value}`,
      tabIndex: tab === value ? 0 : -1, onClick: () => setTab(value) }, t(`settings.${value}Tab`)))),
    React.createElement('div', { className: 'dsh-super-code-settings-body' },
      React.createElement('div', { role: 'tabpanel', id: 'super-code-panel-home', 'aria-labelledby': 'super-code-tab-home', hidden: tab !== 'home' },
        featureView(SettingsHome, { budgetApi: budgets, connectionApi, connectionSettings, t, active: tab === 'home', revision: overviewRevision, navigate: setTab },
      // Healthy state collapses to one status line; problems expand into a notice with its fix.
      React.createElement('header', { className: 'dsh-super-code-settings-header' },
        React.createElement('span', { className: 'dsh-super-code-settings-mark', 'aria-hidden': true }, React.createElement(Glyph, { type: 'code' })),
        React.createElement('div', { className: 'dsh-super-code-settings-head-text' },
          React.createElement('h2', { className: 'dsh-super-code-settings-name' }, t('preset.title')),
          React.createElement('div', { className: 'dsh-super-code-settings-status-row' },
            status ? React.createElement('p', { className: 'dsh-super-code-preset-status', role: 'status', 'data-available': available },
              React.createElement('i', { 'aria-hidden': true }),
              React.createElement('span', null, t(status.delivery === 'declaration' && status.state === 'installed' ? 'preset.state.declaredInstalled' : `preset.state.${status.state}`)),
              React.createElement('code', null, status.id))
              : React.createElement('p', { className: 'dsh-super-code-preset-status', role: 'status' }, busy ? t('preset.working') : t('preset.unavailableHint')),
            status && React.createElement('dl', { className: 'dsh-super-code-preset-meta' },
              React.createElement('div', null, React.createElement('dt', null, t('preset.pluginVersion')), React.createElement('dd', null, status.pluginVersion)),
              React.createElement('div', null, React.createElement('dt', null, t('preset.presetVersion')), React.createElement('dd', { 'data-stale': status.state !== 'missing' && versionState !== 'match' || undefined }, status.state === 'missing' ? t('preset.versionMissing') : status.presetVersion || t('preset.versionUnknown')))),
            status && status.state !== 'missing' && versionState === 'match' && React.createElement('span', { className: 'dsh-super-code-version-badge', 'data-version-state': 'match', title: t('preset.versionMatches') }, t('preset.versionBadge')))),
        React.createElement('div', { className: 'dsh-super-code-settings-actions' },
          React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-icon-button', disabled: busy, onClick: () => run(false), 'aria-label': t('preset.refresh') },
            React.createElement(IconRefreshOutline16, { 'aria-hidden': true })))),
      (stateProblem || versionProblem) && React.createElement('div', { className: 'dsh-super-code-preset-notice', 'data-tone': status.state === 'broken' ? 'error' : 'warning' },
        React.createElement(Glyph, { type: 'error' }),
        React.createElement('div', { className: 'dsh-super-code-preset-notice-text' },
          stateProblem && React.createElement('p', null, t(status.authorable ? 'preset.installHint' : 'preset.unavailableHint')),
          versionProblem && React.createElement('p', { 'data-version-state': versionState },
            t(versionState === 'mismatch' ? 'preset.versionMismatch' : 'preset.versionUnknownHint')),
          // The fix goes on its own line, so no locale-specific sentence joiner is needed.
          versionProblem && versionState === 'mismatch' && React.createElement('p', { className: 'dsh-super-code-preset-notice-fix' },
            t(reinstall && status.authorable ? 'preset.versionReinstallHint' : 'preset.versionReloadHint'))),
        status.authorable && React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-primary-button', onClick: () => setTab('preset') },
          t(status.state === 'missing' ? status.delivery === 'declaration' ? 'preset.installDeclared' : 'preset.install' : 'home.managePreset'))))),
      React.createElement('div', { role: 'tabpanel', id: 'super-code-panel-preset', 'aria-labelledby': 'super-code-tab-preset', hidden: tab !== 'preset' },
      status?.authorable && React.createElement('form', { onSubmit: event => { event.preventDefault(); submit() } },
        React.createElement('div', { className: 'dsh-super-code-settings-field' },
          React.createElement('label', { htmlFor: 'super-code-display-name' }, t('preset.displayName')),
          React.createElement('input', { id: 'super-code-display-name', value: displayName, maxLength: 120, required: true, disabled: busy, 'aria-describedby': 'super-code-display-name-hint', onChange: event => setCustomDisplayName(event.target.value) }),
          React.createElement('small', { id: 'super-code-display-name-hint' }, t('preset.displayNameHint'))),
        React.createElement('div', { className: 'dsh-super-code-settings-field' },
          React.createElement('label', { htmlFor: 'super-code-preset-name' }, t('preset.name')),
          React.createElement('input', { id: 'super-code-preset-name', className: 'dsh-super-code-technical', value: name, maxLength: 64, disabled: busy,
            pattern: '[a-z0-9][a-z0-9\\-]{0,63}', required: true, autoComplete: 'off', spellCheck: false,
            'aria-describedby': 'super-code-preset-name-hint', onChange: event => setCustomId(event.target.value) }),
          React.createElement('small', { id: 'super-code-preset-name-hint' }, t(status?.delivery === 'declaration' ? 'preset.declaredNameHint' : 'preset.nameHint'))),
        React.createElement('div', { className: 'dsh-super-code-settings-form-actions' },
          React.createElement(ActionButton, { type: 'submit', className: 'dsh-super-code-primary-button', disabled: busy || !displayName.trim() || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name.trim()) }, t(busy ? 'preset.working' : reinstall ? 'preset.reinstall' : status?.delivery === 'declaration' ? 'preset.installDeclared' : 'preset.install')))),
      React.createElement('div', { className: 'dsh-super-code-settings-guidance' },
        status && !status.authorable && ['missing', 'broken'].includes(status.state) && React.createElement('p', { role: 'note' }, t('preset.unavailableHint')),
        status?.userConflict && status.state !== 'conflict' && React.createElement('p', null, t('preset.userConflict')),
        status?.delivery === 'declaration' && !status.authorable && React.createElement('p', { role: 'note' }, t('preset.declaredReadonly')),
        status?.delivery === 'directory' && !status.authorable && React.createElement('p', { role: 'note' }, t('preset.readonly'))),
      error && React.createElement('p', { role: 'alert' }, t(error)),
      featureView(BudgetSettings, { api: budgets, t, section: 'shell', active: tab === 'preset', onSaved })),
      React.createElement('div', { role: 'tabpanel', id: 'super-code-panel-skills', 'aria-labelledby': 'super-code-tab-skills', hidden: tab !== 'skills' },
        featureView(BudgetSettings, { api: budgets, t, section: 'skills', presetStatus: status, active: tab === 'skills', onSaved })),
      React.createElement('div', { role: 'tabpanel', id: 'super-code-panel-context', 'aria-labelledby': 'super-code-tab-context', hidden: tab !== 'context' },
        featureView(BudgetSettings, { api: budgets, t, active: tab === 'context', onSaved })),
      React.createElement('div', { role: 'tabpanel', id: 'super-code-panel-protection', 'aria-labelledby': 'super-code-tab-protection', hidden: tab !== 'protection' },
        featureView(BudgetSettings, { api: budgets, t, section: 'protection', active: tab === 'protection', onSaved })),
      React.createElement('div', { role: 'tabpanel', id: 'super-code-panel-connection', 'aria-labelledby': 'super-code-tab-connection', hidden: tab !== 'connection' },
        featureView(ConnectionSettings, { api: connectionApi, settings: connectionSettings, t, active: tab === 'connection', openSession, onSaved }))),
    confirmation && React.createElement('dialog', { ref: dialog, className: 'dsh-super-code-confirm',
      'aria-labelledby': 'super-code-confirm-title', 'aria-describedby': 'super-code-confirm-hint',
      onKeyDown: event => { if (event.key === 'Escape') event.stopPropagation() },
      onCancel: event => { event.preventDefault(); event.stopPropagation(); setConfirmation(null) } },
      React.createElement('h3', { id: 'super-code-confirm-title' }, t('preset.confirmTitle')),
      React.createElement('p', { id: 'super-code-confirm-hint' }, t('preset.confirmHint')),
      confirmation.length ? React.createElement('ul', null, ...confirmation.map(item =>
        React.createElement('li', { key: item.previousId },
          React.createElement('div', { className: 'dsh-super-code-confirm-item-info' },
            React.createElement('span', { className: 'dsh-super-code-confirm-previous' }, React.createElement('code', null, item.previousId), ' →'),
            React.createElement('strong', null, item.label), React.createElement('code', { className: 'dsh-super-code-confirm-new-id' }, item.id)),
          React.createElement(ActionButton, { type: 'button', 'aria-label': `${t('preset.remove')}: ${item.previousId}`,
            onClick: () => setConfirmation(items => items.filter(row => row.previousId !== item.previousId)) }, t('preset.remove')))))
        : React.createElement('p', { className: 'dsh-super-code-confirm-empty', role: 'status' }, t('preset.confirmEmpty')),
      React.createElement('div', { className: 'dsh-super-code-confirm-actions' },
        React.createElement(ActionButton, { type: 'button', autoFocus: true, 'data-super-code-cancel': true, onClick: () => setConfirmation(null) }, t('preset.cancel')),
        React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-primary-button', disabled: busy || !confirmation.length,
          onClick: () => {
            if (busy || pending.current || !confirmation.length) return
            const selected = confirmation[0]
            setConfirmation(null)
            run(true, selected)
          } }, t('preset.confirm')))))
}

export { PresetSettings, synchronizePresetDisplay }
