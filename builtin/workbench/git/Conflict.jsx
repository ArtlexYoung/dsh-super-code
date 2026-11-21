import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Annotation, Compartment, EditorState, StateEffect } from '@codemirror/state';
import { Decoration, EditorView, lineNumbers, keymap, drawSelection } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { editorTheme } from '../editor/theme.js';
import { loadLanguage } from '../editor/languages.js';
import { conflictBlocks } from '../../../src/workbench/git/text-diff.ts';
import { usePanelState } from '../components/panel-state.js';
import { errorText } from '../locales.js';
import { Icon } from '../components/Icon.jsx';
import { asText, textChanges } from '../editing/history.js';

const TransactionSource = Annotation.define();

function comparisonMarks(base, doc) {
  if (base === undefined) return [];
  const lines = new Set();
  try {
    textChanges(asText(base), doc).iterChangedRanges((_from, _to, from, to) => {
      const first = doc.lineAt(from).number, last = doc.lineAt(Math.max(from, to - 1)).number;
      for (let line = first; line <= last; line++) lines.add(doc.line(line).from);
    });
  } catch (error) {
    // 超大差异保留完整可读文本；着色不影响手动处理和版本检查。
    if (error.message !== 'WORKBENCH_UNDO_CONFLICT') throw error;
  }
  return [...lines].map(from => Decoration.line({ class: 'sc-wb-conflict-changed' }).range(from));
}

export function ConflictEditor({ path, text, change, label, palette, disabled, block, base, wrap = false }) {
  const parent = useRef(null), editor = useRef(null), changed = useRef(change);
  const [access] = useState(() => new Compartment());
  const [highlight] = useState(() => new Compartment());
  changed.current = change;
  useEffect(() => {
    let disposed = false;
    const view = new EditorView({ parent: parent.current, state: EditorState.create({ doc: text ?? '', extensions: [
      editorTheme(palette), lineNumbers(), drawSelection(), history(), keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]), search(),
      ...(wrap ? [EditorView.lineWrapping] : []),
      EditorView.contentAttributes.of({ 'aria-label': label }), access.of([EditorView.editable.of(!!change && !disabled), EditorState.readOnly.of(!change || disabled)]), highlight.of([]),
      EditorView.updateListener.of(update => { if (update.docChanged && !update.transactions.some(item => item.annotation(TransactionSource))) changed.current?.(update.state.doc.toString()); }),
    ] }) });
    editor.current = view;
    void loadLanguage(path).then(language => { if (!disposed) view.dispatch({ effects: StateEffect.appendConfig.of(language) }); });
    return () => { disposed = true; editor.current = null; view.destroy(); };
  }, [path, palette, label, !!change, wrap]);
  useEffect(() => { editor.current?.dispatch({ effects: access.reconfigure([EditorView.editable.of(!!change && !disabled), EditorState.readOnly.of(!change || disabled)]) }); }, [disabled, !!change]);
  useEffect(() => {
    const view = editor.current, value = text ?? '';
    if (view && view.state.doc.toString() !== value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: TransactionSource.of(true) });
  }, [text]);
  useEffect(() => {
    const view = editor.current; if (!view) return;
    const marks = comparisonMarks(base, view.state.doc);
    if (block) {
      const first = view.state.doc.lineAt(Math.min(block.from, view.state.doc.length)), last = view.state.doc.lineAt(Math.min(Math.max(block.from, block.to - 1), view.state.doc.length));
      for (let line = first.number; line <= last.number; line++) marks.push(Decoration.line({ class: 'sc-wb-conflict-selected' }).range(view.state.doc.line(line).from));
    }
    view.dispatch({ effects: [highlight.reconfigure(EditorView.decorations.of(Decoration.set(marks))), ...(block ? [EditorView.scrollIntoView(Math.min(view.state.doc.length, block.from), { y: 'center' })] : [])] });
  }, [block?.from, block?.to, palette, base, text]);
  return <div ref={parent} className="sc-wb-conflict-editor" />;
}

