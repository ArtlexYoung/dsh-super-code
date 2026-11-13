/** 代码工作台的公开 Remote 边界，身份与工作目录由宿主会话决定。 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { WorkbenchFiles, MAX_FILE_BYTES } from '../workbench/files.js'
import type { WorkbenchEntry, WorkbenchFile, WorkbenchRoot } from '../workbench/files.js'
import { parseAssistant, assistantRequest, assistantResponse } from '../workbench/assistant.js'
import type { AssistantResult, WorkbenchModel } from '../workbench/assistant.js'

const sessionSchema = z.string().min(1).max(256)
const requestSchema = z.string().max(2 * 1024 * 1024 + 16000)
const saveRequestSchema = z.string().max(MAX_FILE_BYTES * 6 + 16384)
const ASSISTANT_TIMEOUT_MS = 10 * 60 * 1000

export class SuperCodeWorkbench extends TypertRemoteService {
  private readonly files: WorkbenchFiles
  private readonly lifetime = new AbortController()

  constructor(ctx: Context) {
    super(ctx, 'superCodeWorkbench')
    this.files = new WorkbenchFiles(ctx.fs, id => this.rootOf(id))
    ctx.effect(() => () => { this.lifetime.abort() })
  }

  private async sessionOf(sessionId: string): Promise<Session> {
    const id = SessionId(sessionSchema.parse(sessionId))
    const session = this.ctx.sessions.get(id)
    if (!session) throw new Error('WORKBENCH_SESSION')
    return session
  }

  private async rootOf(sessionId: string): Promise<WorkbenchRoot> {
    const session = await this.sessionOf(sessionId)
    if (!session.header.cwd) throw new Error('WORKBENCH_WORKSPACE')
    return { cwd: session.header.cwd, policy: this.ctx.get('sandboxPolicy')?.resolve({ session }) }
  }

  private modelOf(session: Session): WorkbenchModel {
    const projections = this.ctx.get('sessionProjections') as { stateOf(session: Session, key: string): { pending?: WorkbenchModel | null } | undefined } | undefined
    const defaults = this.ctx.get('agentDefaultModel') as { currentSelection(): WorkbenchModel } | undefined
    const model = projections?.stateOf(session, 'modelSelection')?.pending ?? session.requestHeader()?.config ?? defaults?.currentSelection()
    if (!model?.provider || !model.model) throw new Error('WORKBENCH_MODEL')
    return { provider: model.provider, model: model.model, reasoningEffort: model.reasoningEffort }
  }

  @Remote
  async list(sessionId: string, path: string, signal: AbortSignal): Promise<{ entries: WorkbenchEntry[]; truncated: boolean }> {
    return this.files.list(sessionId, path, signal)
  }

  @Remote
  async read(sessionId: string, path: string, signal: AbortSignal): Promise<WorkbenchFile> { return this.files.read(sessionId, path, signal) }

  @Remote
  async save(sessionId: string, content: string, signal: AbortSignal): Promise<WorkbenchFile> {
    return this.files.save(sessionId, JSON.parse(saveRequestSchema.parse(content)), signal)
  }

  @Remote
  async project(sessionId: string, signal: AbortSignal): Promise<{ files: string[]; truncated: boolean }> { return this.files.project(sessionId, signal) }

  @Remote({ mode: 'stream' })
  async *assist(sessionId: string, content: string, signal: AbortSignal): AsyncGenerator<AssistantResult> {
    const input = parseAssistant(JSON.parse(requestSchema.parse(content)))
    const session = await this.sessionOf(sessionId)
    // 读取原文件确认路径与访问权限；未保存的缓冲区由调用方显式提交。
    await this.files.read(sessionId, input.file, signal)
    const model = this.modelOf(session)
    const combined = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(ASSISTANT_TIMEOUT_MS)])
    yield await assistantResponse(this.ctx.llm.stream(assistantRequest(input, model, combined)), input.mode, combined)
  }
}

export function applyWorkbench(ctx: Context): void {
  ctx.inject(['fs', 'sessions', 'llm', 'sandboxPolicy', 'sessionProjections', 'agentDefaultModel'], owner => { new SuperCodeWorkbench(owner) })
}
