import { agentExecutionStatus, agentSessionState, buildAgentView, visibleAgentRows } from './agents.js'
import React, { useRef, useState, useMemo, useLayoutEffect } from '../ui/react.js'
import { localeCode, text, zh } from '../ui/locale.js'
import { ActionButton, Glyph, IconRefreshOutline16 } from '../ui/controls.js'
import { AgentCatalogWatch, WorkspaceSectionToggle } from './controls.js'

/** Join only the selected conversation's known descendants; never infer a plan. */
function taskFeedbackRows(view) {
  const { rows, more } = visibleAgentRows(view, () => true, view.nodes.size)
  const tasks = rows.map(row => {
    const node = view.nodes.get(row.id), projections = node.projectionValues || {}, facts = projections.superCodeFeedback
    const current = projections.superCodeTasks?.current
    const recorded = current?.kind === 'task' ? current : undefined
    const goal = recorded?.goal || (facts?.goal?.kind === 'recorded' ? facts.goal.text : '')
    const title = recorded?.title || goal || facts?.request || ''
    const todos = facts?.todos || projections.todos || []
    return { ...row, node, facts, title, goal, source: recorded || facts?.goal?.kind === 'recorded' ? 'record' : facts?.request ? 'request' : 'none',
      owner: node.title || node.displayTitle || '', todos, done: todos.filter(item => item.status === 'completed').length,
      total: todos.length, complete: !facts?.omittedTodos, taskStatus: recorded?.status || (facts?.goal?.kind === 'recorded' ? facts.goal.status : '') }
  })
  const files = new Map(), prefixes = new Map()
  // File identity remains independent of the virtual viewport.
  for (const node of view.nodes.values()) for (const file of node.projectionValues?.superCodeFeedback?.files || []) {
    const row = files.get(file.path) || { path: file.path, operations: new Set(), sources: [] }
    row.operations.add(file.operation); row.sources.push({ node, seq: file.seq, tool: file.tool })
    files.set(file.path, row)
  }
  return { tasks, more, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)).map(file => ({ ...file, ...feedbackFileLabel(file, prefixes) })),
    partial: [...view.nodes.values()].some(node => !node.projectionValues?.superCodeFeedback || node.projectionValues.superCodeFeedback.omittedFiles) }
}
/** Presentation only: retain the full path while shortening workspace-owned labels. */
function feedbackFileLabel(file, prefixes) {
  const path = file.path.replace(/\\/g, '/')
  let relative = path
  for (const { node } of file.sources) {
    let prefix = prefixes.get(node)
    if (prefix === undefined) {
      const cwd = node.cwd || node.projectionValues?.workingDirectory || ''
      prefix = cwd ? cwd.replace(/\\/g, '/').replace(/\/$/, '') + '/' : ''
      prefixes.set(node, prefix)
    }
    if (prefix && path.startsWith(prefix)) { relative = path.slice(prefix.length); break }
  }
  const slash = relative.lastIndexOf('/')
  return { name: relative.slice(slash + 1) || relative, directory: slash < 0 ? '' : relative.slice(0, slash) }
}
function FeedbackMark({ tone, label }) {
  return React.createElement('span', { className: 'dsh-super-code-feedback-mark ' + tone, role: 'img', 'aria-label': label },
    tone === 'success' && React.createElement('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true },
      React.createElement('path', { d: 'm3.5 8 3 3 6-6', strokeLinecap: 'round', strokeLinejoin: 'round' })),
    tone === 'error' && React.createElement('span', { 'aria-hidden': true }, '!'))
}
/** Per-tool settled counts in first-use order; single calls stay in the execution log. */
function feedbackToolSummary(activities = []) {
  const tools = new Map()
  for (const { tool, status } of activities) {
    const row = tools.get(tool) || { tool, succeeded: 0, failed: 0, running: false }
    if (status === 'succeeded') row.succeeded++
    else if (status === 'failed') row.failed++
    else if (status === 'running') row.running = true
    tools.set(tool, row)
  }
  return [...tools.values()]
}
function FeedbackTools({ tools, t }) {
  return React.createElement('ul', { className: 'dsh-super-code-feedback-tools', 'aria-label': text(t, 'feedback.tools') },
    tools.map(row => {
      const label = text(t, 'feedback.toolCount', { tool: row.tool, ok: row.succeeded, failed: row.failed })
      return React.createElement('li', { key: row.tool, title: label, 'aria-label': label, 'data-running': row.running || undefined },
        React.createElement('span', { 'aria-hidden': true }, row.tool),
        React.createElement('b', { className: 'dsh-super-code-tool-badge', 'data-tone': 'success', 'aria-hidden': true }, row.succeeded),
        React.createElement('b', { className: 'dsh-super-code-tool-badge', 'data-tone': 'warning', 'data-zero': row.failed === 0 || undefined, 'aria-hidden': true }, row.failed))
    }))
}
/** Flatten presentation rows only; tool calls fold into one per-task summary row. */
function feedbackListItems(model, root, partial) {
  const items = []
  const add = (kind, key, data = {}, row) => items.push({ kind, key: JSON.stringify(key), row, ...data,
    signature: JSON.stringify([kind, data.content, data.todo, data.historical, data.tools, data.label, data.count,
      data.file && [data.file.name, data.file.directory, [...data.file.operations]], kind === 'task' &&
      [row.title, row.owner, row.done, row.total, row.complete, row.taskStatus, row.facts?.phase, row.node.running]]) })
  for (const row of model.tasks) {
    const facts = row.facts
    add('task', [row.id, 'task'], {}, row)
    if (row.goal && row.goal !== row.title) add('text', [row.id, 'goal'], { content: row.goal }, row)
    if (facts?.latestRequest && (facts.latestRequest !== row.title || facts.history?.length)) add('request', [row.id, 'request'], { content: facts.latestRequest }, row)
    row.todos.forEach((todo, index) => add('step', [row.id, 'step', index], { todo }, row))
    const tools = feedbackToolSummary(facts?.activities)
    if (tools.length) add('tools', [row.id, 'tools'], { tools }, row)
    if (!row.total && !tools.length) add('note', [row.id, 'empty'], { label: facts ? 'feedback.noSteps' : 'feedback.loading' }, row)
    if (facts?.omittedActivities) add('note', [row.id, 'recent'], { label: 'feedback.recentOnly' }, row)
    for (const previous of [...(facts?.history || [])].reverse()) {
      add('request', [row.id, 'history', previous.seq], { content: previous.request, historical: true }, row)
      previous.todos.forEach((todo, index) => add('step', [row.id, 'history', previous.seq, index], { todo, historical: true }, row))
    }
    if (facts?.omittedRequests || facts?.history?.some(previous => previous.omittedTodos)) add('note', [row.id, 'historyPartial'], { label: 'feedback.historyPartial' }, row)
    add('open', [row.id, 'open'], { focusable: !row.node.unavailable }, row)
  }
  if (root) {
    add('files', ['files'], { count: model.files.length })
    add('note', ['filesHint'], { label: 'feedback.filesHint' })
    if (!model.files.length) add('note', ['filesEmpty'], { label: partial ? 'feedback.filesUnknown' : 'feedback.filesEmpty' })
    for (const file of model.files) add('file', ['file', file.path], { file, focusable: !file.sources[0].node.unavailable })
  }
  if (partial) add('note', ['partial'], { label: 'feedback.partial' })
  return items
}

