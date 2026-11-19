import React, { useLayoutEffect, useRef, useState } from 'react';

export function FileList({ items, rowHeight, className = '', children, visible, id, focusKey }) {
  const viewport = useRef(null), [top, setTop] = useState(0), [height, setHeight] = useState(400);
  const follow = useRef({ key: null, index: -1 });
  const start = Math.min(Math.max(0, Math.floor(top / rowHeight) - 4), Math.max(0, items.length - 1));
  const end = Math.min(items.length, start + Math.ceil(height / rowHeight) + 8);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { setTop(viewport.current.scrollTop); }, [items.length]);
  useLayoutEffect(() => {
    const index = focusKey ? items.findIndex(item => item.key === focusKey) : -1, node = viewport.current;
    if (follow.current.key === focusKey && follow.current.index === index) return;
    if (index >= 0) {
      if (!node.clientHeight) return;
      const y = index * rowHeight;
      if (y < node.scrollTop || y + rowHeight > node.scrollTop + node.clientHeight) {
        node.scrollTop = Math.max(0, y - (node.clientHeight - rowHeight) / 2);
        setTop(node.scrollTop);
      }
    }
    follow.current = { key: focusKey, index };
  }, [focusKey, items, rowHeight, height]);
  useLayoutEffect(() => { visible?.(items.slice(start, end)); }, [items, start, end, visible]);
  return <div id={id} ref={viewport} className={`sc-wb-git-file-list ${className}`} onScroll={event => setTop(event.currentTarget.scrollTop)}>
    <div style={{ height: start * rowHeight }} aria-hidden />
    {items.slice(start, end).map((item, index) => <div key={item.key} style={{ height: rowHeight }}>{children(item, start + index)}</div>)}
    <div style={{ height: (items.length - end) * rowHeight }} aria-hidden />
  </div>;
}
