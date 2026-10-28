/** Optional public answerer seam; host policy and durable approval audit stay authoritative. */
import type { Context } from '@deepseek-ai/cordis'
import { scopeChainOf } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ConnectionService } from '../connection/service.js'
import type { ApprovalOutcome } from '../connection/approvals.js'

interface ApprovalRequest { agent: Agent; toolName: string; callId?: string; reason?: string; signal?: AbortSignal }
interface ActiveCall { callId: string; toolName: string; arguments: string | false }

function serializedArguments(value: unknown): string | false {
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' && text.length <= 16000 ? text : false
  } catch { return false }
}

export function applyConnectionApproval(ctx: Context, current: () => ConnectionService | false): void {
  const active = new WeakMap<Agent, Set<ActiveCall>>()
  ctx.inject(['tools'], owner => {
    owner.on('tools/execute', async (exec, next) => {
      if (!exec.agent) return next()
      const agent = exec.agent, calls = active.get(agent) ?? new Set<ActiveCall>()
      const call: ActiveCall = { callId: exec.callId, toolName: exec.name, arguments: serializedArguments(exec.arguments) }
      active.set(agent, calls); calls.add(call)
      try { return await next() }
      finally { calls.delete(call); if (!calls.size) active.delete(agent) }
    }, { prepend: true })
  })
  ctx.on('approval/request', async (request: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> => {
    const service = current()
    if (!service || !service.read().configuration.allowCallerApproval) return next()
    const roots = scopeChainOf(request.agent).flatMap(key => {
      const id = (key as Partial<Agent>).session?.id
      return typeof id === 'string' ? [id] : []
    })
    // A seed parentSession alone does not authorize a fork. Only the live scope ancestry counts.
    let argumentsText = ''
    if (request.callId) {
      // PTC sub-calls have no native tool/call event. Bind the actual live
      // execution instead of relying on a journal version or an ID prefix.
      const calls = [...active.get(request.agent) ?? []].filter(call => call.callId === request.callId && call.toolName === request.toolName)
      if (calls.length) {
        if (calls.length !== 1 || calls[0]!.arguments === false) return next()
        argumentsText = calls[0]!.arguments
      } else {
        const events = request.agent.session.ownEvents()
        let found = false
        for (let index = events.length - 1; index >= 0; index--) {
          const event = events[index]!
          if (event.type === 'tool/call' && event.data.callId === request.callId && event.data.name === request.toolName) { argumentsText = event.data.arguments; found = true; break }
        }
        if (!found) return next()
      }
    }
    const answer = await service.requestApproval({ sessionId: request.agent.session.id, toolName: request.toolName,
      ...(request.callId ? { callId: request.callId } : {}), reason: request.reason ?? '', arguments: argumentsText }, roots, request.signal)
    if (request.signal?.aborted) return 'cancelled'
    return answer === 'host' ? next() : answer
  }, { prepend: true })
}