/** Prefix heights allow binary-search windows without mounting offscreen rows. */
function feedbackListLayout(items, heights = new Map()) {
  const estimates = { task: 64, text: 48, request: 70, step: 28, tools: 32, open: 34, files: 40, file: 30, note: 26 }
  const offsets = [0], byKey = new Map()
  items.forEach((item, index) => {
    const measured = heights.get(item.key)
    const height = measured?.signature === item.signature ? measured.height : estimates[item.kind]
    offsets.push(offsets[index] + Math.max(1, height)); byKey.set(item.key, index)
  })
  return { offsets, byKey, height: offsets.at(-1) }
}
function feedbackListIndex(layout, top) {
  let low = 0, high = layout.offsets.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (layout.offsets[middle + 1] <= top) low = middle + 1; else high = middle
  }
  return Math.min(low, Math.max(0, layout.offsets.length - 2))
}
function feedbackListWindow(layout, scrollTop, height) {
  const top = Math.max(0, Math.min(scrollTop, Math.max(0, layout.height - height)))
  return { top, start: feedbackListIndex(layout, Math.max(0, top - 240)),
    end: layout.height ? Math.min(layout.offsets.length - 1, feedbackListIndex(layout, top + height + 240) + 1) : 0 }
}
/** Keep the same visible fact in place when earlier rows resize or arrive. */
function feedbackListAnchor(previous, next, scrollTop, height) {
  if (!previous || !previous.layout.height) return Math.max(0, Math.min(scrollTop, Math.max(0, next.layout.height - height)))
  const index = feedbackListIndex(previous.layout, scrollTop), key = previous.items[index]?.key
  const nextIndex = next.layout.byKey.get(key)
  const top = nextIndex === undefined ? scrollTop : next.layout.offsets[nextIndex] + Math.min(
    Math.max(0, scrollTop - previous.layout.offsets[index]), next.layout.offsets[nextIndex + 1] - next.layout.offsets[nextIndex] - 1)
  return Math.max(0, Math.min(top, Math.max(0, next.layout.height - height)))
}
function FeedbackRowContent({ item, root, openDetail, t }) {
  const row = item.row
  if (item.kind === 'task') {
    const status = feedbackStatus({ ...row, root }, t)
    const progressLabel = text(t, row.complete ? 'feedback.progress' : 'feedback.progressPartial', { done: row.done, total: row.total })
    return React.createElement('div', { className: 'dsh-super-code-feedback-task-heading' },
      React.createElement('div', { className: 'dsh-super-code-feedback-heading' },
        React.createElement('h3', { title: row.source === 'none' ? '' : text(t, 'feedback.source.' + row.source) }, row.title || text(t, 'feedback.noGoal')),
        React.createElement('div', { className: 'dsh-super-code-feedback-meta' },
          React.createElement('small', null, row.owner || (row.id === root ? text(t, 'main.agent') : row.id)),
          React.createElement('span', { className: 'dsh-super-code-feedback-status', 'data-tone': status.tone }, status.label))),
      row.total > 0 && React.createElement('span', { className: 'dsh-super-code-feedback-count', 'aria-label': progressLabel, title: progressLabel }, `${row.done}/${row.total}${row.complete ? '' : '+'}`),
      row.total > 0 && row.complete && React.createElement('progress', { max: row.total, value: row.done, 'aria-label': text(t, 'feedback.steps') }))
  }
  if (item.kind === 'step') return React.createElement('div', { className: 'dsh-super-code-feedback-step', 'data-step-state': item.todo.status, 'data-step-history': item.historical || undefined },
    React.createElement(FeedbackMark, { tone: item.todo.status === 'completed' ? 'success' : !item.historical && item.todo.status === 'in_progress' ? 'active' : 'pending',
      label: item.historical ? text(t, 'feedback.historicalStatus', { status: text(t, 'feedback.todo.' + item.todo.status) }) : text(t, 'feedback.todo.' + item.todo.status) }),
    React.createElement('span', null, item.todo.content))
  if (item.kind === 'tools') return React.createElement(FeedbackTools, { tools: item.tools, t })
  if (item.kind === 'open') return React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-feedback-open', disabled: !item.focusable,
    title: text(t, 'feedback.open'), onClick: () => openDetail(row.node) }, text(t, 'feedback.open'), React.createElement(Glyph, { type: 'arrow' }))
  if (item.kind === 'files') return React.createElement('h3', { className: 'dsh-super-code-feedback-files-heading' }, text(t, 'feedback.files'), React.createElement('span', null, item.count))
  if (item.kind === 'file') {
    const file = item.file
    return React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-feedback-file', title: file.path,
      'aria-label': text(t, 'feedback.openFileRecord') + ' ' + file.path, disabled: !item.focusable, onClick: () => openDetail(file.sources[0].node) },
      React.createElement(Glyph, { type: 'code' }), React.createElement('strong', null, file.name),
      file.directory && React.createElement('small', null, file.directory),
      React.createElement('span', { className: 'dsh-super-code-feedback-file-operation' }, [...file.operations].map(operation => text(t, 'feedback.file.' + operation)).join(' · ')))
  }
  if (item.label === 'tree.loadError') return React.createElement('p', { className: 'dsh-super-code-state', 'data-tone': 'error', role: 'alert' }, React.createElement(Glyph, { type: 'error' }), text(t, item.label))
  if (item.label === 'tree.empty') return React.createElement('p', { className: 'dsh-super-code-state', 'data-tone': 'empty' }, React.createElement(Glyph, { type: 'context' }), text(t, item.label))
  if (item.kind === 'note') return React.createElement('p', { className: 'dsh-super-code-feedback-muted' }, text(t, item.label))
  return React.createElement('p', { className: 'dsh-super-code-feedback-text' },
    item.kind === 'request' && React.createElement('small', null, text(t, item.historical ? 'feedback.previous' : 'feedback.latest')), item.content)
}

