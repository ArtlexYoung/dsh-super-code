import { agentDetailAddress } from './address.js'
import { AgentDetailTitle, agentTabTitle } from './agents.js'
import { AgentDetail, createAgentInspector } from './detail.js'
import { memoryLibraryAddress } from './memory.js'
import { SuperCodeWorkspace } from './workspace.js'
import { memoryRemoteContribution } from '../settings/remote.js'
import { LOCALE_NS, LocalizedTabTitle } from '../ui/locale.js'
import { connectRemote } from '../ui/remote.js'

function applySidebar(ctx, t, state) {
  const { memoryStates, workspaceStates, treeStates, detailStates } = state
  // 保留旧页签类型，以便恢复已有的工作区和记忆页面。
  const treeId = 'dsh-super-code'
  const treeKind = 'super-agent-agents'
  const disposeTreeType = ctx.sidebarRightTabs.register({
    id: treeId, kind: treeKind,
    title: () => t('workspace.title'),
    guide: [{ order: 40, title: () => t('workspace.title'), description: () => t('workspace.description') }],
  })
  ctx.effect(() => disposeTreeType, 'super-code: workspace tab')
  const disposeMemoryType = ctx.sidebarRightTabs.register({ id: 'dsh-super-code-memory', kind: 'super-code-memory',
    patterns: ['dsh-resource://super-code-memory/**'], title: () => t('workspace.title'),
  })
  ctx.effect(() => disposeMemoryType, 'super-code: memory library tab')
  const openMemory = (sessionId, row) => ctx.sidebarRight.openTab(treeKind, { params: { memory: memoryLibraryAddress(sessionId, row) } })
  const treeActions = {
    treeStates,
    refresh: id => ctx.sessions.refreshSubagents ? ctx.sessions.refreshSubagents(id) : ctx.sessions.refreshProjections(id),
    watchCatalog: (id, open) => {
      if (ctx.sessions.setSubagentCatalogOpen) ctx.sessions.setSubagentCatalogOpen(id, open)
      else if (open) void ctx.sessions.refreshProjections(id).catch(error => console.warn('Super Code projections:', error))
    },
    openDetail: child => ctx.sidebarRight.openResource(agentDetailAddress(child), { kind: 'super-agent-detail' }),
  }
  const disposeDetailType = ctx.sidebarRightTabs.register({
    id: 'dsh-super-code-detail', kind: 'super-agent-detail', patterns: ['dsh-resource://super-agent/**'],
    title: address => agentTabTitle(ctx.sessions.list.getSnapshot(), address, t),
  })
  ctx.effect(() => disposeDetailType, 'super-code: Agent detail tab')
  ctx.slots.inject('sidebar.right.pane.tab.title', function* () {
    for (const [key, titleKey] of [[treeId, 'workspace.title'], ['dsh-super-code-memory', 'workspace.title']]) {
      yield ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key, locale: LOCALE_NS,
        inject: () => ({ titleKey }),
      }, LocalizedTabTitle)
    }
    yield ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: 'dsh-super-code-detail', locale: LOCALE_NS }, AgentDetailTitle)
  })
  const detailActions = { openMemory, detailStates, createInspector: (address, initial) => createAgentInspector(
    (target, options) => new (require('@deepseek-ai/dsh-api-session-controller').SessionEventStream)(ctx.remote, target, options), address,
    (request, signal) => ctx.remote.session.page(request, signal), initial, t) }
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: 'dsh-super-code-detail', locale: LOCALE_NS, inject: () => ({ ...detailActions }),
  }, AgentDetail))
  const memoryApi = connectRemote(ctx, memoryRemoteContribution)
  ctx.slots.inject('sidebar.right.pane.tab', function* () {
    // 记忆服务不可用时，任务和 Agent 树仍可打开。
    for (const key of [treeId, 'dsh-super-code-memory']) yield ctx.slots.register({
      name: 'sidebar.right.pane.tab', key, locale: LOCALE_NS,
      inject: () => ({ ...treeActions, api: memoryApi, memoryStates, workspaceStates }),
    }, SuperCodeWorkspace)
  })
}

export { applySidebar }
