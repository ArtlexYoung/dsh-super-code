import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { centerRect, fitRect, moveRect, resizeRect } from '../editor/geometry.js';

export function Floating({ title, children, close, t, Button, anchor, className = '', initialSize, palette }) {
  const panel = useRef(null), gesture = useRef(null), minimizedFrom = useRef('normal');
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [rect, setRect] = useState(() => {
    const centered = centerRect(viewport(), initialSize);
    return anchor ? fitRect({ ...centered, x: anchor.right, y: anchor.top - centered.height - 12 }, viewport()) : centered;
  });
  const [mode, setMode] = useState('normal'), [pinned, setPinned] = useState(false);
  useEffect(() => {
    const resize = () => setRect(value => fitRect(value, viewport()));
    const outside = event => { if (!pinned && !panel.current?.contains(event.target) && !event.target.closest('.selection-action,.selection-mark')) close(); };
    window.addEventListener('resize', resize); document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('resize', resize); document.removeEventListener('pointerdown', outside); };
  }, [pinned, close]);
  const shown = mode === 'maximized' ? centerRect(viewport(), viewport()) : rect;
  function pointerDown(event) {
    const edge = event.target.closest('[data-resize]')?.dataset.resize;
    if (event.button !== 0 || mode !== 'normal') return;
    if (!edge && (!event.target.closest('.sc-wb-dialog-heading') || event.target.closest('button'))) return;
    event.preventDefault(); panel.current.setPointerCapture(event.pointerId);
    gesture.current = { edge, x: event.clientX, y: event.clientY, rect };
  }
  const end = () => { gesture.current = null; };
  return createPortal(<section ref={panel} role="dialog" aria-label={title} data-workbench-dialog data-palette={palette}
    className={`sc-workbench sc-wb-dialog ${className}`} data-mode={mode}
    style={{ left: shown.x, top: shown.y, width: shown.width, height: mode === 'minimized' ? 42 : shown.height }}
    onPointerDown={pointerDown} onPointerMove={event => {
      const start = gesture.current; if (!start) return;
      const delta = { x: event.clientX - start.x, y: event.clientY - start.y };
      setRect(start.edge ? resizeRect(start.rect, delta, start.edge, viewport()) : moveRect(start.rect, delta, viewport()));
    }} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
    onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <header className="sc-wb-dialog-heading" onDoubleClick={event => { if (!event.target.closest('button')) setMode(mode === 'maximized' ? 'normal' : 'maximized'); }}>
      <strong>{title}</strong><nav>
        <Button title={t(pinned ? 'unpin' : 'pin')} aria-pressed={pinned} onClick={() => setPinned(!pinned)}>{t(pinned ? 'unpin' : 'pin')}</Button>
        <Button title={t(mode === 'minimized' ? 'expand' : 'collapse')} onClick={() => {
          if (mode === 'minimized') setMode(minimizedFrom.current); else { minimizedFrom.current = mode; setMode('minimized'); }
        }}>{t(mode === 'minimized' ? 'expand' : 'collapse')}</Button>
        <Button title={t(mode === 'maximized' ? 'restore' : 'maximize')} onClick={() => setMode(mode === 'maximized' ? 'normal' : 'maximized')}>{t(mode === 'maximized' ? 'restore' : 'maximize')}</Button>
        <Button title={t('center')} onClick={() => { setRect(centerRect(viewport(), rect)); setMode('normal'); }}>{t('center')}</Button>
        <Button title={t('close')} onClick={close}>×</Button>
      </nav>
    </header>
    <div className="sc-wb-dialog-body" hidden={mode === 'minimized'}>{children}</div>
    {mode === 'normal' && ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(edge => <div key={edge} data-resize={edge} className={`sc-wb-resize sc-wb-resize-${edge}`} aria-hidden />)}
  </section>, document.body);
}
