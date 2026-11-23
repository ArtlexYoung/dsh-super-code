import React, { useRef, useState } from 'react';
import { WorkflowLibrary } from './Library.jsx';
import { pageMemory, usePageState } from './page-state.js';
import { fileTarget, WORKBENCH_VIEW } from '../workbench/file-links.js';
import { WorkflowAgents, useWorkflowAgents } from './Agents.jsx';

export function WorkflowWorkspace({ Conversation, conversationRemote, detailT, ...props }) {
  const { api, sessionId, page, t, openView } = props;
  const memory = pageMemory(api, sessionId, page), panel = useRef(null), chatButton = useRef(null);
  const agents = useWorkflowAgents(props, memory), current = agents.agent.id === sessionId;
  const [chatOpen, setChatOpen] = usePageState(memory, 'chatOpen', false);
  const [fileError, setFileError] = useState(''), cwd = props.useSessions(state => state.byId[sessionId]?.cwd);
  const openFile = (path, options) => {
    if (!props.hasWorkbench()) { setFileError(t('enableWorkbench')); return; }
    setFileError(''); openView(WORKBENCH_VIEW, JSON.stringify(fileTarget(path, options, { cwd })));
  };
  const reveal = () => {
    setChatOpen(true);
    requestAnimationFrame(() => {
      (panel.current?.querySelector('textarea') || panel.current?.querySelector('h2'))?.focus({ preventScroll: true });
      panel.current?.scrollIntoView({ block: 'nearest' });
    });
  };
  const navigate = (view, request) => {
    if (view !== 'chat') { openView(view, request); return; }
    agents.select(sessionId); reveal();
  };
  const closeChat = () => { setChatOpen(false); chatButton.current?.focus({ preventScroll: true }); };
  const title = current ? t('inlineChat') : agents.agent.title || agents.agent.displayTitle || agents.agent.id;
  return <div className="sc-flow-shell" data-conversation-composer-overlay=""><div className="sc-flow-layout" data-chat={chatOpen}>
    <WorkflowLibrary {...props} openView={navigate} conversationAction={<button type="button" ref={chatButton} aria-expanded={chatOpen} onClick={() => chatOpen ? closeChat() : reveal()}>{t('showConversation')}</button>}
      conversationNavigation={<WorkflowAgents {...agents} sessionId={sessionId} agentActions={props.agentActions} t={t} detailT={detailT} select={node => { agents.select(node.id); reveal(); }} />} />
    {chatOpen && <aside ref={panel} className="sc-workbench sc-flow-chat-panel" aria-label={title}>
      <header><h2 tabIndex={-1}>{title}</h2><button type="button" onClick={closeChat} aria-label={t('closeChat')}>×</button></header>
      {fileError && <p role="alert">{fileError}</p>}
      <Conversation sessionId={sessionId} agent={agents.agent} visible useSessions={props.useSessions} useSessionStatus={props.useSessionStatus} useInput={props.useInput} inputActions={props.inputActions}
        remote={conversationRemote} detailT={detailT} openView={openView} openFile={openFile} useChat={props.useChat} useConversation={props.useConversation} t={t} />
      {!current && <footer className="sc-flow-agent-return"><p>{t('agentReadOnly')}</p><button type="button" onClick={() => navigate('chat', '')}>{t('returnToConversation')}</button></footer>}
    </aside>}
  </div></div>;
}
