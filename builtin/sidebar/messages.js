import { localeCode, text, zh } from '../ui/locale.js'
import React, { useState, useMemo } from '../ui/react.js'
import { ActionButton, Glyph, icons } from '../ui/controls.js'

function AgentMessage({ record, saved, t, toolName }) {
  const item = record.entry ? detailRecord(record.entry, t) : record
  const eventType = record.entry?.event?.type
  const kind = eventType === 'user/message' ? 'user' : eventType === 'assistant/message' ? 'agent'
    : ['user', 'agent', 'tool', 'context', 'error'].includes(item.kind) ? item.kind : 'context'
  const time = new Date(item.time).toLocaleTimeString(localeCode(t), { hour12: false })
  const label = React.createElement('div', { className: 'dsh-super-code-detail-entry-label' },
    React.createElement('span', null, item.label, toolName && !item.toolName ? ' · ' + toolName : ''), React.createElement('time', { dateTime: new Date(item.time).toISOString() }, time))
  return React.createElement('article', { className: 'dsh-super-code-detail-entry ' + kind, 'data-event-type': eventType },
    React.createElement('span', { className: 'dsh-super-code-detail-avatar', 'aria-hidden': true }, React.createElement(Glyph, { type: kind })),
    React.createElement('div', { className: 'dsh-super-code-detail-message' }, item.collapsed
      ? React.createElement('details', { open: saved.open.has(item.seq), onToggle: event => {
          if (event.currentTarget.open) saved.open.add(item.seq); else saved.open.delete(item.seq)
        } },
        React.createElement('summary', null, label, React.createElement(Glyph, { type: 'chevron' })),
        React.createElement(DetailText, { text: item.text, format: item.format, t }))
      : React.createElement(React.Fragment, null, label, React.createElement(DetailText, { text: item.text, format: item.format, t }))))
}

function contentText(blocks, t) {
  return (blocks || []).map(block => {
    if (block.type === 'text' && typeof block.text === 'string') return block.text
    if (block.type === 'image') return text(t, 'image')
    return ''
  }).filter(Boolean).join('\n\n')
}

function detailRecord(entry, t = key => zh[key] || key) {
  const event = entry.event, data = event?.data
  if (!data) return { kind: 'skip' }
  const base = { seq: event.seq, time: event.time, entry }
  if (event.type === 'user/message') {
    if (data.source?.kind !== 'user') return { kind: 'skip' }
    return { ...base, kind: 'message', format: 'text', label: text(t, 'detail.task'), text: contentText(data.content, t) }
  }
  if (event.type === 'assistant/message') return { ...base, kind: 'message', format: 'markdown', label: data.interrupted ? text(t, 'detail.interrupted') : text(t, 'detail.agent'), text: contentText(data.message?.content, t) }
  const nestedCall = event.type === 'tool/ptc-dispatch-start'
  if ((event.type === 'tool/call' || nestedCall) && typeof data.name === 'string' && data.name) {
    // Native arguments are raw JSON; PTC arguments are already decoded values.
    let value = !nestedCall && typeof data.arguments === 'string' ? data.arguments
      : JSON.stringify(data.arguments === undefined ? {} : data.arguments)
    try { value = JSON.stringify(JSON.parse(value), null, 2) } catch { /* Incomplete arguments remain readable. */ }
    return { ...base, kind: 'tool', format: 'json', collapsed: true, toolName: data.name,
      callId: nestedCall ? data.subCallId : data.callId, ...(nestedCall ? { parentCallId: data.parentCallId } : {}),
      label: text(t, 'detail.toolCall') + ' · ' + data.name, text: value }
  }
  if (event.type === 'tool/ptc-dispatch' && typeof data.name === 'string' && data.name) {
    return { ...base, kind: data.isError ? 'error' : 'tool', format: 'code', collapsed: true,
      callId: data.subCallId, parentCallId: data.parentCallId, toolName: data.name,
      label: text(t, data.isError ? 'detail.toolError' : 'detail.toolResult') + ' · ' + data.name,
      text: contentText(data.content, t) }
  }
  if (event.type === 'tool/result') {
    const blocks = (data.message?.content || []).filter(block => block.type === 'tool-result')
    // Harness journals use both direct tool messages (v4) and nested results.
    const direct = data.message?.role === 'tool'
    if (!blocks.length && !direct) return { kind: 'skip' }
    const failed = direct ? data.message.isError : blocks.some(block => block.isError)
    return { ...base, kind: failed ? 'error' : 'tool', format: 'code', collapsed: true,
      callId: direct ? data.message.toolCallId : blocks[0]?.toolCallId,
      label: text(t, failed ? 'detail.toolError' : 'detail.toolResult'),
      text: contentText(direct ? data.message.content : blocks.flatMap(block => block.content || []), t) }
  }
  if (event.type === 'turn/end' && ['error', 'max-tokens'].includes(data.reason?.kind)) {
    const failure = data.reason.error
    // Match the host's AUTH handling: provider diagnostics can echo credentials.
    const message = data.reason.kind === 'max-tokens' ? text(t, 'detail.maxTokens') : failure?.code === 'AUTH' ? text(t, 'detail.authError')
      : (typeof failure?.message === 'string' && failure.message) || text(t, 'detail.incomplete')
    return { ...base, kind: 'error', format: 'text', label: text(t, 'detail.error'), text: message }
  }
  if (event.type === 'turn/error') return { ...base, kind: 'error', format: 'text', label: text(t, 'detail.error'), text: data.message || text(t, 'detail.incomplete') }
  return { kind: 'skip' }
}

function DetailText({ text: value, format = 'text', t = key => zh[key] || key }) {
  const [full, setFull] = useState(false)
  const copyLabel = text(t, 'detail.copy'), copiedLabel = text(t, 'detail.copied'), footnotes = text(t, 'detail.footnotes')
  const labels = useMemo(() => ({ code: { copyLabel, copiedLabel }, footnotes }), [copyLabel, copiedLabel, footnotes])
  const content = full ? value : value.slice(0, 12000)
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'dsh-super-code-detail-content' },
      format === 'markdown' ? React.createElement(icons.MarkdownText, { text: content, labels })
        : format === 'json' || format === 'code' ? React.createElement(icons.CodeBlock, { code: content,
          lang: format === 'json' ? 'json' : 'text', copyLabel, copiedLabel })
        : React.createElement('pre', { className: 'dsh-super-code-detail-plain' }, content)),
    !full && value.length > 12000 && React.createElement(ActionButton, { type: 'button', onClick: () => setFull(true) }, text(t, 'detail.open')))
}

export { AgentMessage, detailRecord }
