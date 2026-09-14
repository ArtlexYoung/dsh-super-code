/* Browser entry for dsh-super-agent. It deliberately uses the Harness public
 * slot and Remote faces; no DOM selectors or private React internals are used.
 *
 * The Harness client module table serves classic scripts and expects every
 * plugin artifact to register a closure factory. Keeping the small bundle
 * self-contained here also makes the published package usable outside the
 * Harness monorepo's tsdown workspace.
 */
;(globalThis.window || globalThis).__ModuleLoader__.load({ id: 'dsh-super-agent', factory: (require) => {
const React = require('react')
const { useEffect, useMemo, useState, useSyncExternalStore } = React

function readPresetList(result) {
  if (!result?.ok) return []
  const value = result.value
  return Array.isArray(value) ? value : (value?.presets ?? [])
}

function PresetPicker({ sessionId, list, select, useProjection }) {
  const [presets, setPresets] = useState([])
  const [current, setCurrent] = useState('')
  const [error, setError] = useState('')
  const selected = useProjection?.('agentPreset')
  useEffect(() => {
    let active = true
    list().then(result => {
      if (!active) return
      const rows = readPresetList(result).filter(p => !p.broken)
      setPresets(rows)
      if (rows.length && !current) setCurrent(typeof selected === 'string' ? selected : rows[0].id)
    }).catch(e => { if (active) setError(String(e?.message ?? e)) })
    return () => { active = false }
  }, [list, selected])
  if (!presets.length) return null
  return React.createElement('label', { className: 'dsh-super-agent-preset-picker', title: error || 'Agent 预设' },
    React.createElement('span', { className: 'dsh-super-agent-preset-icon', 'aria-hidden': true }, '◎'),
    React.createElement('span', { className: 'dsh-super-agent-preset-label' }, 'Agent预设'),
    React.createElement('select', {
      value: current,
      'aria-label': 'Agent预设',
      onChange: async event => {
        const id = event.target.value
        setCurrent(id)
        setError('')
        const result = await select(sessionId, id)
        if (result && !result.ok) {
          setCurrent(typeof selected === 'string' ? selected : id)
          setError(result.error?.message ?? 'Agent预设切换失败：当前对话已开始，不能更换预设')
        }
      },
    }, presets.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name || p.id)))
  )
}

function TokenFooter({ useProjection, settingsScope }) {
  const usage = useProjection?.('superAgentUsage')
  const fallback = useProjection?.('tokenUsage')
  const subscribe = useMemo(() => listener => settingsScope.subscribe(listener), [settingsScope])
  const read = useMemo(() => () => settingsScope.getSnapshot(), [settingsScope])
  const settings = useSyncExternalStore(subscribe, read, read)
  if (settings.value?.tokenStats === false) return null
  const totals = usage?.totals ?? (fallback ? {
    uncachedInputTokens: fallback.uncachedInputTokens || 0,
    outputTokens: fallback.outputTokens || 0,
    cacheReadTokens: fallback.cacheReadTokens || 0,
    cacheWriteTokens: fallback.cacheWriteTokens || 0,
  } : undefined)
  if (!totals) return null
  const total = (totals.uncachedInputTokens || 0) + (totals.cacheReadTokens || 0) + (totals.cacheWriteTokens || 0) + (totals.outputTokens || 0)
  const input = (totals.uncachedInputTokens || 0) + (totals.cacheReadTokens || 0) + (totals.cacheWriteTokens || 0)
  const hit = input ? Math.round(((totals.cacheReadTokens || 0) / input) * 100) : 0
  const models = Object.values(usage?.models || {})
  return React.createElement('details', { className: 'dsh-super-agent-token-footer', 'data-super-agent-token-stats': true },
    React.createElement('summary', null, `Token总量 ${total} · 平均缓存命中率 ${hit}%`),
    React.createElement('dl', null,
      React.createElement('dt', null, '缓存命中'), React.createElement('dd', null, `${hit}%`),
      React.createElement('dt', null, '未缓存输入'), React.createElement('dd', null, totals.uncachedInputTokens || 0),
      React.createElement('dt', null, '缓存读取'), React.createElement('dd', null, totals.cacheReadTokens || 0),
      React.createElement('dt', null, '输出'), React.createElement('dd', null, totals.outputTokens || 0),
      totals.cacheWriteTokens > 0 && React.createElement(React.Fragment, null,
        React.createElement('dt', null, '缓存写入'), React.createElement('dd', null, totals.cacheWriteTokens),
      ),
      models.length > 0 && React.createElement('dt', { className: 'dsh-super-agent-token-models-heading' }, '按模型'),
      models.map(model => React.createElement(React.Fragment, { key: `${model.provider}/${model.model}` },
        React.createElement('dt', { className: 'dsh-super-agent-token-model' }, `${model.provider}/${model.model}`),
        React.createElement('dd', null, `总量 ${model.uncachedInputTokens + model.cacheReadTokens + model.cacheWriteTokens + model.outputTokens}`),
      )),
    ))
}

function catalogValue(result) {
  if (!result || result.ok === false) return undefined
  return result.ok === true ? result.value : result
}

function modelRouteKey(provider, model) {
  return provider ? `${provider}/${model}` : model
}

function optionRouteKey(option) {
  return modelRouteKey(option.provider, option.id)
}

function catalogModels(catalog) {
  return (catalog?.groups || []).flatMap(group => (group.models || []).map(model => ({
    provider: group.id,
    providerName: group.name || group.id,
    id: model.id,
    name: model.name || model.id,
    reasoning: model.reasoning,
  })))
}

function strengthsForCatalogModel(model) {
  return (model.reasoning?.efforts || []).map(effort => effort.id).filter(Boolean)
}

function ModelPoolEditor({ name, title, draft, setDraft, catalog, catalogStatus }) {
  const entries = draft[name] || []
  const models = catalogModels(catalog)
  const byKey = new Map(models.map(model => [modelRouteKey(model.provider, model.id), model]))
  const update = next => setDraft({ ...draft, [name]: next })
  const entryFor = model => entries.find(entry => optionRouteKey(entry) === modelRouteKey(model.provider, model.id)
    || (entry.provider === undefined && entry.id === model.id))
  const toggleModel = model => {
    const existing = entryFor(model)
    if (existing) {
      update(entries.filter(entry => entry !== existing))
      return
    }
    update([...entries, {
      provider: model.provider,
      id: model.id,
      strengths: strengthsForCatalogModel(model),
      available: true,
    }])
  }
  const toggleStrength = (model, strength) => {
    const existing = entryFor(model)
    if (!existing) return
    const strengths = new Set(existing.strengths || [])
    if (strengths.has(strength)) strengths.delete(strength)
    else strengths.add(strength)
    update(entries.map(entry => entry === existing ? { ...entry, strengths: [...strengths], available: true } : entry))
  }
  const unavailable = entries.filter(entry => entry.provider === undefined
    ? !models.some(model => model.id === entry.id)
    : !byKey.has(optionRouteKey(entry)))
  return React.createElement('fieldset', { key: name },
    React.createElement('legend', null, title),
    catalogStatus === 'loading' && React.createElement('p', { role: 'status' }, '正在读取当前可用模型…'),
    catalogStatus === 'error' && React.createElement('p', { role: 'status' }, '模型目录读取失败；仍保留已保存的模型池。'),
    models.length > 0 && React.createElement('div', { className: 'dsh-super-agent-model-list' }, models.map(model => {
      const selected = entryFor(model)
      const strengths = strengthsForCatalogModel(model)
      return React.createElement('div', { key: modelRouteKey(model.provider, model.id), className: 'dsh-super-agent-model-row' },
        React.createElement('label', null,
          React.createElement('input', {
            type: 'checkbox', checked: selected !== undefined,
            onChange: () => toggleModel(model),
          }),
          ` ${model.providerName}/${model.name}`,
        ),
        strengths.length > 0 && selected !== undefined && React.createElement('div', { className: 'dsh-super-agent-strength-list' },
          strengths.map(strength => React.createElement('label', { key: strength },
            React.createElement('input', {
              type: 'checkbox',
              checked: (selected.strengths || []).includes(strength),
              onChange: () => toggleStrength(model, strength),
            }), ` ${strength}`,
          )),
        ),
      )
    })),
    unavailable.length > 0 && React.createElement('div', { className: 'dsh-super-agent-unavailable-models' },
      React.createElement('p', null, '已保存但当前不可用的模型（不会被选择）：'),
      unavailable.map(entry => React.createElement('label', { key: optionRouteKey(entry) },
        React.createElement('input', { type: 'checkbox', checked: true, onChange: () => update(entries.filter(candidate => candidate !== entry)) }),
        ` ${optionRouteKey(entry)}`,
      )),
    ),
    models.length === 0 && unavailable.length === 0 && catalogStatus === 'ready'
      && React.createElement('p', null, '当前没有可用模型；保存空模型池后会按高等级策略继续尝试。'),
  )
}

function SettingsPanel({ settingsScope, modelCatalog }) {
  const subscribe = useMemo(() => listener => settingsScope.subscribe(listener), [settingsScope])
  const read = useMemo(() => () => settingsScope.getSnapshot(), [settingsScope])
  const snapshot = useSyncExternalStore(subscribe, read, read)
  const value = snapshot.value ?? { modelPools: { high: [], normal: [], low: [] }, tokenStats: true }
  const [draft, setDraft] = useState(value.modelPools)
  const [enabled, setEnabled] = useState(value.tokenStats)
  const [busy, setBusy] = useState(false)
  const [catalog, setCatalog] = useState(undefined)
  const [catalogStatus, setCatalogStatus] = useState('loading')
  useEffect(() => { setDraft(value.modelPools); setEnabled(value.tokenStats !== false) }, [snapshot.revision])
  useEffect(() => {
    let active = true
    setCatalogStatus('loading')
    modelCatalog().then(result => {
      if (!active) return
      const next = catalogValue(result)
      setCatalog(next)
      setCatalogStatus(next ? 'ready' : 'error')
    }).catch(() => { if (active) setCatalogStatus('error') })
    return () => { active = false }
  }, [])
  const update = async () => {
    setBusy(true)
    try { await settingsScope.mutate([{ op: 'set', path: ['modelPools'], value: draft }, { op: 'set', path: ['tokenStats'], value: enabled }], snapshot.revision) } finally { setBusy(false) }
  }
  return React.createElement('section', { className: 'dsh-super-agent-settings', 'data-super-agent-settings': true },
    React.createElement('p', null, '模型目录实时反映当前可路由模型；未勾选的模型不会被选择，强度按任务难度自动取值。低等级池只会向更高等级回退，不会降级。'),
    React.createElement(ModelPoolEditor, { name: 'high', title: '高智能模型池（计划、决策）', draft, setDraft, catalog, catalogStatus }),
    React.createElement(ModelPoolEditor, { name: 'normal', title: '常规模型池（探索、实验、分析）', draft, setDraft, catalog, catalogStatus }),
    React.createElement(ModelPoolEditor, { name: 'low', title: '低智能模型池（代码阅读、结果总结）', draft, setDraft, catalog, catalogStatus }),
    React.createElement('label', null, React.createElement('input', { type: 'checkbox', checked: enabled, onChange: e => setEnabled(e.target.checked) }), ' 展示 token 统计'),
    snapshot.status !== 'ready' && React.createElement('p', { role: 'status' }, 'super-agent 设置暂不可用'),
    React.createElement('button', { type: 'button', disabled: busy || snapshot.status !== 'ready' || !snapshot.writable, onClick: update }, busy ? '保存中…' : '保存 super-agent 配置'))
}

function AgentTree({ useSessions, openChild }) {
  const state = useSessions?.(s => s) || { byId: {}, subagentsByParent: {}, current: undefined }
  const summariesById = { ...(state.byId || {}) }
  const parentOf = new Map()
  for (const [parentId, catalog] of Object.entries(state.subagentsByParent || {})) {
    for (const entry of catalog?.entries || []) {
      if (entry.kind !== 'child') continue
      parentOf.set(entry.id, parentId)
      if (summariesById[entry.id]) continue
      summariesById[entry.id] = {
        id: entry.id,
        title: entry.label,
        parentId,
        origin: 'subagent',
        mode: entry.mode,
        running: entry.activity === 'running',
        blank: false,
        updatedAt: entry.createdAt || 0,
      }
    }
  }
  // A selected child may be represented only by its direct catalog. Include
  // the ancestor chain so the tree keeps a stable root instead of rendering
  // the child as a disconnected top-level row.
  let ancestor = state.current
  const ancestors = new Set()
  while (ancestor && !ancestors.has(ancestor)) {
    ancestors.add(ancestor)
    const parent = summariesById[ancestor]?.parentId || parentOf.get(ancestor)
    if (!parent) break
    if (!summariesById[parent]) summariesById[parent] = { id: parent, title: parent, running: false, blank: false, updatedAt: 0 }
    ancestor = parent
  }
  const summaries = Object.values(summariesById).filter(s => s.id === state.current || s.origin === 'subagent' || ancestors.has(s.id))
  if (!summaries.length) return React.createElement('div', { className: 'dsh-super-agent-tree empty' }, '暂无 Agent 执行记录')
  const children = new Map()
  summaries.forEach(s => children.set(s.parentId, [...(children.get(s.parentId) || []), s]))
  const render = (parent, level = 0) => (children.get(parent) || []).map(s => React.createElement('div', { key: s.id, className: 'dsh-super-agent-node', style: { paddingLeft: `${level * 14}px` } },
    React.createElement('button', { type: 'button', className: 'dsh-super-agent-node-dot', onClick: () => openChild(s), 'aria-label': `查看 ${s.title || s.id}` }, '●'),
    React.createElement('span', null, s.title || s.id), render(s.id, level + 1)))
  const roots = render(undefined)
  if (roots.length === 0 && state.current && summariesById[state.current]) {
    return React.createElement('div', { className: 'dsh-super-agent-tree', role: 'tree', 'data-super-agent-tree': true },
      React.createElement('div', { className: 'dsh-super-agent-node' },
        React.createElement('span', { className: 'dsh-super-agent-node-dot', 'aria-hidden': true }, '●'),
        React.createElement('span', null, summariesById[state.current].title || state.current),
      ),
      render(state.current),
    )
  }
  return React.createElement('div', { className: 'dsh-super-agent-tree', role: 'tree', 'data-super-agent-tree': true }, roots)
}

const inject = [
  'slots', 'remote', 'remote.agentPresets', 'remote.settings', 'remote.session', 'sessions', 'locale',
  'settingsScope', 'sidebarRightTabs',
]

function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshSuperAgent = 'true'
    style.textContent = '.dsh-super-agent-preset-picker{display:inline-flex;align-items:center;gap:4px}.dsh-super-agent-preset-picker select{max-width:180px}.dsh-super-agent-token-footer{font-size:12px;color:var(--dsw-color-text-secondary,#777)}.dsh-super-agent-token-footer dl{display:grid;grid-template-columns:1fr auto;gap:2px 12px;margin:6px 0}.dsh-super-agent-token-footer dt,.dsh-super-agent-token-footer dd{margin:0}.dsh-super-agent-settings{display:grid;gap:12px}.dsh-super-agent-settings fieldset{border:1px solid var(--dsw-color-border,#ddd);border-radius:6px;padding:8px}.dsh-super-agent-settings p{margin:0;color:var(--dsw-color-text-secondary,#777)}.dsh-super-agent-model-list{display:grid;gap:8px}.dsh-super-agent-model-row{display:grid;gap:4px}.dsh-super-agent-strength-list{display:flex;flex-wrap:wrap;gap:8px;padding-left:22px;font-size:12px}.dsh-super-agent-unavailable-models{display:grid;gap:4px;color:var(--dsw-color-text-secondary,#777)}.dsh-super-agent-unavailable-models p{font-size:12px}.dsh-super-agent-tree{display:grid;gap:4px;padding:8px;overflow:auto}.dsh-super-agent-node{display:flex;align-items:center;gap:6px;min-height:24px}.dsh-super-agent-node-dot{border:0;background:transparent;color:var(--dsw-color-primary,#377dff);cursor:pointer;padding:0 3px}.dsh-super-agent-tree.empty{color:var(--dsw-color-text-secondary,#777)}'
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'super-agent: browser styles')
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'super-agent-preset', order: -20,
    inject: sessionId => ({
      sessionId,
      list: () => ctx.remote.agentPresets.list(),
      select: (id, preset) => ctx.remote.agentPresets.select(id, preset),
    }),
  }, PresetPicker))

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'super-agent-token-stats', order: 20,
    inject: () => ({ settingsScope: ctx.settingsScope.bind({ namespace: 'super-agent' }) }),
  }, TokenFooter))

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item', key: 'super-agent',
    inject: () => ({
      settingsScope: ctx.settingsScope.bind({ namespace: 'super-agent' }),
      modelCatalog: () => ctx.remote.session.modelCatalog(),
    }),
  }, SettingsPanel))

  // The native subagent catalog already owns sidebar navigation and history.
  // This lightweight contribution keeps a visual Agent tree available in the
  // conversation surface without duplicating the catalog persistence layer.
  const treeId = 'dsh-super-agent'
  const treeKind = 'super-agent-agents'
  const disposeTreeType = ctx.sidebarRightTabs.register({
    id: treeId, kind: treeKind,
    title: () => 'Agent 执行树',
    guide: [{ order: 40, title: () => 'Agent 执行树', description: () => '查看 Agent 层级和执行对话' }],
  })
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    // Keyed tab bodies dispatch by the definition id, while `kind` is the
    // page/content discriminator used by the Sidebar controller.
    name: 'sidebar.right.pane.tab', key: treeId,
    inject: () => ({ openChild: child => {
      if (child.parentId && child.mode && typeof ctx.sessions.openSubagent === 'function') {
        ctx.sessions.openSubagent({ parentSessionId: child.parentId, childSessionId: child.id, mode: child.mode })
      } else {
        ctx.sessions.open(child.id)
      }
    } }),
  }, AgentTree))
  ctx.effect(() => disposeTreeType, 'super-agent: Agent tree tab')
}

return { inject, apply, default: apply }
} })
