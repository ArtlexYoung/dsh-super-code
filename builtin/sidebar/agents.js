import { agentDetailTarget } from './address.js'
import { localeCode, text, zh } from '../ui/locale.js'
import React, { useState, useRef, useMemo, useLayoutEffect, useEffect } from '../ui/react.js'
import { ActionButton, Glyph, IconRefreshOutline16, SelectControl } from '../ui/controls.js'
import { AgentCatalogWatch, WorkspaceSectionToggle } from './controls.js'

function agentTabTitle(state, address, t) {
  const target = agentDetailTarget(address), id = target.childSessionId || target.sessionId
  const node = buildAgentView(agentSessionState(state, id)).nodes.get(id)
  return node?.title || node?.displayTitle || t('detail.title')
}

function AgentDetailTitle({ useTabInfo, useSessions, t }) {
  const { tab } = useTabInfo(), state = useSessions(value => value)
  return agentTabTitle(state, tab.contentId, t)
}

function TaskMemoryPanel({ state, t = key => zh[key] || key }) {
  const tasks = state?.tasks || []
  if (!tasks.length) return null
  const current = state.current?.kind === 'task' ? state.current : undefined
  const labels = { active: text(t, 'status.active'), paused: text(t, 'status.paused'), completed: text(t, 'status.completed'), cancelled: text(t, 'status.cancelled') }
  return React.createElement('section', { className: 'dsh-super-code-task-memory', 'aria-label': text(t, 'task.memory') },
    current && React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'dsh-super-code-task-heading' },
        React.createElement('strong', null, current.title),
        React.createElement('span', null, labels[current.status] || current.status)),
      current.goal && React.createElement('p', null, current.goal),
      current.next && React.createElement('p', null, text(t, 'next'), current.next)),
    tasks.some(task => task.id !== current?.id) && React.createElement('details', null,
      React.createElement('summary', null, current ? text(t, 'task.other') : text(t, 'task.history')),
      React.createElement('ul', null, tasks.filter(task => task.id !== current?.id).map(task => React.createElement('li', { key: task.id }, `${task.title} · ${labels[task.status] || task.status}`)))),
  )
}

/** Normalize the two published host catalog shapes, without opening Agents. */
function agentSessionState(state, sessionId, statuses) {
  const current = sessionId || state.current
  if (state.subagentsByParent) return { ...state, current }
  const snapshots = state.projectionsBySession || {}, byId = { ...state.byId }, catalogs = {}
  for (const [id, snapshot] of Object.entries(snapshots)) {
    byId[id] = { ...byId[id], id, projectionValues: snapshot.values,
      running: statuses?.get(id)?.running ?? byId[id]?.running }
  }
  for (const [parentId, snapshot] of Object.entries(snapshots)) {
    const entries = snapshot.values.subagentCatalog || []
    catalogs[parentId] = { state: snapshot.state === 'idle' ? snapshot.values.subagentCatalog === undefined ? 'loading' : 'ready' : snapshot.state,
      entries: entries.map(entry => {
        const child = byId[entry.id], children = snapshots[entry.id]?.values.subagentCatalog
        const running = statuses?.get(entry.id)?.running ?? child?.running
        return { ...entry, hasChildren: children === undefined || children.length > 0,
          kind: entry.mode === 'unknown' ? 'diagnostic' : 'child',
          ...(typeof running === 'boolean' ? { activity: running ? 'running' : 'inactive' } : {}) }
      }) }
  }
  return { ...state, current, byId, subagentsByParent: catalogs }
}

