import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export function Selection({ value, workbench, Button, t, palette }) {
  const panel = useRef(null), input = useRef(null), anchor = useRef(null), messages = useRef(null);
  const thread = value?.thread, visible = value?.visible, assistant = workbench.assistant;
  useLayoutEffect(() => {
    if (!visible || !thread) return;
    anchor.current = workbench.view()?.coordsAtPos(Math.min(thread.to, workbench.view().state.doc.length));
    input.current?.focus();
  }, [visible, thread?.id]);
  useLayoutEffect(() => { if (messages.current) messages.current.scrollTop = messages.current.scrollHeight; }, [thread?.messages.length]);
  useLayoutEffect(() => {
    if (!visible) return;
    function place() {
      const point = anchor.current, node = panel.current;
      if (!node || !point) return;
      const width = Math.min(450, window.innerWidth - 24), height = Math.min(440, window.innerHeight - 24);
      Object.assign(node.style, { width: `${width}px`, maxHeight: `${height}px`, left: `${Math.max(12, Math.min(point.right, window.innerWidth - width - 12))}px`, top: `${Math.max(12, Math.min(point.top - node.offsetHeight - 12, window.innerHeight - node.offsetHeight - 12))}px` });
    }
    place();
    const observer = new ResizeObserver(place); observer.observe(panel.current);
    const outside = event => { if (!thread.pinned && !panel.current?.contains(event.target) && !event.target.closest('.selection-action,.selection-mark')) assistant.close(); };
    window.addEventListener('resize', place); document.addEventListener('pointerdown', outside);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('pointerdown', outside); };
  }, [visible, thread?.id, thread?.pinned]);
  if (!visible || !thread) return null;
  const busy = thread.status === 'running';
  return createPortal(<section ref={panel} className="sc-workbench sc-wb-assistant" data-palette={palette} data-workbench-dialog
    role="dialog" aria-label={t('selection')} aria-busy={busy}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); assistant.close(); } }}>
    <header><strong>{t('selection')}</strong><nav>
      <Button title={t(thread.pinned ? 'unpin' : 'pin')} aria-pressed={thread.pinned} onClick={assistant.pin}>{t(thread.pinned ? 'unpin' : 'pin')}</Button>
      <Button title={t('remove')} onClick={assistant.remove}>{t('remove')}</Button>
      <Button title={t('close')} onClick={assistant.close}>×</Button>
    </nav></header>
    <div className="sc-wb-messages" ref={messages}>{thread.messages.map((item, i) => <article key={i} data-role={item.role}>
      <strong>{t(item.role === 'assistant' ? 'assistant' : item.mode === 'edit' ? 'editRequest' : 'user')}</strong><pre>{item.text}</pre>
    </article>)}</div>
    <form onSubmit={event => { event.preventDefault(); void assistant.send(); }}>
      <div className="sc-wb-mode" role="group" aria-label={t('selectionAction')}>{['ask', 'edit'].map(mode => <Button key={mode} aria-pressed={value.mode === mode} onClick={() => assistant.mode(mode)} type="button">{t(mode)}</Button>)}</div>
      <textarea ref={input} aria-label={t('question')} placeholder={t('question')} value={thread.draft} disabled={busy} onChange={event => assistant.draft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void assistant.send(); } }} />
      <footer><span role="status">{thread.stale ? t('stale') : thread.note || (busy ? t('working') : '')}</span>
        {busy ? <Button type="button" onClick={assistant.stop}>{t('stop')}</Button> : <Button type="submit" disabled={thread.stale || !thread.draft.trim()} className="sc-wb-primary">{t('send')}</Button>}
      </footer>
    </form>
  </section>, document.body);
}
