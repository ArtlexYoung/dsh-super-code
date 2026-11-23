import React, { useEffect, useState } from 'react';
import { WorkflowLibrary } from './Library.jsx';
import { pageMemory, usePageState } from './page-state.js';
import { fileTarget, WORKBENCH_VIEW } from '../workbench/file-links.js';
import { WorkflowAgents, useWorkflowAgents } from './Agents.jsx';
import { Splitter } from '../workbench/components/Splitter.jsx';
import { WorkflowConversation } from './Conversation.jsx';
import { useConversationLayout } from './conversation-layout.js';
import { ReplyDestination } from './ReplyDestination.jsx';

export function WorkflowWorkspace({ Conversation, conversationRemote, detailT, ...props }) {
  const { api, sessionId, page, t, openView } = props;
  const memory = pageMemory(api, sessionId, page);
  const { mode, panel, chatButton, reveal, close, toggle } = useConversationLayout(memory), chatOpen = mode !== 'closed';
  const agents = useWorkflowAgents(props, memory), current = agents.agent.id === sessionId;
  const [chatWidth, setChatWidth] = usePageState(memory, 'chatWidth', 390);
  const [readingStates] = usePageState(memory, 'conversationRecords', () => new Map());
  const [error, setError] = useState(''), [destination, setDestination] = useState(null);
  useEffect(() => setError(''), [agents.agent.id, destination]);
  const cwd = props.useSessions(state => state.byId[sessionId]?.cwd);
  const openFile = (path, options) => {
    if (!props.hasWorkbench()) { setError(t('enableWorkbench')); return; }
    setError(''); openView(WORKBENCH_VIEW, JSON.stringify(fileTarget(path, options, { cwd })));
  };
  const selectAgent = (id, focus = false) => { agents.select(id); reveal(focus); };
  const navigate = (view, request) => {
    if (view !== 'chat') { openView(view, request); return; }
    agents.select(sessionId); reveal();
  };
  const title = current ? t('inlineChat') : agents.agent.title || agents.agent.displayTitle || agents.agent.id;
  const replyActions = destination ? [{ id: 'excerpt', label: t('excerptTo').replace('{title}', () => destination.title), title: t('excerptHint'), run: ({ text, seq }) => {
    const source = agents.agent.title || agents.agent.displayTitle || title;
    const citation = `${t('excerptSource')}${source} [${agents.agent.id} #${seq}]\n${text.replace(/^/gm, '> ')}`;
    if (!destination.append(citation)) { setError(t('excerptTooLong')); return; }
    setError(''); if (mode === 'focus') toggle();
    requestAnimationFrame(() => destination.focus(close));
  } }] : [];
  return <ReplyDestination register={setDestination}><div className="sc-flow-shell" data-conversation-composer-overlay=""><div className="sc-flow-layout" data-chat={chatOpen} data-layout={mode} style={{ '--flow-chat-width': `${chatWidth}px` }}>
    <WorkflowLibrary {...props} openView={navigate} conversationAction={<button type="button" ref={chatButton} aria-expanded={chatOpen} onClick={() => chatOpen ? close() : reveal()}>{t('showConversation')}</button>}
      conversationNavigation={<WorkflowAgents {...agents} sessionId={sessionId} agentActions={props.agentActions} t={t} detailT={detailT} select={node => { agents.select(node.id); reveal(false); }} />} />
    {chatOpen && <Splitter panel="reading" label={t('resizeConversation')} value={chatWidth} ratio={0.6} change={setChatWidth} commit={() => {}} />}
    {chatOpen && <aside ref={panel} className="sc-workbench sc-flow-chat-panel" aria-label={title}>
      <header><h2 tabIndex={-1}>{title}</h2><div><button type="button" className="sc-flow-expand" aria-pressed={mode === 'focus'} onClick={toggle}>{t(mode === 'focus' ? 'restoreWorkflow' : 'expandConversation')}</button><button type="button" className="sc-flow-reset-width" onClick={() => setChatWidth(390)} aria-label={t('resetConversationWidth')} title={t('resetConversationWidth')}>↔</button><button type="button" onClick={close} aria-label={t('closeChat')}>×</button></div></header>
      {error && <p role="alert">{error}</p>}
      <WorkflowConversation Conversation={Conversation} memory={memory} agents={agents.view} selectAgent={selectAgent} sessionId={sessionId} agent={agents.agent} replyActions={replyActions} readingStates={readingStates} visible useSessions={props.useSessions} useSessionStatus={props.useSessionStatus} useInput={props.useInput} inputActions={props.inputActions}
        remote={conversationRemote} detailT={detailT} openView={openView} openFile={openFile} useChat={props.useChat} useConversation={props.useConversation} t={t} />
    </aside>}
  </div></div></ReplyDestination>;
}
