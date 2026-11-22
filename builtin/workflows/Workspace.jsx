import React, { useRef, useState } from 'react';
import { WorkflowLibrary } from './Library.jsx';
import { pageMemory, usePageState } from './page-state.js';
import { fileTarget, WORKBENCH_VIEW } from '../workbench/file-links.js';

export function WorkflowWorkspace({ Conversation, conversationRemote, detailT, ...props }) {
  const { api, sessionId, page, t, openView } = props;
  const memory = pageMemory(api, sessionId, page), panel = useRef(null), chatButton = useRef(null);
  const [chatOpen, setChatOpen] = usePageState(memory, 'chatOpen', false);
  const [fileError, setFileError] = useState(''), cwd = props.useSessions(state => state.byId[sessionId]?.cwd);
  const openFile = (path, options) => {
    if (!props.hasWorkbench()) { setFileError(t('enableWorkbench')); return; }
    setFileError(''); openView(WORKBENCH_VIEW, JSON.stringify(fileTarget(path, options, { cwd })));
  };
  const navigate = (view, request) => {
    if (view !== 'chat') { openView(view, request); return; }
    setChatOpen(true);
    requestAnimationFrame(() => {
      panel.current?.querySelector('textarea')?.focus({ preventScroll: true });
      panel.current?.scrollIntoView({ block: 'nearest' });
    });
  };
  const closeChat = () => { setChatOpen(false); chatButton.current?.focus({ preventScroll: true }); };
  return <div className="sc-flow-shell" data-conversation-composer-overlay=""><div className="sc-flow-layout" data-chat={chatOpen}>
    <WorkflowLibrary {...props} openView={navigate} conversationAction={<button type="button" ref={chatButton} aria-expanded={chatOpen} onClick={() => chatOpen ? closeChat() : navigate('chat', '')}>{t('inlineChat')}</button>} />
    {chatOpen && <aside ref={panel} className="sc-workbench sc-flow-chat-panel" aria-label={t('inlineChat')}>
      <header><strong>{t('inlineChat')}</strong><button type="button" onClick={closeChat} aria-label={t('closeChat')}>×</button></header>
      {fileError && <p role="alert">{fileError}</p>}
      <Conversation sessionId={sessionId} visible useSessions={props.useSessions} useSessionStatus={props.useSessionStatus} useInput={props.useInput} inputActions={props.inputActions}
        remote={conversationRemote} detailT={detailT} openView={openView} openFile={openFile} useChat={props.useChat} useConversation={props.useConversation} t={t} />
    </aside>}
  </div></div>;
}
