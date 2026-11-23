import React, { useMemo, useState, useEffect } from '../../builtin/ui/react.js'
import { ActionButton, icons } from '../../builtin/ui/controls.js'
import { AgentDetail, createAgentInspector } from '../../builtin/sidebar/detail.js'
import { agentDetailAddress } from '../../builtin/sidebar/address.js'

function WorkbenchConversation({ sessionId, agent = { id: sessionId }, readingStates, replyAction, visible = true, useSessions, useSessionStatus, useInput, inputActions, remote, detailT, openView, openFile, useChat, useConversation, fileMentions, t }) {
  // 订阅官方 Chat target，使冷启动直接进入工作台时也加载文件提及。
  const useMessages = useChat || (select => useConversation?.(value => select(value.views?.get('chat'))));
  const chat = useMessages(value => value);
  const current = agent.id === sessionId, address = agentDetailAddress(agent);
  const mentions = useMemo(() => current ? fileMentions?.(chat, openFile) : undefined, [current, chat, openFile, fileMentions]);
  const { lifetime, detailStates } = useConversationReading(address, readingStates)
  const tab = useMemo(() => ({ signal: lifetime.signal, visible, contentId: address }), [address, lifetime, visible])
  const createInspector = useMemo(() => (address, initial) => createAgentInspector(
    (target, options) => new (require('@deepseek-ai/dsh-api-session-controller').SessionEventStream)(remote, target, options), address,
    (request, signal) => remote.session.page(request, signal), initial, detailT), [remote, detailT])
  if (!useSessions || current && (!useInput || !inputActions)) return React.createElement('div', { className: 'sc-wb-conversation-fallback' },
    t('conversationUnavailable'), React.createElement(ActionButton, { onClick: () => openView('chat', '') }, t('openConversation')))
  const content = React.createElement('div', { className: 'sc-wb-conversation' },
    React.createElement(AgentDetail, { key: address, useTabInfo: () => ({ tab }), useSessions, useSessionStatus, sessionId, createInspector, detailStates,
      openMemory: () => openView('chat', ''), compact: true, replyAction, fileMentions: mentions, t: detailT }),
    current && React.createElement(WorkbenchInput, { useInput, inputActions, openView, t }))
  return icons.MarkdownDelegateProvider ? React.createElement(icons.MarkdownDelegateProvider, { openFile }, content) : content
}

function useConversationReading(address, readingStates) {
  const local = useMemo(() => new Map(), []), records = readingStates || local;
  const lifetime = useMemo(() => new AbortController(), [address]);
  const detailStates = useMemo(() => {
    const states = new WeakMap();
    if (records.has(address)) states.set(lifetime.signal, records.get(address));
    return states;
  }, [records, address, lifetime]);
  useEffect(() => () => {
    const saved = detailStates.get(lifetime.signal);
    if (saved) {
      records.delete(address); records.set(address, saved);
      if (records.size > 12) records.delete(records.keys().next().value);
    }
    lifetime.abort();
  }, [records, address, lifetime, detailStates]);
  return { lifetime, detailStates };
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
