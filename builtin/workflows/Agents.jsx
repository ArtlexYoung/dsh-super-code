import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  const [limit, setLimit] = useState(12), [query, setQuery] = useState(''), [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const all = useMemo(() => visibleAgentRows(view, () => true, view.nodes.size).rows, [view]);
  const { rows, more, empty } = filterAgentRows({ all, view, selected: agent.id, sessionId, query, limit });
  const catalogs = state.subagentsByParent;
  const watched = [...new Set([view.root, ...all.slice(0, limit).map(row => row.id), agent.id])].filter(id => id === view.root || view.nodes.get(id)?.hasChildren);
  const failed = error || watched.some(id => catalogs[id]?.state === 'error');
  const reload = async () => {
    setBusy(true); setError(false);
    try { await Promise.all(watched.map(id => agentActions.refresh(id))); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  return <>
    {agentActions && watched.map(id => <AgentCatalogWatch key={id} id={id} watchCatalog={agentActions.watch} />)}
    {(all.length > 1 || failed) && <section className="sc-flow-agents" aria-label={t('agents')}>
      <header><strong>Agent <small>{all.length}</small></strong>{all.length > 6 && <input type="search" aria-label={t('findAgent')} placeholder={t('findAgent')} value={query}
        onChange={event => { setQuery(event.target.value); setLimit(12); }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setQuery(''); } }} />}
        {agentActions && <button type="button" onClick={reload} disabled={busy} aria-label={t('refreshAgents')} title={t('refreshAgents')}>↻</button>}</header>
      {failed && <p role="alert">{t('agentsFailed')}</p>}
      <AgentNavigation rows={rows} view={view} agent={agent} select={select} sessionId={sessionId} t={t} detailT={detailT} />
      {empty && <p role="status">{t('noMatchingAgent')}</p>}
      {more && <button type="button" className="sc-flow-more-agents" onClick={() => setLimit(value => value + 24)}>{t('moreAgents')}</button>}
    </section>}
  </>;
}

function filterAgentRows({ all, view, selected, sessionId, query, limit }) {
  const term = query.trim().toLocaleLowerCase();
  const matches = all.filter(({ id }) => id === sessionId || `${view.nodes.get(id).title || ''} ${id}`.toLocaleLowerCase().includes(term));
  const rows = matches.slice(0, limit), chosen = all.find(row => row.id === selected);
  if (!term && chosen && !rows.includes(chosen)) rows.push(chosen);
  return { rows, more: matches.length > limit, empty: Boolean(term) && matches.every(row => row.id === sessionId) };
}

function AgentNavigation({ rows, view, agent, select, sessionId, t, detailT }) {
  const navigation = useRef(null);
  const identities = JSON.stringify(rows.map(row => row.id));
  useLayoutEffect(() => {
    const element = navigation.current, selected = element.querySelector('[aria-pressed=true]');
    if (!selected) return;
    const outer = element.getBoundingClientRect(), inner = selected.getBoundingClientRect();
    if (inner.left < outer.left) element.scrollLeft -= outer.left - inner.left;
    if (inner.right > outer.right) element.scrollLeft += inner.right - outer.right;
  }, [agent.id, identities]);
  const focusId = rows.some(row => row.id === agent.id) ? agent.id : sessionId;
  const move = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(event.target);
    const next = { Home: 0, End: buttons.length - 1, ArrowLeft: Math.max(0, index - 1), ArrowRight: Math.min(buttons.length - 1, index + 1) }[event.key];
    buttons[next]?.focus({ preventScroll: true }); buttons[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  return <nav ref={navigation} aria-label={t('agents')} onKeyDown={move}>{rows.map(({ id, level }) => {
    const node = view.nodes.get(id), status = agentExecutionStatus(node, id === view.root, detailT);
    return <button type="button" key={id} disabled={node.unavailable} tabIndex={id === focusId ? 0 : -1} aria-pressed={id === agent.id} data-agent-id={id} onClick={() => select(node)} title={node.title || node.displayTitle || id}>
      <span className="sc-flow-agent-name">{level > 1 && <span aria-hidden="true">{'↳ '.repeat(Math.min(level - 1, 3))}</span>}{id === sessionId ? t('inlineChat') : node.title || node.displayTitle || id}</span>
      <small data-tone={status.tone}>{status.label}</small>
    </button>;
  })}</nav>;
}
