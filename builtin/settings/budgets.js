import { autosaveState, autosaveValidationErrors, createAutosave, createSettingsEditors, settingsRevision } from './editors.js'
import React, { useSyncExternalStore, useState, useRef, useEffect, useLayoutEffect } from '../ui/react.js'
import { Callout, ChoiceCards, ConnectionSwitch, SaveIndicator, SettingRow, SettingsSection } from './controls.js'
import { text } from '../ui/locale.js'
import { ActionButton, Glyph, SelectControl } from '../ui/controls.js'

const skillGroups = [
  { id: 'individual', keys: ['grillMeSkill', 'oilUiSkill'] },
  { id: 'workflows', keys: ['mattpocockSkills', 'pstackSkills', 'openspecSkills'] },
]
const skillPackageKeys = skillGroups.flatMap(group => group.keys)
const budgetFields = [
  { key: 'thresholdRatio', group: 'context', factor: 0.01, min: 1, max: 100, step: 'any' },
  { key: 'retainRatio', group: 'context', factor: 0.01, min: 0, max: 100, step: 'any' },
  { key: 'summaryMaxTokens', group: 'context', factor: 1, min: 1, step: 1 },
  { key: 'ptcTimeoutMs', group: 'execution', factor: 1000, min: 0.001, step: 0.001 },
  { key: 'ptcMaxTimeoutMs', group: 'execution', factor: 1000, min: 0.001, step: 0.001 },
  { key: 'compactionRetries', group: 'advanced', factor: 1, min: 0, max: 10, step: 1 },
  { key: 'maxOverflowRetries', group: 'advanced', factor: 1, min: 0, max: 10, step: 1 },
  { key: 'maxTasks', group: 'superCode', root: true, factor: 1, min: 1, max: 128, step: 1 },
  { key: 'maxContextBytes', group: 'superCode', root: true, factor: 1, min: 1024, max: 262144, step: 1 },
]
function budgetDraft(configuration) {
  const deletion = configuration.deletionProtection
  return Object.fromEntries([...skillPackageKeys.map(key => [key, configuration[key] ?? false]), ['windowsBash', configuration.windowsBash ?? true], ['windowsBashForOfficialPresets', configuration.windowsBashForOfficialPresets ?? false], ['deletionProtection', deletion === true ? 'strict' : deletion === false ? 'off' : deletion ?? 'relaxed'], ['deletionProtectionForOfficialPresets', configuration.deletionProtectionForOfficialPresets ?? false], ['applyToOfficialPresets', configuration.applyToOfficialPresets ?? false], ['pressureBasis', configuration.budgets?.pressureBasis ?? ''],
    ...budgetFields.map(field => {
      const value = field.root ? configuration[field.key] : configuration.budgets?.[field.key]
      return [field.key, value === undefined ? '' : String(value / field.factor)]
    })])
}
function budgetConfiguration(draft, previous = {}) {
  const config = {}, budgets = {}
  const before = budgetDraft(previous)
  if (draft.deletionProtection !== undefined) {
    if (!['off', 'relaxed', 'strict'].includes(draft.deletionProtection)) return { ok: false, error: 'invalid' }
    config.deletionProtection = draft.deletionProtection
  }
  if (draft.deletionProtectionForOfficialPresets !== undefined) {
    if (typeof draft.deletionProtectionForOfficialPresets !== 'boolean') return { ok: false, error: 'invalid' }
    config.deletionProtectionForOfficialPresets = draft.deletionProtectionForOfficialPresets
  }
  if (draft.applyToOfficialPresets !== undefined) {
    if (typeof draft.applyToOfficialPresets !== 'boolean') return { ok: false, error: 'invalid' }
    config.applyToOfficialPresets = draft.applyToOfficialPresets
  }
  if (draft.pressureBasis) {
    if (!['host', 'window'].includes(draft.pressureBasis)) return { ok: false, error: 'invalid' }
    budgets.pressureBasis = draft.pressureBasis
  }
  for (const field of budgetFields) {
    const input = draft[field.key]?.trim()
    if (!input) continue
    const value = Number(input)
    if (!Number.isFinite(value) || value < field.min || (field.max !== undefined && value > field.max)) return { ok: false, error: 'invalid' }
    const scaled = value * field.factor
    const stored = field.root ? previous[field.key] : previous.budgets?.[field.key]
    // Percent/seconds formatting must not change an untouched stored number.
    const unchanged = stored !== undefined && input === before[field.key]
    const selected = unchanged ? stored : field.step === 'any' ? scaled : Math.round(scaled)
    if (field.step !== 'any' && ((!unchanged && Math.abs(selected - scaled) > 1e-7) || !Number.isSafeInteger(selected))) return { ok: false, error: 'invalid' }
    ;(field.root ? config : budgets)[field.key] = selected
  }
  if ((budgets.retainRatio ?? 0.16) >= (budgets.thresholdRatio ?? 0.8)) return { ok: false, error: 'retain' }
  if (budgets.ptcTimeoutMs !== undefined && budgets.ptcMaxTimeoutMs !== undefined && budgets.ptcTimeoutMs > budgets.ptcMaxTimeoutMs) return { ok: false, error: 'ptc-order' }
  if (Object.keys(budgets).length) config.budgets = budgets
  return { ok: true, configuration: config }
}

