import React, { useEffect, useRef, useState } from 'react';
import { commandDraft, skillAvailability } from './model.js';

export const draftLocked = input => input.phase !== 'plain' || input.attachmentIds?.length > 0 || input.occurrences?.length > 0;

function PreparedCommand({ skill, availability, api, sessionId, useInput, inputActions, openView, context, beforeInsert, onUsed, t, label = t('use'), hint = true, className = 'sc-flow-primary' }) {
  const input = useInput(state => state), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const latest = useRef(input), lifetime = useRef(null);
  latest.current = { input, context, beforeInsert, onUsed };
  useEffect(() => { const abort = new AbortController(); lifetime.current = abort; return () => abort.abort(); }, []);
  const locked = draftLocked(input);
  const insert = async () => {
    setBusy(true); setError('');
    try {
      const response = await api.list({ sessionId }, lifetime.current.signal);
      if (lifetime.current.signal.aborted) return;
      if (!response.ok || skillAvailability(skill, response.value.skills) !== 'ready') throw new Error('Unavailable');
      const { input: current, context: currentContext, beforeInsert: prepare, onUsed: used } = latest.current;
      if (draftLocked(current)) throw new Error('Draft is busy');
      if (prepare?.() === false) return;
      inputActions.setDraft(commandDraft(skill, current.draft, currentContext));
      used(); openView('chat', '');
    } catch { if (!lifetime.current.signal.aborted) setError(t('draftFailed')); }
    finally { if (!lifetime.current.signal.aborted) setBusy(false); }
  };
  return <><button type="button" className={className} title={t(locked ? 'richDraft' : 'draftHint')} disabled={availability !== 'ready' || locked || busy} onClick={insert}>{label}</button>
    {hint && <p className="sc-flow-note">{t(locked ? 'richDraft' : 'draftHint')}</p>}{error && <p role="alert">{error}</p>}</>;
}


export function Compose(props) {
  if (!props.useInput || !props.inputActions) return <button type="button" className={props.className || 'sc-flow-primary'} disabled>{props.label || props.t('use')}</button>;
  return <PreparedCommand {...props} />;
}
