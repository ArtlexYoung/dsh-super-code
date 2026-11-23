import React, { useMemo, useState } from 'react';
import { agentExecutionStatus, agentSessionState, buildAgentView, visibleAgentRows } from '../sidebar/agents.js';
import { AgentCatalogWatch } from '../sidebar/controls.js';
import { usePageState } from './page-state.js';

export function useWorkflowAgents({ useSessions, useSessionStatus, sessionId }, memory) {
  const catalog = useSessions(state => state), statuses = useSessionStatus ? useSessionStatus(state => state) : undefined;
  const state = useMemo(() => agentSessionState(catalog, sessionId, statuses), [catalog, sessionId, statuses]);
  const view = useMemo(() => buildAgentView(state), [state.byId, state.subagentsByParent, state.current, state.currentAddress]);
  const [selected, select] = usePageState(memory, 'agent', sessionId);
  const candidate = view.nodes.get(selected);
  const agent = candidate && !candidate.unavailable ? candidate : view.nodes.get(sessionId) || { id: sessionId };
  return { state, view, agent, select };
}

export function WorkflowAgents({ state, view, agent, select, sessionId, agentActions, t, detailT }) {
  const [limit, setLimit] = useState(12), [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const { rows, more } = useMemo(() => visibleAgentRows(view, () => true, limit), [view, limit]);
  const catalogs = state.subagentsByParent || {};
  const watched = rows.filter(({ id }) => id === view.root || view.nodes.get(id)?.hasChildren).map(row => row.id);
  const failed = error || watched.some(id => catalogs[id]?.state === 'error');
  const reload = async () => {
    setBusy(true); setError(false);
    try { await Promise.all(watched.map(id => agentActions.refresh(id))); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  return <>
    {agentActions && watched.map(id => <AgentCatalogWatch key={id} id={id} watchCatalog={agentActions.watch} />)}
    {(rows.length > 1 || failed) && <section className="sc-flow-agents" aria-label={t('agents')}>
      <header><strong>{t('agents')}</strong><span>{t('selectAgent')}</span>{agentActions && <button type="button" onClick={reload} disabled={busy}>{t('refreshAgents')}</button>}</header>
      {failed && <p role="alert">{t('agentsFailed')}</p>}
      <nav aria-label={t('agents')}>{rows.map(({ id, level }) => {
        const node = view.nodes.get(id), status = agentExecutionStatus(node, id === view.root, detailT);
        return <button type="button" key={id} disabled={node.unavailable} aria-pressed={id === agent.id} data-agent-id={id} onClick={() => select(node)} title={node.title || node.displayTitle || id}>
          <span className="sc-flow-agent-name">{level > 1 && <span aria-hidden="true">{'↳ '.repeat(Math.min(level - 1, 3))}</span>}{id === sessionId ? t('inlineChat') : node.title || node.displayTitle || id}</span>
          <small data-tone={status.tone}>{status.label}</small>
        </button>;
      })}</nav>
      {more && <button type="button" className="sc-flow-more-agents" onClick={() => setLimit(value => value + 24)}>{t('moreAgents')}</button>}
    </section>}
  </>;
}
