import React from 'react';

export function Execution({ facts, openFile, inspectCall, openChat, attachFile, t }) {
  const completed = facts.todos.filter(todo => todo.status === 'completed').length;
  const activities = facts.activities.slice(-4).reverse();
  if (!facts.title && !facts.todos.length && !activities.length && !facts.files.length && !facts.next) return <section className="sc-flow-execution sc-flow-execution-empty" aria-label={t('execution')}>
    <header><h2>{t('execution')}</h2><span className="sc-flow-state" data-state={facts.phase}>{t('execution.' + facts.phase)}</span></header>
    <p className="sc-flow-empty">{t('noTasks')}</p><button type="button" className="sc-flow-chat" onClick={openChat}>{t('openChat')} →</button>
  </section>;
  return <section className="sc-flow-execution" aria-label={t('execution')}>
    <header><h2>{t('execution')}</h2><span className="sc-flow-state" data-state={facts.phase}>{t('execution.' + facts.phase)}</span></header>
    <p className="sc-flow-source-note">{t('executionSource')}</p>
    {facts.title && <div className="sc-flow-current-task"><span>{t('recordedTask')}</span><strong>{facts.title}</strong><small>{t('task.' + facts.taskStatus)}</small></div>}
    <div className="sc-flow-task-heading"><h3>{t('tasks')}</h3>{facts.todos.length > 0 && <span>{completed} / {facts.todos.length}</span>}</div>
    {facts.todos.length > 0 && <progress aria-label={t('taskProgress')} value={completed} max={facts.todos.length} />}
    <ol className="sc-flow-tasks">{facts.todos.map((todo, index) => <li key={index} data-state={todo.status}>
      <span className="sc-flow-task-mark" aria-label={t('todo.' + todo.status)}>{todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '●' : '○'}</span><span>{todo.content}</span>
    </li>)}</ol>
    {!facts.todos.length && <p className="sc-flow-empty">{t(facts.available ? 'noTasks' : 'noExecution')}</p>}
    {facts.next && <p className="sc-flow-next-record"><strong>{t('recordedNext')}</strong>{facts.next}</p>}
    {activities.length > 0 && <div className="sc-flow-activities"><h3>{t('activity')}</h3>{activities.map(item => <button type="button" key={item.callId} disabled={!inspectCall} onClick={() => inspectCall(item.callId)}>
      <span>{item.description || item.tool}</span><small data-state={item.status}>{t('activity.' + item.status)}</small></button>)}</div>}
    <div className="sc-flow-task-heading"><h3>{t('files')}</h3><span>{facts.files.length}</span></div>
    <p className="sc-flow-source-note">{t('filesHint')}</p>
    {!facts.files.length && <p className="sc-flow-empty">{t('noFiles')}</p>}
    <ul className="sc-flow-files">{facts.files.map(file => <li key={file.path}>
      <button type="button" className="sc-flow-file-open" title={file.path} onClick={() => openFile(file.path)}>{file.path.replaceAll('\\', '/').split('/').at(-1)}<span>{t('openFile')}</span></button>
      {attachFile && <button type="button" aria-label={`${t('attachFile')} ${file.path}`} onClick={() => attachFile(file.path)}>{t('attach')}</button>}
    </li>)}</ul>
    {facts.partial && <p className="sc-flow-source-note">{t('partial')}</p>}
    <button type="button" className="sc-flow-chat" onClick={openChat}>{t('openChat')} →</button>
  </section>;
}
