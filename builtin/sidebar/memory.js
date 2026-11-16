import React, { useRef, useLayoutEffect, useMemo, useSyncExternalStore, useState, useEffect } from '../ui/react.js'
import { localeCode, text, zh } from '../ui/locale.js'
import { ActionButton, Glyph, IconRefreshOutline16, SelectControl } from '../ui/controls.js'
import { WorkspaceSectionToggle } from './controls.js'

function MemoryActivity({ usage, openMemory, sessionId, t }) {
  const rows = [...(usage?.rows || [])].reverse()
  return React.createElement('details', { className: 'dsh-super-code-memory-activity' },
    React.createElement('summary', null, text(t, 'memory.agentUsage'), rows.length ? ` · ${rows.length}` : ''),
    !rows.length && React.createElement('p', null, text(t, 'memory.usageEmpty')),
    React.createElement('div', { className: 'dsh-super-code-memory-activity-list' }, rows.map(row =>
      React.createElement(ActionButton, { key: `${row.scope}/${row.topic}/${row.id}/${row.action}`, type: 'button',
        onClick: () => openMemory(sessionId, row), title: text(t, 'memory.open') },
      React.createElement('span', { className: 'dsh-super-code-memory-action', 'data-action': row.action }, text(t, `memory.${row.action}`)),
      React.createElement('span', null, row.summary || row.id),
      React.createElement('small', null, `${text(t, `memory.${row.scope}`)} · ${row.topic}`)))),
    usage?.omitted > 0 && React.createElement('p', { className: 'dsh-super-code-memory-muted' }, text(t, 'memory.omitted')))
}

function memoryLibraryAddress(sessionId, row = {}) {
  const url = new URL(`dsh-resource://super-code-memory/${encodeURIComponent(sessionId)}`)
  for (const key of ['scope', 'topic', 'id']) if (row[key]) url.searchParams.set(key, row[key])
  return url.href
}

function memoryLibraryTarget(address, current) {
  try {
    const url = new URL(address)
    if (url.protocol === 'dsh-resource:' && url.host === 'super-code-memory') return {
      sessionId: decodeURIComponent(url.pathname.slice(1)) || current, scope: url.searchParams.get('scope') === 'global' ? 'global' : 'project',
      topic: url.searchParams.get('topic') || '', id: url.searchParams.get('id') || '',
    }
  } catch {}
  return { sessionId: current, scope: 'project', topic: '', id: '' }
}

/** A repeated explicit navigation reopens its entry; ordinary remounts retain reading state. */
function memoryLibraryNavigation(saved, tab, current) {
  const address = typeof tab.navigation?.params?.memory === 'string' ? tab.navigation.params.memory : tab.contentId
  const target = memoryLibraryTarget(address, current)
  const navigationKey = `${address}/${tab.navigation?.revision || 0}/${target.sessionId}`
  if (saved.navigationKey === navigationKey) return saved
  return { ...saved, navigationKey, sessionId: target.sessionId,
    ...(!target.id && saved.sessionId && saved.sessionId !== target.sessionId && saved.scope !== 'global'
      ? { selected: null, query: '', topicFilter: '', top: 0, detailTop: 0 } : {}), ...(target.id ? {
    scope: target.scope, selected: { topic: target.topic, id: target.id }, detailTop: 0,
    ...(saved.scope && saved.scope !== target.scope ? { topicFilter: '', top: 0 } : {}),
  } : {}) }
}

/** A fixed-height index keeps large libraries cheap; entry bodies load on click. */
function memoryLibraryWindow(items, query, top, height) {
  const search = query.trim().toLocaleLowerCase()
  const matches = items.filter(item => !search || `${item.topic} ${item.id} ${item.summary}`.toLocaleLowerCase().includes(search))
  const start = Math.min(Math.max(0, Math.floor(top / 76) - 3), Math.max(0, matches.length - 1))
  const end = Math.min(matches.length, start + Math.ceil(height / 76) + 7)
  return { rows: matches.slice(start, end), count: matches.length, before: start * 76, after: (matches.length - end) * 76 }
}

