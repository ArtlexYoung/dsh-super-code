import React, { useEffect, useState } from 'react';
import { Compose } from './Compose.jsx';
import { readChange, readChanges } from './spec-files.js';
import { skillAvailability } from './model.js';

const actions = [
  ['openspec-explore', '梳理想法', 'Explore an idea', '还不确定怎么做时，先让 AI 帮你检查现有代码，讨论范围和方案。', 'Ask AI to inspect the code and discuss the scope and approach before deciding what to build.'],
  ['openspec-propose', '创建方案', 'Create a proposal', '说明要做什么，让 AI 写出方案、需求说明和任务清单，供你检查。', 'Describe what you want. AI prepares a proposal, requirements and task list for you to review.'],
  ['openspec-apply-change', '按方案开发', 'Implement the change', '让 AI 按所选变更的任务清单修改代码，并更新完成情况。', 'Ask AI to implement the selected change’s tasks and update their status.'],
  ['openspec-verify-change', '检查完成情况', 'Verify the result', '让 AI 对照需求、设计和任务清单检查代码，列出遗漏或不一致的地方。', 'Ask AI to check the code against requirements, design and tasks, and report gaps or inconsistencies.'],
  ['openspec-archive-change', '归档变更', 'Archive the change', '先检查未完成事项，再按项目约定把本次变更移到归档目录。', 'Check unfinished work, then archive this change according to the project’s conventions.'],
];

