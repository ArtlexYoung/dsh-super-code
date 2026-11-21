import React, { useEffect, useState } from 'react';
import { Compose } from './Compose.jsx';
import { readChange, readChanges } from './spec-files.js';
import { skillAvailability } from './model.js';

const actions = [
  ['openspec-explore', '探索问题', 'Explore', '理清范围和约束，形成变更方向。', 'Clarify the scope, constraints and direction.'],
  ['openspec-propose', '创建提案', 'Propose', '生成提案、规格与实施清单，完成后供审阅。', 'Prepare proposal, specs and tasks for review.'],
  ['openspec-apply-change', '实施变更', 'Apply', '按选中变更的 tasks.md 实施，更新真实任务记录。', 'Implement the selected change and update its tasks.md.'],
  ['openspec-verify-change', '核对实现', 'Verify', '对照规格、设计与任务检查实现，记录未解决的问题。', 'Check the implementation against specs, design and tasks.'],
  ['openspec-archive-change', '归档变更', 'Archive', '检查尚未完成的事项，按项目约定归档。', 'Check remaining work and archive according to the project.'],
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
  return (<section className="sc-spec-task-summary" aria-label={text('实施清单', 'Implementation checklist')}><div><strong>{text('实施清单', 'Implementation checklist')}</strong><span>{tasks === null ? text('尚无 tasks.md', 'No tasks.md') : `${done} / ${tasks.length} ${text('已勾选', 'checked')}`}</span></div>
      {tasks?.length > 0 && <><progress aria-label={text('文件中的任务进度', 'Task progress from file')} value={done} max={tasks.length} /><details><summary>{text('查看文件中的任务', 'View tasks from file')}</summary><ul>{tasks.map((task, index) => <li key={index} data-complete={task.completed}><span aria-label={text(task.completed ? '已勾选' : '未勾选', task.completed ? 'Checked' : 'Unchecked')}>{task.completed ? '☑' : '☐'}</span>{task.text}</li>)}</ul></details></>}
      <p>{text('读取 tasks.md 的勾选记录；文档存在和任务勾选不代表实现已通过验证。', 'Reads checkboxes in tasks.md. Files and checked tasks do not prove that implementation is verified.')}</p>
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
  if (state.path !== change.path || state.status === 'loading') return <p role="status">{text('正在读取变更产物…', 'Reading change artifacts…')}</p>;
  if (state.status === 'error') return <p role="alert">{text('未能读取变更产物，请刷新重试。', 'Could not read change artifacts. Refresh to retry.')}</p>;
  const document = state.documents.find(file => file.path === selected) || state.documents.find(file => file.name === 'proposal.md') || state.documents[0];
  return <>
    <header className="sc-spec-change-heading"><div><span className="sc-flow-eyebrow">{text(change.archived ? '已归档变更' : '当前变更', change.archived ? 'ARCHIVED CHANGE' : 'CURRENT CHANGE')}</span><h2>{change.name}</h2></div><span>{state.documents.length} {text('份文档', 'documents')}</span></header>
    <TaskSummary tasks={state.tasks} text={text} />
    <nav className="sc-spec-document-tabs" aria-label={text('变更文档', 'Change documents')}>{state.documents.map(file => <button key={file.path} type="button" aria-pressed={document?.path === file.path} onClick={() => select(file.path)}>{file.path.slice(change.path.length + 1)}</button>)}</nav>
    {document ? <Document api={api} path={document.path} revision={revision} openFile={openFile} text={text} MarkdownText={MarkdownText} /> : <p>{text('这个变更尚无 Markdown 产物。', 'This change has no Markdown artifacts yet.')}</p>}
  </>;
}

function ChangeIndex({ state, changes, change, archived, showArchived, select, text }) {
  const messages = {
    loading: text('正在读取…', 'Reading…'), error: text('未能读取当前项目，请刷新重试。', 'Could not read the workspace. Refresh to retry.'),
    ready: state.kind === 'missing' ? text('当前目录没有 openspec 项目。', 'No openspec project in this directory.') : text('这里还没有变更。', 'No changes here yet.'),
  };
  return (<aside className="sc-spec-index"><h3>{text('变更目录', 'Change index')}</h3><div className="sc-spec-scope">{[false, true].map(value => <button key={String(value)} type="button" aria-pressed={archived === value} onClick={() => showArchived(value)}>{text(value ? '已归档' : '进行中', value ? 'Archived' : 'Active')}</button>)}</div>
      {!changes.length && <p role={state.status === 'error' ? 'alert' : 'status'}>{messages[state.status]}</p>}
      <nav aria-label={text('选择变更', 'Select a change')}>{changes.map(item => <button key={item.path} type="button" aria-pressed={change?.path === item.path} onClick={() => select(item.path)}><span>{item.name}</span><small>{text(item.archived ? '归档目录' : '变更目录', item.archived ? 'Archive' : 'Change')}</small></button>)}</nav>
      <details className="sc-spec-local-note"><summary>{text('浏览范围', 'Browsing scope')}</summary><p>{text('浏览当前项目 openspec/changes 下的文件。使用外部 store 的项目，请在会话中按其配置运行 OpenSpec。', 'Browses openspec/changes in this workspace. For an external store, use OpenSpec in the conversation with its configured store.')}</p></details>
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
  return (<aside className="sc-spec-actions"><h3>{text('按需要操作', 'Actions when needed')}</h3><p>{text('选择操作，准备指令后回到对话确认发送。', 'Choose an action, then review and send its instruction in the conversation.')}</p><nav aria-label={text('OpenSpec 操作', 'OpenSpec actions')}>{actions.map(item => <button key={item[0]} type="button" aria-pressed={action === item[0]} onClick={() => setAction(item[0])}>{text(item[1], item[2])}</button>)}</nav><p>{text(current[3], current[4])}</p><code>/{action}</code>
      {skill && <Compose skill={skill} availability={available} api={api} sessionId={sessionId} useInput={useInput} inputActions={inputActions} openView={openView} context={context} onUsed={() => onUsed(skill.id)} t={name => name === 'use' ? text('准备此操作', 'Prepare this action') : t(name)} />}
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
    <header className="sc-spec-heading"><div><span className="sc-flow-eyebrow">O / SPECIFICATIONS</span><h2>{text('让变更有据可查', 'Keep every change traceable')}</h2><p>{facts.cwd || text('当前会话的项目目录', 'Current conversation workspace')}</p></div><button type="button" onClick={() => setRefresh(value => value + 1)}>{text('刷新变更文件', 'Refresh change files')} ↻</button></header>
    <div className="sc-spec-workspace"><ChangeIndex state={state} changes={changes} change={change} archived={archived} showArchived={showArchived} select={select} text={text} /><main className="sc-spec-content">{change ? <ChangeDocuments api={filesApi} change={change} revision={version} openFile={openFile} text={text} MarkdownText={MarkdownText} /> : <div className="sc-spec-empty"><span>∅</span><h2>{text('从一个要解决的问题开始', 'Start with a problem to solve')}</h2><p>{text('可以先探索问题，或在已配置 OpenSpec 的项目中创建提案。生成的变更产物会出现在这里。', 'Explore the problem or propose a change in an OpenSpec project. Its artifacts will appear here.')}</p></div>}</main>
    <ChangeActions onUsed={onUsed} change={change} goal={goal} run={run} openFile={openFile} t={t} text={text} skills={skills} native={native} api={api} sessionId={sessionId} useInput={useInput} inputActions={inputActions} openView={openView} /></div>
  </section>;
}
