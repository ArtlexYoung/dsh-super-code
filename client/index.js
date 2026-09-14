/* Browser entry for dsh-super-agent. It deliberately uses the Harness public
 * slot and Remote faces; no DOM selectors or private React internals are used. */
import React, { useEffect, useMemo, useState } from 'react'

function readPresetList(result) {
  if (!result?.ok) return []
  const value = result.value
  return Array.isArray(value) ? value : (value?.presets ?? [])
}

function PresetPicker({ sessionId, list, select }) {
  const [presets, setPresets] = useState([])
  const [current, setCurrent] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    list().then(result => {
      if (!active) return
      const rows = readPresetList(result).filter(p => !p.broken)
      setPresets(rows)
      if (rows.length && !current) setCurrent(rows[0].id)
    }).catch(e => { if (active) setError(String(e?.message ?? e)) })
    return () => { active = false }
  }, [list])
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
        if (result && !result.ok) setError(result.error?.message ?? 'Agent预设切换失败')
      },
    }, presets.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name || p.id)))
  )
}

function TokenFooter({ useProjection, tokenStats }) {
  const usage = useProjection?.('tokenUsage')
  if (!tokenStats || !usage) return null
  const total = (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0) + (usage.outputTokens || 0)
  const input = (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)
  const hit = input ? Math.round(((usage.cacheReadTokens || 0) / input) * 100) : 0
  return React.createElement('details', { className: 'dsh-super-agent-token-footer', 'data-super-agent-token-stats': true },
    React.createElement('summary', null, `Token总量 ${total} · 平均缓存命中率 ${hit}%`),
    React.createElement('dl', null,
      React.createElement('dt', null, '缓存命中'), React.createElement('dd', null, usage.cacheReadTokens || 0),
      React.createElement('dt', null, '未缓存输入'), React.createElement('dd', null, usage.uncachedInputTokens || 0),
      React.createElement('dt', null, '缓存读取'), React.createElement('dd', null, usage.cacheReadTokens || 0),
      React.createElement('dt', null, '输出'), React.createElement('dd', null, usage.outputTokens || 0),
    ))
}

function SettingsPanel({ load, write }) {
  const [value, setValue] = useState({ modelPools: { high: [], normal: [], low: [] }, tokenStats: true })
  const [revision, setRevision] = useState(undefined)
  const [draft, setDraft] = useState(value.modelPools)
  const [enabled, setEnabled] = useState(value.tokenStats)
  const [busy, setBusy] = useState(false)
  useEffect(() => { load().then(result => { const ns = result?.ok ? result.value.namespaces.find(item => item.ns === 'super-agent') : undefined; if (ns) { setValue(ns.value); setDraft(ns.value.modelPools); setEnabled(ns.value.tokenStats !== false); setRevision(ns.revision) } }).catch(() => {}) }, [load])
  const update = async () => {
    setBusy(true)
    try { await write({ modelPools: draft, tokenStats: enabled }, revision) } finally { setBusy(false) }
  }
  const pool = (name, title) => React.createElement('fieldset', { key: name },
    React.createElement('legend', null, title),
    React.createElement('textarea', {
      rows: 2,
      value: draft[name].map(model => `${model.id}:${(model.strengths || []).join('|')}`).join(', '),
      'aria-label': `${title}模型池`,
      onChange: event => setDraft({ ...draft, [name]: event.target.value.split(',').map(raw => raw.trim()).filter(Boolean).map(raw => {
        const [id, strengths = ''] = raw.split(':')
        return { id, strengths: strengths.split('|').filter(Boolean), available: true }
      }) }),
      placeholder: 'model-id:低|中|高',
    }))
  return React.createElement('section', { className: 'dsh-super-agent-settings', 'data-super-agent-settings': true },
    pool('high', '高智能模型池（计划、决策）'), pool('normal', '常规模型池（探索、实验、分析）'), pool('low', '低智能模型池（代码阅读、结果总结）'),
    React.createElement('label', null, React.createElement('input', { type: 'checkbox', checked: enabled, onChange: e => setEnabled(e.target.checked) }), ' 展示 token 统计'),
    React.createElement('button', { type: 'button', disabled: busy, onClick: update }, busy ? '保存中…' : '保存 super-agent 配置'))
}

function AgentTree({ useSessions, openChild }) {
  const state = useSessions?.(s => s) || { byId: {}, subagentsByParent: {} }
  const summaries = Object.values(state.byId || {}).filter(s => s.origin === 'subagent')
  if (!summaries.length) return React.createElement('div', { className: 'dsh-super-agent-tree empty' }, '暂无 Agent 执行记录')
  const children = new Map()
  summaries.forEach(s => children.set(s.parentId, [...(children.get(s.parentId) || []), s]))
  const render = (parent, level = 0) => (children.get(parent) || []).map(s => React.createElement('div', { key: s.id, className: 'dsh-super-agent-node', style: { paddingLeft: `${level * 14}px` } },
    React.createElement('button', { type: 'button', className: 'dsh-super-agent-node-dot', onClick: () => openChild(s), 'aria-label': `查看 ${s.title || s.id}` }, '●'),
    React.createElement('span', null, s.title || s.id), render(s.id, level + 1)))
  return React.createElement('div', { className: 'dsh-super-agent-tree', role: 'tree', 'data-super-agent-tree': true }, render(undefined))
}

export const inject = ['slots', 'remote', 'remote.agentPresets', 'remote.settings', 'sessions', 'locale']

export function apply(ctx) {
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
    inject: () => ({ tokenStats: true }),
  }, TokenFooter))

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab', id: 'super-agent', order: 20,
    label: () => 'super-agent',
    inject: () => ({
      load: () => ctx.remote.settings.describe(),
      write: (patch, expected) => ctx.remote.settings.update('super-agent', patch, expected),
    }),
  }, SettingsPanel))

  // The native subagent catalog already owns sidebar navigation and history.
  // This lightweight contribution keeps a visual Agent tree available in the
  // conversation surface without duplicating the catalog persistence layer.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'super-agent-tree', order: 30,
    inject: () => ({
      useSessions: selector => ctx.sessions.list.getSnapshot() && selector(ctx.sessions.list.getSnapshot()),
      openChild: child => ctx.sessions.open(child.id),
    }),
  }, AgentTree))
}
