import { useLayoutEffect, useSyncExternalStore } from 'react';

// Keep unfinished work when the host unmounts a conversation view. A client
// reload clears this memory; accepted outcomes still live in preferences.
const clients = new WeakMap();

export function pageMemory(api, sessionId, page) {
  if (!clients.has(api)) clients.set(api, new Map());
  const pages = clients.get(api), key = JSON.stringify([sessionId, page]);
  if (!pages.has(key)) pages.set(key, { fields: new Map(), scrollTop: 0 });
  return pages.get(key);
}

export function usePageState(memory, key, initial) {
  if (!memory.fields.has(key)) {
    let value = typeof initial === 'function' ? initial() : initial;
    const listeners = new Set();
    memory.fields.set(key, {
      snapshot: () => value,
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      set: update => { value = typeof update === 'function' ? update(value) : update; for (const listener of listeners) listener(); },
    });
  }
  const state = memory.fields.get(key);
  return [useSyncExternalStore(state.subscribe, state.snapshot), state.set];
}

export function usePageScroll(container, memory) {
  useLayoutEffect(() => {
    const element = container.current, position = memory.scrollTop;
    let restoring = position > 0;
    const observer = new ResizeObserver(() => {
      if (!restoring) return;
      element.scrollTop = position;
      if (element.scrollTop >= position - 1) { restoring = false; observer.disconnect(); }
    });
    const save = () => { if (!restoring) memory.scrollTop = element.scrollTop; };
    const cancel = () => { restoring = false; observer.disconnect(); };
    element.scrollTop = position;
    if (restoring) observer.observe(element.querySelector('.sc-flow-main'));
    element.addEventListener('scroll', save);
    for (const event of ['pointerdown', 'wheel', 'keydown', 'touchstart']) element.addEventListener(event, cancel, { passive: true });
    return () => {
      save(); observer.disconnect(); element.removeEventListener('scroll', save);
      for (const event of ['pointerdown', 'wheel', 'keydown', 'touchstart']) element.removeEventListener(event, cancel);
    };
  }, [container, memory]);
}
