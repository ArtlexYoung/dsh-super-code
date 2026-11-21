import React, { useEffect, useRef, useState } from 'react';
import { commandDraft, skillAvailability } from './model.js';

function PreparedCommand({ skill, availability, api, sessionId, useInput, inputActions, openView, context, onUsed, t }) {
  const input = useInput(state => state), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const latest = useRef(input), lifetime = useRef(null);
  latest.current = input;
  useEffect(() => { const abort = new AbortController(); lifetime.current = abort; return () => abort.abort(); }, []);
  const locked = input.phase !== 'plain' || input.attachmentIds?.length > 0 || input.occurrences?.length > 0;
  const insert = async () => {
    setBusy(true); setError('');
    try {
      const response = await api.list({ sessionId }, lifetime.current.signal);
      if (lifetime.current.signal.aborted) return;
      if (!response.ok || skillAvailability(skill, response.value.skills) !== 'ready') throw new Error('Unavailable');
      const current = latest.current;
      if (current.phase !== 'plain' || current.attachmentIds?.length || current.occurrences?.length) throw new Error('Draft is busy');
      inputActions.setDraft(commandDraft(skill, current.draft, context));
      onUsed(); openView('chat', '');
    } catch { if (!lifetime.current.signal.aborted) setError(t('draftFailed')); }
    finally { if (!lifetime.current.signal.aborted) setBusy(false); }
  };
  return <><button type="button" className="sc-flow-primary" disabled={availability !== 'ready' || locked || busy} onClick={insert}>{t('use')}</button>
    <p className="sc-flow-note">{t('draftHint')}</p>
    {locked && <p className="sc-flow-note">{t('richDraft')}</p>}{error && <p role="alert">{error}</p>}</>;
}


export function Compose(props) {
  if (!props.useInput || !props.inputActions) return <button type="button" className="sc-flow-primary" disabled>{props.t('use')}</button>;
  return <PreparedCommand {...props} />;
}
