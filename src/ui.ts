/** Host-neutral page integration for dsh-super-agent. */
export type ModelTier = 'high' | 'normal' | 'low'
export interface ModelOption { id: string; strengths?: readonly string[]; available?: boolean }
export interface ModelPoolConfig { high: readonly ModelOption[]; normal: readonly ModelOption[]; low: readonly ModelOption[] }
export interface SuperAgentSettings { modelPools: ModelPoolConfig; tokenStats: boolean }
export interface TokenUsage { model: string; cacheHit: number; uncachedInput: number; cacheRead: number; output: number }
export interface AgentNode { id: string; label: string; parentId?: string; status?: 'idle'|'running'|'done'|'failed'; conversation?: readonly unknown[] }

const tierRank: Record<ModelTier, number> = { low: 0, normal: 1, high: 2 }
/** Select an available model, promoting to stronger tiers when necessary. */
export function selectModel(pool: ModelPoolConfig, tier: ModelTier, difficulty = 0.5): ModelOption | undefined {
  const strengths = (m: ModelOption) => m.strengths?.[Math.min(m.strengths.length - 1, Math.max(0, Math.round(difficulty * ((m.strengths?.length ?? 1) - 1))))]
  for (let rank = tierRank[tier]; rank <= tierRank.high; rank++) {
    const key = (['low', 'normal', 'high'] as ModelTier[]).find(k => tierRank[k] === rank)!
    const found = pool[key].find(m => m.available !== false && (m.strengths === undefined || strengths(m) !== undefined))
    if (found) return found
  }
  return undefined
}

export interface TokenSummary { total: number; averageCacheHitRate: number; details: { cacheHit: number; uncachedInput: number; cacheRead: number; output: number } }
export function summarizeTokens(usages: readonly TokenUsage[]): TokenSummary {
  const total = usages.reduce((n, u) => n + u.cacheHit + u.uncachedInput + u.cacheRead + u.output, 0)
  const input = usages.reduce((n, u) => n + u.cacheHit + u.uncachedInput + u.cacheRead, 0)
  const cache = usages.reduce((n, u) => n + u.cacheHit, 0)
  return { total, averageCacheHitRate: input ? cache / input : 0, details: { cacheHit: cache, uncachedInput: usages.reduce((n,u)=>n+u.uncachedInput,0), cacheRead: usages.reduce((n,u)=>n+u.cacheRead,0), output: usages.reduce((n,u)=>n+u.output,0) } }
}

/** Dynamic preset injection: derives entries from the host roster at runtime. */
export function injectPresets<T extends { id: string }>(roster: readonly T[], presets: readonly T[]): T[] {
  const ids = new Set(roster.map(p => p.id));
  return [...roster, ...presets.filter(p => !ids.has(p.id))]
}

export function buildAgentTree(nodes: readonly AgentNode[]): unknown[] {
  const children = new Map<string | undefined, AgentNode[]>()
  for (const node of nodes) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node])
  const walk = (parentId?: string): unknown[] => (children.get(parentId) ?? []).map(node => ({ ...node, children: walk(node.id) }))
  return walk()
}
