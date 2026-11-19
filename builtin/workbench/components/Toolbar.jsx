import React, { useLayoutEffect, useRef, useState } from 'react';
import { workbenchCommands } from '../commands.js';
import { keyOf, keyLabel } from '../editor/preferences.js';
import { toolbarActions } from '../toolbar.js';
import { Icon } from './Icon.jsx';

const WHEEL_LINE_PIXELS = 16;

export function Toolbar({ workbench, snapshot, current, Button, t }) {
  const scroll = useRef(null), [edges, setEdges] = useState({ overflow: false, start: true, end: true });
  useLayoutEffect(() => {
    const element = scroll.current;
    const measure = () => setEdges({ overflow: element.scrollWidth > element.clientWidth + 1, start: element.scrollLeft <= 1, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 });
    const observer = new ResizeObserver(measure);
    const wheel = event => {
      if (event.ctrlKey || element.scrollWidth <= element.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const unit = event.deltaMode === 1 ? WHEEL_LINE_PIXELS : event.deltaMode === 2 ? element.clientWidth : 1;
      const next = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, element.scrollLeft + delta * unit));
      if (next === element.scrollLeft) return;
      event.preventDefault(); event.stopPropagation(); element.scrollLeft = next;
    };
    observer.observe(element); observer.observe(element.firstElementChild);
    element.addEventListener('scroll', measure, { passive: true }); measure();
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('scroll', measure); element.removeEventListener('wheel', wheel); };
  }, []);
  const commands = workbenchCommands(workbench, snapshot, current, t);
  const shift = direction => scroll.current.scrollBy({ left: direction * Math.max(160, scroll.current.clientWidth * .7), behavior: 'smooth' });
  const renderAction = item => {
    const command = commands[item.id], label = item.id === 'window' && workbench.external ? 'windowReturn' : item.label;
    return <Button key={item.id} data-toolbar-action={item.id} title={t(item.title || label)} disabled={command.disabled}
      onClick={() => { void Promise.resolve().then(command.run).catch(workbench.fail); }}>
      {item.icon && <Icon name={item.icon} />}<span className="sc-wb-toolbar-label">{t(label)}</span>{snapshot.preferences.showToolbarShortcuts && item.shortcut && <kbd>{keyLabel(keyOf(snapshot.preferences, item.shortcut), t('space'))}</kbd>}
    </Button>;
  };
  return <header className="sc-wb-toolbar">
    <Button className="sc-wb-toolbar-arrow" title={t('toolbarScrollLeft')} hidden={!edges.overflow} disabled={edges.start} onClick={() => shift(-1)}><Icon name="scrollLeft" /></Button>
    <div ref={scroll} className="sc-wb-toolbar-scroll" role="toolbar" aria-label={t('toolbar')} tabIndex={0}>
      <div className="sc-wb-toolbar-content">{snapshot.preferences.toolbar.filter(item => item.visible).map(({ id }) => renderAction(toolbarActions.find(item => item.id === id)))}</div>
    </div>
    <Button className="sc-wb-toolbar-arrow" title={t('toolbarScrollRight')} hidden={!edges.overflow} disabled={edges.end} onClick={() => shift(1)}><Icon name="scrollRight" /></Button>
    <nav className="sc-wb-nav sc-wb-toolbar-fixed" aria-label={t('toolbarFixed')}>
      {toolbarActions.filter(item => item.fixed).map(renderAction)}
    </nav>
  </header>;
}
