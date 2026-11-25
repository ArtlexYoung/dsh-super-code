import React, { useRef, useState } from 'react';
import { EditorPane, openGroupTab } from './EditorPane.jsx';
import { groupRect } from '../editor/groups.js';

const DROP_EDGE = .2, DIVIDER_STEP = .05;

function edgeAt(area, x, y) {
  const { left, top, width, height } = area.getBoundingClientRect();
  const u = (x - left) / width, v = (y - top) / height;
  if (v >= DROP_EDGE && v <= 1 - DROP_EDGE) {
    if (u < DROP_EDGE) return 'left';
    if (u > 1 - DROP_EDGE) return 'right';
  }
  if (u >= DROP_EDGE && u <= 1 - DROP_EDGE) {
    if (v < DROP_EDGE) return 'up';
    if (v > 1 - DROP_EDGE) return 'down';
  }
  return null;
}

export function useTabLayout(groups, openWindow, canSplit) {
  const [drop, setDrop] = useState(null);
  function targetAt(origin, event, hit) {
    if (!canSplit) return { type: 'window' };
    const element = hit?.closest('[data-editor-group]');
    const pane = groups.snapshot().panes.find(({ pane }) => pane.id === Number(element?.dataset.editorGroup))?.pane;
    if (pane) {
      const area = hit.closest('.sc-wb-editor-area');
      const direction = area && edgeAt(area, event.clientX, event.clientY);
      if (direction) return { type: 'split', pane, direction };
      if (pane !== origin) return { type: 'move', pane };
    }
    return { type: 'window' };
  }
  function detach(pane, item) {
    openWindow?.({ kind: 'file', file: item.path, editorKind: item.kind, markdownSplit: !!pane.previews?.has(item.path) });
  }
  function split(origin, item, direction, destination = origin, moving = false) {
    const { file, editorKind, cursor, tabs } = origin.workbench.snapshot();
    groups.split(destination, direction, {
      item: { ...item, cursor: file === item.path && editorKind === item.kind ? cursor : undefined },
      preview: !!origin.previews?.has(item.path),
      async opened(pane) {
        if (moving && (origin !== destination || tabs.length > 1)) await origin.workbench.closeFile(item.path, 'move', item.kind);
        groups.activate(pane);
        if (item.kind === 'file') pane.workbench.view()?.focus();
      },
      fail: origin.workbench.fail,
    });
  }
  return {
    drop, split, detach,
    drag(pane) {
      return {
        dragging: !!drop,
        targetAt: (event, hit) => targetAt(pane, event, hit),
        moved(next) { setDrop(current => current?.type === next.type && current.pane === next.pane && current.direction === next.direction ? current : next); },
        end() { setDrop(null); },
        drop(target, item) {
          if (target.type === 'split') split(pane, item, target.direction, target.pane, true);
          if (target.type === 'move') void (async () => {
            if (!await openGroupTab(target.pane, item)) return;
            await pane.workbench.closeFile(item.path, 'move', item.kind);
            groups.activate(target.pane);
            if (item.kind === 'file') target.pane.workbench.view()?.focus();
          })().catch(pane.workbench.fail);
          if (target.type === 'window') detach(pane, item);
        },
      };
    },
  };
}

function Divider({ node, rect, resize, t }) {
  const gesture = useRef(null), vertical = node.vertical;
  const position = (vertical ? rect.top : rect.left) + (vertical ? rect.height : rect.width) * node.ratio;
  const box = groupRect(vertical ? { ...rect, top: position, height: 0 } : { ...rect, left: position, width: 0 });
  const coordinate = vertical ? 'clientY' : 'clientX';
  return <div className="sc-wb-editor-divider" data-vertical={vertical} style={box} role="separator" tabIndex={0}
    aria-label={t(vertical ? 'resizeEditorHeight' : 'resizeEditorWidth')} aria-orientation={vertical ? 'horizontal' : 'vertical'}
    aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(node.ratio * 100)}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const parent = event.currentTarget.parentElement.getBoundingClientRect();
      gesture.current = { coordinate: event[coordinate], ratio: node.ratio, length: vertical ? parent.height * rect.height : parent.width * rect.width };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      const start = gesture.current;
      if (start?.length) resize(node, start.ratio + (event[coordinate] - start.coordinate) / start.length);
    }} onLostPointerCapture={() => { gesture.current = null; }}
    onDoubleClick={() => resize(node, .5)} onKeyDown={event => {
      const keys = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
      if (!keys.includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      resize(node, node.ratio + (event.key === keys[0] ? -DIVIDER_STEP : DIVIDER_STEP));
    }} />;
}

export function EditorGroups({ groups, layout, tabLayout, canSplit, t, ...props }) {
  const { active, panes, dividers, parked } = layout;
  return <main className="sc-wb-code" data-split={panes.length > 1}>
    {(parked ? [parked, ...panes] : panes).map(({ pane, rect, hidden }) => <EditorPane key={pane.id} pane={pane} rect={rect} groups={groups} active={pane === active} hidden={hidden} t={t}
      drag={tabLayout.drag(pane)} drop={tabLayout.drop?.pane === pane ? tabLayout.drop : null} split={canSplit} {...props} />)}
    {dividers.map(({ node, rect }) => <Divider key={node.id} node={node} rect={rect} resize={groups.resize} t={t} />)}
  </main>;
}