/** Join host catalogs without leaking agents from unrelated conversations. */
function buildAgentView(state) {
  const nodes = new Map(Object.values(state.byId || {}).map(node => [node.id, { ...node }]))
  for (const [parentId, catalog] of Object.entries(state.subagentsByParent || {})) {
    // Navigation rows omit timestamps; the parent's public projection retains them.
    const created = new Map((nodes.get(parentId)?.projectionValues?.subagentCatalog || []).map(entry => [entry.id, entry.createdAt]))
    for (const entry of catalog?.entries || []) {
      const summary = nodes.get(entry.id)
      nodes.set(entry.id, { ...summary, id: entry.id, parentId,
        title: entry.label || summary?.title || summary?.displayTitle || entry.id,
        mode: entry.mode, hasChildren: entry.hasChildren, createdAt: created.get(entry.id),
        running: summary?.running ?? (entry.activity === undefined ? undefined : entry.activity === 'running'),
        unavailable: entry.kind === 'diagnostic',
      })
    }
  }
  if (!state.current) return { root: '', nodes: new Map(), children: new Map(), ancestors: new Set() }
  if (state.currentAddress && !nodes.get(state.current)?.parentId) {
    nodes.set(state.current, { ...nodes.get(state.current), id: state.current,
      parentId: state.currentAddress.parentSessionId, mode: state.currentAddress.mode })
  }
  let root = state.current
  const ancestors = new Set()
  while (!ancestors.has(root)) {
    ancestors.add(root)
    if (!nodes.has(root)) nodes.set(root, { id: root, title: root })
    const parent = nodes.get(root).parentId
    if (!parent || ancestors.has(parent)) break
    root = parent
  }
  const children = new Map()
  for (const node of nodes.values()) {
    if (!children.has(node.parentId)) children.set(node.parentId, [])
    children.get(node.parentId).push(node.id)
  }
  // The public catalog is ordered by creation time; summary insertion order is not.
  for (const [parent, catalog] of Object.entries(state.subagentsByParent || {})) {
    const rank = new Map((catalog.entries || []).map((entry, index) => [entry.id, index]))
    children.get(parent)?.sort((a, b) => (rank.get(a) ?? -1) - (rank.get(b) ?? -1))
  }
  const reachable = new Map(), pending = [root]
  while (pending.length) {
    const id = pending.pop()
    if (reachable.has(id)) continue
    reachable.set(id, nodes.get(id))
    for (const child of children.get(id) || []) pending.push(child)
  }
  return { root, nodes: reachable, children, ancestors }
}

/** Iterative traversal bounds rendered rows even for long-running sessions. */
function visibleAgentRows(view, expanded, limit) {
  const rows = [], seen = new Set(), stack = view.root ? [{ id: view.root, level: 1 }] : []
  while (stack.length && rows.length < limit) {
    const row = stack.pop()
    if (seen.has(row.id)) continue
    seen.add(row.id)
    rows.push(row)
    if (expanded(row.id)) {
      const children = view.children.get(row.id) || []
      for (let i = children.length - 1; i >= 0; i--) stack.push({ id: children[i], level: row.level + 1 })
    }
  }
  return { rows, more: stack.length > 0 }
}

/** Presentation only: never archive sessions or discard usage/history. */
function agentTreeDisplay(view, catalogs = {}, options = {}) {
  const expanded = options.expanded || new Set(), collapsed = options.collapsed || new Set()
  const recent = options.compact ? 2 : 4
  const all = visibleAgentRows(view, () => true, view.nodes.size).rows
  const levels = new Map(all.map(row => [row.id, row.level])), required = new Set(view.ancestors)
  if (options.focused) required.add(options.focused)
  const children = new Map()
  for (let index = all.length - 1; index >= 0; index--) {
    const { id, level } = all[index], node = view.nodes.get(id)
    const original = (view.children.get(id) || []).filter(child => levels.get(child) === level + 1)
    const unknownChildren = node.hasChildren && catalogs[id]?.state !== 'ready'
    if (node.running !== false || node.unavailable || unknownChildren || original.some(child => required.has(child))) required.add(id)
    const deep = level >= 2 && !expanded.has(id)
    const keep = collapsed.has(id) || deep ? new Set() : new Set(original.slice(-recent))
    const visible = original.filter(child => required.has(child) || (!collapsed.has(id) && (expanded.has(id) || keep.has(child))))
    children.set(id, visible)
  }
  const display = { ...view, children }
  const shown = new Set(visibleAgentRows(display, () => true, view.nodes.size).rows.map(row => row.id))
  return { view: display, hidden: all.filter(row => !shown.has(row.id)).map(row => row.id) }
}

function agentTreeTotals(view, catalogs = {}) {
  const totals = new Map(), order = [], parents = new Map(), seen = new Set(), pending = view.root ? [view.root] : []
  while (pending.length) {
    const id = pending.pop()
    if (seen.has(id)) continue
    seen.add(id); order.push(id)
    for (const child of view.children.get(id) || []) {
      if (!seen.has(child) && !parents.has(child)) { parents.set(child, id); pending.push(child) }
    }
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i], node = view.nodes.get(id), projections = node.projectionValues || {}
    const usage = projections.superAgentUsage?.totals || projections.tokenUsage
    const input = usage ? (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0) : 0
    const total = totals.get(id) || { agents: 0, tokens: 0, cache: 0, input: 0, known: 0, partial: false }
    total.agents++; total.tokens += input + (usage?.outputTokens || 0); total.cache += usage?.cacheReadTokens || 0; total.input += input
    if (usage) total.known++
    if (node.unavailable || ((id === view.root || node.hasChildren) && catalogs[id]?.state !== 'ready')) total.partial = true
    totals.set(id, total)
    const parent = parents.get(id)
    if (parent && parent !== id) {
      const sum = totals.get(parent) || { agents: 0, tokens: 0, cache: 0, input: 0, known: 0, partial: false }
      for (const key of ['agents', 'tokens', 'cache', 'input', 'known']) sum[key] += total[key]
      sum.partial ||= total.partial
      totals.set(parent, sum)
    }
  }
  return totals
}

