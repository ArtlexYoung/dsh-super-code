import { agentDetailTarget, agentPath } from './address.js'
import { featureView } from '../ui/boundary.js'
import { localeCode, text, zh } from '../ui/locale.js'
import { AgentMessage, detailRecord } from './messages.js'
import React, { useMemo, useRef, useState, useSyncExternalStore, useLayoutEffect, useEffect } from '../ui/react.js'
import { TaskMemoryPanel, agentExecutionStatus, agentSessionState, buildAgentView } from './agents.js'
import { ActionButton, Glyph, IconRefreshOutline16, SelectControl } from '../ui/controls.js'
import { MemoryActivity } from './memory.js'
import { FeedbackTools, feedbackToolSummary } from './feedback.js'

// The host journal owns decoding, cursor validation and reconnects. This view
// keeps a bounded display window and never stages or sends to another session.
function createAgentInspector(createStream, address, readPage, initial, t = key => zh[key] || key) {
  let snapshot = initial || { status: 'loading', items: [], hasMore: false, earlier: false, truncated: false, projections: {}, error: '', firstSeq: 0, cursor: -1 }
  let cursor = snapshot.cursor
  let disposed = false, paging = false, stream
  const listeners = new Set()
  const publish = patch => {
    if (disposed) return
    if (patch.cursor !== undefined) cursor = patch.cursor
    snapshot = { ...snapshot, cursor, ...patch }
    listeners.forEach(listener => listener())
  }
  const itemsOf = entries => entries.map(entry => detailRecord(entry, t)).filter(item => item.kind !== 'skip' && (item.text || item.callId))
  stream = createStream(agentDetailTarget(address), {
    publish: change => {
      if (disposed) return
      if (change.type === 'replace') {
        if (snapshot.earlier) {
          publish({ status: paging ? 'paging' : 'ready', projections: change.page.projections?.values || {}, error: '' })
          return
        }
        const fresh = itemsOf(change.entries)
        const sequences = new Set(fresh.map(item => item.seq))
        const overlaps = snapshot.items.some(item => sequences.has(item.seq))
        // A resumed tail page can start later than the user's reading window.
        // Immutable journal records can be merged without moving that window.
        const items = overlaps ? [...new Map([...snapshot.items, ...fresh].map(item => [item.seq, item])).values()].sort((a, b) => a.seq - b.seq) : fresh
        publish({ status: paging ? 'paging' : 'ready', items: items.slice(-200), hasMore: (overlaps ? snapshot.hasMore : change.hasMore) || items.length > 200, earlier: false, truncated: items.length > 200,
          firstSeq: items.length > 200 ? items.at(-200).seq : overlaps ? snapshot.firstSeq : change.entries[0]?.event.seq ?? 0,
          cursor: change.entries.at(-1)?.event.seq ?? -1,
          projections: change.page.projections?.values || {}, error: '' })
      } else if (change.type === 'append' && !snapshot.earlier) {
        const item = detailRecord(change.entry, t)
        cursor = change.entry.event.seq
        if (item.kind !== 'skip' && (item.text || item.callId)) {
          const items = [...snapshot.items, item]
          publish({ items: items.slice(-200), cursor, truncated: snapshot.truncated || items.length > 200,
            firstSeq: items.length > 200 ? items.at(-200).seq : snapshot.firstSeq, hasMore: snapshot.hasMore || items.length > 200 })
        }
      }
    },
    carrierFailed: () => publish({ error: 'detail.connection' }),
    failed: () => publish({ status: 'error', error: 'detail.loadError' }),
  })
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    start: () => { stream.open({ maxMessages: 40 }).catch(() => publish({ status: 'error', error: 'detail.loadError' })) },
    older: async () => {
      if (disposed || paging || !snapshot.hasMore) return
      paging = true
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
      catch { publish({ status: 'error', error: 'detail.historyError' }) }
      finally { paging = false }
    },
    dispose: () => { disposed = true; listeners.clear(); void stream.dispose() },
  }
}

// 只归并展示；调用身份包含步骤及 PTC 父调用，返回记录仍完整保留。
function workbenchConversationRows(records) {
  const rows = [], calls = new Map()
  for (const record of records) {
    const event = record.entry?.event, data = event?.data
    if (!['tool/call', 'tool/result', 'tool/ptc-dispatch-start', 'tool/ptc-dispatch'].includes(event?.type)) {
      rows.push({ kind: 'message', key: record.seq, record }); continue
    }
    let group = rows.at(-1)
    if (group?.kind !== 'tools') { group = { kind: 'tools', key: `tools:${record.seq}`, items: [], calls: [] }; rows.push(group) }
    group.items.push(record)
    const identity = (id, parent) => JSON.stringify([data.turn, data.step, parent, id])
    const settle = (id, parent, tool, status) => {
      const key = identity(id ?? record.seq, parent)
      let call = calls.get(key)
      if (!call) { call = { tool: tool || 'tool', status }; calls.set(key, call); group.calls.push(call) }
      if (tool) call.tool = tool
      call.status = status
    }
    if (event.type === 'tool/call') settle(data.callId, undefined, data.name, 'running')
    else if (event.type === 'tool/ptc-dispatch-start') settle(data.subCallId, data.parentCallId, data.name, 'running')
    else if (event.type === 'tool/ptc-dispatch') settle(data.subCallId, data.parentCallId, data.name, data.isError ? 'failed' : 'succeeded')
    else if (data.message?.role === 'tool') settle(data.message.toolCallId, undefined, undefined, data.message.isError ? 'failed' : 'succeeded')
    else for (const block of data.message?.content || []) if (block.type === 'tool-result') settle(block.toolCallId, undefined, undefined, block.isError ? 'failed' : 'succeeded')
  }
  return rows.map(row => row.kind === 'tools' ? { kind: row.kind, key: row.key, items: row.items, tools: feedbackToolSummary(row.calls) } : row)
}