/** One measured, variable-height viewport for tasks, steps, activity and files. */
function FeedbackVirtualList({ items, root, saved, openDetail, t, watchCatalog }) {
  const viewport = useRef(null), list = useRef(null), previous = useRef(null), pendingFocus = useRef('')
  const language = localeCode(t)
  const [scroll, setScroll] = useState({ top: saved.feedbackTop || 0, height: 640, width: saved.feedbackWidth || 0 })
  const measurements = useRef(saved.feedbackHeights || new Map())
  const [heightRevision, setHeightRevision] = useState(0)
  const [focused, setFocused] = useState('')
  const layout = useMemo(() => feedbackListLayout(items, measurements.current), [items, heightRevision])
  const range = feedbackListWindow(layout, scroll.top, scroll.height)
  const indices = Array.from({ length: range.end - range.start }, (_, index) => range.start + index)
  const focusIndex = layout.byKey.get(focused)
  if (focusIndex !== undefined && !indices.includes(focusIndex)) indices.push(focusIndex)
  indices.sort((a, b) => a - b)
  const renderKey = indices.join(',')
  const watched = new Set(root ? [root] : [])
  for (const index of indices) if (items[index].row) watched.add(items[index].row.id)
  useLayoutEffect(() => {
    const element = viewport.current
    const measure = () => {
      const width = element.clientWidth
      if (width !== saved.feedbackWidth || language !== saved.feedbackLanguage) {
        saved.feedbackWidth = width; saved.feedbackLanguage = language
        saved.feedbackHeights = new Map(); measurements.current = saved.feedbackHeights; setHeightRevision(value => value + 1)
      }
      setScroll(value => value.top === element.scrollTop && value.height === element.clientHeight && value.width === width
        ? value : { top: element.scrollTop, height: element.clientHeight, width })
    }
    element.scrollTop = saved.feedbackTop || 0; measure()
    const observer = new ResizeObserver(measure); observer.observe(element)
    return () => observer.disconnect()
  }, [saved, language])
  useLayoutEffect(() => {
    const element = viewport.current
    const top = feedbackListAnchor(previous.current, { items, layout }, previous.current?.top ?? saved.feedbackTop ?? 0, element.clientHeight)
    element.scrollTop = top; saved.feedbackTop = element.scrollTop
    previous.current = { items, layout, top: element.scrollTop }
    setScroll(value => value.top === element.scrollTop ? value : { ...value, top: element.scrollTop })
    // Retain only current identities; long-running sessions must not leak measurements.
    for (const key of measurements.current.keys()) if (!layout.byKey.has(key)) measurements.current.delete(key)
    saved.feedbackHeights = measurements.current
  }, [items, layout, saved])
  useLayoutEffect(() => {
    const rows = [...list.current.children]
    let active = true
    const measure = () => {
      if (!active) return
      const current = measurements.current
      let next = current
      for (const element of rows) {
        const key = element.dataset.feedbackKey, item = items[layout.byKey.get(key)], height = element.getBoundingClientRect().height
        if (!item || height <= 0 || current.get(key)?.signature === item.signature && Math.abs(current.get(key).height - height) < .5) continue
        if (next === current) next = new Map(current)
        next.set(key, { signature: item.signature, height })
      }
      if (next === current) return
      measurements.current = next; saved.feedbackHeights = next
      setHeightRevision(value => value + 1)
    }
    measure()
    const observer = new ResizeObserver(measure); rows.forEach(element => observer.observe(element))
    return () => { active = false; observer.disconnect() }
  }, [items, renderKey, scroll.width, language, saved])
  useLayoutEffect(() => {
    if (!pendingFocus.current) return
    const element = [...list.current.children].find(row => row.dataset.feedbackKey === pendingFocus.current)
    const button = element?.querySelector('button')
    if (button) { button.focus({ preventScroll: true }); pendingFocus.current = '' }
  }, [renderKey, items, layout, focused])
  const tab = event => {
    if (event.key !== 'Tab') return
    const current = layout.byKey.get(focused)
    if (current === undefined) return
    const direction = event.shiftKey ? -1 : 1
    for (let index = current + direction; index >= 0 && index < items.length; index += direction) {
      if (!items[index].focusable) continue
      event.preventDefault(); pendingFocus.current = items[index].key; setFocused(items[index].key)
      const top = Math.max(0, Math.min(layout.offsets[index], Math.max(0, layout.height - viewport.current.clientHeight)))
      viewport.current.scrollTop = top; saved.feedbackTop = top
      if (previous.current) previous.current.top = top
      setScroll(value => ({ ...value, top })); return
    }
  }
  return React.createElement('div', { ref: viewport, className: 'dsh-super-code-feedback-scroll', tabIndex: 0, 'aria-label': text(t, 'feedback.title'), onKeyDown: tab,
    onScroll: event => {
      const top = event.currentTarget.scrollTop; saved.feedbackTop = top
      if (previous.current) previous.current.top = top
      setScroll(value => value.top === top ? value : { ...value, top })
    }, onFocusCapture: event => setFocused(event.target.closest('[data-feedback-key]')?.dataset.feedbackKey || ''),
    onBlurCapture: event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused('') } },
    [...watched].map(id => React.createElement(AgentCatalogWatch, { key: id, id, watchCatalog })),
    React.createElement('ol', { ref: list, className: 'dsh-super-code-feedback-list', 'aria-label': text(t, 'feedback.title'), style: { height: layout.height }, 'data-feedback-total': items.length },
      indices.map(index => {
        const item = items[index], row = item.row, header = item.kind === 'task'
        const indent = row ? Math.min(Math.max(0, row.level - 1), 4) * 16 + (header ? 0 : 14) : 0
        return React.createElement('li', { key: item.key, 'data-feedback-key': item.key, 'data-feedback-kind': item.kind,
          'data-feedback-agent': row?.id, 'data-feedback-depth': row?.level, 'data-feedback-live': row ? row.node.running === true || row.facts?.phase === 'running' : undefined,
          'aria-posinset': index + 1, 'aria-setsize': items.length,
          style: { transform: `translateY(${layout.offsets[index]}px)`, paddingLeft: indent, '--sc-feedback-indent': indent + 'px' } }, React.createElement(FeedbackRowContent, { item, root, openDetail, t }))
      })))
}
function feedbackStatus(row, t = key => zh[key] || key) {
  if (row.node.unavailable) return { tone: 'unavailable', label: text(t, 'tree.legend.unavailable') }
  const phase = row.facts?.phase
  if (row.node.running === true) return { tone: 'active', label: text(t, phase === 'waiting' ? 'feedback.waiting' : 'tree.legend.active') }
  if (phase === 'error' || phase === 'interrupted') return { tone: 'error', label: text(t, `feedback.${phase}`) }
  if (['completed', 'cancelled', 'paused', 'blocked'].includes(row.taskStatus)) return { tone: row.taskStatus === 'completed' ? 'success' : 'idle', label: text(t, `status.${row.taskStatus}`) }
  // Host inactivity or a completed turn does not establish task completion.
  return agentExecutionStatus(row.node, row.id === row.root, t)
}
function TaskFeedback({ useSessions, useSessionStatus, sessionId, useTabInfo, treeStates, openDetail, refresh, watchCatalog, onToggle, t }) {
  const catalog = useSessions(s => s), statuses = useSessionStatus ? useSessionStatus(s => s) : undefined
  const state = useMemo(() => agentSessionState(catalog, sessionId, statuses), [catalog, sessionId, statuses])
  const view = useMemo(() => buildAgentView(state), [state.byId, state.subagentsByParent, state.current, state.currentAddress])
  const { tab } = useTabInfo()
  const saved = useMemo(() => {
    let value = treeStates.get(tab.signal)
    if (!value || value.root !== view.root) { value = { root: view.root, limit: 200, focused: state.current, expanded: new Set(), collapsed: new Set() }; treeStates.set(tab.signal, value) }
    return value
  }, [treeStates, tab.signal, view.root])
  const catalogs = state.subagentsByParent
  return React.createElement(TaskFeedbackBody, { key: view.root, view, catalogs, saved, openDetail, refresh, watchCatalog, onToggle, t })
}
function TaskFeedbackBody({ view, catalogs, saved, openDetail, refresh, watchCatalog, onToggle, t }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(false)
  const model = useMemo(() => taskFeedbackRows(view), [view])
  const partial = model.partial || [...view.nodes.keys()].some(id => catalogs?.[id]?.state === 'error')
  const items = useMemo(() => {
    const rows = feedbackListItems(model, view.root, partial)
    if (!view.root) rows.unshift({ kind: 'note', key: 'empty', label: 'tree.empty', signature: 'empty' })
    if (error) rows.unshift({ kind: 'note', key: 'error', label: 'tree.loadError', signature: 'error' })
    return rows
  }, [model, view.root, partial, error])
  const reload = async () => {
    setBusy(true); setError(false)
    try {
      const ids = [...view.nodes.keys()]
      for (let start = 0; start < ids.length; start += 20) await Promise.all(ids.slice(start, start + 20).map(id => refresh(id)))
    }
    catch { setError(true) }
    finally { setBusy(false) }
  }
  return React.createElement('section', { className: 'dsh-super-code-feedback', 'data-task-feedback': true },
    React.createElement('header', null,
      React.createElement(WorkspaceSectionToggle, { section: 'tasks', expanded: true, onToggle, t }),
      React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-icon-button', title: text(t, 'feedback.refresh'), 'aria-label': text(t, 'feedback.refresh'), disabled: busy || !view.root, onClick: () => void reload() }, React.createElement(IconRefreshOutline16))),
    React.createElement(FeedbackVirtualList, { items, root: view.root, saved, openDetail, t, watchCatalog }))
}

export { TaskFeedback, feedbackListAnchor, feedbackListIndex, feedbackListItems, feedbackListLayout, feedbackListWindow, feedbackStatus, taskFeedbackRows }
