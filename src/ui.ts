/** Host-neutral page integration for dsh-super-agent. */
export type ModelTier = 'high' | 'normal' | 'low'
export interface ModelOption {
  id: string
  /** Provider id for a Host model route; omitted keeps legacy id-only configs valid. */
  provider?: string
  strengths?: readonly string[]
  /** Strength selected for this invocation from the configured strengths. */
  strength?: string
  available?: boolean
}
export interface ModelPoolConfig { high: readonly ModelOption[]; normal: readonly ModelOption[]; low: readonly ModelOption[] }
export interface TokenUsage { model: string; cacheHit: number; uncachedInput: number; cacheRead: number; output: number }
export interface AgentNode { id: string; label: string; parentId?: string; status?: 'idle'|'running'|'done'|'failed'; conversation?: readonly unknown[] }

const tierRank: Record<ModelTier, number> = { low: 0, normal: 1, high: 2 }
/** Select an available model, promoting to stronger tiers when necessary. */
export function selectModel(pool: ModelPoolConfig, tier: ModelTier, difficulty = 0.5): ModelOption | undefined {
  const strengths = (m: ModelOption): string | undefined => {
    if (m.strengths === undefined || m.strengths.length === 0) return undefined
    const index = Math.min(m.strengths.length - 1, Math.max(0, Math.round(difficulty * (m.strengths.length - 1))))
    return m.strengths[index]
  }
  for (let rank = tierRank[tier]; rank <= tierRank.high; rank++) {
    const key = (['low', 'normal', 'high'] as ModelTier[]).find(k => tierRank[k] === rank)!
    const found = pool[key].find(m => m.available !== false && (m.strengths === undefined || m.strengths.length === 0 || strengths(m) !== undefined))
    if (found === undefined) continue
    const strength = strengths(found)
    return strength === undefined ? { ...found } : { ...found, strength }
  }
  return undefined
}

export interface TokenSummary { total: number; averageCacheHitRate: number; details: { cacheHit: number; uncachedInput: number; cacheRead: number; output: number } }
/** Constant-space usage accumulation for a process serving long conversations. */
export class TokenCounter {
  private cached = 0
  private uncached = 0
  private reads = 0
  private output = 0

  add(usage: TokenUsage): void {
    for (const value of [usage.cacheHit, usage.uncachedInput, usage.cacheRead, usage.output]) {
      if (!Number.isFinite(value) || value < 0) throw new Error('Token usage must be finite and non-negative')
    }
    const next = [this.cached + Math.max(usage.cacheHit, usage.cacheRead), this.uncached + usage.uncachedInput, this.reads + usage.cacheRead, this.output + usage.output]
    if (next.some(value => !Number.isSafeInteger(value)) || !Number.isSafeInteger(next[0]! + next[1]! + next[3]!)) throw new Error('Token counters exceed safe integer capacity')
    ;[this.cached, this.uncached, this.reads, this.output] = next as [number, number, number, number]
  }

  summary(): TokenSummary {
    const input = this.cached + this.uncached
    return { total: input + this.output, averageCacheHitRate: input === 0 ? 0 : this.cached / input,
      details: { cacheHit: this.cached, uncachedInput: this.uncached, cacheRead: this.reads, output: this.output } }
  }
}

export function summarizeTokens(usages: readonly TokenUsage[]): TokenSummary {
  // `cacheHit` is the UI hit-rate bucket while `cacheRead` is the provider's
  // detailed read counter. Host adapters may report both for the same tokens,
  // so billing totals use the larger value instead of double-counting them.
  const cached = (u: TokenUsage): number => Math.max(u.cacheHit, u.cacheRead)
  const total = usages.reduce((n, u) => n + cached(u) + u.uncachedInput + u.output, 0)
  const input = usages.reduce((n, u) => n + cached(u) + u.uncachedInput, 0)
  const cache = usages.reduce((n, u) => n + cached(u), 0)
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