export function Conflict({ workbench, path, Button, t, palette, close }) {
  const { state } = useSyncExternalStore(workbench.changes.subscribe, workbench.changes.snapshot);
  const [drafts, setDrafts] = usePanelState(workbench, 'gitConflicts', {}), entry = drafts[path];
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [at, setAt] = useState(0), request = useRef(null);
  const saveDraft = value => setDrafts(previous => ({ ...previous, [path]: value }));
  const update = text => saveDraft({ ...entry, text });
  const blocks = useMemo(() => conflictBlocks(entry?.text ?? ''), [entry?.text]);
  async function load() {
    request.current?.abort(); const abort = new AbortController(); request.current = abort; setBusy(true); setError('');
    try {
      const latest = await workbench.git({ action: 'status' }, abort.signal);
      abort.signal.throwIfAborted();
      const result = await workbench.git({ action: 'conflict', path, version: latest.state.version }, abort.signal);
      if (!abort.signal.aborted) {
        // 独立窗口会复制状态对象，按版本和文本判断读取期间草稿是否被修改。
        setDrafts(previous => previous[path]?.version === entry?.version && previous[path]?.text === entry?.text
          ? { ...previous, [path]: { ...result.conflict, text: result.conflict.result } } : previous);
        setAt(0);
      }
    } catch (failure) { if (!abort.signal.aborted) setError(errorText(failure, t)); }
    finally { if (request.current === abort) { request.current = null; setBusy(false); } }
  }
  useEffect(() => { setError(''); setAt(0); if (!entry) void load(); return () => request.current?.abort(); }, [path]);
  const stale = entry && entry.version !== state?.version;
  async function save() {
    const abort = new AbortController(); request.current = abort; setBusy(true); setError('');
    try {
      await workbench.git({ action: 'resolveConflict', path, text: entry.text, version: entry.version }, abort.signal);
      if (!abort.signal.aborted) {
        const current = workbench.snapshot().panel?.state?.gitConflicts?.[path];
        if (current?.version !== entry.version || current?.text !== entry.text) { setError(t('gitResolutionDraftKept')); return; }
        setDrafts(previous => { const next = { ...previous }; delete next[path]; return next; }); close();
      }
    } catch (failure) { if (!abort.signal.aborted) { setError(errorText(failure, t)); workbench.changes.invalidate(); } }
    finally { if (request.current === abort) { request.current = null; setBusy(false); } }
  }
  const selected = Math.min(at, Math.max(0, blocks.length - 1));
  const choose = side => { const block = blocks[selected]; if (block) update(entry.text.slice(0, block.from) + block[side] + entry.text.slice(block.to)); };
  return <section className="sc-wb-conflict" aria-label={t('gitResolveConflict')} aria-busy={busy}>
    <header><strong title={path}>{path}</strong><nav><Button title={t(entry && entry.text !== entry.result ? 'gitReloadConflict' : 'refresh')} disabled={busy} onClick={() => { void load(); }}>{t(entry && entry.text !== entry.result ? 'gitReloadConflict' : 'refresh')}</Button><Button title={t('close')} disabled={busy} onClick={close}>{t('close')}</Button></nav></header>
    {(error || stale) && <p role="alert" className="sc-wb-error">{error || t('WORKBENCH_GIT_STALE')}</p>}
    {!entry ? <p role="status">{t(busy ? 'loading' : 'gitChooseFile')}</p> : <>
      <div className="sc-wb-conflict-actions"><span>{blocks.length} {t('gitConflictsRemaining')}</span>
        <Button title={t('gitPrevious')} aria-label={t('gitPrevious')} disabled={!blocks.length} onClick={() => setAt((selected + blocks.length - 1) % blocks.length)}><Icon name="up" /></Button><small>{blocks.length ? selected + 1 : 0}/{blocks.length}</small><Button title={t('gitNext')} aria-label={t('gitNext')} disabled={!blocks.length} onClick={() => setAt((selected + 1) % blocks.length)}><Icon name="down" /></Button>
        <Button title={t('gitAcceptOurs')} aria-label={t('gitAcceptOurs')} disabled={busy || !state?.writable || !blocks.length} onClick={() => choose('ours')}><Icon name="arrowRight" />{t('gitAcceptOurs')}</Button>
        <Button title={t('gitAcceptTheirs')} aria-label={t('gitAcceptTheirs')} disabled={busy || !state?.writable || !blocks.length} onClick={() => choose('theirs')}>{t('gitAcceptTheirs')}<Icon name="arrowLeft" /></Button>
      </div>
      <div className="sc-wb-conflict-columns">{[['ours', 'gitOurs'], ['text', 'gitResult'], ['theirs', 'gitTheirs']].map(([side, label]) => <section key={side}><header><span>{t(label)}</span>{side !== 'text' && <Button title={t(side === 'ours' ? 'gitAcceptAllOurs' : 'gitAcceptAllTheirs')} aria-label={t(side === 'ours' ? 'gitAcceptAllOurs' : 'gitAcceptAllTheirs')} disabled={busy || !state?.writable} onClick={() => update(entry[side])}>{t('gitAcceptAll')}</Button>}</header>
        {entry[side] === null && <small className="sc-wb-git-muted">{t('gitDeletedFile')}</small>}
        <ConflictEditor path={path} text={entry[side]} change={side === 'text' ? update : undefined} disabled={busy || !state?.writable} label={t(label)} palette={palette} block={side === 'text' ? blocks[selected] : undefined} />
      </section>)}</div>
      <footer><small>{t('gitConflictSaveHint')}</small><Button className="sc-wb-primary" title={t('gitSaveResolution')} disabled={busy || stale || !state?.writable || !!blocks.length} onClick={() => { void save(); }}>{t(busy ? 'working' : 'gitSaveResolution')}</Button></footer>
    </>}
  </section>;
}
