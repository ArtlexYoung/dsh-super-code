import { descriptors as workbenchDescriptors } from '../builtin/workbench/remote.js'
import { ActionButton, SelectControl, icons } from '../builtin/ui/controls.js'
import { connectRemote } from '../builtin/ui/remote.js'
import { WorkbenchConversation } from './workbench/conversation.js'
import { DirectoryRecovery } from './workbench/directory.js'
import { LOCALE_NS, en, zh } from '../builtin/ui/locale.js'
import { budgetRemoteContribution, connectionRemoteContribution, memoryRemoteContribution, presetRemoteContribution, toolRemoteContribution } from '../builtin/settings/remote.js'
import { skillPackageSource, synchronizeSkillMenus } from '../builtin/settings/skills.js'
import { ConnectionConsent } from '../builtin/settings/connection.js'
import { createSettingsServices } from '../builtin/settings/services.js'
import { PresetSettings, synchronizePresetDisplay } from '../builtin/settings/presets.js'
import { applySidebar } from '../builtin/sidebar/apply.js'
import stylesheet from '../builtin/ui/style.css'
import { applyWorkflows } from '../builtin/workflows/apply.jsx'

const inject = ['slots', 'remote', 'locale']

function apply(ctx) {
  const locale = ctx.locale || { register: () => () => {}, bind: () => key => zh[key] || key }
  ctx.effect(() => locale.register(LOCALE_NS, { zh, en }), 'dsh-super-code: dictionaries')
  const t = locale.bind(LOCALE_NS)
  // $mount creates a lifecycle effect on this same fiber; awaiting it from
  // another effect would stall the namespace and the settings contribution.
  void ctx.remote.$mount({ package: 'dsh-super-code', descriptors: [
    ...presetRemoteContribution.descriptors, ...memoryRemoteContribution.descriptors, ...budgetRemoteContribution.descriptors, ...connectionRemoteContribution.descriptors, ...toolRemoteContribution.descriptors, ...workbenchDescriptors,
  ] }).catch(error => console.warn('Super Code Remote:', error))
  const navigation = { openSession: () => {} }
  ctx.inject(['uiWorkspace', 'sessions'], ready => {
    navigation.openSession = id => {
      if (typeof ready.uiWorkspace.openSession === 'function') ready.uiWorkspace.openSession(id)
      else ready.sessions.open(id)
    }
    ready.effect(() => () => { navigation.openSession = () => {} })
  })
  ctx.inject(['remote.superCodeBudgets', 'inputTriggers', 'sessions'], ready => {
    ready.effect(() => synchronizeSkillMenus(ready, ready.remote.superCodeBudgets, require('@deepseek-ai/dsh-client-ui-skill'),
      error => console.warn('Super Code Skill menu refresh:', error)), 'super-code: live skill menus')
  })
  ctx.inject(['remote.skills', 'inputTriggers', 'sessions'], ready => {
    ready.effect(() => ready.inputTriggers.registerSource(skillPackageSource(ready)), 'super-code: skill package search')
  })
  ctx.inject(['remote.superCodeConnection'], ready => {
    ready.slots.inject('shell.overlay', () => ready.slots.register({
      name: 'shell.overlay', id: 'super-code-directory-consent', order: 180, locale: LOCALE_NS,
      inject: () => ({ api: ready.remote.superCodeConnection, remote: ready.remote }),
    }, ConnectionConsent))
  })
  // Locale already requires its host's preference service. Declare that same
  // service here: Cordis rejects even optional reads without an injection.
  const preferenceService = 'configForms' in ctx ? 'configForms' : 'settingsScope'
  ctx.inject(['remote.superCodePresets', preferenceService], ready => {
    const preferenceScope = preferenceService === 'configForms'
      ? ready.configForms.get('locale') : ready.settingsScope.bind({ namespace: 'locale' })
    ready.effect(() => synchronizePresetDisplay(ready.remote.superCodePresets, locale,
      () => window.location.reload(), error => console.warn('Super Code preset display:', error), preferenceScope), 'super-code: preset display')
  })
  let workbenchValue = null
  const workbenchListeners = new Set()
  const workbenchState = { snapshot: () => workbenchValue, subscribe: listener => { workbenchListeners.add(listener); return () => workbenchListeners.delete(listener) } }
  applyWorkflows(ctx, () => workbenchState.snapshot()?.preference.snapshot().enabled === true)
  const updateWorkbench = value => { workbenchValue = value; for (const listener of workbenchListeners) listener() }
  const workbenchRemote = connectRemote(ctx, { descriptors: workbenchDescriptors })
  ctx.inject(['sessions', 'sidebarRightTabs'], ready => {
    const workbench = require('super-code-workbench')
    const preference = workbench.createWorkbenchPreference(localStorage)
    ready.effect(() => () => updateWorkbench(null))
    const ui = workbench.apply(ready, { Button: ActionButton, Select: SelectControl, MarkdownText: icons.MarkdownText, Conversation: WorkbenchConversation, preference })
    updateWorkbench({ preference, ui })
  })
  ctx.inject(['remote.superCodeWorkbench', 'remote.superCodeConnection'], ready => {
    ready.slots.inject('conversation.session.header.actions', () => ready.slots.register({
      name: 'conversation.session.header.actions', id: 'super-code-directory-recovery', order: 140, locale: LOCALE_NS,
      inject: () => ({ api: ready.remote.superCodeWorkbench, directoryApi: ready.remote.superCodeConnection, openSession: id => navigation.openSession(id) }),
    }, DirectoryRecovery))
  })
  const settings = createSettingsServices(ctx)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'super-code', order: 120, label: () => t('preset.title'), locale: LOCALE_NS,
    inject: () => ({ ...settings, workbenchState, workbenchRemote, openSession: id => navigation.openSession(id) }),
  }, PresetSettings))
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshSuperCode = 'true'
    style.textContent = stylesheet
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'super-code: browser styles')
  // 视图状态属于父级，侧栏依赖卸载或恢复时保留草稿与浏览位置。
  const sidebar = { memoryStates: new WeakMap(), workspaceStates: new WeakMap(), treeStates: new WeakMap(), detailStates: new WeakMap() }
  ctx.inject(['remote.session', 'sessions', 'sidebarRightTabs', 'sidebarRight'], ready => applySidebar(ready, t, { ...sidebar, workbenchState, workbenchRemote }))
}

export { apply, inject }
