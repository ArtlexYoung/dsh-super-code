import React, { useState } from 'react';
import { localized } from './recipes.js';
import { cardsFor } from './deck.js';
import { emptyStage, skillAvailability } from './model.js';
import { Compose } from './Compose.jsx';
import { Execution } from './Execution.jsx';

function playbookContext({ recipe, topic, topics, run, goal, tool, t, text }) {
  const language = t('language');
  const scope = tool === 'poteto-mode' ? `${t('playbookContext')}${recipe.playbook}` : text('本次仅执行所选工具，以下工作流手记作为背景。', 'Run only the selected tool; the workflow notes below provide context.');
  return `${scope}\n${t('draftContext')}${localized(recipe.title, language)}\n${t('goal')}：${goal}\n${text('当前关注', 'Current focus')}：${localized(topic.title, language)}\n${localized(topic.goal, language)}\n${topics.flatMap(item => { const saved = run.stages[item.id]; return saved?.result || saved?.files.length ? [localized(item.title, language) + ': ' + [saved.result, ...saved.files].filter(Boolean).join('\n')] : []; }).join('\n')}`;
}

function JournalTopics({ topics, run, topic, text, language, choose }) {
  return <nav aria-label={text('手记主题', 'Journal topics')}><span>{text('随时回看与补充', 'Revisit as work evolves')}</span>{topics.map(item => <button key={item.id} type="button" aria-pressed={topic.id === item.id} onClick={() => choose(item.id)}><strong>{localized(item.title, language)}</strong><small>{run.stages[item.id]?.result || run.stages[item.id]?.files.length ? text('有记录', 'Notes saved') : text('待记录', 'No notes yet')}</small></button>)}</nav>;
}

export function PStack({ recipe, run, goal, facts, saveNote, openFile, inspectCall, openChat, skills, native, api, sessionId, useInput, inputActions, openView, t, onUsed }) {
  const language = t('language'), text = (zh, en) => language === 'zh' ? zh : en;
  const [selected, setSelected] = useState({}), [drafts, setDrafts] = useState({}), [tool, setTool] = useState('poteto-mode'), [notice, setNotice] = useState('');
  const topics = cardsFor(recipe, run), topic = topics.find(item => item.id === selected[recipe.id]) || topics[0];
  const key = `${recipe.id}/${topic.id}`, record = run.stages[topic.id] || emptyStage(), note = drafts[key] || record;
  const update = patch => { setNotice(''); setDrafts(previous => ({ ...previous, [key]: { ...note, ...patch } })); };
  const skill = skills.find(item => item.pack === 'pstack' && item.name === tool);
  const context = playbookContext({ recipe, topic, topics, run, goal, tool, t, text });
  const save = () => {
    if (!saveNote(topic.id, { result: note.result, files: note.files })) return;
    setDrafts(previous => { const next = { ...previous }; delete next[key]; return next; }); setNotice(t('recordSaved'));
  };
  return <div className="sc-pstack-workspace">
    <section className="sc-pstack-journal" aria-label={text('工作手记', 'Working journal')}>
      <header className="sc-pstack-heading"><span className="sc-flow-eyebrow">P / {recipe.playbook.toUpperCase()}</span><h2>{text(recipe.playbook === 'feature' ? '边构建，边证明' : '结构改变，行为有据', recipe.playbook === 'feature' ? 'Build it. Prove it.' : 'New shape. Same behavior.')}</h2><p>{text('记下设计与取舍，带着验证证据继续。', 'Keep the decisions, tradeoffs and evidence beside the work.')}</p></header>
      <div className="sc-pstack-launch"><div><span>{text('本次使用', 'Working with')}</span><strong>{tool === 'poteto-mode' ? `poteto-mode / ${recipe.playbook}` : tool}</strong></div>
        {skill && <Compose skill={skill} availability={skillAvailability(skill, native.skills)} api={api} sessionId={sessionId} useInput={useInput} inputActions={inputActions} openView={openView} context={context} onUsed={() => onUsed(skill.id)} t={name => name === 'use' ? text(tool === 'poteto-mode' ? '带着手记继续' : '准备工具指令', tool === 'poteto-mode' ? 'Continue with these notes' : 'Prepare tool instruction') : t(name)} />}
      </div>
      <div className="sc-pstack-notebook"><JournalTopics topics={topics} run={run} topic={topic} text={text} language={language} choose={id => { setSelected(previous => ({ ...previous, [recipe.id]: id })); setNotice(''); }} />
        <article className="sc-pstack-note"><div className="sc-pstack-note-heading"><span>{text('工作笔记', 'Working notes')}</span><small>{drafts[key] ? t('unsaved') : text('跟随本次会话保存', 'Saved with this conversation')}</small></div><h3>{localized(topic.title, language)}</h3><p>{localized(topic.goal, language)}</p><blockquote>{localized(topic.output, language)}</blockquote>
          <label>{text('决定、依据与验证记录', 'Decisions, evidence and checks')}<textarea aria-label={text('决定、依据与验证记录', 'Decisions, evidence and checks')} rows={7} maxLength={4000} value={note.result} placeholder={text('为什么这样设计？已经验证了什么？还差哪一步？', 'Why this design? What did the checks show? What remains?')} onChange={event => update({ result: event.target.value })} /></label>
          <ul className="sc-flow-attachments">{note.files.map(path => <li key={path}><button type="button" title={path} onClick={() => openFile(path)}>{path.replaceAll('\\', '/').split('/').at(-1)}</button><button type="button" aria-label={`${t('detach')} ${path}`} onClick={() => update({ files: note.files.filter(file => file !== path) })}>×</button></li>)}</ul>
          {record.blocker && <p className="sc-flow-blocked">{record.blocker}</p>}
          <footer><button type="button" onClick={save}>{text('保存手记', 'Save notes')}</button><span role="status">{notice}</span></footer>
        </article>
      </div>
      <div className="sc-pstack-tools"><span>{text('随手工具', 'At hand')}</span><button type="button" aria-pressed={tool === 'poteto-mode'} onClick={() => setTool('poteto-mode')}>{text('回到工作流', 'Back to playbook')}</button>{recipe.tools.map(item => <button key={item.skill} type="button" title={localized(item.when, language)} aria-pressed={tool === item.skill} onClick={() => setTool(item.skill)}>{localized(item.label, language)}</button>)}</div>
      <details className="sc-flow-method"><summary>{recipe.source.label}<span>{t('authorMethod')}</span></summary><p>{localized(recipe.guidance, language)}</p><a href={recipe.source.url} target="_blank" rel="noreferrer">{t('readMethod')} ↗</a></details>
    </section>
    <Execution facts={facts} openFile={openFile} inspectCall={inspectCall} openChat={openChat} t={name => ({ attachFile: text('关联到当前手记', 'Attach to current notes'), filesHint: text('从会话中关联文件，留下设计和验证的依据。', 'Attach conversation files as design and verification evidence.'), executionSource: text('会话中实际记录的工作与结果。', 'Work and results recorded by the conversation.') })[name] || t(name)} attachFile={path => {
      if (note.files.includes(path)) return;
      if (note.files.length >= 16) { setNotice(text('一篇手记最多关联 16 个文件。', 'A note can have at most 16 files.')); return; }
      update({ files: [...note.files, path] });
    }} />
  </div>;
}
