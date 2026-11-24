import React, { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';

let context;
function destinationContext() { return context ??= createContext(null); }

export function ReplyDestination({ register, children }) {
  const Context = destinationContext();
  return <Context.Provider value={register}>{children}</Context.Provider>;
}

// The visible editor owns its draft. Register its actions without exposing the
// page's storage shape or registering again on every keystroke.
export function useReplyDestination({ id, title, value, update, t }) {
  const register = useContext(destinationContext()), field = useRef(null), latest = useRef(null);
  const [notice, setNotice] = useState('');
  useLayoutEffect(() => { latest.current = { value, update, t }; });
  useLayoutEffect(() => {
    setNotice('');
    if (!register) return;
    const destination = { id, title, append(citation) {
      const { value, update, t } = latest.current;
      const next = `${value}${value ? '\n\n' : ''}${citation}\n\n`;
      if (next.length > field.current.maxLength) return false;
      update(next); setNotice(t('excerptAdded')); return true;
    }, focus: expand => focusEditor(field, expand) };
    register(destination);
    return () => register(current => current === destination ? null : current);
  }, [register, id, title]);
  return { field, notice };
}

function focusEditor(field, expand) {
  const editor = field.current;
  if (!editor) return;
  const work = editor.closest('.sc-flows'), navigation = work.querySelector('.sc-flow-agents');
  const inset = (navigation?.offsetHeight || 0) + 24;
  if (editor.offsetHeight + inset > work.clientHeight) expand();
  requestAnimationFrame(() => {
    if (field.current !== editor) return;
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(editor.value.length, editor.value.length); editor.scrollTop = editor.scrollHeight;
    const bounds = work.getBoundingClientRect(), rect = editor.getBoundingClientRect();
    const scale = bounds.height / work.offsetHeight, top = bounds.top + inset * scale, bottom = bounds.bottom - 12 * scale;
    work.scrollTop += (rect.top < top ? rect.top - top : Math.max(0, rect.bottom - bottom)) / scale;
  });
}