/** Drafts and in-flight operations survive the host unmounting a hidden tab. */
function createMemoryEditor(saved, api) {
  if (saved.editorStore) {
    saved.editorStore.bindApi(api)
    return saved.editorStore
  }
  let snapshot = { draft: null, confirmation: null, busy: false, error: '', refresh: 0 }
  const listeners = new Set()
  const update = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener() }
  const run = async (method, target) => {
    if (snapshot.busy) return { kind: 'busy' }
    update({ busy: true, error: '' })
    try {
      const response = method === 'save' ? await api.saveEntry(target.sessionId, target.scope, target.topic, target.id, JSON.stringify({
        expected: target.expected, kind: target.kind, summary: target.summary.trim(), detail: target.detail.trim(),
      })) : await api.deleteEntry(target.sessionId, target.scope, target.topic, target.id, target.expected)
      if (!response.ok) throw new Error('Remote unavailable')
      const result = response.value
      if (!['saved', 'removed'].includes(result.kind)) {
        update({ busy: false, error: { conflict: 'memory.conflict', missing: 'memory.missingEdit', full: 'memory.full' }[result.kind] || 'memory.writeError' })
        return result
      }
      saved.scope = target.scope
      saved.selected = result.kind === 'saved' ? { topic: target.topic, id: target.id } : null
      saved.detailTop = 0
      update({ draft: null, confirmation: null, busy: false, error: '', refresh: snapshot.refresh + 1 })
      return result
    } catch {
      update({ busy: false, error: 'memory.writeError' })
      return { kind: 'error' }
    }
  }
  saved.editorStore = { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    // The host may replace its Remote while the retained draft is still open.
    bindApi: value => { api = value },
    update, save: () => run('save', snapshot.draft), remove: () => run('remove', snapshot.confirmation) }
  return saved.editorStore
}

function MemoryEditor({ store, state, t }) {
  const draft = state.draft
  const set = (key, value) => store.update({ draft: { ...draft, [key]: value }, error: '' })
  return React.createElement('form', { className: 'dsh-super-code-memory-editor', 'aria-label': text(t, draft.expected ? 'memory.edit' : 'memory.add'),
    onSubmit: event => { event.preventDefault(); void store.save() } },
    React.createElement('div', { className: 'dsh-super-code-memory-editor-heading' },
      React.createElement('strong', null, text(t, draft.expected ? 'memory.edit' : 'memory.add')),
      React.createElement('small', null, text(t, `memory.${draft.scope}`))),
    React.createElement('label', null, text(t, 'memory.topic'),
      React.createElement('input', { value: draft.topic, 'aria-label': text(t, 'memory.topic'), required: true, maxLength: 96,
        disabled: state.busy || Boolean(draft.expected) || draft.scope === 'global', onChange: event => set('topic', event.target.value) }),
      !draft.expected && draft.scope !== 'global' && React.createElement('small', null, text(t, 'memory.topicHint'))),
    React.createElement(SelectControl, { label: text(t, 'memory.kind'), value: draft.kind, disabled: state.busy || draft.scope === 'global',
      choices: ['constraint', 'fact', 'experience'].map(kind => [kind, text(t, `memory.${kind}`)]), onChange: kind => set('kind', kind) }),
    React.createElement('label', null, text(t, 'memory.summaryLabel'), React.createElement('small', null, `${Array.from(draft.summary).length}/30`),
      React.createElement('input', { value: draft.summary, 'aria-label': text(t, 'memory.summaryLabel'), required: true, disabled: state.busy, onChange: event => set('summary', event.target.value) })),
    React.createElement('label', null, text(t, 'memory.detailLabel'), React.createElement('small', null, `${draft.detail.length}/1000`),
      React.createElement('textarea', { value: draft.detail, 'aria-label': text(t, 'memory.detailLabel'), required: true, maxLength: 1000, rows: 5, disabled: state.busy, onChange: event => set('detail', event.target.value) })),
    state.error && React.createElement('p', { role: 'alert' }, text(t, state.error)),
    React.createElement('div', { className: 'dsh-super-code-memory-actions' },
      React.createElement(ActionButton, { type: 'button', disabled: state.busy, onClick: () => store.update({ draft: null, error: '' }) }, text(t, 'memory.cancel')),
      React.createElement(ActionButton, { type: 'submit', className: 'dsh-super-code-memory-primary', disabled: state.busy || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(draft.topic) || !draft.summary.trim() || Array.from(draft.summary.trim()).length > 30 || !draft.detail.trim() }, text(t, state.busy ? 'memory.saving' : 'memory.save'))))
}

