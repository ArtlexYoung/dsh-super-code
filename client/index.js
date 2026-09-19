/* Browser entry for dsh-super-code. It deliberately uses the Harness public
 * slot and Remote faces; no DOM selectors or private React internals are used.
 *
 * The Harness client module table serves classic scripts and expects every
 * plugin artifact to register a closure factory. Keeping the small bundle
 * self-contained here also makes the published package usable outside the
 * Harness monorepo's tsdown workspace.
 */
;(globalThis.window || globalThis).__ModuleLoader__.load({ id: 'dsh-super-code', factory: (require) => {
const React = require('react')
const { useEffect, useLayoutEffect, useRef, useMemo, useState, useSyncExternalStore } = React
const { IconRefreshOutline16 } = require('@deepseek-ai/dsh-client-ui-primitives')
const { SessionEventStream } = require('@deepseek-ai/dsh-api-session-controller')

function TaskMemoryPanel({ state }) {
  const tasks = state?.tasks || []
  if (!tasks.length) return null
  const current = state.current?.kind === 'task' ? state.current : undefined
  const labels = { active: '进行中', paused: '已暂停', completed: '已完成', cancelled: '已取消' }
  return React.createElement('section', { className: 'dsh-super-code-task-memory', 'aria-label': '任务档案' },
    current && React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'dsh-super-code-task-heading' },
        React.createElement('strong', null, current.title),
        React.createElement('span', null, labels[current.status] || current.status)),
      current.goal && React.createElement('p', null, current.goal),
      current.next && React.createElement('p', null, '下一步：', current.next)),
    tasks.some(task => task.id !== current?.id) && React.createElement('details', null,
      React.createElement('summary', null, current ? '其他任务' : '任务记录'),
      React.createElement('ul', null, tasks.filter(task => task.id !== current?.id).map(task => React.createElement('li', { key: task.id }, `${task.title} · ${labels[task.status] || task.status}`)))),
  )
}