/** Each budget tab writes only its own fields and carries the other tab's stored values through. */
function budgetSectionConfiguration(section, draft, snapshot) {
  if (section === 'skills') return skillPackageKeys.every(key => typeof draft[key] === 'boolean')
    ? { ok: true, configuration: { ...snapshot.configuration, ...Object.fromEntries(skillPackageKeys.map(key => [key, draft[key]])) } }
    : { ok: false, error: 'invalid' }
  if (section === 'shell') return typeof draft.windowsBash === 'boolean' && typeof draft.windowsBashForOfficialPresets === 'boolean'
    ? { ok: true, configuration: { ...snapshot.configuration, windowsBash: draft.windowsBash, windowsBashForOfficialPresets: draft.windowsBashForOfficialPresets } }
    : { ok: false, error: 'invalid' }
  const parsed = budgetConfiguration(draft, snapshot.configuration)
  if (!parsed.ok) return parsed
  const current = snapshot.configuration
  return { ok: true, configuration: section === 'protection'
    ? { ...current, deletionProtection: draft.deletionProtection, deletionProtectionForOfficialPresets: draft.deletionProtectionForOfficialPresets }
    : { ...parsed.configuration, ...Object.fromEntries(skillPackageKeys.map(key => [key, current[key]])), windowsBash: current.windowsBash, windowsBashForOfficialPresets: current.windowsBashForOfficialPresets, deletionProtection: current.deletionProtection, deletionProtectionForOfficialPresets: current.deletionProtectionForOfficialPresets } }
}
function createBudgetAutosave(api, section = 'context') {
  return createAutosave(api, { draft: budgetDraft({}), toDraft: budgetDraft,
    toConfiguration: (draft, snapshot) => budgetSectionConfiguration(section, draft, snapshot) })
}

/** All budget tabs edit one document; finish local writes before another tab reads it. */
function createBudgetEditors(api) {
  return { ...createSettingsEditors(api, Object.fromEntries(['context', 'shell', 'protection', 'skills']
    .map(section => [section, source => createBudgetAutosave(source, section)]))),
    openSkillsDirectory: () => api.openSkillsDirectory(), syncSkills: () => api.syncSkills() }
}
function budgetFieldValid(field, input) {
  const value = String(input ?? '').trim()
  if (!value) return true
  const number = Number(value)
  if (!Number.isFinite(number) || number < field.min || (field.max !== undefined && number > field.max)) return false
  if (field.step === 'any') return true
  const scaled = number * field.factor, rounded = Math.round(scaled)
  return Math.abs(rounded - scaled) <= 1e-7 && Number.isSafeInteger(rounded)
}

