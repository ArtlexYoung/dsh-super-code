import { useRef } from 'react';
import { usePageState } from './page-state.js';

export function useConversationLayout(memory) {
  const [layout, setLayout] = usePageState(memory, 'conversationLayout', { mode: 'closed' });
  const panel = useRef(null), chatButton = useRef(null);
  const reveal = (focus = true) => {
    setLayout(previous => previous.mode === 'closed' ? { mode: 'split' } : previous);
    if (!focus) return;
    requestAnimationFrame(() => {
      const target = panel.current?.querySelector('textarea') || panel.current?.querySelector('h2');
      target?.focus({ preventScroll: true });
      if (target?.tagName === 'TEXTAREA') { target.setSelectionRange(target.value.length, target.value.length); target.scrollTop = target.scrollHeight; }
      panel.current?.scrollIntoView({ block: 'nearest' });
    });
  };
  const close = () => {
    const work = panel.current.parentElement.querySelector('.sc-flows');
    const source = work.querySelector('.sc-flow-agents [aria-pressed=true]') || chatButton.current;
    setLayout({ mode: 'closed' });
    requestAnimationFrame(() => {
      if (layout.mode === 'focus') work.scrollTop = layout.workScroll;
      source?.focus({ preventScroll: true });
    });
  };
  const toggle = () => {
    const work = panel.current.parentElement.querySelector('.sc-flows'), restoreReading = preserveReadingPosition(panel.current);
    setLayout(layout.mode === 'focus' ? { mode: 'split' } : { mode: 'focus', workScroll: work.scrollTop });
    requestAnimationFrame(() => {
      if (layout.mode === 'focus') work.scrollTop = layout.workScroll;
      restoreReading();
    });
  };
  return { mode: layout.mode, panel, chatButton, reveal, close, toggle };
}

function preserveReadingPosition(panel) {
  const log = panel.querySelector('.dsh-super-code-detail-log');
  if (!log) return () => {};
  const following = log.scrollHeight - log.clientHeight - log.scrollTop < 32, top = log.getBoundingClientRect().top;
  const anchor = [...log.querySelectorAll('.dsh-super-code-detail-content :is(p,pre,li,h1,h2,h3,h4,h5,h6), .dsh-super-code-detail-entry-label, .sc-wb-tool-group>summary')]
    .find(element => element.getBoundingClientRect().bottom > top + 8);
  const offset = anchor?.getBoundingClientRect().top - top;
  return () => {
    if (following) { log.scrollTop = log.scrollHeight; return; }
    if (anchor?.isConnected) log.scrollTop += anchor.getBoundingClientRect().top - log.getBoundingClientRect().top - offset;
  };
}
