const subscriptions = new WeakMap();

// The host accepts a boolean; multiple plugin views may consume the same catalog.
export function watchAgentCatalog(sessions, id, open) {
  // Cordis binds a different service proxy in each consumer; the list store is shared.
  const owner = sessions.list;
  let counts = subscriptions.get(owner);
  if (!counts) { counts = new Map(); subscriptions.set(owner, counts); }
  const previous = counts.get(id) || 0, next = Math.max(0, previous + (open ? 1 : -1));
  if (next) counts.set(id, next);
  if (!next) counts.delete(id);
  if (Boolean(previous) === Boolean(next)) return;
  if (sessions.setSubagentCatalogOpen) { sessions.setSubagentCatalogOpen(id, next > 0); return; }
  if (next) void sessions.refreshProjections(id).catch(error => console.warn('Super Code projections:', error));
}
