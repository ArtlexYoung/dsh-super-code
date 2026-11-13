import React, { useLayoutEffect, useRef, useState } from 'react';

export function FileList({ items, rowHeight, children }) {
  const viewport = useRef(null), [top, setTop] = useState(0), [height, setHeight] = useState(400);
  const start = Math.min(Math.max(0, Math.floor(top / rowHeight) - 4), Math.max(0, items.length - 1));
  const end = Math.min(items.length, start + Math.ceil(height / rowHeight) + 8);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { setTop(viewport.current.scrollTop); }, [items.length]);
  return <div ref={viewport} className="sc-wb-git-file-list" onScroll={event => setTop(event.currentTarget.scrollTop)}>
    <div style={{ height: start * rowHeight }} aria-hidden />
    {items.slice(start, end).map((item, index) => <div key={item.key} style={{ height: rowHeight }}>{children(item, start + index)}</div>)}
    <div style={{ height: (items.length - end) * rowHeight }} aria-hidden />
  </div>;
}
