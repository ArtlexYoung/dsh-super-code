import React, { useLayoutEffect, useRef, useState } from 'react';
import { panelMinimum, panelWidth } from '../layout.js';

export function Splitter({ panel, label, value, ratio, change, commit }) {
  const ref = useRef(null), gesture = useRef(null);
  const minimum = panelMinimum[panel], [maximum, setMaximum] = useState(minimum);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setMaximum(Math.max(minimum, Math.floor(entry.contentRect.width * ratio))));
    observer.observe(ref.current.parentElement);
    return () => observer.disconnect();
  }, [minimum, ratio]);
  const finish = event => {
    if (!gesture.current) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    commit();
  };
  return <div ref={ref} className={`sc-wb-splitter sc-wb-splitter-${panel}`} role="separator" tabIndex={0} aria-label={label}
    aria-orientation="vertical" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={panelWidth(value, minimum, maximum)}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const neighbor = panel === 'explorer' ? event.currentTarget.previousElementSibling : event.currentTarget.nextElementSibling;
      gesture.current = { x: event.clientX, width: neighbor.getBoundingClientRect().width };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      const start = gesture.current;
      if (start) change(panelWidth(start.width + (event.clientX - start.x) * (panel === 'explorer' ? 1 : -1), minimum, maximum));
    }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const direction = (event.key === 'ArrowRight' ? 1 : -1) * (panel === 'explorer' ? 1 : -1);
      change(panelWidth(event.key === 'Home' ? minimum : event.key === 'End' ? maximum : Math.min(value, maximum) + direction * 10, minimum, maximum));
      commit();
    }} />;
}
