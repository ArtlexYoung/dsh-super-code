import React, { useRef, useState } from 'react';
import { WorkflowLibrary } from './Library.jsx';
import { pageMemory, usePageState } from './page-state.js';
import { fileTarget, WORKBENCH_VIEW } from '../workbench/file-links.js';
import { WorkflowAgents, useWorkflowAgents } from './Agents.jsx';
import { Splitter } from '../workbench/components/Splitter.jsx';
import { WorkflowConversation } from './Conversation.jsx';

export function WorkflowWorkspace({ Conversation, conversationRemote, detailT, ...props }) {
  const { api, sessionId, page, t, openView } = props;
  const memory = pageMemory(api, sessionId, page), panel = useRef(null), chatButton = useRef(null);
  const agents = useWorkflowAgents(props, memory), current = agents.agent.id === sessionId;
  const [chatOpen, setChatOpen] = usePageState(memory, 'chatOpen', false);
  const [chatWidth, setChatWidth] = usePageState(memory, 'chatWidth', 390);
  const [readingStates] = usePageState(memory, 'conversationRecords', () => new Map());
  const [fileError, setFileError] = useState(''), cwd = props.useSessions(state => state.byId[sessionId]?.cwd);
  const openFile = (path, options) => {
    if (!props.hasWorkbench()) { setFileError(t('enableWorkbench')); return; }
    setFileError(''); openView(WORKBENCH_VIEW, JSON.stringify(fileTarget(path, options, { cwd })));
  };
  const reveal = (focus = true) => {
    setChatOpen(true);
    if (!focus) return;
    requestAnimationFrame(() => {
      const target = panel.current?.querySelector('textarea') || panel.current?.querySelector('h2');
      target?.focus({ preventScroll: true });
      if (target?.tagName === 'TEXTAREA') { target.setSelectionRange(target.value.length, target.value.length); target.scrollTop = target.scrollHeight; }
      panel.current?.scrollIntoView({ block: 'nearest' });
    });
  };
  const selectAgent = (id, focus = false) => { agents.select(id); reveal(focus); };
  const navigate = (view, request) => {
    if (view !== 'chat') { openView(view, request); return; }
    agents.select(sessionId); reveal();
  };
  const closeChat = () => {
    const source = panel.current?.parentElement.querySelector('.sc-flow-agents [aria-pressed=true]') || chatButton.current;
    setChatOpen(false); source?.focus({ preventScroll: true });
  };
  const title = current ? t('inlineChat') : agents.agent.title || agents.agent.displayTitle || agents.agent.id;
  return <div className="sc-flow-shell" data-conversation-composer-overlay=""><div className="sc-flow-layout" data-chat={chatOpen} style={{ '--flow-chat-width': `${chatWidth}px` }}>
    <WorkflowLibrary {...props} openView={navigate} conversationAction={<button type="button" ref={chatButton} aria-expanded={chatOpen} onClick={() => chatOpen ? closeChat() : reveal()}>{t('showConversation')}</button>}
      conversationNavigation={<WorkflowAgents {...agents} sessionId={sessionId} agentActions={props.agentActions} t={t} detailT={detailT} select={node => { agents.select(node.id); reveal(false); }} />} />
    {chatOpen && <Splitter panel="reading" label={t('resizeConversation')} value={chatWidth} ratio={0.6} change={setChatWidth} commit={() => {}} />}
    {chatOpen && <aside ref={panel} className="sc-workbench sc-flow-chat-panel" aria-label={title}>
      <header><h2 tabIndex={-1}>{title}</h2><div><button type="button" className="sc-flow-reset-width" onClick={() => setChatWidth(390)} aria-label={t('resetConversationWidth')} title={t('resetConversationWidth')}>↔</button><button type="button" onClick={closeChat} aria-label={t('closeChat')}>×</button></div></header>
      {fileError && <p role="alert">{fileError}</p>}
      <WorkflowConversation Conversation={Conversation} memory={memory} agents={agents.view} selectAgent={selectAgent} sessionId={sessionId} agent={agents.agent} readingStates={readingStates} visible useSessions={props.useSessions} useSessionStatus={props.useSessionStatus} useInput={props.useInput} inputActions={props.inputActions}
        remote={conversationRemote} detailT={detailT} openView={openView} openFile={openFile} useChat={props.useChat} useConversation={props.useConversation} t={t} />
    </aside>}
  </div></div>;
}
