import { localeCode, text, zh } from '../ui/locale.js'
import React, { useState, useMemo } from '../ui/react.js'
import { ActionButton, Glyph, icons } from '../ui/controls.js'

const normalizedRecords = new WeakMap()

function AgentMessage({ record, saved, t, toolName, compact = false, fileMentions, replyAction }) {
  const item = useMemo(() => record.entry ? presentDetail(normalizedRecords.get(record) || normalizeDetail(record.entry), t) : record, [record, t])
  const eventType = record.entry?.event?.type
  const kind = eventType === 'user/message' ? 'user' : eventType === 'assistant/message' ? 'agent'
    : ['user', 'agent', 'tool', 'context', 'error'].includes(item.kind) ? item.kind : 'context'
  const time = new Date(item.time).toLocaleTimeString(localeCode(t), { hour12: false })
  const label = React.createElement('div', { className: 'dsh-super-code-detail-entry-label' },
    React.createElement('span', null, compact && kind === 'user' ? text(t, 'workbench.question') : compact && kind === 'agent' && !record.entry?.event?.data?.interrupted ? text(t, 'workbench.reply') : item.label, toolName && !item.toolName ? ' · ' + toolName : ''), React.createElement('time', { dateTime: new Date(item.time).toISOString() }, time))
  const body = React.createElement(React.Fragment, null,
    React.createElement(DetailText, { text: item.text, format: item.format, fileMentions, t }),
    kind === 'agent' && replyAction && item.text.trim() && React.createElement(ActionButton, {
      type: 'button', className: 'sc-wb-reply-action', disabled: replyAction.disabled, title: replyAction.title,
      onPointerDown: event => event.preventDefault(),
      onClick: event => {
        const content = event.currentTarget.closest('.dsh-super-code-detail-message').querySelector('.dsh-super-code-detail-content')
        replyAction.run({ seq: item.seq, text: selectedReplyText(content, item.text) })
      },
    }, replyAction.label))
  return React.createElement('article', { className: 'dsh-super-code-detail-entry ' + kind, 'data-event-type': eventType, 'data-message-seq': item.seq, tabIndex: compact ? -1 : undefined },
    React.createElement('span', { className: 'dsh-super-code-detail-avatar', 'aria-hidden': true }, React.createElement(Glyph, { type: kind })),
    React.createElement('div', { className: 'dsh-super-code-detail-message' },
      messageContent({ item, kind, compact, saved, label, body, t })))
}

function messageContent({ item, kind, compact, saved, label, body, t }) {
  const question = compact && kind === 'user' && (item.text.length > 280 || item.text.split('\n').length > 6)
  if (!question && !item.collapsed) return React.createElement(React.Fragment, null, label, body)
  const preview = question ? item.text.replace(/\s+/g, ' ').trim() : ''
  return React.createElement('details', { className: question ? 'sc-wb-question' : undefined, open: saved.open.has(item.seq), onToggle: event => {
    if (event.target !== event.currentTarget) return
    if (event.currentTarget.open) saved.open.add(item.seq); else saved.open.delete(item.seq)
  } },
    React.createElement('summary', null, label,
      question && React.createElement(React.Fragment, null,
        React.createElement('span', { className: 'sc-wb-question-preview' }, preview.slice(0, 160), preview.length > 160 ? '…' : ''),
        React.createElement('span', { className: 'sc-wb-question-toggle' },
          React.createElement('span', { className: 'sc-wb-question-expand' }, text(t, 'workbench.expandQuestion')),
          React.createElement('span', { className: 'sc-wb-question-collapse' }, text(t, 'workbench.collapseQuestion')))),
      React.createElement(Glyph, { type: 'chevron' })), body)
}

function selectedReplyText(content, original) {
  const selection = content.ownerDocument.getSelection()
  if (!selection?.rangeCount || selection.isCollapsed) return original
  const range = selection.getRangeAt(0)
  if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return original
  return selection.toString().trim() ? selection.toString() : original
}

function contentText(blocks, t) {
  return (blocks || []).map(block => {
    if (block.type === 'text' && typeof block.text === 'string') return block.text
    if (block.type === 'image') return text(t, 'image')
    return ''
  }).filter(Boolean).join('\n\n')
}

function detailRecord(entry, t = key => zh[key] || key) {
  const normalized = normalizeDetail(entry), item = presentDetail(normalized, t)
  normalizedRecords.set(item, normalized)
  return item
}

function presentDetail(record, t) {
  if (record.kind === 'skip') return record
  const { labelKey, textKey, content, ...item } = record
  return { ...item, label: text(t, labelKey) + (item.toolName ? ' · ' + item.toolName : ''),
    text: content === undefined ? textKey ? text(t, textKey) : item.text : contentText(content, t) }
}

