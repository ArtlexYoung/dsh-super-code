/** Structural adapter over public host services, shared by supported v3/v4 journals. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ConnectionError } from '../connection/types.js'
import type { DelegationHost, HostObservation } from '../connection/types.js'
import type { PresetInstallationStatus } from './preset-installation.js'

interface HostAgent { status: string; cancel(cause: { kind: 'user' }, options: { keepInbox: boolean }): void }
interface SessionCut extends Disposable { events: readonly SessionEvent[]; inheritedEventCount: number }
interface Descendant { id: string; parentId: string; kind: string; mode?: string; activity?: string }
export interface ConnectionHostServices {
  presets: { status(): Promise<PresetInstallationStatus> }
  controller: {
    create(request: { sessionId: string; cwd: string; agentPreset: string }): Promise<{ sessionId: string; agentPreset?: string }>
    prompt(request: { sessionId: string; requestId: string; mode: 'queue'; content: { type: 'text'; text: string }[] }, signal: AbortSignal): Promise<unknown>
  }
  agents: { get(id: string): HostAgent | undefined }
  query: { observeSession(id: string, options: { projectionMode: 'none'; signal: AbortSignal }): Promise<SessionCut> }
  subagents: { listDescendants(id: string, signal?: AbortSignal): Promise<Descendant[]>;
    interrupt(id: string, authority: { kind: 'user'; parentSessionId: string }): Promise<unknown> }
}
interface SessionFacts { status: HostObservation['status']; output: string }
function record(value: unknown): Record<string, any> { return value && typeof value === 'object' ? value as Record<string, any> : {} }
/** Own events only; idle without a settled, admitted request is not a completed task. */
export function connectionSessionFacts(events: readonly SessionEvent[], agentStatus: string, requestId: string, cancelling = false): SessionFacts {
  let admitted = requestId === '', requestSeq = -1, endSeq = -1, reason = '', output = ''
  const approvals = new Set<string>(), external = new Set<string>()
  for (const event of events) {
    const data = record(event.data), type: string = event.type
    if (type === 'user/message' && data.source?.rpcId === requestId) { admitted = true; requestSeq = event.seq; output = '' }
    if (type === 'turn/start') { reason = ''; approvals.clear() }
    if (type === 'turn/end') { endSeq = event.seq; reason = data.reason?.kind ?? ''; approvals.clear() }
    if (type === 'approval/asked' && typeof data.id === 'string') approvals.add(data.id)
    if (type === 'approval/decided') approvals.delete(data.id)
    if (type === 'subagent/start' && data.runId) external.add(data.runId)
    if (type === 'subagent/end') external.delete(data.runId)
    if (type === 'assistant/message' && admitted && event.seq > requestSeq) {
      const content = data.message?.content ?? data.content
      if (Array.isArray(content)) {
        const text = content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
        if (text) output = text.slice(-12000)
      }
    }
  }
  if (approvals.size) return { status: 'waiting_confirmation', output }
  if (agentStatus === 'running' || external.size) return { status: agentStatus === 'missing' ? 'unavailable' : 'running', output }
  if (cancelling && agentStatus === 'idle') return { status: 'interrupted', output }
  if (!admitted || endSeq <= requestSeq || !reason) return { status: agentStatus === 'missing' ? 'unavailable' : 'running', output }
  if (reason === 'error' || reason === 'max-tokens') return { status: 'failed', output }
  if (['aborted', 'interrupted', 'forked'].includes(reason)) return { status: 'interrupted', output }
  if (reason === 'blocked') return { status: 'waiting_confirmation', output }
  return { status: reason === 'completed' ? 'finished' : 'unavailable', output }
}
export class ConnectionHost implements DelegationHost {
  constructor(private readonly services: ConnectionHostServices) {}
  async preset(): Promise<string> {
    const preset = await this.services.presets.status()
    if (!['available', 'installed'].includes(preset.state)) throw new ConnectionError('super-code-preset-unavailable')
    return preset.id
  }
  async create(sessionId: string, cwd: string, preset: string): Promise<void> {
    const created = await this.services.controller.create({ sessionId, cwd, agentPreset: preset })
    if (created.sessionId !== sessionId || created.agentPreset !== undefined && created.agentPreset !== preset) throw new ConnectionError('session-identity-mismatch')
  }
  async prompt(sessionId: string, requestId: string, prompt: string): Promise<void> {
    await this.services.controller.prompt({ sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: prompt }] }, new AbortController().signal)
  }
  private async facts(id: string, requestId: string, cancelling = false): Promise<SessionFacts> {
    const cut = await this.services.query.observeSession(id, { projectionMode: 'none', signal: AbortSignal.timeout(5000) })
    try { return connectionSessionFacts(cut.events.slice(cut.inheritedEventCount), this.services.agents.get(id)?.status ?? 'missing', requestId, cancelling) }
    finally { cut[Symbol.dispose]() }
  }
  async observe(sessionId: string, requestId: string, cancelling = false): Promise<HostObservation> {
    try {
      const root = await this.facts(sessionId, requestId, cancelling)
      const children = await this.services.subagents.listDescendants(sessionId, AbortSignal.timeout(5000))
      let status = root.status
      for (const child of children) {
        if (child.kind === 'diagnostic') { status = 'unavailable'; break }
        if (child.mode === 'external') continue // Root start/end run facts track these activations.
        const facts = await this.facts(child.id, '', cancelling)
        if (facts.status === 'waiting_confirmation') { status = 'waiting_confirmation'; break }
        if (facts.status === 'unavailable') { status = 'unavailable'; break }
        if (facts.status === 'running' && status !== 'waiting_confirmation') status = 'running'
      }
      return { status, output: root.output, detail: status === 'finished' ? 'Root and managed descendants settled. Acceptance has not been verified.'
        : status === 'waiting_confirmation' ? 'Resolve the pending permission or blocked turn in DSH.' : `DSH task tree: ${status}.` }
    } catch { return { status: 'unavailable', output: '', detail: 'Could not observe the complete DSH task tree. No request was replayed.' } }
  }
  async cancel(sessionId: string): Promise<void> {
    // Clear queued follow-ups as well as aborting the root, so cancellation cannot wake another turn.
    this.services.agents.get(sessionId)?.cancel({ kind: 'user' }, { keepInbox: false })
    const children = await this.services.subagents.listDescendants(sessionId, AbortSignal.timeout(5000))
    for (const child of [...children].reverse()) {
      if (child.kind === 'diagnostic') throw new ConnectionError('cancellation-unconfirmed')
      const agent = this.services.agents.get(child.id)
      agent?.cancel({ kind: 'user' }, { keepInbox: false })
      if (child.mode === 'external' || agent?.status === 'running') {
        await this.services.subagents.interrupt(child.id, { kind: 'user', parentSessionId: child.parentId })
      }
    }
  }
}