const historyRowHeight = 56

function agentHistoryRange(range, from = '', to = '', now = Date.now()) {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const parse = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
    const [year, month, day] = value.split('-').map(Number), date = new Date(year, month - 1, day)
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date.getTime() : NaN
  }
  let start = -Infinity, end = Infinity
  if (range === 'custom') {
    start = from ? parse(from) : -Infinity
    if (to) { const date = new Date(parse(to)); date.setDate(date.getDate() + 1); end = date.getTime() }
  } else if (range !== 'all') {
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    today.setDate(today.getDate() - ({ today: 0, week: 6, month: 29 }[range] ?? 0))
    start = today.getTime(); end = tomorrow.getTime()
  }
  return { start, end, valid: !Number.isNaN(start) && !Number.isNaN(end) && start < end }
}

function agentHistoryRows(view, hidden, totals, options = {}) {
  const historyCollator = new Intl.Collator(localeCode(options.t || (key => zh[key] || key)), { numeric: true, sensitivity: 'base' })
  const query = (options.query || '').trim().toLocaleLowerCase()
  const range = agentHistoryRange(options.range || 'all', options.from, options.to, options.now)
  if (!range.valid) return []
  const rows = []
  for (const id of hidden) {
    const node = view.nodes.get(id), title = node.title || node.displayTitle || id
    const parent = view.nodes.get(node.parentId)?.title || text(options.t || (key => zh[key] || key), 'main.agent'), usage = totals.get(id)
    const time = Number.isFinite(node.createdAt) && node.createdAt >= 0 && node.createdAt <= 8640000000000000 ? node.createdAt : -1
    if (query && !`${title} ${parent}`.toLocaleLowerCase().includes(query)) continue
    if (options.range && options.range !== 'all' && (time < 0 || time < range.start || time >= range.end)) continue
    rows.push({ id, node, title, parent, time, tokens: usage?.known ? usage.tokens : -1, partial: !!usage && (usage.partial || usage.known < usage.agents) })
  }
  const [field, direction] = (options.sort || 'time-desc').split('-'), sign = direction === 'asc' ? 1 : -1
  return rows.sort((a, b) => {
    let comparison
    if (field === 'title') comparison = historyCollator.compare(a.title, b.title)
    else {
      const left = field === 'tokens' ? a.tokens : a.time, right = field === 'tokens' ? b.tokens : b.time
      // Missing metadata stays last in either direction, never masquerades as zero.
      if ((left < 0) !== (right < 0)) return left < 0 ? 1 : -1
      comparison = left - right
    }
    return comparison * sign || historyCollator.compare(a.title, b.title) || a.id.localeCompare(b.id)
  })
}

function agentHistoryWindow(count, scrollTop, height) {
  const top = Math.max(0, Math.min(scrollTop, Math.max(0, count * historyRowHeight - height)))
  return { top, start: Math.max(0, Math.floor(top / historyRowHeight) - 3),
    end: Math.min(count, Math.ceil((top + height) / historyRowHeight) + 3), height: count * historyRowHeight }
}