function BudgetSettings({ api, t, active, section = 'context', presetStatus, onSaved = () => {} }) {
  const protection = section === 'protection'
  const shell = section === 'shell', skills = section === 'skills'
  const editor = api.editors[section]
  const editing = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot)
  const { snapshot, draft } = editing
  const [loading, setLoading] = useState(false), [failure, setFailure] = useState(''), [notice, setNotice] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [openingSkills, setOpeningSkills] = useState(false), [directoryError, setDirectoryError] = useState(false)
  const openSkills = async () => {
    if (openingSkills) return
    setOpeningSkills(true); setDirectoryError(false)
    try {
      const result = await api.openSkillsDirectory()
      if (!result.ok || !result.value?.opened) throw new Error('Open failed')
    } catch { if (alive.current) setDirectoryError(true) }
    finally { if (alive.current) setOpeningSkills(false) }
  }
  const alive = useRef(false), pending = useRef(false)
  const load = async (discard = false) => {
    if (pending.current) return
    pending.current = true; setLoading(true); setFailure('')
    try {
      const response = await api.readConfig()
      if (!response.ok) throw new Error('Remote unavailable')
      if (alive.current) {
        if (discard || !editor.hasChanges()) editor.receive(response.value)
        else editor.permissions(response.value.writable)
      }
    } catch { if (alive.current) setFailure('connection') }
    finally { pending.current = false; if (alive.current) setLoading(false) }
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; void editor.flush() } }, [editor])
  useEffect(() => { if (editing.saveCount) onSaved() }, [editing.saveCount])
  // Other tabs write the same document, so reread on every visit; leaving flushes pending input.
  useLayoutEffect(() => { if (active) load(); else { setConfirmReset(false); void editor.flush() } }, [editor, active])
  const reset = async () => {
    setConfirmReset(false)
    if (pending.current) return
    // Claim the whole operation, including the wait for an earlier autosave.
    pending.current = true; setLoading(true); setFailure(''); setNotice('')
    try {
      await editor.flush()
      const current = editor.getSnapshot().snapshot
      if (!alive.current || !current?.writable) return
      const base = current.configuration
      const configuration = protection
        ? { ...base, deletionProtection: 'relaxed', deletionProtectionForOfficialPresets: false }
        : { ...Object.fromEntries(skillPackageKeys.map(key => [key, base[key]])), windowsBash: base.windowsBash, windowsBashForOfficialPresets: base.windowsBashForOfficialPresets, deletionProtection: base.deletionProtection, deletionProtectionForOfficialPresets: base.deletionProtectionForOfficialPresets }
      const response = await api.saveConfig(JSON.stringify(configuration), settingsRevision(current))
      if (!response.ok) throw new Error('Remote unavailable')
      if (!alive.current) return
      if (response.value.ok) { editor.receive(response.value.snapshot); onSaved(); setNotice('resetDone') }
      else setFailure(response.value.error)
    } catch { if (alive.current) setFailure('save-failed') }
    finally { pending.current = false; if (alive.current) setLoading(false) }
  }
  const disabled = loading || !snapshot?.writable
  const edit = (key, value, delay = 0) => { setNotice(''); setFailure(''); editor.change({ [key]: value }, delay) }
  const parsed = budgetConfiguration(draft, snapshot?.configuration)
  const storedDraft = budgetDraft(snapshot?.configuration ?? {})
  const fieldError = field => draft[field.key] !== storedDraft[field.key] && !budgetFieldValid(field, draft[field.key]) ? t('budget.error.range')
    : field.key === 'retainRatio' && parsed.error === 'retain' ? t('budget.error.retain')
    : field.key === 'ptcTimeoutMs' && parsed.error === 'ptc-order' ? t('budget.error.ptc-order') : ''
  const defaultOf = field => {
    const value = field.root ? snapshot?.defaults?.[field.key] : snapshot?.defaults?.budgets?.[field.key]
    return value === undefined ? '' : Number(value / field.factor).toLocaleString('en-US', { maximumFractionDigits: 3, useGrouping: false })
  }
  const numberRow = field => {
    const id = `super-code-budget-${field.key}`, execution = field.group === 'execution', fallback = defaultOf(field)
    return React.createElement(SettingRow, { key: field.key, id, label: t(`budget.${field.key}`), error: fieldError(field),
      hint: text(t, 'budget.defaultHint', { value: fallback || t('budget.managed') }) }, described =>
      React.createElement('input', { id, type: 'number', inputMode: 'decimal', value: draft[field.key], min: field.min,
        max: execution && snapshot?.ptcMaxTimeoutMs ? snapshot.ptcMaxTimeoutMs / 1000 : field.max, step: field.step,
        placeholder: fallback || t('budget.inherit'), 'aria-invalid': fieldError(field) ? true : undefined, 'aria-describedby': described,
        disabled: disabled || (execution && snapshot?.ptcMaxTimeoutMs === false),
        onChange: event => edit(field.key, event.target.value, 500), onBlur: () => { void editor.flush() } }))
  }
  const rows = group => budgetFields.filter(field => field.group === group).map(numberRow)
  const saveError = editing.error && !autosaveValidationErrors.includes(editing.error) ? editing.error : ''
  const problem = failure || saveError
  const button = (label, onClick, extra = {}) => React.createElement(ActionButton, { type: 'button', disabled: loading, onClick, ...extra }, label)
  const shellStatus = snapshot?.shell
  const windowsHost = shellStatus?.platform === 'win32'
  const shellTooltip = shellStatus && !windowsHost ? t('shell.windowsOnly') : undefined
  const content = skills ? React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'dsh-super-code-settings-footer-actions' },
      button(t('skills.openDirectory'), openSkills, { disabled: openingSkills || !snapshot?.skills?.canOpen, title: snapshot?.skills?.canOpen ? t('skills.openDirectory') : t('skills.directoryUnavailable') })),
    directoryError && React.createElement(Callout, { tone: 'error' }, React.createElement('p', null, t('skills.openFailed'))),
    snapshot?.skills?.state === 'error' && React.createElement(Callout, { tone: 'warning', action: button(t('skills.retry'), async () => {
      try { await editor.flush(); const result = await api.syncSkills(); if (!result.ok) throw new Error('Sync failed'); if (alive.current) await load() }
      catch { if (alive.current) setDirectoryError(true) }
    }) }, React.createElement('p', null, t('skills.directoryError'))),
    ...skillGroups.map((group, index) => React.createElement(SettingsSection, { key: group.id, id: `super-code-skills-${group.id}`, title: t(`skills.${group.id}`), description: index === 0 ? t('skills.scope') : undefined },
      ...group.keys.map(key => React.createElement(SettingRow, { key, id: `super-code-skill-${key}`,
        label: React.createElement(React.Fragment, null, t(`skills.${key}`), snapshot?.skillPackages?.[key]?.version &&
          React.createElement('span', { className: 'dsh-super-code-skill-version' }, `v${snapshot.skillPackages[key].version}`)), hint: t(`skills.${key}Hint`) }, described =>
        React.createElement(ConnectionSwitch, { id: `super-code-skill-${key}`, checked: draft[key], disabled, 'aria-describedby': described, onChange: value => edit(key, value) }))))),
    !snapshot?.skills && presetStatus && !presetStatus.skillPacks && React.createElement(Callout, { tone: 'warning' }, React.createElement('p', null, t(presetStatus.state === 'missing' ? 'skills.missing' : 'skills.upgrade'))),
    React.createElement('div', { className: 'dsh-super-code-settings-guidance' },
      ...['commands', 'openspecRequirement', 'pstackRequirement'].map(key =>
        React.createElement('p', { key }, t(`skills.${key}`)))))
    : shell ? React.createElement(SettingsSection, { id: 'super-code-shell', title: t('shell.title') },
    React.createElement(SettingRow, { id: 'super-code-windows-bash', label: t('shell.enabled'),
      hint: !windowsHost ? t('shell.otherPlatform') : t('shell.hint') }, described =>
      React.createElement(ConnectionSwitch, { id: 'super-code-windows-bash', checked: draft.windowsBash,
        disabled: disabled || !windowsHost, tooltip: shellTooltip, 'aria-describedby': described,
        onChange: value => edit('windowsBash', value) })),
    React.createElement(SettingRow, { id: 'super-code-windows-bash-official', label: t('shell.official'), hint: t('shell.officialHint') }, described =>
      React.createElement(ConnectionSwitch, { id: 'super-code-windows-bash-official', checked: draft.windowsBashForOfficialPresets,
        disabled: disabled || !windowsHost || !draft.windowsBash, tooltip: shellTooltip, 'aria-describedby': described,
        onChange: value => edit('windowsBashForOfficialPresets', value) })),
    windowsHost && React.createElement('p', { className: 'dsh-super-code-shell-status', role: 'status' },
      React.createElement('span', null, t(!draft.windowsBash ? 'shell.host' : `shell.${shellStatus.state}`)),
      shellStatus.version && draft.windowsBash && React.createElement('code', null, shellStatus.version)),
    shellStatus?.state === 'error' && draft.windowsBash && React.createElement(Callout, { tone: 'error' },
      React.createElement('p', null, shellStatus.error)))
    : protection ? React.createElement(React.Fragment, null,
    React.createElement(SettingsSection, { id: 'super-code-deletion-mode', title: t('delete.mode'), plain: true },
      React.createElement(ChoiceCards, { name: 'super-code-deletion-mode', label: t('delete.mode'), value: draft.deletionProtection, disabled,
        choices: ['off', 'relaxed', 'strict'].map(mode => [mode, t(`delete.${mode}`), t(`delete.hint.${mode}`)]),
        onChange: value => edit('deletionProtection', value) })),
    React.createElement(SettingsSection, { id: 'super-code-deletion-scope', title: t('delete.scope') },
      React.createElement(SettingRow, { id: 'super-code-deletion-official', label: t('delete.official'), hint: t('delete.officialHint') }, described =>
        React.createElement(ConnectionSwitch, { id: 'super-code-deletion-official', checked: draft.deletionProtectionForOfficialPresets,
          disabled: disabled || draft.deletionProtection === 'off', 'aria-describedby': described,
          onChange: value => edit('deletionProtectionForOfficialPresets', value) }))))
    : React.createElement(React.Fragment, null,
      React.createElement(Callout, { tone: 'info' }, React.createElement('p', null, t('budget.scope')), React.createElement('p', null, t('budget.defaults'))),
      React.createElement(SettingsSection, { id: 'super-code-budget-common', title: t('budget.common') },
        React.createElement(SettingRow, { id: 'super-code-budget-official', label: t('budget.applyToOfficialPresets'), hint: t('budget.officialHint') }, described =>
          React.createElement(ConnectionSwitch, { id: 'super-code-budget-official', checked: draft.applyToOfficialPresets, disabled, 'aria-describedby': described,
            onChange: value => edit('applyToOfficialPresets', value) }))),
      React.createElement(SettingsSection, { id: 'super-code-budget-context', title: t('budget.context'), description: t('budget.contextHint') },
        React.createElement(SettingRow, { id: 'super-code-budget-basis', label: t('budget.pressureBasis'), hint: text(t, 'budget.defaultHint', { value: t('budget.host') }) },
          React.createElement(SelectControl, { id: 'super-code-budget-basis', label: t('budget.pressureBasis'), value: draft.pressureBasis, disabled,
            choices: [['', t('budget.inherit')], ['host', t('budget.host')], ['window', t('budget.window')]], onChange: value => edit('pressureBasis', value) })),
        ...rows('context'),
        React.createElement('details', { className: 'dsh-super-code-section-more' },
          React.createElement('summary', null, React.createElement(Glyph, { type: 'chevron' }), t('budget.advanced')), ...rows('advanced'))),
      React.createElement(SettingsSection, { id: 'super-code-budget-execution', title: t('budget.execution'),
        description: [t(snapshot?.ptcMaxTimeoutMs === false ? 'budget.ptcUnavailable' : 'budget.ptcHint'),
          snapshot?.ptcMaxTimeoutMs && text(t, 'budget.ptcCeiling', { seconds: snapshot.ptcMaxTimeoutMs / 1000 })] }, ...rows('execution')),
      React.createElement(SettingsSection, { id: 'super-code-budget-exclusive', title: t('budget.superCode'), description: t('budget.superCodeHint') }, ...rows('superCode')))
  return React.createElement('section', { className: 'dsh-super-code-budgets' },
    React.createElement('form', { className: 'dsh-super-code-stack', 'aria-label': t(skills ? 'skills.title' : shell ? 'shell.title' : protection ? 'delete.title' : 'budget.title'), 'aria-busy': loading || editing.saving,
      onSubmit: event => { event.preventDefault(); void editor.flush() } },
      problem && React.createElement(Callout, { tone: 'error',
        action: failure === 'connection' || problem === 'conflict' ? button(t('budget.reload'), () => load(true))
          : saveError ? button(t('save.retry'), () => { void editor.retry() }, { disabled }) : null },
        React.createElement('p', null, t(`budget.error.${problem}`))),
      snapshot && !snapshot.writable && React.createElement(Callout, { tone: 'warning' }, React.createElement('p', null, t('budget.error.read-only'))),
      notice && React.createElement(Callout, { tone: 'success' }, React.createElement('p', null, t(`budget.${notice}`))),
      content,
      React.createElement('div', { className: 'dsh-super-code-settings-footer' },
        React.createElement(SaveIndicator, { state: autosaveState(editing), t }),
        !shell && !skills && React.createElement('div', { className: 'dsh-super-code-settings-footer-actions' },
          confirmReset ? React.createElement(React.Fragment, null,
            React.createElement('span', null, t('budget.resetQuestion')),
            button(t('preset.cancel'), () => setConfirmReset(false)),
            button(t('budget.resetConfirm'), reset, { className: 'dsh-super-code-danger-button', disabled }))
            : button(t('budget.reset'), () => setConfirmReset(true), { disabled })))))
}

export { BudgetSettings, budgetConfiguration, budgetDraft, createBudgetAutosave, createBudgetEditors, skillPackageKeys }