function Document({ api, path, revision, openFile, text, MarkdownText }) {
  const [state, setState] = useState({ path: '', status: 'loading' });
  useEffect(() => {
    const abort = new AbortController(); setState({ path, status: 'loading' });
    void api.read(path, abort.signal).then(file => { if (!abort.signal.aborted) setState({ path, status: 'ready', file }); })
      .catch(() => { if (!abort.signal.aborted) setState({ path, status: 'error' }); });
    return () => abort.abort();
  }, [api, path, revision]);
  return <article className="sc-spec-document"><header><code>{path}</code><button type="button" onClick={() => openFile(path)}>{text('在工作台打开', 'Open in workbench')} ↗</button></header>
    {state.path !== path || state.status === 'loading' ? <p role="status">{text('正在读取文档…', 'Reading document…')}</p>
      : state.status === 'error' ? <p role="alert">{text('未能读取文档，请刷新重试。', 'Could not read the document. Refresh to retry.')}</p>
      : <div className="sc-spec-reading" onClickCapture={event => {
        const link = event.target.closest('a[href]');
        if (!link) return;
        if (/^https?:\/\//i.test(link.getAttribute('href'))) { link.target = '_blank'; link.rel = 'noopener noreferrer'; return; }
        event.preventDefault(); openFile(path);
      }}><MarkdownText text={state.file.text} /></div>}
  </article>;
}

function TaskSummary({ tasks, text }) {
  const done = tasks?.filter(task => task.completed).length;
  return (<section className="sc-spec-task-summary" aria-label={text('任务进度', 'Task progress')}><div><strong>{text('任务进度', 'Task progress')}</strong><span>{tasks === null ? text('还没有任务清单', 'No task list yet') : `${done} / ${tasks.length} ${text('已勾选', 'checked')}`}</span></div>
      {tasks?.length > 0 && <><progress aria-label={text('文件中的任务进度', 'Task progress from file')} value={done} max={tasks.length} /><details><summary>{text('查看任务清单', 'View the task list')}</summary><ul>{tasks.map((task, index) => <li key={index} data-complete={task.completed}><span aria-label={text(task.completed ? '已勾选' : '未勾选', task.completed ? 'Checked' : 'Unchecked')}>{task.completed ? '☑' : '☐'}</span>{task.text}</li>)}</ul></details></>}
      <p>{text('进度来自 tasks.md 的勾选记录。任务全部勾选后，仍需检查代码是否符合要求。', 'Progress comes from tasks.md checkboxes. Even when all are checked, verify that the code meets the requirements.')}</p>
    </section>);
}

function ChangeDocuments({ api, change, revision, openFile, text, MarkdownText }) {
  const [state, setState] = useState({ path: '', status: 'loading' }), [selected, select] = useState('');
  useEffect(() => {
    const abort = new AbortController(); setState({ path: change.path, status: 'loading' });
    void readChange(api, change.path, abort.signal).then(value => { if (!abort.signal.aborted) setState({ path: change.path, status: 'ready', ...value }); })
      .catch(() => { if (!abort.signal.aborted) setState({ path: change.path, status: 'error' }); });
    return () => abort.abort();
  }, [api, change.path, revision]);
  if (state.path !== change.path || state.status === 'loading') return <p role="status">{text('正在读取变更文档…', 'Reading change documents…')}</p>;
  if (state.status === 'error') return <p role="alert">{text('未能读取变更文档，请刷新重试。', 'Could not read change documents. Refresh to retry.')}</p>;
  const document = state.documents.find(file => file.path === selected) || state.documents.find(file => file.name === 'proposal.md') || state.documents[0];
  return <>
    <header className="sc-spec-change-heading"><div><span className="sc-flow-eyebrow">{text(change.archived ? '已归档变更' : '当前变更', change.archived ? 'ARCHIVED CHANGE' : 'CURRENT CHANGE')}</span><h2>{change.name}</h2></div><span>{state.documents.length} {text('份文档', 'documents')}</span></header>
    <TaskSummary tasks={state.tasks} text={text} />
    <nav className="sc-spec-document-tabs" aria-label={text('变更文档', 'Change documents')}>{state.documents.map(file => <button key={file.path} type="button" aria-pressed={document?.path === file.path} onClick={() => select(file.path)}>{file.path.slice(change.path.length + 1)}</button>)}</nav>
    {document ? <Document api={api} path={document.path} revision={revision} openFile={openFile} text={text} MarkdownText={MarkdownText} /> : <p>{text('这个变更还没有 Markdown 文档。', 'This change has no Markdown documents yet.')}</p>}
  </>;
}

function ChangeIndex({ state, changes, change, archived, showArchived, select, text }) {
  const messages = {
    loading: text('正在读取…', 'Reading…'), error: text('未能读取当前项目，请刷新重试。', 'Could not read the workspace. Refresh to retry.'),
    ready: state.kind === 'missing' ? text('当前项目还没有 OpenSpec 目录。', 'This workspace has no OpenSpec directory yet.') : text('这里还没有变更记录。', 'No changes recorded here yet.'),
  };
  return (<aside className="sc-spec-index"><h3>{text('项目中的变更', 'Project changes')}</h3><div className="sc-spec-scope">{[false, true].map(value => <button key={String(value)} type="button" aria-pressed={archived === value} onClick={() => showArchived(value)}>{text(value ? '已归档' : '进行中', value ? 'Archived' : 'Active')}</button>)}</div>
      {!changes.length && <p role={state.status === 'error' ? 'alert' : 'status'}>{messages[state.status]}</p>}
      <nav aria-label={text('选择变更', 'Select a change')}>{changes.map(item => <button key={item.path} type="button" aria-pressed={change?.path === item.path} onClick={() => select(item.path)}><span>{item.name}</span></button>)}</nav>
      <details className="sc-spec-local-note"><summary>{text('找不到变更？', 'Missing a change?')}</summary><p>{text('这里只显示当前项目 openspec/changes 中的变更。若项目把变更存放在外部 store，请回到对话中使用 OpenSpec。', 'Only changes under this workspace’s openspec/changes appear here. If the project uses an external store, use OpenSpec in the conversation.')}</p></details>
    </aside>);
}

function LegacyNotes({ run, openFile, text }) {
  if (!Object.values(run.stages).some(record => record.result || record.files.length || record.blocker)) return null;
  return <details className="sc-spec-history"><summary>{text('以前保存的手动记录', 'Earlier manual notes')}</summary>{Object.entries(run.stages).map(([id, record]) => <section key={id}><strong>{id}</strong><p>{record.result}</p>{record.blocker && <p>{record.blocker}</p>}{record.files.map(path => <button key={path} type="button" onClick={() => openFile(path)}>{path.split('/').at(-1)}</button>)}</section>)}</details>;
}

function changeInstruction({ t, text, current, goal, change, needsChange }) {
  return `${t('draftContext')}OpenSpec / ${text(current[1], current[2])}\n${t('goal')}：${goal}${change && needsChange ? `\n${text('选定变更', 'Selected change')}：${change.name}\n${text('变更目录', 'Change directory')}：${change.path}` : ''}\n${text('先检查项目配置和实际产物，遵守此 Skill 的工作范围；本操作只准备草稿。', 'Check project configuration and artifacts, and follow this Skill’s scope. This action only prepares a draft.')}`;
}

function ChangeActions({ change, goal, run, openFile, t, text, skills, native, api, sessionId, useInput, inputActions, openView, onUsed }) {
  const [action, setAction] = useState(actions[0][0]);
  const current = actions.find(item => item[0] === action), skill = skills.find(item => item.id === `openspec/${action}`);
  const needsChange = actions.slice(2).some(item => item[0] === action), blocked = needsChange && (!change || change.archived);
  const available = skill && !blocked ? skillAvailability(skill, native.skills) : 'unavailable';
  const reason = blocked ? text('请先选择一个进行中的变更。', 'Select an active change first.') : available === 'ready' ? '' : t(available);
  const context = changeInstruction({ t, text, current, goal, change, needsChange });
  return (<aside className="sc-spec-actions"><h3>{text('你想做什么？', 'What would you like to do?')}</h3><nav aria-label={text('OpenSpec 操作', 'OpenSpec actions')}>{actions.map(item => <button key={item[0]} type="button" aria-pressed={action === item[0]} onClick={() => setAction(item[0])}>{text(item[1], item[2])}</button>)}</nav><p>{text(current[3], current[4])}</p><code>/{action}</code>
      {skill && <Compose skill={skill} availability={available} api={api} sessionId={sessionId} useInput={useInput} inputActions={inputActions} openView={openView} context={context} onUsed={() => onUsed(skill.id)} t={t} />}
      {reason && <p>{reason}</p>}
      <LegacyNotes run={run} openFile={openFile} text={text} />
    </aside>);
}

export function OpenSpec({ filesApi, sessionId, revision, goal, facts, run, openFile, t, skills, native, api, useInput, inputActions, openView, MarkdownText, onUsed }) {
  const language = t('language'), text = (zh, en) => language === 'zh' ? zh : en;
  const [state, setState] = useState({ status: 'loading', changes: [] }), [selected, select] = useState(''), [archived, showArchived] = useState(false), [refresh, setRefresh] = useState(0);
  const version = `${revision}/${refresh}`;
  useEffect(() => {
    const abort = new AbortController(); setState({ status: 'loading', changes: [] });
    if (!filesApi) { setState({ status: 'error', changes: [] }); return () => abort.abort(); }
    void readChanges(filesApi, abort.signal).then(value => { if (!abort.signal.aborted) setState({ status: 'ready', ...value }); })
      .catch(() => { if (!abort.signal.aborted) setState({ status: 'error', changes: [] }); });
    return () => abort.abort();
  }, [filesApi, sessionId, version]);
  const changes = state.changes.filter(change => change.archived === archived), change = changes.find(item => item.path === selected) || changes[0];
  return <section className="sc-spec-desk" aria-label={text('变更与文档', 'Changes and documents')}>
    <header className="sc-spec-heading"><p><span>{text('当前项目', 'Workspace')}</span>{facts.cwd || text('当前会话的项目目录', 'Current conversation workspace')}</p><button type="button" onClick={() => setRefresh(value => value + 1)}>{text('刷新变更文件', 'Refresh change files')} ↻</button></header>
    <div className="sc-spec-workspace"><ChangeIndex state={state} changes={changes} change={change} archived={archived} showArchived={showArchived} select={select} text={text} /><main className="sc-spec-content">{change ? <ChangeDocuments api={filesApi} change={change} revision={version} openFile={openFile} text={text} MarkdownText={MarkdownText} /> : <div className="sc-spec-empty"><p>{text('选择一个变更，查看它的需求、方案和任务清单。还没有变更时，可以先选“梳理想法”或“创建方案”。', 'Select a change to read its requirements, proposal and tasks. To start a new one, choose “Explore an idea” or “Create a proposal”.')}</p></div>}</main>
    <ChangeActions onUsed={onUsed} change={change} goal={goal} run={run} openFile={openFile} t={t} text={text} skills={skills} native={native} api={api} sessionId={sessionId} useInput={useInput} inputActions={inputActions} openView={openView} /></div>
  </section>;
}