/** Local scroll state keeps the graph out of the scrolling render path. */
function AgentHistory({ view, hidden, totals, open, saved, t = key => zh[key] || key }) {
  const [filters, setFilters] = useState(saved.historyFilters || { query: '', range: 'all', from: '', to: '', sort: 'time-desc' })
  const [scroll, setScroll] = useState({ top: saved.historyTop || 0, height: 168 })
  const previousFilters = useRef(filters)
  const viewport = useRef(null), focusTarget = useRef('')
  const records = useMemo(() => agentHistoryRows(view, hidden, totals, { ...filters, t }), [view, hidden, totals, filters, t])
  const language = localeCode(t)
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(language, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), [language])
  const window = agentHistoryWindow(records.length, scroll.top, scroll.height)
  const range = agentHistoryRange(filters.range, filters.from, filters.to)
  const change = (key, value) => setFilters(previous => ({ ...previous, [key]: value }))
  useLayoutEffect(() => {
    saved.historyFilters = filters
    if (previousFilters.current !== filters) {
      viewport.current.scrollTop = 0; saved.historyTop = 0
      setScroll(previous => ({ ...previous, top: 0 }))
    }
    previousFilters.current = filters
  }, [filters, saved])
  useLayoutEffect(() => {
    const element = viewport.current
    const measure = () => setScroll(previous => previous.top === element.scrollTop && previous.height === element.clientHeight
      ? previous : { top: element.scrollTop, height: element.clientHeight })
    element.scrollTop = saved.historyTop || 0
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    viewport.current.scrollTop = window.top; saved.historyTop = window.top
    if (focusTarget.current) {
      const target = Array.from(viewport.current.querySelectorAll('button')).find(button => button.dataset.historyId === focusTarget.current)
      if (target) { target.focus({ preventScroll: true }); focusTarget.current = '' }
    }
  }, [window.top, window.start, window.end, records, scroll])
  const keyDown = (event, index) => {
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: records.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const target = Math.max(0, Math.min(records.length - 1, next)), element = viewport.current
    focusTarget.current = records[target].id
    if (target * historyRowHeight < element.scrollTop) element.scrollTop = target * historyRowHeight
    else if ((target + 1) * historyRowHeight > element.scrollTop + element.clientHeight) element.scrollTop = (target + 1) * historyRowHeight - element.clientHeight
    setScroll({ top: element.scrollTop, height: element.clientHeight })
  }
  const select = (key, label, choices) => React.createElement('div', { className: 'dsh-super-code-select-field' },
    React.createElement('label', { htmlFor: 'super-code-history-' + key }, label),
    React.createElement(SelectControl, { id: 'super-code-history-' + key, label, value: filters[key], choices, onChange: value => change(key, value) }))
  return React.createElement('section', { className: 'dsh-super-code-history', 'aria-label': text(t, 'history.aria') },
    React.createElement('input', { type: 'search', value: filters.query, 'aria-label': text(t, 'history.find'), placeholder: text(t, 'history.search'), onChange: event => change('query', event.target.value) }),
    React.createElement('div', { className: 'dsh-super-code-history-filters' },
      select('range', text(t, 'history.created'), [['all', text(t, 'history.all')], ['today', text(t, 'history.today')], ['week', text(t, 'history.week')], ['month', text(t, 'history.month')], ['custom', text(t, 'history.custom')]]),
      select('sort', text(t, 'history.sort'), [['time-desc', text(t, 'history.latest')], ['time-asc', text(t, 'history.earliest')], ['tokens-desc', text(t, 'history.tokensHigh')], ['tokens-asc', text(t, 'history.tokensLow')], ['title-asc', text(t, 'history.titleAsc')], ['title-desc', text(t, 'history.titleDesc')]])),
    filters.range === 'custom' && React.createElement('div', { className: 'dsh-super-code-history-filters' },
      ['from', 'to'].map((key, index) => React.createElement('label', { key }, index ? text(t, 'history.end') : text(t, 'history.start'),
        React.createElement('input', { type: 'date', value: filters[key], 'aria-label': index ? text(t, 'history.end') : text(t, 'history.start'), onChange: event => change(key, event.target.value) })))),
    React.createElement('p', { className: 'dsh-super-code-history-summary', role: 'status' }, range.valid ? text(t, 'history.summary', { shown: records.length, total: hidden.length }) : text(t, 'history.invalid')),
    React.createElement('div', { ref: viewport, className: 'dsh-super-code-history-list', role: 'list', 'aria-label': text(t, 'history.aria'),
      onScroll: event => { const top = event.currentTarget.scrollTop; setScroll(previous => previous.top === top ? previous : { ...previous, top }) } },
      React.createElement('div', { style: { height: window.height, position: 'relative' } }, records.slice(window.start, window.end).map((record, offset) => {
        const index = window.start + offset, status = agentExecutionStatus(record.node, false, t)
        const date = record.time < 0 ? text(t, 'history.unknownTime') : dateFormat.format(record.time)
        return React.createElement('div', { key: record.id, role: 'listitem', 'aria-posinset': index + 1, 'aria-setsize': records.length,
          style: { position: 'absolute', top: index * historyRowHeight, height: historyRowHeight, width: '100%' } },
          React.createElement(ActionButton, { type: 'button', 'data-history-id': record.id, onClick: () => open(record.node), onKeyDown: event => keyDown(event, index),
            title: `${record.title} · ${record.parent} · ${record.time < 0 ? date : new Date(record.time).toLocaleString(localeCode(t))} · ${record.tokens < 0 ? text(t, 'history.unknownUsage') : record.tokens + ' Token' + (record.partial ? ' (' + text(t, 'usage.partial') + ')' : '')}`,
            'aria-label': text(t, 'history.view', { title: record.title }) },
            React.createElement('i', { className: 'dsh-super-code-circle ' + status.tone, 'aria-hidden': true }),
            React.createElement('span', null, React.createElement('strong', null, record.title), React.createElement('small', null, `${status.label} · ${date} · ${record.parent}`)),
            React.createElement('small', null, record.tokens < 0 ? '—' : `${record.partial ? '≈' : ''}${record.tokens.toLocaleString(localeCode(t), { notation: 'compact', maximumFractionDigits: 1 })} tok`)))
      })),
      !records.length && React.createElement('p', { className: 'dsh-super-code-history-empty' }, text(t, 'history.empty'))))
}

