const tierRank = { low: 0, normal: 1, high: 2 };
/** Select an available model, promoting to stronger tiers when necessary. */
export function selectModel(pool, tier, difficulty = 0.5) {
    const strengths = (m) => m.strengths?.[Math.min(m.strengths.length - 1, Math.max(0, Math.round(difficulty * ((m.strengths?.length ?? 1) - 1))))];
    for (let rank = tierRank[tier]; rank <= tierRank.high; rank++) {
        const key = ['low', 'normal', 'high'].find(k => tierRank[k] === rank);
        const found = pool[key].find(m => m.available !== false && (m.strengths === undefined || strengths(m) !== undefined));
        if (found)
            return found;
    }
    return undefined;
}
export function summarizeTokens(usages) {
    const total = usages.reduce((n, u) => n + u.cacheHit + u.uncachedInput + u.cacheRead + u.output, 0);
    const input = usages.reduce((n, u) => n + u.cacheHit + u.uncachedInput + u.cacheRead, 0);
    const cache = usages.reduce((n, u) => n + u.cacheHit, 0);
    return { total, averageCacheHitRate: input ? cache / input : 0, details: { cacheHit: cache, uncachedInput: usages.reduce((n, u) => n + u.uncachedInput, 0), cacheRead: usages.reduce((n, u) => n + u.cacheRead, 0), output: usages.reduce((n, u) => n + u.output, 0) } };
}
/** Dynamic preset injection: derives entries from the host roster at runtime. */
export function injectPresets(roster, presets) {
    const ids = new Set(roster.map(p => p.id));
    return [...roster, ...presets.filter(p => !ids.has(p.id))];
}
export function buildAgentTree(nodes) {
    const children = new Map();
    for (const node of nodes)
        children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
    const walk = (parentId) => (children.get(parentId) ?? []).map(node => ({ ...node, children: walk(node.id) }));
    return walk();
}
//# sourceMappingURL=ui.js.map