function normalizeDetail(entry) {
  const event = entry.event, data = event?.data
  if (!data) return { kind: 'skip' }
  const base = { seq: event.seq, time: event.time, entry }
  if (event.type === 'user/message') {
    if (data.source?.kind !== 'user') return { kind: 'skip' }
    return { ...base, kind: 'message', format: 'text', labelKey: 'detail.task', content: data.content || [] }
  }
  if (event.type === 'assistant/message') return { ...base, kind: 'message', format: 'markdown', labelKey: data.interrupted ? 'detail.interrupted' : 'detail.agent', content: data.message?.content || [] }
  const nestedCall = event.type === 'tool/ptc-dispatch-start'
  if ((event.type === 'tool/call' || nestedCall) && typeof data.name === 'string' && data.name) {
    // Native arguments are raw JSON; PTC arguments are already decoded values.
    let value = !nestedCall && typeof data.arguments === 'string' ? data.arguments
      : JSON.stringify(data.arguments === undefined ? {} : data.arguments)
    try { value = JSON.stringify(JSON.parse(value), null, 2) } catch { /* Incomplete arguments remain readable. */ }
    return { ...base, kind: 'tool', format: 'json', collapsed: true, toolName: data.name,
      callId: nestedCall ? data.subCallId : data.callId, ...(nestedCall ? { parentCallId: data.parentCallId } : {}),
      labelKey: 'detail.toolCall', text: value }
  }
  if (event.type === 'tool/ptc-dispatch' && typeof data.name === 'string' && data.name) {
    return { ...base, kind: data.isError ? 'error' : 'tool', format: 'code', collapsed: true,
      callId: data.subCallId, parentCallId: data.parentCallId, toolName: data.name,
      labelKey: data.isError ? 'detail.toolError' : 'detail.toolResult',
      content: data.content || [] }
  }
  if (event.type === 'tool/result') {
    const blocks = (data.message?.content || []).filter(block => block.type === 'tool-result')
    // Harness journals use both direct tool messages (v4) and nested results.
    const direct = data.message?.role === 'tool'
    if (!blocks.length && !direct) return { kind: 'skip' }
    const failed = direct ? data.message.isError : blocks.some(block => block.isError)
    return { ...base, kind: failed ? 'error' : 'tool', format: 'code', collapsed: true,
      callId: direct ? data.message.toolCallId : blocks[0]?.toolCallId,
      labelKey: failed ? 'detail.toolError' : 'detail.toolResult',
      content: (direct ? data.message.content : blocks.flatMap(block => block.content || [])) || [] }
  }
  if (event.type === 'turn/end' && ['error', 'max-tokens'].includes(data.reason?.kind)) {
    const failure = data.reason.error
    // Match the host's AUTH handling: provider diagnostics can echo credentials.
    const textKey = data.reason.kind === 'max-tokens' ? 'detail.maxTokens' : failure?.code === 'AUTH' ? 'detail.authError'
      : typeof failure?.message === 'string' && failure.message ? undefined : 'detail.incomplete'
    return { ...base, kind: 'error', format: 'text', labelKey: 'detail.error', textKey, text: textKey ? undefined : failure.message }
  }
  if (event.type === 'turn/error') return { ...base, kind: 'error', format: 'text', labelKey: 'detail.error', textKey: data.message ? undefined : 'detail.incomplete', text: data.message }
  return { kind: 'skip' }
}

function DetailText({ text: value, format = 'text', fileMentions, t = key => zh[key] || key }) {
  const [full, setFull] = useState(false)
  const copyLabel = text(t, 'detail.copy'), copiedLabel = text(t, 'detail.copied'), footnotes = text(t, 'detail.footnotes')
  const labels = useMemo(() => ({ code: { copyLabel, copiedLabel }, footnotes }), [copyLabel, copiedLabel, footnotes])
  const content = full ? value : value.slice(0, 12000)
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'dsh-super-code-detail-content' },
      format === 'markdown' ? React.createElement(icons.MarkdownText, { text: content, labels, fileMentions })
        : format === 'json' || format === 'code' ? React.createElement(icons.CodeBlock, { code: content,
          lang: format === 'json' ? 'json' : 'text', copyLabel, copiedLabel })
        : React.createElement('pre', { className: 'dsh-super-code-detail-plain' }, content)),
    !full && value.length > 12000 && React.createElement(ActionButton, { type: 'button', onClick: () => setFull(true) }, text(t, 'detail.open')))
}

export { AgentMessage, detailRecord }