function AgentTree({ useSessions, useSessionStatus, sessionId, useTabInfo, treeStates, openDetail, refresh, watchCatalog, onToggle, t = key => zh[key] || key }) {
  const catalog = useSessions(s => s)
  const statuses = useSessionStatus ? useSessionStatus(s => s) : undefined
  const state = useMemo(() => agentSessionState(catalog, sessionId, statuses), [catalog, sessionId, statuses])
  const { tab } = useTabInfo()
  const view = useMemo(() => buildAgentView(state), [state.byId, state.subagentsByParent, state.current, state.currentAddress])
  const saved = useMemo(() => {
    let value = treeStates.get(tab.signal)
    if (!value || value.root !== view.root) {
      value = { root: view.root, limit: 200, focused: state.current, expanded: new Set(), collapsed: new Set() }
      treeStates.set(tab.signal, value)
    }
    return value
  }, [treeStates, tab.signal, view.root])
  return React.createElement(AgentTreeBody, { key: view.root, state, view, saved, openDetail, refresh, watchCatalog, onToggle, t })
}

// Keep connector anchors and canvas bounds in step with the node's text stack.
const agentTreeNodeHeight = 120, agentTreeLevelSpacing = 152
function agentTreeLayout(view, limit) {
  const { rows, more } = visibleAgentRows(view, () => true, limit)
  const positions = new Map(), edges = []
  let leaves = 0
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    const children = (view.children.get(row.id) || []).filter(id => positions.has(id) && positions.get(id).level === row.level + 1)
    const x = children.length ? children.reduce((sum, id) => sum + positions.get(id).x, 0) / children.length : 70 + leaves++ * 140
    positions.set(row.id, { ...row, x, y: 18 + (row.level - 1) * agentTreeLevelSpacing })
    for (const child of children) edges.push({ parent: row.id, child })
  }
  const width = Math.max(140, leaves * 140)
  // Reverse the postorder leaf allocation to preserve catalog order.
  for (const position of positions.values()) position.x = width - position.x
  return { rows: rows.map(row => positions.get(row.id)), edges, positions, more, width,
    height: Math.max(140, ...rows.map(row => row.level * agentTreeLevelSpacing)) }
}

function agentExecutionStatus(node, isRoot, t = key => zh[key] || key) {
  if (!node || node.unavailable || typeof node.running !== 'boolean') return { tone: 'unavailable', label: text(t, 'tree.legend.unavailable') }
  if (node.running) return { tone: 'active', label: text(t, 'tree.legend.active') }
  return isRoot || node.mode === 'continuable' ? { tone: 'idle', label: text(t, 'tree.legend.idle') } : { tone: 'stopped', label: text(t, 'tree.legend.stopped') }
}