function MemoryDeleteConfirmation({ store, state, t }) {
  const dialog = useRef(null), target = state.confirmation
  useLayoutEffect(() => {
    dialog.current.showModal()
    return () => { if (dialog.current?.open) dialog.current.close() }
  }, [])
  const cancel = () => { if (!store.getSnapshot().busy) store.update({ confirmation: null, error: '' }) }
  return React.createElement('dialog', { ref: dialog, className: 'dsh-super-code-confirm', 'aria-label': text(t, 'memory.deleteTitle'),
    onCancel: event => { event.preventDefault(); cancel() }, onKeyDown: event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() }
    } },
    React.createElement('h3', null, text(t, 'memory.deleteTitle')),
    React.createElement('p', null, text(t, 'memory.deleteHint', { summary: target.summary })),
    state.error && React.createElement('p', { role: 'alert' }, text(t, state.error)),
    React.createElement('div', { className: 'dsh-super-code-confirm-actions' },
      React.createElement(ActionButton, { type: 'button', disabled: state.busy, onClick: cancel }, text(t, 'memory.cancel')),
      React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-memory-danger', disabled: state.busy, onClick: () => { void store.remove() } }, text(t, state.busy ? 'memory.deleting' : 'memory.delete'))))
}

function MemoryLibrary({ useTabInfo, useSessions, sessionId: scopeSessionId, api, memoryStates, onToggle, t = key => zh[key] || key }) {
  const { tab } = useTabInfo(), current = useSessions(state => scopeSessionId || state.current)
  const address = typeof tab.navigation?.params?.memory === 'string' ? tab.navigation.params.memory : tab.contentId
  const target = memoryLibraryTarget(address, current)
  const saved = useMemo(() => {
    const value = memoryStates.get(tab.signal) || {}
    const editing = value.editorStore?.getSnapshot()
    if (!editing?.draft && !editing?.confirmation && !editing?.busy) Object.assign(value, memoryLibraryNavigation(value, tab, current))
    memoryStates.set(tab.signal, value)
    return value
  }, [memoryStates, tab.signal])
  const editor = useMemo(() => createMemoryEditor(saved, api), [saved, api])
  const editing = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot)
  const [scope, setScope] = useState(saved.scope || target.scope)
  const [query, setQuery] = useState(saved.query || '')
  const [topicFilter, setTopicFilter] = useState(saved.topicFilter || '')
  const [selected, setSelected] = useState(saved.selected || null)
  const [state, setState] = useState({ key: '', items: [], loading: true, error: false })
  const [detail, setDetail] = useState(null), [revision, setRevision] = useState(0)
  const [viewport, setViewport] = useState({ top: saved.top || 0, height: 600 })
  const list = useRef(null), detailBody = useRef(null), sessionId = editing.draft?.sessionId || editing.confirmation?.sessionId || target.sessionId
  const key = `${sessionId}/${scope}`, selectionKey = selected ? `${key}/${selected.topic}/${selected.id}` : ''
  const visibleState = state.key === key ? state : { items: [], loading: true, error: false }
  useLayoutEffect(() => {
    if (editing.draft || editing.confirmation || editing.busy) return
    const next = memoryLibraryNavigation(saved, tab, current)
    if (next === saved) return
    Object.assign(saved, next)
    setScope(saved.scope || target.scope); setSelected(saved.selected || null)
    setQuery(saved.query || '')
    setTopicFilter(saved.topicFilter || '')
    setViewport(value => ({ ...value, top: saved.top || 0 }))
    if (detailBody.current) detailBody.current.scrollTop = 0
  }, [saved, address, current, tab.navigation?.revision, editing.draft, editing.confirmation, editing.busy])
  useLayoutEffect(() => {
    if (!editing.refresh) return
    setScope(saved.scope); setSelected(saved.selected); setRevision(value => value + 1)
  }, [editing.refresh])
  useEffect(() => {
    if (!tab.visible || !sessionId) return
    let cancelled = false
    setState(previous => ({ ...previous, loading: true, error: false }))
    api.list(sessionId, scope).then(result => {
      if (!cancelled) setState({ key, items: result.ok ? result.value.items : [], loading: false, error: !result.ok })
    }).catch(() => { if (!cancelled) setState({ key, items: [], loading: false, error: true }) })
    return () => { cancelled = true }
  }, [api, tab.visible, sessionId, scope, revision])
  useEffect(() => {
    if (!tab.visible || !sessionId || !selected) return
    let cancelled = false
    setDetail(null)
    api.read(sessionId, scope, selected.topic, selected.id).then(result => {
      if (!cancelled) setDetail({ key: selectionKey, ...(result.ok ? result.value : { kind: 'error' }) })
    }).catch(() => { if (!cancelled) setDetail({ key: selectionKey, kind: 'error' }) })
    return () => { cancelled = true }
  }, [api, tab.visible, sessionId, scope, selectionKey, revision])
  useLayoutEffect(() => {
    const element = list.current
    if (!element || visibleState.loading) return
    element.scrollTop = saved.top || 0
    const resize = () => setViewport({ top: element.scrollTop, height: element.clientHeight || 600 })
    resize()
    const observer = new ResizeObserver(resize); observer.observe(element)
    return () => observer.disconnect()
  }, [selected, key, tab.visible, Boolean(editing.draft), visibleState])
  useLayoutEffect(() => {
    if (detailBody.current) detailBody.current.scrollTop = saved.detailTop || 0
  }, [selectionKey, detail?.key, tab.visible, Boolean(editing.draft)])
  const resetScroll = () => { saved.top = 0; if (list.current) list.current.scrollTop = 0; setViewport(value => ({ ...value, top: 0 })) }
  const choose = value => { saved.detailTop = 0; if (detailBody.current) detailBody.current.scrollTop = 0; saved.selected = value; setSelected(value) }
  const changeTopic = value => { saved.topicFilter = value; setTopicFilter(value); resetScroll() }
  const topics = useMemo(() => {
    const counts = new Map()
    for (const item of visibleState.items) counts.set(item.topic, (counts.get(item.topic) || 0) + 1)
    return [...counts].map(([topic, count]) => ({ topic, count })).sort((a, b) => a.topic.localeCompare(b.topic, localeCode(t)))
  }, [visibleState.items, t])
  const topicItems = useMemo(() => topicFilter ? visibleState.items.filter(item => item.topic === topicFilter) : visibleState.items, [visibleState.items, topicFilter])
  const page = useMemo(() => memoryLibraryWindow(topicItems, query, viewport.top, viewport.height), [topicItems, query, viewport])
  const currentDetail = detail?.key === selectionKey ? detail : null
  const entry = currentDetail?.kind === 'found' ? currentDetail.entry : null
  const related = entry ? visibleState.items.filter(item => item.topic === entry.topic && item.id !== entry.id).slice(0, 5) : []
  return React.createElement('section', { className: 'dsh-super-code-memory', 'aria-label': text(t, 'memory.title') },
    React.createElement('header', null,
      React.createElement('div', { className: 'dsh-super-code-memory-heading' },
        onToggle ? React.createElement(WorkspaceSectionToggle, { section: 'memory', expanded: true, onToggle, t })
          : React.createElement('div', { className: 'dsh-super-code-title-line' }, React.createElement(Glyph, { type: 'memory' }), React.createElement('h2', null, text(t, 'memory.title'))),
        React.createElement('div', { className: 'dsh-super-code-memory-header-actions' },
          React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-view-button', 'aria-label': text(t, 'memory.add'), disabled: !sessionId || editing.busy || Boolean(editing.draft), onClick: () => editor.update({ error: '', draft: {
            sessionId, scope, topic: scope === 'global' ? 'preferences' : topicFilter || 'notes', id: window.crypto.randomUUID(), expected: '', kind: 'constraint', summary: '', detail: '',
          } }) }, `+ ${text(t, 'memory.add')}`),
          React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-icon-button', title: text(t, 'memory.refresh'), 'aria-label': text(t, 'memory.refresh'), disabled: editing.busy || Boolean(editing.draft), onClick: () => { editor.update({ error: '' }); setRevision(value => value + 1) } }, React.createElement(IconRefreshOutline16)))),
      React.createElement('div', { className: 'dsh-super-code-memory-scopes', role: 'group', 'aria-label': text(t, 'memory.title') },
        ['project', 'global'].map(value => React.createElement(ActionButton, { key: value, type: 'button', 'aria-pressed': scope === value, disabled: editing.busy || Boolean(editing.draft), onClick: () => {
          saved.scope = value; setScope(value); changeTopic(''); choose(null)
        } }, text(t, `memory.${value}`)))),
      !selected && !editing.draft && React.createElement('div', { className: 'dsh-super-code-memory-search' }, React.createElement(Glyph, { type: 'search' }),
        React.createElement('input', { type: 'search', 'aria-label': text(t, 'memory.search'), placeholder: text(t, 'memory.search'), value: query, onChange: event => { saved.query = event.target.value; setQuery(event.target.value); resetScroll() } }))),
    !sessionId ? React.createElement('p', { className: 'dsh-super-code-memory-empty' }, text(t, 'memory.selectSession')) : editing.draft ? React.createElement(MemoryEditor, { store: editor, state: editing, t }) : selected
      ? React.createElement('div', { ref: detailBody, className: 'dsh-super-code-memory-body', 'aria-busy': !currentDetail, onScroll: event => { saved.detailTop = event.currentTarget.scrollTop } },
        React.createElement('div', { className: 'dsh-super-code-memory-actions' },
          React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-view-button', onClick: () => choose(null) }, `← ${text(t, 'memory.back')}`),
          entry && React.createElement(React.Fragment, null,
            React.createElement(ActionButton, { type: 'button', onClick: () => editor.update({ error: '', draft: { sessionId, scope, topic: entry.topic, id: entry.id, expected: entry.token, kind: entry.kind, summary: entry.summary, detail: entry.detail } }) }, text(t, 'memory.edit')),
            React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-memory-danger', onClick: () => editor.update({ error: '', confirmation: { sessionId, scope, topic: entry.topic, id: entry.id, expected: entry.token, summary: entry.summary } }) }, text(t, 'memory.delete')))),
        !currentDetail && React.createElement('p', { role: 'status', className: 'dsh-super-code-memory-empty' }, text(t, 'memory.loading')),
        currentDetail?.kind === 'error' && React.createElement('p', { role: 'alert' }, text(t, 'memory.error')),
        currentDetail?.kind === 'missing' && React.createElement('p', null, text(t, 'memory.missing')),
        entry && React.createElement('article', { 'data-kind': entry.kind },
          React.createElement('div', { className: 'dsh-super-code-memory-detail-meta' },
            React.createElement('span', null, React.createElement(Glyph, { type: 'folder' }), entry.topic),
            React.createElement('span', null, text(t, `memory.${entry.kind}`))),
          React.createElement('h3', null, entry.summary), React.createElement('p', { className: 'dsh-super-code-memory-detail' }, entry.detail),
          React.createElement('dl', null, React.createElement('dt', null, text(t, 'memory.source')),
            React.createElement('dd', null, `${text(t, `memory.${entry.source.kind}`)}${entry.source.eventSeq === undefined ? '' : ` · #${entry.source.eventSeq}`}`, React.createElement('br'), entry.source.sessionId)),
          related.length > 0 && React.createElement('section', { className: 'dsh-super-code-memory-related' },
            React.createElement('h4', null, text(t, 'memory.related')),
            related.map(item => React.createElement(ActionButton, { key: item.id, type: 'button', onClick: () => choose({ topic: item.topic, id: item.id }) },
              React.createElement(Glyph, { type: 'memory' }), React.createElement('span', null, item.summary), React.createElement(Glyph, { type: 'arrow' }))))))
      : React.createElement('div', { className: 'dsh-super-code-memory-workspace' },
        React.createElement('nav', { className: 'dsh-super-code-memory-topic-index', 'aria-label': text(t, 'memory.topics') },
          React.createElement('div', { className: 'dsh-super-code-memory-topic-label' }, text(t, 'memory.topics'), React.createElement('span', null, topics.length)),
          React.createElement('div', { className: 'dsh-super-code-memory-topic-options' },
            [{ topic: '', count: visibleState.items.length }, ...topics].map(({ topic, count }) => React.createElement(ActionButton, { key: topic, type: 'button', title: topic || text(t, 'memory.allTopics'), 'data-topic': topic, 'aria-pressed': topicFilter === topic, onClick: () => changeTopic(topic) },
              React.createElement(Glyph, { type: topic ? 'folder' : 'memory' }), React.createElement('span', null, topic || text(t, 'memory.allTopics')), React.createElement('small', null, count))))),
        React.createElement('div', { className: 'dsh-super-code-memory-results' },
          React.createElement('div', { className: 'dsh-super-code-memory-list-heading' }, React.createElement('strong', null, topicFilter || text(t, 'memory.allTopics')), React.createElement('small', null, text(t, 'memory.count', { count: page.count }))),
          React.createElement('div', { ref: list, className: 'dsh-super-code-memory-list', role: 'list', 'aria-busy': visibleState.loading, onScroll: event => { saved.top = event.currentTarget.scrollTop; setViewport(value => ({ ...value, top: saved.top })) } },
            visibleState.loading && !visibleState.error && !visibleState.items.length && React.createElement('p', { role: 'status', className: 'dsh-super-code-memory-empty' }, text(t, 'memory.loading')),
            visibleState.error && React.createElement('p', { role: 'alert' }, text(t, 'memory.error')),
            !visibleState.error && !visibleState.loading && !page.count && React.createElement('p', { className: 'dsh-super-code-memory-empty' }, text(t, query || topicFilter ? 'memory.noMatches' : 'memory.empty')),
            React.createElement('div', { 'aria-hidden': true, style: { height: page.before } }),
            page.rows.map(item => React.createElement('div', { role: 'listitem', key: `${item.topic}/${item.id}` },
              React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-memory-row', 'data-topic': item.topic, 'data-kind': item.kind, onClick: () => choose({ topic: item.topic, id: item.id }) },
                React.createElement('span', { className: 'dsh-super-code-memory-row-heading' }, React.createElement(Glyph, { type: 'folder' }), React.createElement('span', { className: 'dsh-super-code-memory-row-topic' }, item.topic)),
                React.createElement('strong', null, item.summary),
                React.createElement('span', { className: 'dsh-super-code-memory-row-meta' }, React.createElement('span', { className: 'dsh-super-code-memory-row-kind' }, text(t, `memory.${item.kind}`)))))),
            React.createElement('div', { 'aria-hidden': true, style: { height: page.after } })))),
    editing.confirmation && React.createElement(MemoryDeleteConfirmation, { store: editor, state: editing, t }))
}

export { MemoryActivity, MemoryLibrary, createMemoryEditor, memoryLibraryAddress, memoryLibraryNavigation, memoryLibraryTarget, memoryLibraryWindow }
