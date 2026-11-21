import React, { useState } from 'react';
import { localized } from './recipes.js';
import { cardsFor } from './deck.js';
import { emptyStage, skillAvailability } from './model.js';
import { Compose } from './Compose.jsx';
import { Execution } from './Execution.jsx';
import { usePageState } from './page-state.js';

function playbookContext({ recipe, topic, topics, run, goal, tool, t, text }) {
  const language = t('language');
  const scope = tool === 'poteto-mode' ? `${t('playbookContext')}${recipe.playbook}` : text('本次仅执行所选工具，以下工作流手记作为背景。', 'Run only the selected tool; the workflow notes below provide context.');
  return `${scope}\n${t('draftContext')}${localized(recipe.title, language)}\n${t('goal')}：${goal}\n${text('当前关注', 'Current focus')}：${localized(topic.title, language)}\n${localized(topic.goal, language)}\n${topics.flatMap(item => { const saved = run.stages[item.id]; return saved?.result || saved?.files.length ? [localized(item.title, language) + ': ' + [saved.result, ...saved.files].filter(Boolean).join('\n')] : []; }).join('\n')}`;
}

function JournalTopics({ topics, run, topic, text, language, choose }) {
  return <nav aria-label={text('笔记主题', 'Note topics')}><span>{text('选择要记录的内容', 'Choose a topic')}</span>{topics.map(item => <button key={item.id} type="button" aria-pressed={topic.id === item.id} onClick={() => choose(item.id)}><strong>{localized(item.title, language)}</strong><small>{run.stages[item.id]?.result || run.stages[item.id]?.files.length ? text('有笔记', 'Has notes') : text('还没有笔记', 'No notes yet')}</small></button>)}</nav>;
}