function AgentTreeBody({ state, view, saved, openDetail, refresh, watchCatalog, onToggle, t = key => zh[key] || key }) {
  const [pan, setPan] = useState(saved.pan || { x: 0, y: 0 })
  const [zoom, setZoom] = useState(saved.zoom || 1)
  const viewport = useRef(null), graph = useRef(null)
  const autoFit = useRef(!saved.pan)
  const camera = useRef({ pan, zoom })
  camera.current = { pan, zoom }
  const changeCamera = (nextPan, nextZoom) => {
    saved.pan = nextPan; saved.zoom = nextZoom
    camera.current = { pan: nextPan, zoom: nextZoom }
    setPan(nextPan); setZoom(nextZoom)
  }
  const zoomAt = (factor, x, y) => {
    autoFit.current = false
    const current = camera.current, rect = graph.current.getBoundingClientRect()
    const next = Math.max(.4, Math.min(2, current.zoom * factor))
    const dx = (x - rect.left) / current.zoom, dy = (y - rect.top) / current.zoom
    changeCamera({ x: current.pan.x - dx * (next - current.zoom), y: current.pan.y - dy * (next - current.zoom) }, next)
  }
  useEffect(() => {
    const element = viewport.current
    const wheel = event => { event.preventDefault(); zoomAt(Math.exp(-event.deltaY * (event.deltaMode === 1 ? .04 : .002)), event.clientX, event.clientY) }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])
  const gesture = useRef({ moved: false })
  const finishDrag = event => {
    const drag = gesture.current
    if (drag.id !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    drag.id = undefined
    event.currentTarget.classList.remove('dragging')
  }
  const [limit, setLimit] = useState(saved.limit)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [focused, setFocused] = useState(saved.focused)
  const [expanded, setExpanded] = useState(saved.expanded || new Set())
  const [collapsed, setCollapsed] = useState(saved.collapsed || new Set())
  const [historyOpen, setHistoryOpen] = useState(saved.historyOpen || false)
  const [compact, setCompact] = useState(false)
  useEffect(() => { Object.assign(saved, { limit, focused, expanded, collapsed, historyOpen }) }, [saved, limit, focused, expanded, collapsed, historyOpen])
  const catalogs = state.subagentsByParent || {}
  const display = useMemo(() => agentTreeDisplay(view, catalogs, { expanded, collapsed, focused, compact }), [view, catalogs, expanded, collapsed, focused, compact])
  const { rows, more, edges, positions, width, height } = useMemo(() => agentTreeLayout(display.view, limit), [display, limit])
  const toggleBranch = id => {
    autoFit.current = true
    const show = collapsed.has(id) || !(display.view.children.get(id) || []).length
    const nextExpanded = new Set(expanded), nextCollapsed = new Set(collapsed)
    nextExpanded.delete(id); nextCollapsed.delete(id)
    if (show) nextExpanded.add(id); else nextCollapsed.add(id)
    setExpanded(nextExpanded); setCollapsed(nextCollapsed)
  }
  const fit = () => {
    autoFit.current = true
    const element = viewport.current
    const next = Math.max(.4, Math.min(1.25, (element.clientWidth - 24) / width, (element.clientHeight - 24) / height))
    changeCamera({ x: (element.clientWidth - 24 - width * next) / 2, y: 8 }, next)
    element.scrollLeft = 0; element.scrollTop = 0
  }
  useLayoutEffect(() => {
    const resize = () => {
      setCompact(viewport.current.clientWidth < 400)
      if (autoFit.current) fit()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [width, height])
  const zoomButton = factor => {
    const rect = viewport.current.getBoundingClientRect()
    zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }
  const totals = useMemo(() => agentTreeTotals(view, catalogs), [view, catalogs])
  // Retain already-loaded branch subscriptions so a hidden worker can become visible.
  const watched = [...new Set([...rows.filter(({ id }) => id === view.root || view.nodes.get(id)?.hasChildren).map(row => row.id),
    ...Object.keys(catalogs).filter(id => view.nodes.has(id))])]
  const open = node => {
    setError('')
    Promise.resolve().then(() => openDetail(node)).catch(() => setError('detail.noAccess'))
  }
  const reload = async () => {
    setBusy(true); setError('')
    try { await Promise.all([...new Set([view.root, ...watched])].filter(Boolean).map(id => refresh(id))) }
    catch { setError('tree.loadError') }
    finally { setBusy(false) }
  }
  const keyDown = (event, row) => {
    const index = rows.findIndex(item => item.id === row.id)
    let target
    if (event.key === 'ArrowDown') target = rows[Math.min(rows.length - 1, index + 1)]?.id
    else if (event.key === 'ArrowUp') target = rows[Math.max(0, index - 1)]?.id
    else if (event.key === 'Home') target = rows[0]?.id
    else if (event.key === 'End') target = rows.at(-1)?.id
    else if (event.key === 'ArrowRight') {
      target = rows[index + 1]?.level > row.level ? rows[index + 1].id : row.id
    } else if (event.key === 'ArrowLeft') {
      target = view.nodes.get(row.id).parentId
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (!view.nodes.get(row.id).unavailable) open(view.nodes.get(row.id))
    } else return
    event.preventDefault()
    if (target) {
      setFocused(target)
      const tree = event.currentTarget.closest('[role="tree"]')
      Array.from(tree.querySelectorAll('[role="treeitem"]')).find(item => item.dataset.agentId === target)?.focus()
    }
  }
  const focusId = rows.some(row => row.id === focused) ? focused : view.root
  const running = [...view.nodes.values()].filter(node => node.running).length
  const catalogError = watched.some(id => catalogs[id]?.state === 'error')
  return React.createElement('section', { className: 'dsh-super-code-tree', 'data-super-agent-tree': true },
    watched.map(id => React.createElement(AgentCatalogWatch, { key: id, id, watchCatalog })),
    React.createElement('header', { className: 'dsh-super-code-tree-header' },
      React.createElement('div', { className: 'dsh-super-code-tree-heading' },
        onToggle ? React.createElement(WorkspaceSectionToggle, { section: 'tree', expanded: true, onToggle, t },
          React.createElement('span', { className: 'dsh-super-code-tree-count' }, text(t, 'tree.countCompact', { shown: rows.length, total: view.nodes.size, running })))
          : React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'dsh-super-code-title-line' }, React.createElement(Glyph, { type: 'branch' }), React.createElement('strong', null, text(t, 'tree.title'))),
            React.createElement('span', { className: 'dsh-super-code-tree-count', title: text(t, 'tree.count', { shown: rows.length, total: view.nodes.size, running }) }, text(t, 'tree.countCompact', { shown: rows.length, total: view.nodes.size, running })))),
      React.createElement('div', { className: 'dsh-super-code-tree-toolbar' },
        React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-icon-button', disabled: busy || !view.root, onClick: reload, title: text(t, 'tree.refresh'), 'aria-label': text(t, 'tree.refresh') }, React.createElement(IconRefreshOutline16)),
        React.createElement('div', { className: 'dsh-super-code-graph-controls', 'aria-label': text(t, 'tree.canvas') },
          React.createElement(ActionButton, { type: 'button', title: text(t, 'tree.zoom.out'), 'aria-label': text(t, 'tree.zoom.out'), disabled: zoom <= .4, onClick: () => zoomButton(1 / 1.2) }, '−'),
          React.createElement('span', { 'aria-live': 'polite' }, `${Math.round(zoom * 100)}%`),
          React.createElement(ActionButton, { type: 'button', title: text(t, 'tree.zoom.in'), 'aria-label': text(t, 'tree.zoom.in'), disabled: zoom >= 2, onClick: () => zoomButton(1.2) }, '+')),
        React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-icon-button', title: text(t, 'tree.fit'), 'aria-label': text(t, 'tree.fit'), onClick: fit }, React.createElement(Glyph, { type: 'fit' })),
        (display.hidden.length > 0 || expanded.size > 0 || collapsed.size > 0) && React.createElement('div', { className: 'dsh-super-code-history-controls' },
          React.createElement(ActionButton, { type: 'button', title: text(t, 'tree.collapsed', { count: display.hidden.length }), 'aria-label': text(t, 'tree.collapsed', { count: display.hidden.length }), 'aria-expanded': historyOpen, onClick: () => setHistoryOpen(!historyOpen) }, React.createElement(Glyph, { type: 'history' }), React.createElement('span', { className: 'dsh-super-code-action-label' }, text(t, 'tree.collapsedLabel')), React.createElement('span', { className: 'dsh-super-code-action-count' }, display.hidden.length)),
          (expanded.size > 0 || collapsed.size > 0) && React.createElement(ActionButton, { type: 'button', title: text(t, 'tree.organize'), 'aria-label': text(t, 'tree.organize'), onClick: () => { autoFit.current = true; setExpanded(new Set()); setCollapsed(new Set()); setHistoryOpen(false); setFocused(state.current) } }, React.createElement(Glyph, { type: 'organize' }), React.createElement('span', { className: 'dsh-super-code-action-label' }, text(t, 'tree.organizeLabel'))))),
      React.createElement('div', { className: 'dsh-super-code-graph-legend', 'aria-label': text(t, 'tree.status') },
        ['tree.legend.active', 'tree.legend.idle', 'tree.legend.stopped', 'tree.legend.unavailable'].map((key, index) => React.createElement('span', { key },
          React.createElement('i', { className: 'dsh-super-code-circle ' + ['active', 'idle', 'stopped', 'unavailable'][index], 'aria-hidden': true }), text(t, key))))),
    (error || catalogError) && React.createElement('p', { role: 'alert', className: 'dsh-super-code-tree-error' }, text(t, error || 'tree.loadError')),
    !view.root && React.createElement('p', { className: 'dsh-super-code-tree-empty' }, text(t, 'tree.empty')),
    historyOpen && React.createElement(AgentHistory, { view, hidden: display.hidden, totals, open, saved, t }),
    React.createElement('div', { ref: viewport, className: 'dsh-super-code-graph-scroll',
      onPointerDown: event => {
        if (!event.isPrimary || event.button !== 0) return
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: pan, moved: false }
      },
      onPointerMove: event => {
        const drag = gesture.current
        if (drag.id !== event.pointerId) return
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y
        if (!drag.moved && Math.hypot(dx, dy) < 6) return
        autoFit.current = false
        if (!drag.moved) { drag.moved = true; event.currentTarget.setPointerCapture(event.pointerId) }
        event.currentTarget.classList.add('dragging')
        const next = { x: drag.origin.x + dx, y: drag.origin.y + dy }
        changeCamera(next, camera.current.zoom)
      },
      onPointerUp: finishDrag, onPointerCancel: finishDrag, onLostPointerCapture: finishDrag,
      onClickCapture: event => { if (gesture.current.moved && event.detail !== 0) { event.preventDefault(); event.stopPropagation() } },
      onDoubleClick: event => { if (!event.target.closest('[role="treeitem"]')) fit() },
      title: text(t, 'tree.canvas'),
    },
    React.createElement('div', { ref: graph, role: 'tree', 'aria-label': text(t, 'tree.aria'), className: 'dsh-super-code-graph', style: { '--sc-agent-node-height': agentTreeNodeHeight + 'px', width, height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` } },
      React.createElement('svg', { width, height, className: 'dsh-super-code-graph-edges', 'aria-hidden': true }, edges.map(edge => {
        const parent = positions.get(edge.parent), child = positions.get(edge.child)
        return React.createElement('path', { key: edge.child, d: `M ${parent.x} ${parent.y + agentTreeNodeHeight} V ${child.y - 16} H ${child.x} V ${child.y - 10}`, fill: 'none' })
      })),
      rows.map((row, index) => {
      const node = view.nodes.get(row.id)
      const title = node.title || node.displayTitle || text(t, 'main.agent')
      const { label: status, tone } = agentExecutionStatus(node, row.id === view.root, t)
      const usage = totals.get(row.id)
      const partial = usage.partial || usage.known < usage.agents
      const number = value => value.toLocaleString(localeCode(t), { notation: 'compact', maximumFractionDigits: 1 })
      const hasChildren = (view.children.get(row.id) || []).length > 0
      const isExpanded = (display.view.children.get(row.id) || []).length > 0
      return React.createElement(React.Fragment, { key: row.id }, React.createElement(ActionButton, {
          type: 'button',
          role: 'treeitem', tabIndex: row.id === focusId ? 0 : -1, 'data-agent-id': row.id,
          'aria-level': row.level, 'aria-selected': row.id === state.current,
          'aria-expanded': hasChildren ? isExpanded : undefined,
          'aria-disabled': node.unavailable || undefined, 'aria-label': `${title}，${status}`,
          className: `dsh-super-code-graph-node${row.id === state.current ? ' selected' : ''}${node.running ? ' running' : ''}`,
          style: { left: row.x - 64, top: row.y }, title: `${title} · ${status} · ${text(t, 'tree.open')}`,
          onFocus: () => setFocused(row.id), onClick: () => { if (!node.unavailable) open(node) },
          onKeyDown: event => { if (event.target === event.currentTarget) keyDown(event, row) },
        },
        React.createElement('span', { className: 'dsh-super-code-circle ' + tone, 'aria-hidden': true }, row.id === view.root ? text(t, 'main.agent').slice(0, 1) : String(index)),
        React.createElement('span', { className: 'dsh-super-code-tree-content' },
          React.createElement('span', { className: 'dsh-super-code-tree-title' }, title),
          React.createElement('span', { className: 'dsh-super-code-node-status', 'data-tone': tone }, React.createElement('i', { 'aria-hidden': true }), status),
          React.createElement('span', { className: 'dsh-super-code-tree-usage', title: text(t, 'tree.usage', { partial: partial ? text(t, 'usage.incomplete') : '', tokens: usage.tokens.toLocaleString(localeCode(t)), cache: usage.cache.toLocaleString(localeCode(t)), agents: usage.agents }) },
            React.createElement('span', null, usage.known ? `${number(usage.tokens)} token` : text(t, 'usage.unknown')),
            React.createElement('span', null, usage.known ? text(t, 'usage.cache', { value: usage.input ? Math.round(usage.cache / usage.input * 100) : 0 }) + (partial ? ` · ${text(t, 'usage.partial')}` : '') : text(t, 'usage.cacheUnknown'))))),
        hasChildren && React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-branch-toggle',
          style: { left: row.x + 21, top: row.y + 25 }, 'aria-label': `${collapsed.has(row.id) || !isExpanded ? text(t, 'tree.expand') : text(t, 'tree.collapse')} ${title}`,
          title: text(t, 'tree.organize'), onClick: () => toggleBranch(row.id) },
          React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true, style: { transform: collapsed.has(row.id) || !isExpanded ? 'rotate(-90deg)' : undefined } },
            React.createElement('path', { d: 'M3 4.5 6 7.5 9 4.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }))))
    }))),
    more && React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-tree-more', onClick: () => setLimit(limit + 200) }, text(t, 'tree.more')))
}

export { AgentDetailTitle, AgentTree, TaskMemoryPanel, agentExecutionStatus, agentHistoryRange, agentHistoryRows, agentHistoryWindow, agentSessionState, agentTabTitle, agentTreeDisplay, agentTreeLayout, agentTreeNodeHeight, agentTreeTotals, buildAgentView, visibleAgentRows }
