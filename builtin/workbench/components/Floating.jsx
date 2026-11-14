import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { centerRect, fitRect, moveRect, resizeRect } from '../editor/geometry.js';
import { defaults, keyOf, matchesShortcut } from '../editor/preferences.js';

const Boundary = createContext(null), dialogs = new Set();
let sequence = 0;
const rank = entry => (entry.pinned ? 1000000 : 1000) + entry.order;
const topDialog = () => [...dialogs].sort((a, b) => rank(b) - rank(a))[0];

export function FloatingBoundary({ children, preferences }) {
  const [element, setElement] = useState(null);
  const value = useMemo(() => ({ element, preferences }), [element, preferences]);
  return <Boundary.Provider value={value}><div className="sc-wb-window-layer" ref={setElement} />{children}</Boundary.Provider>;
}

export function Floating({ title, children, close, t, Button, anchor, className = '', initialSize, palette }) {
  const boundary = useContext(Boundary), container = boundary?.element || document.body;
  const panel = useRef(null), gesture = useRef(null), minimizedFrom = useRef('normal');
  const viewport = () => container === document.body ? { width: window.innerWidth, height: window.innerHeight } : { width: container.clientWidth, height: container.clientHeight };
  const initialRect = () => {
    const centered = centerRect(viewport(), initialSize);
    const offset = container === document.body ? { left: 0, top: 0 } : container.getBoundingClientRect();
    return anchor ? fitRect({ ...centered, x: anchor.right - offset.left, y: anchor.top - offset.top - centered.height - 12 }, viewport()) : centered;
  };
  const [rect, setRect] = useState(initialRect);
  const [mode, setMode] = useState('normal'), [pinned, setPinned] = useState(false);
  const [order, setOrder] = useState(() => ++sequence), [entry] = useState(() => ({}));
  Object.assign(entry, { order, pinned, close, shortcut: keyOf(boundary?.preferences || defaults(), 'close') });
  useLayoutEffect(() => { if (!boundary || boundary.element) setRect(initialRect()); }, [container]);
  useEffect(() => {
    const resize = () => setRect(value => fitRect(value, viewport()));
    const outside = event => {
      if (topDialog() === entry && !entry.pinned && !panel.current?.contains(event.target) && !event.target.closest('[data-workbench-dialog],[role=listbox],.selection-action,.selection-mark')) entry.close();
    };
    const keydown = event => {
      if (topDialog() !== entry || event.defaultPrevented || !matchesShortcut(event, entry.shortcut)) return;
      event.preventDefault(); event.stopImmediatePropagation(); entry.close();
    };
    const previous = document.activeElement;
    dialogs.add(entry);
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(resize); observer.observe(container);
    window.addEventListener('resize', resize); document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', keydown);
    return () => {
      const restore = document.activeElement === document.body || panel.current?.contains(document.activeElement);
      dialogs.delete(entry); observer.disconnect();
      window.removeEventListener('resize', resize); document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', keydown);
      if (restore && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [container, entry]);
  const shown = mode === 'maximized' ? { x: 0, y: 0, ...viewport() } : rect;
  function pointerDown(event) {
    const edge = event.target.closest('[data-resize]')?.dataset.resize;
    if (event.button !== 0 || mode !== 'normal') return;
    if (!edge && (!event.target.closest('.sc-wb-dialog-heading') || event.target.closest('button'))) return;
    event.preventDefault(); panel.current.setPointerCapture(event.pointerId);
    gesture.current = { edge, x: event.clientX, y: event.clientY, rect };
  }
  const end = () => { gesture.current = null; };
  if (boundary && !boundary.element) return null;
  return createPortal(<section ref={panel} role="dialog" tabIndex={-1} aria-label={title} data-workbench-dialog data-palette={palette}
    className={`sc-workbench sc-wb-dialog ${className}`} data-mode={mode} data-pinned={pinned}
    style={{ left: shown.x, top: shown.y, width: shown.width, height: mode === 'minimized' ? 42 : shown.height, zIndex: rank(entry) }}
    onPointerDownCapture={() => { const next = ++sequence; entry.order = next; setOrder(next); }}
    onPointerDown={pointerDown} onPointerMove={event => {
      const start = gesture.current; if (!start) return;
      const delta = { x: event.clientX - start.x, y: event.clientY - start.y };
      setRect(start.edge ? resizeRect(start.rect, delta, start.edge, viewport()) : moveRect(start.rect, delta, viewport()));
    }} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    <header className="sc-wb-dialog-heading" onDoubleClick={event => { if (!event.target.closest('button')) setMode(mode === 'maximized' ? 'normal' : 'maximized'); }}>
      <strong>{title}</strong><nav>
        <Button title={t(pinned ? 'unpin' : 'pin')} aria-pressed={pinned} onClick={() => setPinned(!pinned)}>{t(pinned ? 'unpin' : 'pin')}</Button>
        <Button title={t(mode === 'minimized' ? 'expand' : 'collapse')} onClick={() => {
          if (mode === 'minimized') setMode(minimizedFrom.current); else { minimizedFrom.current = mode; setMode('minimized'); }
        }}>{t(mode === 'minimized' ? 'expand' : 'collapse')}</Button>
        <Button title={t(mode === 'maximized' ? 'restore' : 'maximize')} onClick={() => setMode(mode === 'maximized' ? 'normal' : 'maximized')}>{t(mode === 'maximized' ? 'restore' : 'maximize')}</Button>
        <Button title={t('close')} onClick={close}>×</Button>
      </nav>
    </header>
    <div className="sc-wb-dialog-body" hidden={mode === 'minimized'}>{children}</div>
    {mode === 'normal' && ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(edge => <div key={edge} data-resize={edge} className={`sc-wb-resize sc-wb-resize-${edge}`} aria-hidden />)}
  </section>, container);
}