/** Join host catalogs without leaking agents from unrelated conversations. */
function buildAgentView(state) {
  const nodes = new Map(Object.values(state.byId || {}).map(node => [node.id, { ...node }]))
  for (const [parentId, catalog] of Object.entries(state.subagentsByParent || {})) {
    for (const entry of catalog?.entries || []) {
      const summary = nodes.get(entry.id)
      nodes.set(entry.id, { ...summary, id: entry.id, parentId,
        title: entry.label || summary?.title || summary?.displayTitle || entry.id,
        mode: entry.mode, hasChildren: entry.hasChildren,
        running: summary?.running ?? entry.activity === 'running',
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

function AgentTree({ useSessions, useTabInfo, treeStates, openDetail, refresh, watchCatalog }) {
  const state = useSessions(s => s)
  const { tab } = useTabInfo()
  const view = useMemo(() => buildAgentView(state), [state.byId, state.subagentsByParent, state.current, state.currentAddress])
  const saved = useMemo(() => {
    let value = treeStates.get(tab.signal)
    if (!value || value.root !== view.root) {
      value = { root: view.root, limit: 200, focused: state.current }
      treeStates.set(tab.signal, value)
    }
    return value
  }, [treeStates, tab.signal, view.root])
  return React.createElement(AgentTreeBody, { key: view.root, state, view, saved, openDetail, refresh, watchCatalog })
}

function AgentCatalogWatch({ id, watchCatalog }) {
  useEffect(() => {
    watchCatalog(id, true)
    return () => watchCatalog(id, false)
  }, [id, watchCatalog])
  return null
}

function agentTreeLayout(view, limit) {
  const { rows, more } = visibleAgentRows(view, () => true, limit)
  const positions = new Map(), edges = []
  let leaves = 0
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    const children = (view.children.get(row.id) || []).filter(id => positions.has(id) && positions.get(id).level === row.level + 1)
    const x = children.length ? children.reduce((sum, id) => sum + positions.get(id).x, 0) / children.length : 70 + leaves++ * 140
    positions.set(row.id, { ...row, x, y: 18 + (row.level - 1) * 128 })
    for (const child of children) edges.push({ parent: row.id, child })
  }
  const width = Math.max(140, leaves * 140)
  // Reverse the postorder leaf allocation to preserve catalog order.
  for (const position of positions.values()) position.x = width - position.x
  return { rows: rows.map(row => positions.get(row.id)), edges, positions, more, width,
    height: Math.max(140, ...rows.map(row => row.level * 128)) }
}

function agentExecutionStatus(node, isRoot) {
  if (!node || node.unavailable || typeof node.running !== 'boolean') return { tone: 'unavailable', label: '记录不可用' }
  if (node.running) return { tone: 'active', label: '运行中' }
  return isRoot || node.mode === 'continuable' ? { tone: 'idle', label: '待命' } : { tone: 'stopped', label: '已停止' }
}

function AgentTreeBody({ state, view, saved, openDetail, refresh, watchCatalog }) {
  const [pan, setPan] = useState(saved.pan || { x: 0, y: 0 })
  const [zoom, setZoom] = useState(saved.zoom || 1)
  const viewport = useRef(null), graph = useRef(null)
  const camera = useRef({ pan, zoom })
  camera.current = { pan, zoom }
  const changeCamera = (nextPan, nextZoom) => {
    saved.pan = nextPan; saved.zoom = nextZoom
    camera.current = { pan: nextPan, zoom: nextZoom }
    setPan(nextPan); setZoom(nextZoom)
  }
  const zoomAt = (factor, x, y) => {
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
  useEffect(() => { Object.assign(saved, { limit, focused }) }, [saved, limit, focused])
  const { rows, more, edges, positions, width, height } = useMemo(() => agentTreeLayout(view, limit), [view, limit])
  const fit = () => {
    const element = viewport.current
    const next = Math.max(.4, Math.min(1.25, (element.clientWidth - 24) / width, (element.clientHeight - 24) / height))
    changeCamera({ x: (element.clientWidth - 24 - width * next) / 2, y: 8 }, next)
    element.scrollLeft = 0; element.scrollTop = 0
  }
  const zoomButton = factor => {
    const rect = viewport.current.getBoundingClientRect()
    zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }
  const catalogs = state.subagentsByParent || {}
  const totals = useMemo(() => agentTreeTotals(view, catalogs), [view, catalogs])
  const watched = rows.filter(({ id }) => id === view.root || view.nodes.get(id)?.hasChildren).map(row => row.id)
  const open = node => {
    setError('')
    Promise.resolve().then(() => openDetail(node)).catch(() => setError('无法打开详情，请重试'))
  }
  const reload = async () => {
    setBusy(true); setError('')
    try { await Promise.all([...new Set([view.root, ...watched])].filter(Boolean).map(id => refresh(id))) }
    catch { setError('执行记录刷新失败') }
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
      React.createElement('div', null,
        React.createElement('strong', null, '协作执行'),
        React.createElement('span', { className: 'dsh-super-code-tree-count' }, `已加载 ${view.nodes.size} · 运行中 ${running}`)),
      React.createElement('button', { type: 'button', className: 'dsh-super-code-icon-button', disabled: busy || !view.root, onClick: reload, title: '刷新执行记录', 'aria-label': '刷新执行记录' }, React.createElement(IconRefreshOutline16))),
    (error || catalogError) && React.createElement('p', { role: 'alert', className: 'dsh-super-code-tree-error' }, error || '部分执行记录读取失败，请刷新重试'),
    React.createElement('div', { className: 'dsh-super-code-graph-legend', 'aria-label': '状态颜色' },
      ['运行中', '待命', '已停止', '记录不可用'].map((label, index) => React.createElement('span', { key: label },
        React.createElement('i', { className: 'dsh-super-code-circle ' + ['active', 'idle', 'stopped', 'unavailable'][index], 'aria-hidden': true }), label))),
    !view.root && React.createElement('p', { className: 'dsh-super-code-tree-empty' }, '暂无会话'),
    React.createElement('div', { className: 'dsh-super-code-graph-controls', 'aria-label': '画布操作' },
      React.createElement('button', { type: 'button', 'aria-label': '缩小节点图', disabled: zoom <= .4, onClick: () => zoomButton(1 / 1.2) }, '−'),
      React.createElement('span', { 'aria-live': 'polite' }, `${Math.round(zoom * 100)}%`),
      React.createElement('button', { type: 'button', 'aria-label': '放大节点图', disabled: zoom >= 2, onClick: () => zoomButton(1.2) }, '+'),
      React.createElement('button', { type: 'button', onClick: fit }, '适应窗口')),
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
        if (!drag.moved) { drag.moved = true; event.currentTarget.setPointerCapture(event.pointerId) }
        event.currentTarget.classList.add('dragging')
        const next = { x: drag.origin.x + dx, y: drag.origin.y + dy }
        changeCamera(next, camera.current.zoom)
      },
      onPointerUp: finishDrag, onPointerCancel: finishDrag, onLostPointerCapture: finishDrag,
      onClickCapture: event => { if (gesture.current.moved && event.detail !== 0) { event.preventDefault(); event.stopPropagation() } },
      onDoubleClick: event => { if (!event.target.closest('[role="treeitem"]')) fit() },
      title: '拖动平移，滚轮缩放，双击空白适应窗口',
    },
    React.createElement('div', { ref: graph, role: 'tree', 'aria-label': 'Agent 执行树', className: 'dsh-super-code-graph', style: { width, height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` } },
      React.createElement('svg', { width, height, className: 'dsh-super-code-graph-edges', 'aria-hidden': true }, edges.map(edge => {
        const parent = positions.get(edge.parent), child = positions.get(edge.child)
        return React.createElement('path', { key: edge.child, d: `M ${parent.x} ${parent.y + 105} V ${child.y - 12} H ${child.x} V ${child.y}`, fill: 'none' })
      })),
      rows.map(row => {
      const node = view.nodes.get(row.id)
      const title = node.title || node.displayTitle || '主 Agent'
      const { label: status, tone } = agentExecutionStatus(node, row.id === view.root)
      const usage = totals.get(row.id)
      const partial = usage.partial || usage.known < usage.agents
      const number = value => value.toLocaleString('zh-CN', { notation: 'compact', maximumFractionDigits: 1 })
      return React.createElement('button', {
          key: row.id, type: 'button',
          role: 'treeitem', tabIndex: row.id === focusId ? 0 : -1, 'data-agent-id': row.id,
          'aria-level': row.level, 'aria-selected': row.id === state.current,
          'aria-disabled': node.unavailable || undefined, 'aria-label': `${title}，${status}`,
          className: `dsh-super-code-graph-node${row.id === state.current ? ' selected' : ''}${node.running ? ' running' : ''}`,
          style: { left: row.x - 64, top: row.y }, title: `${title} · ${status} · 点击查看详情`,
          onFocus: () => setFocused(row.id), onClick: () => { if (!node.unavailable) open(node) },
          onKeyDown: event => { if (event.target === event.currentTarget) keyDown(event, row) },
        },
        React.createElement('span', { className: 'dsh-super-code-circle ' + tone, 'aria-hidden': true }, row.id === view.root ? '主' : String(rows.findIndex(item => item.id === row.id))),
        React.createElement('span', { className: 'dsh-super-code-tree-content' },
          React.createElement('span', { className: 'dsh-super-code-tree-title' }, title),
          React.createElement('span', { className: 'dsh-super-code-tree-usage', title: `本节点及所有已知下级合计，包含本节点。${partial ? '部分记录或用量尚不可用；仅显示已知值。' : ''}Token ${usage.tokens.toLocaleString('zh-CN')}；缓存读取 ${usage.cache.toLocaleString('zh-CN')}；${usage.agents} 个 Agent` },
            React.createElement('span', null, usage.known ? `${number(usage.tokens)} token` : '用量 —'),
            React.createElement('span', null, usage.known ? `缓存 ${usage.input ? Math.round(usage.cache / usage.input * 100) : 0}%${partial ? ' · 部分' : ''}` : '缓存 —'))))
    }))),
    more && React.createElement('button', { type: 'button', className: 'dsh-super-code-tree-more', onClick: () => setLimit(limit + 200) }, '显示更多'))
}

function agentDetailAddress(node) {
  const address = new URL('dsh-resource://super-agent/' + encodeURIComponent(node.id))
  if (node.parentId && node.mode) {
    address.searchParams.set('parent', node.parentId)
    address.searchParams.set('mode', node.mode)
  }
  return address.href
}

function agentDetailTarget(address) {
  const url = new URL(address)
  if (url.protocol !== 'dsh-resource:' || url.hostname !== 'super-agent') throw new Error('Invalid Agent address')
  const id = decodeURIComponent(url.pathname.slice(1))
  if (!id) throw new Error('Missing Agent identity')
  const parent = url.searchParams.get('parent'), mode = url.searchParams.get('mode')
  if (parent && (mode === 'one-shot' || mode === 'continuable')) return { kind: 'subagent', parentSessionId: parent, childSessionId: id, mode }
  return { kind: 'session', sessionId: id }
}

function agentPath(view, id) {
  const path = [], seen = new Set()
  while (id && !seen.has(id)) {
    seen.add(id)
    const node = view.nodes.get(id)
    path.unshift({ id, title: node?.title || node?.displayTitle || id })
    id = node?.parentId
  }
  return path
}

function contentText(blocks) {
  return (blocks || []).map(block => {
    if (block.type === 'text' && typeof block.text === 'string') return block.text
    if (block.type === 'image') return '[图片]'
    return ''
  }).filter(Boolean).join('\n\n')
}

function detailRecord(entry) {
  const event = entry.event, data = event?.data
  if (!data) return { kind: 'skip' }
  const base = { seq: event.seq, time: event.time }
  if (event.type === 'user/message') {
    if (data.source?.kind !== 'user') return { kind: 'skip' }
    return { ...base, kind: 'message', label: '任务', text: contentText(data.content) }
  }
  if (event.type === 'assistant/message') return { ...base, kind: 'message', label: data.interrupted ? 'Agent · 已中断' : 'Agent', text: contentText(data.message?.content) }
  if (event.type === 'turn/error') return { ...base, kind: 'error', label: '执行错误', text: data.message || '执行未完成，请稍后重试。' }
  return { kind: 'skip' }
}

// The host journal owns decoding, cursor validation and reconnects. This view
// keeps a bounded display window and never stages or sends to another session.
function createAgentInspector(createStream, address, readPage, initial) {
  let snapshot = initial || { status: 'loading', items: [], hasMore: false, earlier: false, truncated: false, projections: {}, error: '', firstSeq: 0, cursor: -1 }
  let cursor = snapshot.cursor
  let disposed = false, stream
  const listeners = new Set()
  const publish = patch => {
    if (disposed) return
    if (patch.cursor !== undefined) cursor = patch.cursor
    snapshot = { ...snapshot, cursor, ...patch }
    listeners.forEach(listener => listener())
  }
  const itemsOf = entries => entries.map(detailRecord).filter(item => item.kind !== 'skip' && item.text)
  stream = createStream(agentDetailTarget(address), {
    publish: change => {
      if (disposed) return
      if (change.type === 'replace') {
        if (snapshot.earlier) {
          publish({ status: 'ready', projections: change.page.projections?.values || {}, error: '' })
          return
        }
        const fresh = itemsOf(change.entries)
        const sequences = new Set(fresh.map(item => item.seq))
        const overlaps = snapshot.items.some(item => sequences.has(item.seq))
        // A resumed tail page can start later than the user's reading window.
        // Immutable journal records can be merged without moving that window.
        const items = overlaps ? [...new Map([...snapshot.items, ...fresh].map(item => [item.seq, item])).values()].sort((a, b) => a.seq - b.seq) : fresh
        publish({ status: 'ready', items: items.slice(-200), hasMore: (overlaps ? snapshot.hasMore : change.hasMore) || items.length > 200, earlier: false, truncated: items.length > 200,
          firstSeq: items.length > 200 ? items.at(-200).seq : overlaps ? snapshot.firstSeq : change.entries[0]?.event.seq ?? 0,
          cursor: change.entries.at(-1)?.event.seq ?? -1,
          projections: change.page.projections?.values || {}, error: '' })
      } else if (change.type === 'append' && !snapshot.earlier) {
        const item = detailRecord(change.entry)
        cursor = change.entry.event.seq
        if (item.kind !== 'skip' && item.text) {
          const items = [...snapshot.items, item]
          publish({ items: items.slice(-200), cursor, truncated: snapshot.truncated || items.length > 200,
            firstSeq: items.length > 200 ? items.at(-200).seq : snapshot.firstSeq, hasMore: snapshot.hasMore || items.length > 200 })
        }
      }
    },
    carrierFailed: () => publish({ error: '连接中断，正在重连' }),
    failed: () => publish({ status: 'error', error: '对话详情读取失败' }),
  })
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    start: () => { stream.open({ maxMessages: 40 }).catch(() => publish({ status: 'error', error: '对话详情读取失败' })) },
    older: async () => {
      if (snapshot.status === 'paging' || !snapshot.hasMore) return
      publish({ status: 'paging', error: '' })
      const throughSeq = cursor
      try {
        const result = await readPage({ address: agentDetailTarget(address), throughSeq, beforeSeq: snapshot.firstSeq, maxMessages: 40 }, stream.signal)
        if (!result.ok) throw new Error('History unavailable')
        const items = itemsOf(result.value.records), visible = items.slice(-200)
        publish({ status: 'ready', items: visible, earlier: true, cursor: throughSeq, truncated: items.length > 200,
          firstSeq: items.length > 200 ? visible[0].seq : result.value.records[0]?.event.seq ?? 0,
          hasMore: result.value.hasMore || items.length > 200 })
      }
      catch { publish({ status: 'error', error: '历史记录读取失败' }) }
    },
    dispose: () => { disposed = true; listeners.clear(); void stream.dispose() },
  }
}

function DetailText({ text }) {
  const [full, setFull] = useState(false)
  return React.createElement(React.Fragment, null,
    React.createElement('pre', null, full ? text : text.slice(0, 12000)),
    !full && text.length > 12000 && React.createElement('button', { type: 'button', onClick: () => setFull(true) }, '展开全文'))
}

function AgentDetail({ useTabInfo, useSessions, createInspector, detailStates }) {
  const { tab } = useTabInfo()
  const state = useSessions(s => s)
  const saved = useMemo(() => {
    if (!detailStates.has(tab.signal)) detailStates.set(tab.signal, { top: 0, following: true, open: new Set(), snapshot: undefined })
    return detailStates.get(tab.signal)
  }, [detailStates, tab.signal])
  const log = useRef(null)
  const restored = useRef(false)
  const previous = useRef(saved.snapshot)
  const [unread, setUnread] = useState(saved.unread || false)
  const markUnread = value => { saved.unread = value; setUnread(value) }
  const [revision, setRevision] = useState(0)
  const inspector = useMemo(() => createInspector(tab.contentId, saved.snapshot), [createInspector, tab.contentId, tab.visible, revision])
  const snapshot = useSyncExternalStore(inspector.subscribe, inspector.getSnapshot, inspector.getSnapshot)
  const latest = () => {
    saved.snapshot = undefined; saved.following = true; saved.top = 0
    restored.current = false; previous.current = undefined; markUnread(false)
    setRevision(value => value + 1)
  }
  useLayoutEffect(() => {
    const element = log.current
    if (!element || snapshot.status === 'loading') return
    if (!restored.current) {
      element.scrollTop = saved.following && !snapshot.earlier ? element.scrollHeight : saved.top
      restored.current = true
    } else if (snapshot.items !== previous.current?.items) {
      if (snapshot.earlier && snapshot.firstSeq !== previous.current?.firstSeq) {
        element.scrollTop = 0; saved.following = false
      } else if (saved.following && !snapshot.earlier) element.scrollTop = element.scrollHeight
      else if (snapshot.items.at(-1)?.seq > (previous.current?.items.at(-1)?.seq ?? -1)) markUnread(true)
    }
    saved.top = element.scrollTop; saved.snapshot = snapshot; previous.current = snapshot
    const visible = new Set(snapshot.items.map(item => item.seq))
    for (const key of saved.open) if (key !== 'usage' && !visible.has(key)) saved.open.delete(key)
  }, [snapshot, saved])
  useEffect(() => {
    if (tab.visible) inspector.start()
    return () => inspector.dispose()
  }, [inspector, tab.visible])
  const target = agentDetailTarget(tab.contentId), id = target.childSessionId || target.sessionId
  const view = buildAgentView(state), node = view.nodes.get(id)
  const path = agentPath(view, id)
  const projections = state.byId[id]?.projectionValues || snapshot.projections
  const totals = projections.superAgentUsage?.totals || projections.tokenUsage
  const input = totals ? (totals.uncachedInputTokens || 0) + (totals.cacheReadTokens || 0) + (totals.cacheWriteTokens || 0) : 0
  const format = value => value === undefined ? '未提供' : value.toLocaleString('zh-CN')
  const tasks = projections.superCodeTasks
  const task = tasks?.current?.kind === 'task' ? tasks.current : undefined
  const title = node?.title || node?.displayTitle || 'Agent 详情'
  const metrics = [
    ['输入', totals ? input : undefined], ['输出', totals?.outputTokens],
    ['缓存读取', totals?.cacheReadTokens], ['缓存写入', totals?.cacheWriteTokens],
  ]
  return React.createElement('section', { className: 'dsh-super-code-detail', 'data-agent-detail': id },
    React.createElement('header', { className: 'dsh-super-code-detail-header' },
      React.createElement('nav', { 'aria-label': 'Agent 路径' }, path.map((part, index) => React.createElement('span', { key: part.id }, index > 0 ? ' / ' : '', part.title))),
      React.createElement('div', { className: 'dsh-super-code-detail-heading' },
        React.createElement('div', null,
          React.createElement('h2', null, title),
          React.createElement('span', { className: 'dsh-super-code-detail-status' }, agentExecutionStatus(node, id === view.root).label)),
        React.createElement('button', { type: 'button', className: 'dsh-super-code-icon-button', title: '刷新对话详情', 'aria-label': '刷新对话详情', onClick: latest }, React.createElement(IconRefreshOutline16))),
      id !== view.root && task?.goal && task.goal !== title && React.createElement('p', { className: 'dsh-super-code-detail-task' }, task.goal),
      id === view.root && React.createElement(TaskMemoryPanel, { state: tasks }),
      React.createElement('dl', { className: 'dsh-super-code-detail-metrics' },
        React.createElement('div', null, React.createElement('dt', null, 'Token 总量'), React.createElement('dd', null, format(totals ? input + (totals.outputTokens || 0) : undefined))),
        React.createElement('div', null, React.createElement('dt', null, '缓存命中率'), React.createElement('dd', null, totals ? (input ? Math.round((totals.cacheReadTokens || 0) / input * 100) : 0) + '%' : '未提供'))),
      React.createElement('details', { className: 'dsh-super-code-usage-details', open: saved.open.has('usage'), onToggle: event => { if (event.currentTarget.open) saved.open.add('usage'); else saved.open.delete('usage') } },
        React.createElement('summary', null, '用量详情'),
        React.createElement('dl', { className: 'dsh-super-code-detail-metrics' }, metrics.map(([label, value]) => React.createElement('div', { key: label }, React.createElement('dt', null, label), React.createElement('dd', null, format(value))))))),
    React.createElement('div', { ref: log, className: 'dsh-super-code-detail-log', 'aria-label': 'Agent 执行内容', onScroll: event => {
      const element = event.currentTarget
      saved.top = element.scrollTop
      saved.following = !snapshot.earlier && element.scrollHeight - element.clientHeight - element.scrollTop < 32
      if (saved.following) markUnread(false)
    } },
      snapshot.error && React.createElement('p', { role: 'alert' }, snapshot.error),
      snapshot.status === 'loading' && React.createElement('p', { role: 'status' }, '正在读取对话…'),
      snapshot.hasMore && React.createElement('button', { type: 'button', disabled: snapshot.status === 'paging', onClick: inspector.older }, snapshot.status === 'paging' ? '读取中…' : '加载更早记录'),
      (snapshot.earlier || snapshot.truncated) && React.createElement('button', { type: 'button', onClick: latest }, '回到最新'),
      snapshot.status === 'ready' && !snapshot.items.length && React.createElement('p', null, '暂无执行内容'),
      snapshot.items.map(item => React.createElement('article', { key: item.seq, className: 'dsh-super-code-detail-entry ' + item.kind },
        item.collapsed ? React.createElement('details', { open: saved.open.has(item.seq), onToggle: event => { if (event.currentTarget.open) saved.open.add(item.seq); else saved.open.delete(item.seq) } },
          React.createElement('summary', null, item.label),
          React.createElement(DetailText, { text: item.text }))
          : React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'dsh-super-code-detail-entry-label' }, item.label,
              React.createElement('time', null, new Date(item.time).toLocaleTimeString('zh-CN', { hour12: false }))),
            React.createElement(DetailText, { text: item.text })))) ),
    unread && React.createElement('button', { type: 'button', className: 'dsh-super-code-new-content', onClick: () => {
      saved.following = true; log.current.scrollTop = log.current.scrollHeight; markUnread(false)
    } }, '有新内容 · 查看最新'))
}

const inject = [
  'slots', 'remote', 'remote.session', 'sessions', 'locale',
  'sidebarRightTabs', 'sidebarRight',
]

function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshSuperCode = 'true'
    style.textContent = `
.dsh-super-code-tree{--agent-muted:var(--dsw-alias-label-secondary,#70757d);--agent-line:var(--dsw-alias-border-l1,#dedfe3);height:100%;min-width:0;overflow:auto;font-size:13px;letter-spacing:0;color:inherit}
.dsh-super-code-tree-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 18px 16px}
.dsh-super-code-tree-header strong{display:block;font-size:14px;font-weight:600}
.dsh-super-code-tree-count{display:block;margin-top:5px;color:var(--agent-muted);font-size:12px}
.dsh-super-code-graph-controls{display:flex;align-items:center;gap:6px;padding:2px 18px 12px;color:var(--agent-muted);font-size:11px}
.dsh-super-code-graph-controls button{border:1px solid var(--agent-line);border-radius:5px;background:transparent;color:inherit;padding:3px 8px;min-height:28px;cursor:pointer;font:inherit}
.dsh-super-code-graph-controls button:disabled{opacity:.4;cursor:default}
.dsh-super-code-graph-controls span{min-width:38px;text-align:center;font-variant-numeric:tabular-nums}
.dsh-super-code-graph-scroll{overflow:hidden;padding:0 12px;min-height:260px;height:calc(100% - 150px);touch-action:none;cursor:grab;user-select:none}
.dsh-super-code-graph-scroll.dragging,.dsh-super-code-graph-scroll.dragging *{cursor:grabbing!important}
.dsh-super-code-graph-legend{display:flex;flex-wrap:wrap;gap:6px 12px;padding:0 18px 8px;color:var(--agent-muted);font-size:10px}
.dsh-super-code-graph-legend>span{display:flex;align-items:center;gap:5px}
.dsh-super-code-graph-legend .dsh-super-code-circle{width:7px;height:7px;box-shadow:none}
.dsh-super-code-graph{position:relative;transform-origin:0 0}
.dsh-super-code-graph-edges{position:absolute;inset:0;pointer-events:none;stroke:var(--agent-line);stroke-width:1.5}
.dsh-super-code-graph-node{position:absolute;width:128px;min-height:100px;display:flex;flex-direction:column;align-items:center;gap:6px;border:0;padding:0 4px;background:transparent;color:inherit;font:inherit;cursor:pointer;border-radius:8px}
.dsh-super-code-circle{position:relative;display:flex;align-items:center;justify-content:center;flex:none;width:40px;height:40px;border-radius:50%!important;corner-shape:round!important;font-size:13px;font-weight:600;background:var(--state-color);color:#fff}
.dsh-super-code-circle.active{--state-color:#008b78}.dsh-super-code-circle.idle{--state-color:#3971de}.dsh-super-code-circle.stopped{--state-color:#777d87}.dsh-super-code-circle.unavailable{--state-color:#b87716}
.dsh-super-code-graph-node .dsh-super-code-circle{background:linear-gradient(145deg,color-mix(in srgb,var(--state-color) 83%,white),var(--state-color));box-shadow:inset 0 1px 1px #ffffff40,0 2px 6px #00000012}
.dsh-super-code-graph-node .dsh-super-code-circle:after{content:"";position:absolute;inset:-5px;border:1px solid color-mix(in srgb,var(--state-color) 22%,transparent);border-radius:50%;corner-shape:round;pointer-events:none}
.dsh-super-code-graph-node .dsh-super-code-circle.idle:after{animation:super-agent-breathe 3s ease-in-out infinite}
.dsh-super-code-graph-node .dsh-super-code-circle.active:after{border-width:2px;border-top-color:var(--state-color);border-right-color:var(--state-color);animation:super-agent-process 1.6s linear infinite}
.dsh-super-code-graph-node .dsh-super-code-circle.stopped{background:linear-gradient(145deg,#9297a0,#747a84);box-shadow:inset 0 1px 1px #ffffff30}
.dsh-super-code-graph-node .dsh-super-code-circle.stopped:after{border-color:color-mix(in srgb,var(--state-color) 14%,transparent)}
.dsh-super-code-graph-node .dsh-super-code-circle.unavailable:after{border-style:dashed;border-color:var(--state-color)}
.dsh-super-code-graph-node:hover .dsh-super-code-circle{box-shadow:inset 0 1px 1px #ffffff40,0 3px 10px color-mix(in srgb,var(--state-color) 25%,transparent)}
@keyframes super-agent-breathe{0%,100%{transform:scale(1);opacity:.35}50%{transform:scale(1.12);opacity:.85}}
@keyframes super-agent-process{to{transform:rotate(360deg)}}
.dsh-super-code-graph-node:focus-visible{outline:2px solid var(--dsw-color-primary,#3276dc);outline-offset:4px}
.dsh-super-code-graph-node[aria-disabled]{cursor:default;opacity:.65}
.dsh-super-code-graph-node .dsh-super-code-tree-content{width:100%;text-align:center}
.dsh-super-code-graph-node .dsh-super-code-tree-title{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:18px;height:18px;font-size:12px}
.dsh-super-code-graph-node .dsh-super-code-tree-usage{justify-content:center;gap:1px 7px;font-size:10px}
.dsh-super-code-icon-button,.dsh-super-code-tree-toggle{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--agent-muted);cursor:pointer}
.dsh-super-code-icon-button:hover,.dsh-super-code-tree-toggle:hover{background:color-mix(in srgb,currentColor 9%,transparent)}
.dsh-super-code-icon-button:disabled{opacity:.45;cursor:default}
.dsh-super-code-view-button{flex:none;border:0;border-radius:4px;padding:6px 8px;background:transparent;color:var(--agent-muted);font:inherit;font-size:12px;cursor:pointer}
.dsh-super-code-view-button:hover{background:color-mix(in srgb,currentColor 7%,transparent);color:inherit}
.dsh-super-code-view-button:disabled{opacity:.45;cursor:default}
.dsh-super-code-tree-rows{padding:0 12px 20px}
.dsh-super-code-tree-row{position:relative;display:flex;align-items:center;gap:6px;min-width:0;min-height:64px;padding:10px 8px 10px calc(4px + var(--agent-depth)*14px);border-radius:6px;cursor:default;box-sizing:border-box}
.dsh-super-code-tree-row[aria-expanded]{cursor:pointer}
.dsh-super-code-tree-row[aria-level]:not([aria-level="1"]):before{content:"";position:absolute;left:15px;width:calc(var(--agent-depth)*14px);height:100%;top:0;background:repeating-linear-gradient(to right,var(--agent-line) 0,var(--agent-line) 1px,transparent 1px,transparent 14px);pointer-events:none}
.dsh-super-code-tree-row:hover{background:color-mix(in srgb,currentColor 5%,transparent)}
.dsh-super-code-tree-row.selected{background:color-mix(in srgb,var(--dsw-color-primary,#3276dc) 6%,transparent)}
.dsh-super-code-tree-row:focus-visible,.dsh-super-code-tree button:focus-visible{outline:2px solid var(--dsw-color-primary,#3276dc);outline-offset:-2px}
.dsh-super-code-tree-row[aria-disabled]{cursor:default;opacity:.7}
.dsh-super-code-tree-toggle{width:22px;height:26px;z-index:1}
.dsh-super-code-tree-toggle svg{transition:transform .12s}.dsh-super-code-tree-toggle.expanded svg{transform:rotate(90deg)}
.dsh-super-code-tree-connector{width:22px;flex:none}
.dsh-super-code-tree-content{display:grid;gap:4px;flex:1;min-width:0}
.dsh-super-code-tree-title{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere;line-height:1.4}
.dsh-super-code-tree-meta{color:var(--agent-muted);font-size:11px;line-height:1.4;overflow-wrap:anywhere}
.dsh-super-code-tree-usage{display:flex;flex-wrap:wrap;gap:3px 10px;font-size:10px;line-height:1.6;color:var(--agent-muted);font-variant-numeric:tabular-nums}
.dsh-super-code-tree-usage>span{white-space:nowrap}
.dsh-super-code-state{display:inline-flex;align-items:center;gap:5px;padding:2px 6px;border-radius:5px;color:var(--state-color);background:color-mix(in srgb,var(--state-color) 9%,transparent)}
.dsh-super-code-state:before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}
.dsh-super-code-state.active{--state-color:#16877d}
.dsh-super-code-state.idle{--state-color:#5471bb}
.dsh-super-code-state.stopped{--state-color:#827299}
.dsh-super-code-state.unavailable{--state-color:#b77b29}
@media(prefers-color-scheme:dark){.dsh-super-code-state.active{--state-color:#6bc7b6}.dsh-super-code-state.idle{--state-color:#91b0f4}.dsh-super-code-state.stopped{--state-color:#b9a9cf}.dsh-super-code-state.unavailable{--state-color:#e8b971}}
.dsh-super-code-tree-status{width:6px;height:6px;border-radius:50%;background:var(--agent-line);flex:none}
.dsh-super-code-tree-row.running .dsh-super-code-tree-status{background:#168c78}
.dsh-super-code-tree-status.unavailable{background:#c17e1d}
.dsh-super-code-tree-note,.dsh-super-code-tree-empty{margin:10px 18px;color:var(--agent-muted);font-size:12px}
.dsh-super-code-tree-error{margin:12px 14px;color:var(--dsw-color-text-error,#bd423b);font-size:12px;overflow-wrap:anywhere}
.dsh-super-code-tree-more{display:block;margin:4px auto 14px;padding:6px 12px;border:1px solid var(--agent-line);border-radius:4px;background:transparent;color:inherit;cursor:pointer}
.dsh-super-code-detail{height:100%;min-width:0;display:flex;flex-direction:column;font-size:13px;letter-spacing:0;--agent-muted:var(--dsw-alias-label-secondary,#70757d);--agent-line:var(--dsw-alias-border-l1,#dedfe3)}
.dsh-super-code-detail-header{padding:20px 20px 18px;border-bottom:1px solid var(--agent-line);flex:none;max-height:45%;overflow:auto}
.dsh-super-code-detail-header nav{font-size:11px;line-height:1.5;color:var(--agent-muted);overflow-wrap:anywhere}
.dsh-super-code-detail-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-top:14px}
.dsh-super-code-detail-heading>div{min-width:0}
.dsh-super-code-detail h2{font-size:16px;line-height:1.5;font-weight:600;margin:0;overflow-wrap:anywhere}
.dsh-super-code-detail-task{font-size:13px;line-height:1.7;margin:12px 0 0;overflow-wrap:anywhere}
.dsh-super-code-task-memory{margin-top:16px;padding-top:14px;border-top:1px solid var(--agent-line);font-size:12px;line-height:1.7;overflow-wrap:anywhere}
.dsh-super-code-task-heading{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px}
.dsh-super-code-task-heading strong{font-weight:500;color:inherit}
.dsh-super-code-task-heading span{color:var(--agent-muted);font-size:11px}
.dsh-super-code-task-memory p{margin:6px 0 0}
.dsh-super-code-task-memory details{margin-top:8px;color:var(--agent-muted)}
.dsh-super-code-task-memory summary{cursor:pointer}
.dsh-super-code-detail-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px;margin:16px 0 0}
.dsh-super-code-usage-details{margin-top:14px;font-size:12px;color:var(--agent-muted)}
.dsh-super-code-usage-details summary{cursor:pointer}
.dsh-super-code-new-content{align-self:center;flex:none;margin:8px 16px 12px;padding:7px 12px;border:1px solid var(--agent-line);border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.dsh-super-code-detail-metrics dt{font-size:11px;color:var(--agent-muted)}
.dsh-super-code-detail-metrics dd{margin:5px 0 0;font-variant-numeric:tabular-nums;font-size:14px;line-height:1.4;overflow-wrap:anywhere}
.dsh-super-code-detail-metrics>div:first-child dd{font-weight:600}
.dsh-super-code-detail-status{display:block;margin-top:5px;font-size:11px;color:var(--agent-muted)}
.dsh-super-code-detail-log{flex:1;min-height:0;overflow:auto;padding:4px 20px 24px}
.dsh-super-code-detail-log>button,.dsh-super-code-detail-entry button{border:1px solid var(--agent-line);border-radius:4px;background:transparent;color:inherit;padding:5px 8px;margin:10px 8px 4px 0;font-size:12px;cursor:pointer}
.dsh-super-code-detail-entry{padding:20px 0;min-width:0}
.dsh-super-code-detail-entry:has(>details){padding:10px 0;color:var(--agent-muted)}
.dsh-super-code-detail-entry details[open]{color:inherit;padding-bottom:8px}
.dsh-super-code-detail-entry-label{display:flex;justify-content:space-between;gap:10px;font-size:12px;font-weight:600}
.dsh-super-code-detail-entry time{color:var(--agent-muted);font-size:11px;font-weight:400;flex:none}
.dsh-super-code-detail-entry pre{font:inherit;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0}
.dsh-super-code-detail-entry summary{cursor:pointer;font-size:12px;overflow-wrap:anywhere}
.dsh-super-code-detail-entry.context{color:var(--agent-muted)}
.dsh-super-code-detail-entry.error,.dsh-super-code-detail [role=alert]{color:var(--dsw-color-text-error,#bd423b)}
.dsh-super-code-detail button:focus-visible,.dsh-super-code-detail summary:focus-visible{outline:2px solid var(--dsw-color-primary,#3276dc);outline-offset:3px}
.dsh-super-code-detail-entry summary:hover{color:var(--dsw-alias-label-primary,inherit)}
@media(prefers-reduced-motion:reduce){.dsh-super-code-tree-toggle svg{transition:none}.dsh-super-code-graph-node .dsh-super-code-circle:after{animation:none!important}}
`
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'super-code: browser styles')
  // Both the tree and read-only details stay in the current conversation's tabs.
  const treeId = 'dsh-super-code'
  const treeKind = 'super-agent-agents'
  const disposeTreeType = ctx.sidebarRightTabs.register({
    id: treeId, kind: treeKind,
    title: () => 'Agent 执行树',
    guide: [{ order: 40, title: () => 'Agent 执行树', description: () => '查看 Agent 层级和执行对话' }],
  })
  const treeActions = {
    // The host unmounts hidden bodies; tab signals live until close/unload.
    treeStates: new WeakMap(),
    refresh: id => ctx.sessions.refreshSubagents(id),
    watchCatalog: (id, open) => ctx.sessions.setSubagentCatalogOpen(id, open),
    openDetail: child => ctx.sidebarRight.openResource(agentDetailAddress(child), { kind: 'super-agent-detail' }),
  }
  const disposeDetailType = ctx.sidebarRightTabs.register({
    id: 'dsh-super-code-detail', kind: 'super-agent-detail', patterns: ['dsh-resource://super-agent/**'],
    title: address => {
      const target = agentDetailTarget(address), state = ctx.sessions.list.getSnapshot()
      const node = buildAgentView(state).nodes.get(target.childSessionId || target.sessionId)
      return node?.title || node?.displayTitle || 'Agent 详情'
    },
  })
  const detailActions = { detailStates: new WeakMap(), createInspector: (address, initial) => createAgentInspector(
    (target, options) => new SessionEventStream(ctx.remote, target, options), address,
    (request, signal) => ctx.remote.session.page(request, signal), initial) }
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: 'dsh-super-code-detail', inject: () => detailActions,
  }, AgentDetail))
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    // Keyed tab bodies dispatch by the definition id, while `kind` is the
    // page/content discriminator used by the Sidebar controller.
    name: 'sidebar.right.pane.tab', key: treeId,
    inject: () => treeActions,
  }, AgentTree))
  ctx.effect(() => disposeTreeType, 'super-code: Agent tree tab')
  ctx.effect(() => disposeDetailType, 'super-code: Agent detail tab')
}

return { inject, apply, buildAgentView, visibleAgentRows, agentTreeTotals, agentTreeLayout, agentExecutionStatus, agentDetailAddress, agentDetailTarget, agentPath, detailRecord, createAgentInspector }
} })
