import React, { useLayoutEffect, useRef, useState } from 'react';
import { panelMinimum, panelWidth } from '../layout.js';

export function Splitter({ panel, label, value, ratio, change, commit }) {
  const ref = useRef(null), gesture = useRef(null);
  const horizontal = panel === 'files', dimension = horizontal ? 'height' : 'width', coordinate = horizontal ? 'clientY' : 'clientX';
  const direction = panel === 'reading' ? -1 : 1;
  const minimum = panelMinimum[panel], [maximum, setMaximum] = useState(minimum);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setMaximum(Math.max(minimum, Math.floor(entry.contentRect[dimension] * ratio))));
    observer.observe(ref.current.parentElement);
    return () => observer.disconnect();
  }, [minimum, ratio, dimension]);
  const finish = event => {
    if (!gesture.current) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    commit();
  };
  return <div ref={ref} className={`sc-wb-splitter sc-wb-splitter-${panel}`} role="separator" tabIndex={0} aria-label={label}
    aria-orientation={horizontal ? 'horizontal' : 'vertical'} aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={panelWidth(value, minimum, maximum)}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const neighbor = panel === 'reading' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
      gesture.current = { position: event[coordinate], size: neighbor.getBoundingClientRect()[dimension] };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      const start = gesture.current;
      if (start) change(panelWidth(start.size + (event[coordinate] - start.position) * direction, minimum, maximum));
    }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onKeyDown={event => {
      const keys = horizontal ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
      if (![...keys, 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const step = (event.key === keys[1] ? 1 : -1) * direction;
      change(panelWidth(event.key === 'Home' ? minimum : event.key === 'End' ? maximum : Math.min(value, maximum) + step * 10, minimum, maximum));
      commit();
    }} />;
}
