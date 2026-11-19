import React, { useMemo, useState, useEffect } from '../../builtin/ui/react.js'
import { ActionButton, icons } from '../../builtin/ui/controls.js'
import { AgentDetail, createAgentInspector } from '../../builtin/sidebar/detail.js'

function WorkbenchConversation({ sessionId, visible = true, useSessions, useSessionStatus, useInput, inputActions, remote, detailT, openView, openFile, useChat, useConversation, fileMentions, t }) {
  // 订阅官方 Chat target，使冷启动直接进入工作台时也加载文件提及。
  const useMessages = useChat || (select => useConversation?.(value => select(value.views?.get('chat'))));
  const chat = useMessages(value => value);
  const mentions = useMemo(() => fileMentions?.(chat, openFile), [chat, openFile, fileMentions]);
  const [lifetime] = useState(() => new AbortController())
  const tab = useMemo(() => ({ signal: lifetime.signal, visible, contentId: 'dsh-resource://super-agent/' + encodeURIComponent(sessionId) }), [sessionId, lifetime, visible])
  const detailStates = useMemo(() => new WeakMap(), [])
  const createInspector = useMemo(() => (address, initial) => createAgentInspector(
    (target, options) => new (require('@deepseek-ai/dsh-api-session-controller').SessionEventStream)(remote, target, options), address,
    (request, signal) => remote.session.page(request, signal), initial, detailT), [remote, detailT])
  useEffect(() => () => lifetime.abort(), [lifetime])
  if (!useInput || !inputActions || !useSessions) return React.createElement('div', { className: 'sc-wb-conversation-fallback' },
    t('conversationUnavailable'), React.createElement(ActionButton, { onClick: () => openView('chat', '') }, t('openConversation')))
  const content = React.createElement('div', { className: 'sc-wb-conversation' },
    React.createElement(AgentDetail, { useTabInfo: () => ({ tab }), useSessions, useSessionStatus, sessionId, createInspector, detailStates,
      openMemory: () => openView('chat', ''), compact: true, fileMentions: mentions, t: detailT }),
    React.createElement(WorkbenchInput, { useInput, inputActions, openView, t }))
  return icons.MarkdownDelegateProvider ? React.createElement(icons.MarkdownDelegateProvider, { openFile }, content) : content
}

function WorkbenchInput({ useInput, inputActions, openView, t }) {
  const [error, setError] = useState('')
  const input = useInput(value => value)
  const rich = input.attachmentIds?.length > 0 || input.occurrences?.length > 0
  const locked = input.phase !== 'plain' || rich
  const act = callback => { try { callback(); setError('') } catch { setError(t('conversationFailed')) } }
  const send = () => act(() => inputActions.submit())
  return React.createElement('form', { className: 'sc-wb-conversation-input', onSubmit: event => { event.preventDefault(); send() } },
    error && React.createElement('p', { role: 'alert' }, error),
    rich && React.createElement('small', null, t('conversationRichDraft')),
    React.createElement('textarea', { 'aria-label': t('conversationInput'), placeholder: t('conversationInput'), value: input.draft, disabled: locked,
      onChange: event => act(() => inputActions.setDraft(event.target.value)),
      onKeyDown: event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!locked && input.draft.trim()) send() }
      } }),
    React.createElement('div', null, React.createElement(ActionButton, { type: 'button', onClick: () => openView('chat', '') }, t('openConversation')),
      React.createElement(ActionButton, { type: 'submit', disabled: locked || !input.draft.trim() }, t('send'))))
}

export { WorkbenchConversation }
