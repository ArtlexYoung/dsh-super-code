/** Global registration with per-preset eligibility; no shell rewriting or remembered grants. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { configurationOf, deletionProtectionMode } from './budgets.js'
import type { DeletionProtectionMode } from './budgets.js'
import { deletionCommand } from '../core/deletion-command.js'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'dsh-super-code/deletion-protection': { kind: 'dsh-super-code/deletion-protection' } }
}

export const DELETION_INSTRUCTION: string = '删除文件或目录默认用 trash <path>（可恢复）；仅清理临时文件、构建产物且我已确认时才用 rm。脚本、内联脚本和间接调用也不允许直接使用 rm 或其他永久删除命令，不得用脚本绕过删除保护；同样优先移动到回收站。确需清理临时文件或构建产物时，必须对具体命令和路径取得用户二次确认，仅对当前调用有效。trash 不可用时，改用其他可恢复的回收站方式或先停止，不得静默退回 rm。\nUse trash <path> (recoverable) by default for files and directories. Use rm only to clean temporary files or build artifacts after the user explicitly confirms the exact operation. Scripts, inline scripts, and indirect invocations must also avoid rm or other permanent deletion commands; never use a script to bypass this protection. Prefer a recoverable trash mechanism. An exception requires a separate user confirmation for this exact command and its paths, valid for this call only. If trash is unavailable, use another recoverable trash mechanism or stop; never silently fall back to rm.'

export const RELAXED_DELETION_INSTRUCTION: string = '删除文件或目录默认用 trash <path>（可恢复）；仅清理临时文件、构建产物且我已确认时才用 rm。脚本、内联脚本和间接调用中也建议使用 trash 等可恢复命令，尽量避免 rm。当前为宽松模式：用户已明确说明需要使用 rm 时，可以按用户指定的范围使用，包括在脚本中使用；该明确要求可作为确认，无需本插件额外二次确认。用户没有明确要求时，不要自行改用永久删除。宿主原有权限检查仍然有效。\nUse trash <path> (recoverable) by default for files and directories; use rm for temporary files or build artifacts after confirmation. Scripts, inline scripts, and indirect calls should also prefer recoverable trash commands and avoid rm when possible. In relaxed mode, an explicit user request to use rm is sufficient confirmation within the requested scope, including in scripts; this plugin requires no additional confirmation. Without an explicit request, do not silently switch to permanent deletion. Host permission checks still apply.'

function instruction(mode: DeletionProtectionMode): string {
  return mode === 'strict' ? DELETION_INSTRUCTION : mode === 'relaxed' ? RELAXED_DELETION_INSTRUCTION : ''
}

const corrective = 'SUPER_CODE_DELETE_PROTECTED: 已拦截永久删除命令。请使用 trash <path> 等可恢复的回收站命令，脚本也不得绕过。仅清理临时文件或构建产物且用户对当前命令二次确认后才可执行。\nPermanent deletion blocked. Use trash <path> or another recoverable trash command, including in scripts. Only temporary/build cleanup with a separate one-time user confirmation may proceed.'
const official = new Set(['standard', 'ptc', 'minimal', 'cordis'])
interface Presets { composedPreset(ctx: Context): string | undefined }
interface Approver {
  request(request: { agent: Agent; toolName: string; callId: ToolExecution['callId']; reason: string; signal: AbortSignal }): Promise<string>
}

export function applyDeletionProtection(ctx: Context): void {
  ctx.inject(['tools', 'systemPrompt'], owner => {
    const modeFor = (agent?: Agent): DeletionProtectionMode => {
      const config = configurationOf(owner)
      const mode = deletionProtectionMode(config)
      if (mode === 'off' || !agent) return 'off'
      if (owner.tools.get('super_code_task', agent)) return mode
      const presets = owner.get('agentPresets') as Presets | undefined
      return config.deletionProtectionForOfficialPresets === true && !!presets && official.has(presets.composedPreset(agent.ctx) ?? '') ? mode : 'off'
    }
    owner.systemPrompt.section({ name: 'super-code:deletion-protection', order: 95,
      text: ({ agent }) => instruction(modeFor(agent)) })
    // Minimal owns a complete system prompt and suppresses global context.
    // Use its public pre-step message seam so the policy remains logged and replayable.
    const minimalNotices = new WeakMap<Agent, DeletionProtectionMode>()
    owner.on('agent/pre-step', async ({ agent }, next) => {
      const result = await next()
      const presets = owner.get('agentPresets') as Presets | undefined
      if (result.kind !== 'enter' || presets?.composedPreset(agent.ctx) !== 'minimal') return result
      const mode = modeFor(agent), previous = minimalNotices.get(agent)
      if (previous === mode || mode === 'off' && previous === undefined) return result
      minimalNotices.set(agent, mode)
      const notice = createUserMessage({ source: { kind: 'dsh-super-code/deletion-protection' }, content: [{ type: 'text',
        text: mode === 'off' ? '此预设的删除保护已关闭，先前的删除保护提示不再适用；宿主自身权限检查仍然有效。\nDeletion protection is now disabled for this preset. Earlier deletion-protection notices no longer apply; host permission checks still apply.'
          : (previous === undefined ? '' : '删除保护模式已切换，以下规则取代先前的删除保护规则。\nThe deletion-protection mode has changed; the following rules replace earlier deletion-protection instructions.\n') + instruction(mode),
      }] })
      return { ...result, messages: [...result.messages, notice] }
    })
    owner.on('tools/execute', async (exec, next) => {
      if (modeFor(exec.agent) !== 'strict' || !['bash', 'pwsh'].includes(exec.name)) return next()
      const args = exec.arguments as { command?: unknown; workdir?: unknown } | null
      if (typeof args?.command !== 'string' || !deletionCommand(args.command, exec.name === 'pwsh')) return next()
      exec.signal.throwIfAborted()
      const approval = owner.get('approval') as Approver | undefined
      if (!approval || !exec.agent) throw new Error(corrective + '\n当前宿主无可用确认渠道，命令未执行。 No approval channel is available; nothing ran.')
      const reason = `删除保护：建议改用 trash。仅在本次操作是临时文件或构建产物清理时，确认以下命令的永久删除；其他文件请选择拒绝。\nDeletion protection: prefer trash. Approve permanent deletion only for temporary files or build artifacts in this exact call; reject other deletions.\n${typeof args.workdir === 'string' ? `工作目录 / Workdir: ${args.workdir}\n` : ''}${args.command}`
      let outcome: string
      try { outcome = await approval.request({ agent: exec.agent, toolName: exec.name, callId: exec.callId, reason, signal: exec.signal }) }
      catch { throw new Error(corrective + '\n确认渠道不可用，命令未执行。 Approval failed; nothing ran.') }
      exec.signal.throwIfAborted()
      if (outcome !== 'allowed-once') throw new Error(corrective + `\n确认结果 / Approval: ${outcome}`)
      return next()
    })
  })
}
