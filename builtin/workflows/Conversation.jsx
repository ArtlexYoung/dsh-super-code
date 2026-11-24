import React, { useEffect, useRef, useState } from 'react';
import { usePageState } from './page-state.js';
import { draftLocked } from './Compose.jsx';

export function WorkflowConversation(props) {
  const { Conversation, useInput, inputActions, agent, sessionId, selectAgent, t } = props;
  if (useInput && inputActions) return <QuotedConversation {...props} />;
  return <div className="sc-flow-conversation"><Conversation {...props} />
    {agent.id !== sessionId && <footer className="sc-flow-agent-return"><button type="button" onClick={() => selectAgent(sessionId, true)}>{t('returnToConversation')}</button></footer>}
  </div>;
}

function QuotedConversation({ Conversation, memory, agents, selectAgent, replyActions = [], ...props }) {
  const { sessionId, agent, useInput, inputActions, t } = props;
  const input = useInput(value => value), panel = useRef(null);
  const [source, setSource] = usePageState(memory, 'replySource', null), [error, setError] = useState('');
  const current = agent.id === sessionId, locked = draftLocked(input);
  useEffect(() => setError(''), [agent.id]);
  const quote = ({ text, seq }) => {
    if (locked) return;
    if (text.length > 12000) { setError(t('quoteTooLong')); return; }
    const title = agent.title || agent.displayTitle || agent.id;
    const citation = `${t('quoteSource')}${title} [${agent.id} #${seq}]\n${text.replace(/^/gm, '> ')}`;
    try { inputActions.setDraft(`${input.draft}${input.draft ? '\n\n' : ''}${citation}\n\n`); }
    catch { setError(t('draftFailed')); return; }
    setError(''); setSource({ id: agent.id, title, seq }); selectAgent(sessionId, true);
  };
  return <div ref={panel} className="sc-flow-conversation">
    {current && <ReplySource source={source} agents={agents} selectAgent={selectAgent} panel={panel} clear={() => setSource(null)} t={t} />}
    {error && !current && <p role="alert">{error}</p>}
    <Conversation {...props} replyActions={current ? replyActions : [{ id: 'quote', label: t('quoteReply'), title: t(locked ? 'quoteLocked' : 'quoteHint'), disabled: locked, run: quote }, ...replyActions]} />
    {!current && <footer className="sc-flow-agent-return"><p>{t(locked ? 'quoteLocked' : 'agentReadOnly')}</p><button type="button" onClick={() => locked ? props.openView('chat', '') : selectAgent(sessionId, true)}>{t(locked ? 'openConversation' : 'returnToConversation')}</button></footer>}
  </div>;
}

function ReplySource({ source, agents, selectAgent, panel, clear, t }) {
  if (!source) return null;
  const origin = agents.nodes.get(source.id);
  if (!origin || origin.unavailable) return null;
  const returnToReply = () => {
    selectAgent(source.id);
    requestAnimationFrame(() => {
      const target = panel.current?.querySelector(`[data-message-seq="${source.seq}"] .sc-wb-reply-action`);
      target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'nearest' });
    });
  };
  return <div className="sc-flow-reply-source">
    <span role="status">{t('quotedFrom')}<strong>{source.title}</strong></span>
    <button type="button" onClick={returnToReply}>{t('returnToReply')}</button>
    <button type="button" aria-label={t('dismissQuoteSource')} onClick={clear}>×</button>
  </div>;
}
