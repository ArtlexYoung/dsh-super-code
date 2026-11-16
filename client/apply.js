import { agentDetailAddress } from '../builtin/sidebar/address.js'
import { LOCALE_NS, LocalizedTabTitle, en, zh } from '../builtin/ui/locale.js'
import { budgetRemoteContribution, connectionRemoteContribution, memoryRemoteContribution, presetRemoteContribution } from '../builtin/settings/remote.js'
import { skillPackageSource, synchronizeSkillMenus } from '../builtin/settings/skills.js'
import { ConnectionConsent } from '../builtin/settings/connection.js'
import { createSettingsServices } from '../builtin/settings/services.js'
import { PresetSettings, synchronizePresetDisplay } from '../builtin/settings/presets.js'
import { AgentDetailTitle, agentTabTitle } from '../builtin/sidebar/agents.js'
import { memoryLibraryAddress } from '../builtin/sidebar/memory.js'
import { AgentDetail, createAgentInspector } from '../builtin/sidebar/detail.js'
import { SuperCodeWorkspace } from '../builtin/sidebar/workspace.js'
import stylesheet from '../builtin/ui/style.css'
import { connectRemote } from '../builtin/ui/remote.js'

const inject = [
  'slots', 'remote', 'remote.session', 'sessions', 'locale',
  'sidebarRightTabs', 'sidebarRight',
]

function apply(ctx) {
  const locale = ctx.locale || { register: () => () => {}, bind: () => key => zh[key] || key }
  ctx.effect(() => locale.register(LOCALE_NS, { zh, en }), 'dsh-super-code: dictionaries')
  const t = locale.bind(LOCALE_NS)
  // $mount creates a lifecycle effect on this same fiber; awaiting it from
  // another effect would stall the namespace and the settings contribution.
  void ctx.remote.$mount({ package: 'dsh-super-code', descriptors: [
    ...presetRemoteContribution.descriptors, ...memoryRemoteContribution.descriptors, ...budgetRemoteContribution.descriptors, ...connectionRemoteContribution.descriptors,
  ] }).catch(error => console.warn('Super Code Remote:', error))
  const memoryStates = new WeakMap(), workspaceStates = new WeakMap()
  const navigation = { openSession: () => {} }
  ctx.inject(['uiWorkspace'], ready => {
    navigation.openSession = id => {
      if (typeof ready.uiWorkspace.openSession === 'function') ready.uiWorkspace.openSession(id)
      else ready.sessions.open(id)
    }
    ready.effect(() => () => { navigation.openSession = () => {} })
  })
  ctx.inject(['remote.superCodeBudgets', 'inputTriggers'], ready => {
    ready.effect(() => synchronizeSkillMenus(ready, ready.remote.superCodeBudgets, require('@deepseek-ai/dsh-client-ui-skill'),
      error => console.warn('Super Code Skill menu refresh:', error)), 'super-code: live skill menus')
  })
  ctx.inject(['remote.skills', 'inputTriggers'], ready => {
    ready.effect(() => ready.inputTriggers.registerSource(skillPackageSource(ready)), 'super-code: skill package search')
  })
  ctx.inject(['remote.superCodeConnection'], ready => {
    ready.slots.inject('shell.overlay', () => ready.slots.register({
      name: 'shell.overlay', id: 'super-code-directory-consent', order: 180, locale: LOCALE_NS,
      inject: () => ({ api: ready.remote.superCodeConnection }),
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
  const settings = createSettingsServices(ctx)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'super-code', order: 120, label: () => t('preset.title'), locale: LOCALE_NS,
    inject: () => ({ ...settings, openSession: id => navigation.openSession(id) }),
  }, PresetSettings))
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshSuperCode = 'true'
    style.textContent = stylesheet
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'super-code: browser styles')
  // Keep the original tree kind so restored tabs become the unified workspace.
  const treeId = 'dsh-super-code'
  const treeKind = 'super-agent-agents'
  const disposeTreeType = ctx.sidebarRightTabs.register({
    id: treeId, kind: treeKind,
    title: () => t('workspace.title'),
    guide: [{ order: 40, title: () => t('workspace.title'), description: () => t('workspace.description') }],
  })
  const disposeMemoryType = ctx.sidebarRightTabs.register({ id: 'dsh-super-code-memory', kind: 'super-code-memory',
    patterns: ['dsh-resource://super-code-memory/**'], title: () => t('workspace.title'),
  })
  const openMemory = (sessionId, row) => ctx.sidebarRight.openTab(treeKind, { params: { memory: memoryLibraryAddress(sessionId, row) } })
  const treeActions = {
    // The host unmounts hidden bodies; tab signals live until close/unload.
    treeStates: new WeakMap(),
    refresh: id => ctx.sessions.refreshSubagents ? ctx.sessions.refreshSubagents(id) : ctx.sessions.refreshProjections(id),
    watchCatalog: (id, open) => {
      if (ctx.sessions.setSubagentCatalogOpen) ctx.sessions.setSubagentCatalogOpen(id, open)
      else if (open) void ctx.sessions.refreshProjections(id).catch(error => console.warn('Super Code projections:', error))
    },
    openDetail: child => ctx.sidebarRight.openResource(agentDetailAddress(child), { kind: 'super-agent-detail' }),
  }
  const disposeDetailType = ctx.sidebarRightTabs.register({
    id: 'dsh-super-code-detail', kind: 'super-agent-detail', patterns: ['dsh-resource://super-agent/**'],
    title: address => {
      return agentTabTitle(ctx.sessions.list.getSnapshot(), address, t)
    },
  })
  ctx.slots.inject('sidebar.right.pane.tab.title', function* () {
    for (const [key, titleKey] of [[treeId, 'workspace.title'], ['dsh-super-code-memory', 'workspace.title']]) {
      yield ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key, locale: LOCALE_NS,
        inject: () => ({ titleKey }),
      }, LocalizedTabTitle)
    }
    yield ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: 'dsh-super-code-detail', locale: LOCALE_NS }, AgentDetailTitle)
  })
  const detailActions = { openMemory, detailStates: new WeakMap(), createInspector: (address, initial) => createAgentInspector(
    (target, options) => new (require('@deepseek-ai/dsh-api-session-controller').SessionEventStream)(ctx.remote, target, options), address,
    (request, signal) => ctx.remote.session.page(request, signal), initial, t) }
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: 'dsh-super-code-detail', locale: LOCALE_NS, inject: () => ({ ...detailActions }),
  }, AgentDetail))
  const memoryApi = connectRemote(ctx, memoryRemoteContribution)
  ctx.slots.inject('sidebar.right.pane.tab', function* () {
    // 旧键继续恢复历史记忆页；记忆服务不可用时，任务和 Agent 树仍可打开。
    for (const key of [treeId, 'dsh-super-code-memory']) yield ctx.slots.register({
      name: 'sidebar.right.pane.tab', key, locale: LOCALE_NS,
      inject: () => ({ ...treeActions, api: memoryApi, memoryStates, workspaceStates }),
    }, SuperCodeWorkspace)
  })
  ctx.effect(() => disposeTreeType, 'super-code: workspace tab')
  ctx.effect(() => disposeDetailType, 'super-code: Agent detail tab')
  ctx.effect(() => disposeMemoryType, 'super-code: memory library tab')
}

export { apply, inject }