export function PStack({ memory, recipe, run, goal, facts, saveNotes, openFile, inspectCall, openChat, skills, native, api, sessionId, useInput, inputActions, openView, t, onUsed }) {
  const language = t('language'), text = (zh, en) => language === 'zh' ? zh : en;
  const [selected, setSelected] = usePageState(memory, 'topics', {}), [drafts, setDrafts] = usePageState(memory, 'notes', {}), [tool, setTool] = usePageState(memory, `tool/${recipe.id}`, 'poteto-mode'), [notice, setNotice] = useState('');
  const topics = cardsFor(recipe, run), topic = topics.find(item => item.id === selected[recipe.id]) || topics[0];
  const key = `${recipe.id}/${topic.id}`, record = run.stages[topic.id] || emptyStage(), note = drafts[key] || record;
  const update = patch => { setNotice(''); setDrafts(previous => ({ ...previous, [key]: { ...note, ...patch } })); };
  const skill = skills.find(item => item.pack === 'pstack' && item.name === tool);
  const pending = Object.fromEntries(topics.filter(item => drafts[`${recipe.id}/${item.id}`]).map(item => [item.id, drafts[`${recipe.id}/${item.id}`]]));
  const workingRun = { ...run, stages: { ...run.stages, ...pending } };
  const context = playbookContext({ recipe, topic, topics, run: workingRun, goal, tool, t, text });
  const save = (notes = { [topic.id]: note }) => {
    if (!Object.keys(notes).length) return true;
    if (!saveNotes(notes)) return false;
    setDrafts(previous => { const next = { ...previous }; for (const id of Object.keys(notes)) delete next[`${recipe.id}/${id}`]; return next; }); setNotice(t('recordSaved')); return true;
  };
  return <div className="sc-pstack-workspace">
    <section className="sc-pstack-journal" aria-label={text('工作笔记', 'Working notes')}>
      <div className="sc-pstack-notebook"><JournalTopics topics={topics} run={workingRun} topic={topic} text={text} language={language} choose={id => { setSelected(previous => ({ ...previous, [recipe.id]: id })); setNotice(''); }} />
        <article className="sc-pstack-note"><div className="sc-pstack-note-heading"><span>{text('随手记录，带到对话中继续', 'Keep notes and continue in the conversation')}</span><small>{drafts[key] ? t('unsaved') : text('保存在当前浏览器中', 'Stored in this browser')}</small></div><h3>{localized(topic.title, language)}</h3><p>{localized(topic.goal, language)}</p><blockquote>{text('需要留下：', 'Keep a record of: ')}{localized(topic.output, language)}</blockquote>
          <label>{text('想法、决定和检查结果', 'Decisions and check results')}<textarea aria-label={text('想法、决定和检查结果', 'Decisions and check results')} rows={5} maxLength={4000} value={note.result} placeholder={text('例如：采用了哪个方案，为什么这样选；哪些检查已通过，还有什么问题。', 'For example: which approach you chose and why, which checks passed, and what remains unresolved.')} onChange={event => update({ result: event.target.value })} /></label>
          <ul className="sc-flow-attachments">{note.files.map(path => <li key={path}><button type="button" title={path} onClick={() => openFile(path)}>{path.replaceAll('\\', '/').split('/').at(-1)}</button><button type="button" aria-label={`${t('detach')} ${path}`} onClick={() => update({ files: note.files.filter(file => file !== path) })}>×</button></li>)}</ul>
          {record.blocker && <p className="sc-flow-blocked">{record.blocker}</p>}
          <footer className="sc-pstack-launch"><div><span>{text(tool === 'poteto-mode' ? '完整工作流 · 带上各主题的最新笔记' : '本次使用的工具', tool === 'poteto-mode' ? 'Full workflow · includes the latest notes' : 'Selected tool')}</span><strong>{tool === 'poteto-mode' ? localized(recipe.title, language) : tool}</strong></div>
            <div className="sc-pstack-note-actions"><button type="button" onClick={() => save()}>{text('保存笔记', 'Save notes')}</button>
              {skill && <Compose key={`${recipe.id}/${skill.id}`} skill={skill} availability={skillAvailability(skill, native.skills)} api={api} sessionId={sessionId} useInput={useInput} inputActions={inputActions} openView={openView} context={context} beforeInsert={() => save(pending)} label={text('保存笔记并去对话', 'Save notes and open chat')} hint={false} onUsed={() => onUsed(skill.id)} t={t} />}
            </div><p className="sc-flow-note">{t('draftHint')}</p><span role="status">{notice}</span>
          </footer>
        </article>
      </div>
      <div className="sc-pstack-tools"><span>{text('需要时使用', 'Use when needed')}</span><button type="button" aria-pressed={tool === 'poteto-mode'} onClick={() => setTool('poteto-mode')}>{text('使用完整工作流', 'Use the full workflow')}</button>{recipe.tools.map(item => <button key={item.skill} type="button" title={localized(item.when, language)} aria-pressed={tool === item.skill} onClick={() => setTool(item.skill)}>{localized(item.label, language)}</button>)}</div>
      <details className="sc-flow-method"><summary>{recipe.source.label}<span>{t('authorMethod')}</span></summary><p>{localized(recipe.guidance, language)}</p><a href={recipe.source.url} target="_blank" rel="noreferrer">{t('readMethod')} ↗</a></details>
    </section>
    <Execution facts={facts} openFile={openFile} inspectCall={inspectCall} openChat={openChat} t={name => ({ attachFile: text('关联到当前笔记', 'Attach to current notes'), filesHint: text('可以打开文件查看，也可以关联到笔记中。', 'Open a file to inspect it, or attach it to your notes.'), executionSource: text('这里显示 AI 在当前对话中记录的进度。', 'Progress recorded by AI in this conversation.') })[name] || t(name)} attachFile={path => {
      if (note.files.includes(path)) return;
      if (note.files.length >= 16) { setNotice(text('一篇笔记最多关联 16 个文件。', 'A note can have at most 16 files.')); return; }
      update({ files: [...note.files, path] });
    }} />
  </div>;
}
