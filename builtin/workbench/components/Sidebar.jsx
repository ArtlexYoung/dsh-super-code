import React, { useRef } from 'react';
import { resizeSidebar, sidebarMinimum } from '../layout.js';
import { FileChanges } from '../git/Changes.jsx';
import { QuickConversations } from './QuickConversations.jsx';
import { Icon } from './Icon.jsx';
import { message } from '../locales.js';

export const rightPanels = [
  { key: 'conversation', label: 'conversation', icon: 'conversation' },
  { key: 'quick', label: 'quickConversations', icon: 'quick' },
  { key: 'changes', label: 'changesTitle', icon: 'changes' },
  { key: 'learning', label: 'readingTitle', icon: 'reading' },
];

export function Sidebar({ workbench, Button, Select, t, layout, changeLayout, persistLayout, conversation, learning, open, toggle, expandedPane, expand, items, hidden, id }) {
  const root = useRef(null), gesture = useRef(null);
  const keys = rightPanels.map(panel => panel.key), active = keys.filter(key => open[key]);
  const labels = Object.fromEntries(rightPanels.map(panel => [panel.key, t(panel.label)]));
  const geometry = (first, second) => ({
    before: root.current.querySelector(`[data-pane="${first}"]`).getBoundingClientRect().height,
    after: root.current.querySelector(`[data-pane="${second}"]`).getBoundingClientRect().height,
  });
  const resize = (first, second, value, sizes = layout.right) => changeLayout({ right: resizeSidebar(sizes, first, second, value) });
  const finish = event => {
    if (!gesture.current) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    persistLayout();
  };
  return <aside ref={root} className="sc-wb-right" hidden={hidden} style={{ '--wb-pane-min-height': `${sidebarMinimum}px` }}>{keys.map(key => {
    const next = !expandedPane && open[key] ? active[active.indexOf(key) + 1] : null;
    const enlarged = expandedPane === key;
    const enlargeLabel = message(t, enlarged ? 'restoreToolArea' : 'expandToolArea', { name: labels[key] });
    return <React.Fragment key={key}><section id={`${id}-${key}`} className="sc-wb-right-pane" data-pane={key} data-open={open[key]} hidden={!open[key] || Boolean(expandedPane && !enlarged)}
      style={{ flex: `${layout.right[key]} 1 0px` }}>
      {key === 'quick' ? <QuickConversations items={items} workbench={workbench} Button={Button} t={t} open={open.quick} toggle={() => toggle(key)} />
        : key === 'changes' ? <FileChanges workbench={workbench} Button={Button} Select={Select} t={t} expanded={open.changes} toggle={() => toggle(key)} />
        : <><Button className="sc-wb-section" aria-expanded={open[key]} aria-controls={`${id}-${key}-content`} title={labels[key]}
          onClick={() => toggle(key)}><Icon name="chevron" /><strong>{labels[key]}</strong></Button>
          <div id={`${id}-${key}-content`} hidden={!open[key]} className="sc-wb-right-content">{key === 'conversation' ? conversation : learning}</div></>}
      {active.length > 1 && <Button className="sc-wb-pane-expand" aria-pressed={enlarged} title={enlargeLabel} aria-label={enlargeLabel} onClick={() => expand(enlarged ? null : key)}><Icon name={enlarged ? 'restore' : 'maximize'} /></Button>}
    </section>{open[key] && next && <div className="sc-wb-splitter sc-wb-splitter-rows" role="separator" tabIndex={0}
      aria-orientation="horizontal" aria-label={`${t('resizeSections')} · ${labels[key]}`}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(100 * layout.right[key] / (layout.right[key] + layout.right[next]))}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        gesture.current = { position: event.clientY, ...geometry(key, next), sizes: layout.right };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event => {
        const start = gesture.current;
        if (start) resize(key, next, { ...start, delta: event.clientY - start.position }, start.sizes);
      }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const pair = geometry(key, next);
        resize(key, next, { ...pair, delta: event.key === 'Home' ? -pair.before : event.key === 'End' ? pair.after : event.key === 'ArrowUp' ? -10 : 10 });
        persistLayout();
      }} />}</React.Fragment>;
  })}</aside>;
}
