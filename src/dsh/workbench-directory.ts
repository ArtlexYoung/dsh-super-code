/** 会话头不可变：切换目录以续聊副本实现，原日志始终保留。 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { z } from 'zod'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { WorkbenchModel } from '../workbench/assistant.js'

interface Observation extends Disposable {
  header: SessionHeader
  events: readonly SessionEvent[]
  projections?: { values: { agentPreset?: string | null; modelSelection?: { pending?: WorkbenchModel | null } } }
}
interface Query { observeSession(id: string, options: { projectionMode: 'all'; signal: AbortSignal }): Promise<Observation> }
interface Controller { selectModel(request: WorkbenchModel & { sessionId: string }): Promise<unknown> }
interface Registry { list(): readonly { path: string; attachSession(id: SessionHeader['id']): Promise<void> }[] }
interface Subagents { listDescendants(id: string, signal: AbortSignal): Promise<{ id: string; kind: string }[]> }
export interface DirectoryState { state: 'available' | 'missing' | 'unset'; cwd: string; sequence: number }
const request = z.object({ path: z.string().min(1).max(4096).refine(path => !path.includes('\0')), sequence: z.number().int().nonnegative() }).strict()

export class WorkbenchDirectory {
  private readonly pending = new Map<string, Promise<{ sessionId: string }>>()
  constructor(private readonly ctx: Context) {}

  private async available(path: string, signal: AbortSignal): Promise<boolean> {
    try { return (await this.ctx.fs.stat(await this.ctx.fs.resolve(path, { signal }), signal))?.type === 'directory' }
    catch (error) {
      if (['ENOENT', 'ENOTDIR', 'FS_NOT_FOUND'].includes((error as { code?: string }).code || '')) return false
      throw error
    }
  }

  async status(id: string, signal: AbortSignal): Promise<DirectoryState> {
    const query = this.ctx.get('sessionQuery') as Query
    const source = await query.observeSession(id, { projectionMode: 'all', signal })
    try {
      const cwd = source.header.cwd || ''
      return { state: !cwd ? 'unset' : await this.available(cwd, signal) ? 'available' : 'missing', cwd, sequence: source.events.length }
    } finally { source[Symbol.dispose]() }
  }

  recover(id: string, content: unknown, signal: AbortSignal): Promise<{ sessionId: string }> {
    const input = request.parse(content), key = JSON.stringify([id, input.path, input.sequence])
    const existing = this.pending.get(key)
    if (existing) return existing
    const work = this.continue(id, input, signal).catch(error => { this.pending.delete(key); throw error })
    this.pending.set(key, work)
    return work
  }

  private async continue(id: string, input: z.infer<typeof request>, signal: AbortSignal): Promise<{ sessionId: string }> {
    const query = this.ctx.get('sessionQuery') as Query
    const source = await query.observeSession(id, { projectionMode: 'all', signal })
    try {
      if (source.events.length !== input.sequence) throw new Error('WORKBENCH_DIRECTORY_STALE')
      if (source.header.cwd && await this.available(source.header.cwd, signal)) throw new Error('WORKBENCH_DIRECTORY_AVAILABLE')
      if (source.header.origin === 'subagent') throw new Error('WORKBENCH_DIRECTORY_CHILD')
      const target = await this.ctx.fs.resolve(input.path, { signal })
      if ((await this.ctx.fs.stat(target, signal))?.type !== 'directory') throw new Error('WORKBENCH_DIRECTORY_TARGET')
      const cwd = this.ctx.fs.processPath(target), sessionId = SessionId(`session-${randomUUID()}`)
      let lastEnd = -1, lastStart = -1, config: SessionEvent | undefined, sandbox: SessionEvent | undefined
      const external = new Set<string>()
      for (let index = 0; index < source.events.length; index++) {
        const event = source.events[index]!
        if (event.type === 'turn/end') lastEnd = index
        if (event.type === 'turn/start') lastStart = index
        if (event.type === 'request/header') config = event
        if (event.type === 'sandbox/mode') sandbox = event
        const activation = event as { type: string; data: { runId?: string } }
        if (activation.type === 'subagent/start' && activation.data.runId) external.add(activation.data.runId)
        if (activation.type === 'subagent/end' && activation.data.runId) external.delete(activation.data.runId)
      }
      const subagents = this.ctx.get('subagents') as Subagents | undefined
      const children = subagents ? await subagents.listDescendants(id, signal) : []
      const assertIdle = () => {
        if (external.size || this.ctx.agents.get(SessionId(id))?.status === 'running' || lastStart > lastEnd
          || children.some(child => child.kind === 'diagnostic' || this.ctx.agents.get(SessionId(child.id))?.status === 'running')) throw new Error('WORKBENCH_DIRECTORY_BUSY')
        const live = this.ctx.sessions.get(SessionId(id))
        if (live && live.seq !== input.sequence) throw new Error('WORKBENCH_DIRECTORY_STALE')
      }
      assertIdle()
      const preset = await this.ctx.agentPresets.resolve(source.projections?.values.agentPreset ?? source.header.agentPreset)
      if (preset.broken) throw new Error('WORKBENCH_DIRECTORY_PRESET')
      const defaults = this.ctx.get('agentDefaultModel') as { currentSelection(): WorkbenchModel }
      const model = source.projections?.values.modelSelection?.pending ?? (config?.type === 'request/header' ? config.data.header.config : undefined) ?? defaults.currentSelection()
      const cut = lastEnd + 1, seed = source.events.slice(0, cut)
      const options = { sessionId, meta: { cwd, parentSession: source.header.id, isSeeded: cut > 0, agentPreset: preset.id },
        ...(cut > 0 ? { seed, inheritedEventCount: cut as SessionLogOffset } : {}),
        agentOptions: { provider: model.provider, model: model.model, reasoningEffort: model.reasoningEffort } as CreateAgentOptions['agentOptions'], signal,
        setup: async (owner: Context) => { await this.ctx.agentPresets.mount(owner, preset.id); assertIdle(); return { commit: assertIdle } },
      }
      signal.throwIfAborted()
      const handle = await this.ctx.agents.create(options)
      try {
        if (sandbox?.type === 'sandbox/mode' && sandbox.seq >= cut) setSandboxMode(handle.agent.session, sandbox.data.mode)
        await (this.ctx.get('sessionController') as Controller).selectModel({ sessionId, provider: model.provider, model: model.model, reasoningEffort: model.reasoningEffort })
        const registry = this.ctx.get('workspaceRegistry') as Registry | undefined
        if (registry) for (const workspace of registry.list()) {
          if (this.ctx.fs.processPath(await this.ctx.fs.resolve(workspace.path, { signal })) !== cwd) continue
          await workspace.attachSession(sessionId); break
        }
        // 不调用 prompt 或唤醒 inbox；用户在新目录中决定何时继续。
        await this.ctx.parallel('session/flush', handle.agent.session)
        return { sessionId }
      } catch (error) { await handle.dispose(); throw error }
    } finally { source[Symbol.dispose]() }
  }
}
