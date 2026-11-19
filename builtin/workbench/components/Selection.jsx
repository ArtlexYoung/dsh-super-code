import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { keyOf } from '../editor/preferences.js';
import { useWindowMode } from '../windows/presentation.js';
import { useDialogKeyboard } from './Floating.jsx';
import { Icon } from './Icon.jsx';

export function Selection({ value, workbench, Button, t, palette, preferences, inline = false }) {
  const panel = useRef(null), input = useRef(null), anchor = useRef(null), messages = useRef(null);
  const thread = value?.thread, visible = value?.visible, assistant = workbench.assistant;
  // 选区气泡位于内部窗口之上，失去控件焦点后仍优先响应关闭快捷键。
  const dialog = useRef({ order: Number.POSITIVE_INFINITY });
  Object.assign(dialog.current, { close: assistant.close, shortcut: keyOf(preferences, 'close') });
  useDialogKeyboard(dialog.current, !!visible);
  const openWindow = workbench.openWindow ? () => workbench.openWindow({ kind: 'selection' }) : undefined;
  useWindowMode(openWindow, preferences.windowMode, !!value?.visible, thread?.id);
  useLayoutEffect(() => {
    if (!visible || !thread || inline) return;
    const view = workbench.view();
    const end = thread.file === workbench.snapshot().file && view ? view.coordsAtPos(Math.min(thread.to, view.state.doc.length)) : null;
    const start = end ? view.coordsAtPos(Math.min(thread.from, view.state.doc.length)) : null;
    anchor.current = end ? { top: start?.top ?? end.top, bottom: end.bottom, right: end.right } : { top: window.innerHeight / 2, bottom: window.innerHeight / 2, right: window.innerWidth / 2 };
    input.current?.focus();
  }, [visible, thread?.id, inline]);
  useLayoutEffect(() => { if (messages.current) messages.current.scrollTop = messages.current.scrollHeight; }, [thread?.messages.length]);
  useLayoutEffect(() => {
    if (!visible || inline) return;
    function place() {
      const anchorPoint = anchor.current, node = panel.current;
      if (!node || !anchorPoint) return;
      // 源码坐标来自视口，先转换为气泡的布局尺寸，避免缩放后重复放大位置。
      const box = node.getBoundingClientRect(), scaleX = box.width / node.offsetWidth, scaleY = box.height / node.offsetHeight;
      const viewport = { width: window.innerWidth / scaleX, height: window.innerHeight / scaleY };
      const point = { top: anchorPoint.top / scaleY, bottom: anchorPoint.bottom / scaleY, right: anchorPoint.right / scaleX };
      const width = Math.min(450, viewport.width - 24), height = Math.min(440, viewport.height - 24);
      const below = point.bottom + 12, top = below + node.offsetHeight <= viewport.height - 12 ? below : point.top - node.offsetHeight - 12;
      Object.assign(node.style, { width: `${width}px`, maxHeight: `${height}px`, left: `${Math.max(12, Math.min(point.right, viewport.width - width - 12))}px`, top: `${Math.max(12, Math.min(top, viewport.height - node.offsetHeight - 12))}px` });
    }
    place();
    const observer = new ResizeObserver(place); observer.observe(panel.current); observer.observe(document.body);
    const outside = event => { if (!thread.pinned && !panel.current?.contains(event.target) && !event.target.closest('.selection-action,.selection-mark')) assistant.close(); };
    window.addEventListener('resize', place); document.addEventListener('pointerdown', outside);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('pointerdown', outside); };
  }, [visible, thread?.id, thread?.pinned, inline]);
  if (!visible || !thread) return null;
  const busy = thread.status === 'running', translation = thread.kind === 'translation', placeholder = t(translation ? 'translationQuestion' : 'question');
  const content = <section ref={panel} className={`sc-workbench sc-wb-assistant${inline ? ' sc-wb-assistant-inline' : ''}`} data-palette={palette} data-workbench-dialog
    role="dialog" aria-label={t(translation ? 'translate' : 'selection')} aria-busy={busy}>
    <header><strong>{t(translation ? 'translate' : 'selection')}</strong><nav>
      {openWindow && <Button title={t('windowOpen')} aria-label={t('windowOpen')} onClick={() => { void openWindow(); }}><Icon name="window" /></Button>}
      <Button title={t(thread.pinned ? 'selectionUnpin' : 'selectionPin')} aria-label={t(thread.pinned ? 'selectionUnpin' : 'selectionPin')} aria-pressed={thread.pinned} onClick={() => assistant.pin()}><Icon name={thread.pinned ? 'unpin' : 'pin'} /></Button>
      <Button title={t('remove')} aria-label={t('remove')} onClick={() => assistant.remove()}><Icon name="trash" /></Button>
      <Button className="sc-wb-window-close" title={t('close')} aria-label={t('close')} onClick={() => assistant.close()}><Icon name="close" /></Button>
    </nav></header>
    <div className="sc-wb-messages" ref={messages}>{thread.messages.map((item, i) => <article key={i} data-role={item.role}>
      <strong>{t(item.role === 'assistant' ? 'assistant' : item.mode === 'edit' ? 'editRequest' : 'user')}</strong><pre>{item.text}</pre>
    </article>)}</div>
    <div className="sc-wb-answer-state" data-status={thread.status} role="status" aria-live="polite">
      {busy && <i className="sc-wb-answer-spinner" aria-hidden="true" />}
      <span>{t(busy ? 'quickRunning' : thread.status === 'error' ? 'quickFailed' : thread.status === 'stopped' ? 'quickStopped' : thread.messages.at(-1)?.role === 'assistant' ? 'quickCompleted' : 'quickReady')}</span>
    </div>
    <form onSubmit={event => { event.preventDefault(); void assistant.send(); }}>
      {!translation && <div className="sc-wb-mode" role="group" aria-label={t('selectionAction')}>{['ask', 'edit'].map(mode => <Button key={mode} aria-pressed={value.mode === mode} onClick={() => assistant.mode(mode)} type="button">{t(mode)}</Button>)}</div>}
      <textarea ref={input} aria-label={placeholder} placeholder={placeholder} value={thread.draft} disabled={busy} onChange={event => assistant.draft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void assistant.send(); } }} />
      <footer><span role="status">{thread.stale && !translation ? t('stale') : thread.note || (busy ? t('working') : '')}</span>
        {busy ? <Button type="button" onClick={() => assistant.stop()}>{t('stop')}</Button> : <Button type="submit" disabled={!translation && thread.stale || !thread.draft.trim()} className="sc-wb-primary">{t('send')}</Button>}
      </footer>
    </form>
  </section>;
  return inline ? content : createPortal(content, document.body);
}