function AgentDetail({ useTabInfo, useSessions, useSessionStatus, sessionId, createInspector, detailStates, openMemory, compact = false, fileMentions, replyAction, t = key => zh[key] || key }) {
  const { tab } = useTabInfo()
  const catalog = useSessions(s => s)
  const statuses = useSessionStatus ? useSessionStatus(s => s) : undefined
  const state = useMemo(() => agentSessionState(catalog, sessionId, statuses), [catalog, sessionId, statuses])
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
  const [away, setAway] = useState(!saved.following), [question, setQuestion] = useState('')
  const inspector = useMemo(() => createInspector(tab.contentId, saved.snapshot), [createInspector, tab.contentId, tab.visible, revision])
  const snapshot = useSyncExternalStore(inspector.subscribe, inspector.getSnapshot, inspector.getSnapshot)
  const rows = useMemo(() => compact ? workbenchConversationRows(snapshot.items) : snapshot.items.map(record => ({ kind: 'message', key: record.seq, record })), [snapshot.items, compact])
  const questions = useMemo(() => snapshot.items.filter(record => record.entry?.event?.type === 'user/message'), [snapshot.items])
  function trackPosition() {
    const element = log.current
    if (!element) return
    saved.top = element.scrollTop
    saved.following = !snapshot.earlier && element.scrollHeight - element.clientHeight - element.scrollTop < 32
    if (saved.following) markUnread(false)
    if (compact) {
      setAway(!saved.following)
      const top = element.getBoundingClientRect().top
      let active = questions[0]?.seq
      for (const item of questions) if ((element.querySelector(`[data-message-seq="${item.seq}"]`)?.getBoundingClientRect().top ?? Infinity) <= top + 32) active = item.seq
      setQuestion(active === undefined ? '' : String(active))
    }
  }
  const latest = () => {
    saved.snapshot = undefined; saved.following = true; saved.top = 0
    restored.current = false; previous.current = undefined; markUnread(false)
    setRevision(value => value + 1)
  }
  useLayoutEffect(() => {
    const element = log.current
    if (!element || !tab.visible || snapshot.status === 'loading') return
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
    for (const row of rows) visible.add(row.key)
    for (const key of saved.open) if (key !== 'usage' && !visible.has(key)) saved.open.delete(key)
    if (compact) trackPosition()
  }, [snapshot, saved, compact, rows, tab.visible])
  useEffect(() => {
    if (tab.visible) inspector.start()
    return () => inspector.dispose()
  }, [inspector, tab.visible])
  const target = agentDetailTarget(tab.contentId), id = target.childSessionId || target.sessionId
  const view = useMemo(() => buildAgentView(state), [state.byId, state.subagentsByParent, state.current, state.currentAddress]), node = view.nodes.get(id)
  const path = agentPath(view, id)
  const projections = { ...snapshot.projections, ...state.byId[id]?.projectionValues }
  const totals = projections.superAgentUsage?.totals || projections.tokenUsage
  const input = totals ? (totals.uncachedInputTokens || 0) + (totals.cacheReadTokens || 0) + (totals.cacheWriteTokens || 0) : 0
  const format = value => value === undefined ? text(t, 'detail.unavailable') : value.toLocaleString(localeCode(t))
  const tasks = projections.superCodeTasks
  const toolNames = new Map()
  const renderMessage = record => {
    const data = record.entry?.event?.data
    const key = JSON.stringify([data?.turn, data?.step, record.parentCallId, record.callId])
    if (record.toolName && record.callId) toolNames.set(key, record.toolName)
    return React.createElement(AgentMessage, { key: record.seq, record, saved, t, compact, replyAction, fileMentions: fileMentions?.get(record.seq), toolName: toolNames.get(key) })
  }
  const task = tasks?.current?.kind === 'task' ? tasks.current : undefined
  const title = node?.title || node?.displayTitle || text(t, 'detail.title')
  const metrics = [
    [text(t, 'detail.input'), totals ? input : undefined], [text(t, 'detail.output'), totals?.outputTokens],
    [text(t, 'detail.cacheRead'), totals?.cacheReadTokens], [text(t, 'detail.cacheWrite'), totals?.cacheWriteTokens],
  ]
  return React.createElement('section', { className: 'dsh-super-code-detail', 'data-agent-detail': id },
    React.createElement('header', { className: 'dsh-super-code-detail-header' },
      path.length > 1 && React.createElement('nav', { 'aria-label': text(t, 'detail.path'), title: path.map(part => part.title).join(' / ') },
        path.slice(0, -1).map((part, index) => React.createElement('span', { key: part.id }, index > 0 ? ' / ' : '', part.title))),
      React.createElement('div', { className: 'dsh-super-code-detail-heading' },
        React.createElement('h2', { title }, title),
        React.createElement('span', { className: 'dsh-super-code-detail-status', 'data-tone': agentExecutionStatus(node, id === view.root, t).tone }, agentExecutionStatus(node, id === view.root, t).label),
        React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-icon-button', title: text(t, 'detail.refresh'), 'aria-label': text(t, 'detail.refresh'), onClick: latest }, React.createElement(IconRefreshOutline16))),
      React.createElement('details', { className: 'dsh-super-code-usage-details', open: saved.open.has('usage'), onToggle: event => {
        if (event.target !== event.currentTarget) return
        if (event.currentTarget.open) saved.open.add('usage'); else saved.open.delete('usage')
      } },
        React.createElement('summary', null,
          React.createElement('span', { className: 'dsh-super-code-detail-summary' },
            React.createElement('span', { title: text(t, 'detail.total') }, React.createElement('span', null, 'Token'), React.createElement('strong', null, format(totals ? input + (totals.outputTokens || 0) : undefined))),
            React.createElement('span', { title: text(t, 'detail.hitRate') }, React.createElement('span', null, text(t, 'detail.cache')), React.createElement('strong', null, totals ? (input ? Math.round((totals.cacheReadTokens || 0) / input * 100) : 0) + '%' : text(t, 'detail.unavailable')))),
          React.createElement('span', { className: 'dsh-super-code-detail-info-toggle' }, text(t, 'detail.info'), React.createElement(Glyph, { type: 'chevron' }))),
        React.createElement('div', { className: 'dsh-super-code-detail-info' },
          React.createElement('dl', { className: 'dsh-super-code-detail-metrics' }, metrics.map(([label, value]) => React.createElement('div', { key: label }, React.createElement('dt', null, label), React.createElement('dd', null, format(value))))),
          id !== view.root && task?.goal && task.goal !== title && React.createElement('p', { className: 'dsh-super-code-detail-task' }, task.goal),
          id === view.root && React.createElement(TaskMemoryPanel, { state: tasks, t }),
          featureView(MemoryActivity, { usage: projections.superCodeMemoryUsage, sessionId: id, openMemory, t })))),
    compact && questions.length > 0 && React.createElement('nav', { className: 'sc-wb-question-nav', 'aria-label': text(t, 'workbench.questions') },
      React.createElement(SelectControl, { label: text(t, 'workbench.questions'), value: questions.some(item => String(item.seq) === question) ? question : String(questions[0].seq),
        choices: questions.map((item, index) => [String(item.seq), `${index + 1}. ${item.text.replace(/\s+/g, ' ').slice(0, 72)}`]),
        onChange: value => {
          const element = log.current, target = element?.querySelector(`[data-message-seq="${value}"]`)
          if (target) { saved.following = false; element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - 8; setQuestion(value); setAway(true) }
        } })),
    React.createElement('div', { ref: log, className: 'dsh-super-code-detail-log', 'aria-label': text(t, 'tree.title'), onScroll: trackPosition },
      snapshot.error && React.createElement('p', { role: 'alert' }, text(t, snapshot.error)),
      snapshot.status === 'loading' && React.createElement('p', { role: 'status' }, text(t, 'detail.reading')),
      snapshot.hasMore && React.createElement(ActionButton, { type: 'button', disabled: snapshot.status === 'paging', onClick: inspector.older }, snapshot.status === 'paging' ? text(t, 'detail.read') : text(t, 'detail.older')),
      (snapshot.earlier || snapshot.truncated) && React.createElement(ActionButton, { type: 'button', onClick: latest }, text(t, 'detail.latest')),
      snapshot.status === 'ready' && !snapshot.items.length && React.createElement('p', null, text(t, 'detail.empty')),
      rows.map(row => row.kind === 'message' ? renderMessage(row.record) : React.createElement('details', { key: row.key, className: 'sc-wb-tool-group', open: saved.open.has(row.key), onToggle: event => {
        if (event.target !== event.currentTarget) return
        if (event.currentTarget.open) saved.open.add(row.key); else saved.open.delete(row.key)
      } }, React.createElement('summary', null, React.createElement(Glyph, { type: 'chevron' }),
        row.tools.length ? React.createElement(FeedbackTools, { tools: row.tools, t, inline: true }) : text(t, 'detail.toolResult')),
        React.createElement('div', null, row.items.map(renderMessage))))),
    (unread || compact && (away || snapshot.earlier)) && React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-new-content', onClick: () => {
      if (compact && snapshot.earlier) { latest(); return }
      saved.following = true; log.current.scrollTop = log.current.scrollHeight; markUnread(false); setAway(false)
    } }, text(t, unread ? 'detail.new' : 'workbench.bottom')))
}

export { AgentDetail, createAgentInspector, workbenchConversationRows }
