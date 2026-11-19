/** 代码工作台的公开 Remote 边界，身份与工作目录由宿主会话决定。 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { WorkbenchFiles, MAX_FILE_BYTES } from '../workbench/files.js'
import type { WorkbenchEntry, WorkbenchFile, WorkbenchRoot, WorkbenchProject } from '../workbench/files.js'
import { INDEX_BYTES } from '../workbench/project-index.js'
import { parseAssistant, assistantRequest, assistantResponse } from '../workbench/assistant.js'
import type { AssistantResult, WorkbenchModel } from '../workbench/assistant.js'
import type { WorkbenchGit, WorkbenchGitResult } from './workbench-git.js'
import { generateReading } from '../workbench/reading/generate.js'
import { parseReadingRequest, MAX_READING_REQUEST_CHARS } from '../workbench/reading/types.js'
import type { ReadingEvent } from '../workbench/reading/types.js'
import { WorkbenchDirectory } from './workbench-directory.js'
import type { DirectoryState } from './workbench-directory.js'
import { FileHistory } from '../workbench/file-history.js'
import type { FileOperationResult } from '../workbench/file-history.js'
import { searchProject } from '../workbench/search.js'
import type { ProjectSearchEvent } from '../workbench/search.js'
import { parseTranslation, translationRequest } from '../workbench/translation.js'
import { resolveWorkbenchModel } from '../workbench/model.js'
import type { TranslationModelOption } from '../workbench/translation.js'
import { WorkbenchWindows } from '../workbench/window.js'
import type { WindowAddress, WindowEvent } from '../workbench/window.js'
import { listSystemFonts } from '../workbench/fonts.js'
import { environmentPaths, inspectEnvironments } from '../workbench/languages/config.js'
import type { LanguageEnvironment } from '../workbench/languages/config.js'
import { languageSources } from '../workbench/languages/sources.js'
import type { LanguageSourceEvent } from '../workbench/languages/sources.js'

const sessionSchema = z.string().min(1).max(256)
const requestSchema = z.string().max(2 * 1024 * 1024 + 16000)
const saveRequestSchema = z.string().max(MAX_FILE_BYTES * 6 + 16384)
const ASSISTANT_TIMEOUT_MS = 10 * 60 * 1000

export class SuperCodeWorkbench extends TypertRemoteService {
  private readonly files: WorkbenchFiles
  private readonly lifetime = new AbortController()
  private repository?: Promise<WorkbenchGit>
  private readonly fileHistory: FileHistory
  private modelRuntime?: { llm: Context['llm']; signal: AbortSignal }
  private directories?: WorkbenchDirectory
  private readonly windows = new WorkbenchWindows()

  constructor(ctx: Context) {
    super(ctx, 'superCodeWorkbench')
    this.files = new WorkbenchFiles(ctx.fs, (id, signal) => this.rootOf(id, signal))
    this.fileHistory = new FileHistory(ctx.fs)
    ctx.inject(['llm'], owner => {
      const lifetime = new AbortController(), runtime = { llm: owner.llm, signal: lifetime.signal }
      this.modelRuntime = runtime
      owner.effect(() => () => {
        lifetime.abort()
        if (this.modelRuntime === runtime) this.modelRuntime = undefined
      })
    })
    ctx.inject(['agents', 'sessionQuery', 'sessionController', 'agentPresets', ...['workspaceRegistry', 'subagents'].filter(key => key in ctx)], owner => {
      const service = new WorkbenchDirectory(owner); this.directories = service
      owner.effect(() => () => { if (this.directories === service) this.directories = undefined })
    })
    ctx.effect(() => () => { this.lifetime.abort(); this.windows.dispose(); return this.fileHistory.dispose() })
  }

  private async sessionOf(sessionId: string, signal?: AbortSignal): Promise<Session> {
    signal?.throwIfAborted(); this.lifetime.signal.throwIfAborted()
    const id = SessionId(sessionSchema.parse(sessionId))
    const session = this.ctx.sessions.get(id)
    if (session) return session
    // 冷启动恢复的会话尚未进入内存，交给宿主统一加载，保留预设和写入者归属。
    const controller = this.ctx.get('sessionController') as {
      resolveAgent?(id: Session['id']): Promise<{ agent: { session: Session } } | { error: Error & { code?: string } }>
    } | undefined
    const resolved = await controller?.resolveAgent?.(id)
    signal?.throwIfAborted(); this.lifetime.signal.throwIfAborted()
    if (!resolved) throw new Error('WORKBENCH_SESSION')
    if ('error' in resolved) {
      if (resolved.error.code === 'session/not-found') throw new Error('WORKBENCH_SESSION', { cause: resolved.error })
      throw resolved.error
    }
    return resolved.agent.session
  }

  private async rootOf(sessionId: string, signal?: AbortSignal): Promise<WorkbenchRoot> {
    signal = AbortSignal.any([...(signal ? [signal] : []), this.lifetime.signal])
    const session = await this.sessionOf(sessionId, signal)
    if (!session.header.cwd) throw new Error('WORKBENCH_WORKSPACE')
    try {
      const root = await this.ctx.fs.resolve(session.header.cwd, { signal })
      if ((await this.ctx.fs.stat(root, signal))?.type !== 'directory') throw new Error('WORKBENCH_DIRECTORY_MISSING')
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'FS_NOT_FOUND'].includes((error as { code?: string }).code || '')) throw new Error('WORKBENCH_DIRECTORY_MISSING')
      throw error
    }
    signal.throwIfAborted()
    return { cwd: session.header.cwd, policy: this.ctx.sandboxPolicy.resolve({ session }) }
  }

  private llmOf(): { llm: Context['llm']; signal: AbortSignal } {
    if (!this.modelRuntime) throw new Error('WORKBENCH_MODEL_UNAVAILABLE')
    return this.modelRuntime
  }

  private repositoryOf(): Promise<WorkbenchGit> {
    return this.repository ??= import('./workbench-git.js').then(({ WorkbenchGit }) => new WorkbenchGit(this.ctx)).catch(cause => {
      this.repository = undefined
      throw new Error('WORKBENCH_GIT_UNAVAILABLE', { cause })
    })
  }

  private selectionOf(session?: Session): WorkbenchModel | undefined {
    const projections = this.ctx.get('sessionProjections') as { stateOf(session: Session, key: string): { pending?: WorkbenchModel | null } | undefined } | undefined
    const defaults = this.ctx.get('agentDefaultModel') as { currentSelection(): WorkbenchModel } | undefined
    const model = (session && (projections?.stateOf(session, 'modelSelection')?.pending ?? session.requestHeader()?.config)) ?? defaults?.currentSelection()
    if (!model?.provider || !model.model) return undefined
    return { provider: model.provider, model: model.model, reasoningEffort: model.reasoningEffort }
  }

  private modelOf(session: Session): WorkbenchModel {
    const model = this.selectionOf(session)
    if (!model) throw new Error('WORKBENCH_MODEL')
    return model
  }

  @Remote
  async fonts(sessionId: string, signal: AbortSignal): Promise<string[]> {
    z.string().max(256).parse(sessionId)
    return listSystemFonts(AbortSignal.any([signal, this.lifetime.signal]))
  }

  @Remote
  async list(sessionId: string, path: string, signal: AbortSignal): Promise<{ entries: WorkbenchEntry[]; truncated: boolean }> {
    signal.throwIfAborted()
    return this.files.list(sessionId, path, AbortSignal.any([signal, this.lifetime.signal]))
  }

  @Remote
  async read(sessionId: string, path: string, signal: AbortSignal): Promise<WorkbenchFile> {
    signal.throwIfAborted()
    return this.files.read(sessionId, path, AbortSignal.any([signal, this.lifetime.signal]))
  }

  @Remote
  async save(sessionId: string, content: string, signal: AbortSignal): Promise<WorkbenchFile> {
    signal.throwIfAborted()
    return this.files.save(sessionId, JSON.parse(saveRequestSchema.parse(content)), AbortSignal.any([signal, this.lifetime.signal]))
  }

  @Remote
  async project(sessionId: string, signal: AbortSignal): Promise<WorkbenchProject> {
    signal.throwIfAborted()
    return this.files.project(sessionId, AbortSignal.any([signal, this.lifetime.signal]))
  }

  @Remote
  async storeIndex(sessionId: string, content: string, signal: AbortSignal): Promise<{ persisted: boolean }> {
    return this.files.storeIndex(sessionId, JSON.parse(z.string().max(INDEX_BYTES).parse(content)), AbortSignal.any([signal, this.lifetime.signal]))
  }

  @Remote
  async environments(sessionId: string, content: string, signal: AbortSignal): Promise<{ environments: LanguageEnvironment[]; warnings: string[] }> {
    const active = AbortSignal.any([signal, this.lifetime.signal])
    return inspectEnvironments(this.ctx.fs, await this.rootOf(sessionId, active), environmentPaths.parse(JSON.parse(z.string().max(40000).parse(content))), active)
  }

  @Remote({ mode: 'stream' })
  async *languageSources(sessionId: string, content: string, signal: AbortSignal): AsyncGenerator<LanguageSourceEvent> {
    const active = AbortSignal.any([signal, this.lifetime.signal])
    yield* languageSources(this.ctx.fs, await this.rootOf(sessionId, active), JSON.parse(z.string().max(45000).parse(content)), active)
  }

  @Remote({ mode: 'stream' })
  async *searchProject(sessionId: string, content: string, signal: AbortSignal): AsyncGenerator<ProjectSearchEvent> {
    const root = await this.rootOf(sessionId, signal), input: unknown = JSON.parse(z.string().max(400000).parse(content))
    yield* searchProject(this.ctx.fs, this.files, root, sessionId, input, AbortSignal.any([signal, this.lifetime.signal]))
  }

  @Remote
  async fileOperation(sessionId: string, content: string, signal: AbortSignal): Promise<FileOperationResult> {
    signal.throwIfAborted()
    const input: unknown = JSON.parse(z.string().max(32768).parse(content))
    return this.fileHistory.run(await this.rootOf(sessionId, signal), input, AbortSignal.any([signal, this.lifetime.signal]))
  }

  @Remote
  async directory(sessionId: string, signal: AbortSignal): Promise<DirectoryState> {
    sessionSchema.parse(sessionId)
    if (!this.directories) throw new Error('WORKBENCH_DIRECTORY_UNSUPPORTED')
    return this.directories.status(sessionId, AbortSignal.any([signal, this.lifetime.signal]))
  }

  @Remote
  async recoverDirectory(sessionId: string, content: string, signal: AbortSignal): Promise<{ sessionId: string }> {
    sessionSchema.parse(sessionId)
    if (!this.directories) throw new Error('WORKBENCH_DIRECTORY_UNSUPPORTED')
    return this.directories.recover(sessionId, JSON.parse(z.string().max(32768).parse(content)), AbortSignal.any([signal, this.lifetime.signal]))
  }

  @Remote({ mode: 'stream' })
  async *git(sessionId: string, content: string, signal: AbortSignal): AsyncGenerator<WorkbenchGitResult> {
    const session = await this.sessionOf(sessionId, signal)
    await this.rootOf(sessionId, signal)
    const input: unknown = JSON.parse(z.string().parse(content))
    const combined = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(5 * 60 * 1000)])
    const repository = await this.repositoryOf()
    combined.throwIfAborted()
    yield await repository.execute(session, input, this.ctx.sandboxPolicy.resolve({ session }), combined)
  }

  @Remote({ mode: 'stream' })
  async *reading(sessionId: string, content: string, signal: AbortSignal): AsyncGenerator<ReadingEvent> {
    const input = parseReadingRequest(JSON.parse(z.string().max(MAX_READING_REQUEST_CHARS).parse(content)))
    const session = await this.sessionOf(sessionId, signal)
    const { llm, signal: modelSignal } = this.llmOf()
    const combined = AbortSignal.any([signal, this.lifetime.signal, modelSignal, AbortSignal.timeout(ASSISTANT_TIMEOUT_MS)])
    yield* generateReading(this.files, sessionId, input, this.modelOf(session), options => llm.stream(options), combined)
  }

  @Remote({ mode: 'stream' })
  async *assist(sessionId: string, content: string, signal: AbortSignal): AsyncGenerator<AssistantResult> {
    const input = parseAssistant(JSON.parse(requestSchema.parse(content)))
    const session = await this.sessionOf(sessionId, signal)
    const { llm, signal: modelSignal } = this.llmOf()
    const combined = AbortSignal.any([signal, this.lifetime.signal, modelSignal, AbortSignal.timeout(ASSISTANT_TIMEOUT_MS)])
    // 读取原文件确认路径与访问权限；未保存的缓冲区由调用方显式提交。
    await this.files.read(sessionId, input.file, combined)
    const model = await resolveWorkbenchModel(llm, input.model ?? this.modelOf(session), combined, input.reasoningEffort)
    yield await assistantResponse(llm.stream(assistantRequest(input, model, combined)), input.mode, combined)
  }

  @Remote
  async models(sessionId: string, signal: AbortSignal): Promise<TranslationModelOption[]> {
    const active = AbortSignal.any([signal, this.lifetime.signal])
    active.throwIfAborted()
    const session = sessionId === '' ? undefined : await this.sessionOf(sessionId, active)
    active.throwIfAborted()
    const { llm, signal: modelSignal } = this.llmOf()
    const combined = AbortSignal.any([active, modelSignal])
    combined.throwIfAborted()
    const current = this.selectionOf(session)
    const models = await Promise.all(llm.listProviders().map(async provider => {
      const result: TranslationModelOption[] = []
      const catalog = await llm.listModels(provider.id)
      if (current?.provider === provider.id && !catalog.some(model => model.id === current.model)) catalog.push({ provider: provider.id, id: current.model, name: current.model })
      for (const model of catalog) {
        combined.throwIfAborted()
        const info = await llm.resolveModelInfo(provider.id, model.id, combined)
        combined.throwIfAborted()
        result.push({ provider: provider.id, model: model.id, name: `${provider.name} · ${model.name}`,
          current: current?.provider === provider.id && current.model === model.id,
          efforts: (info.reasoning?.efforts ?? []).map(({ id, name }) => ({ id, name })) })
      }
      return result
    }))
    combined.throwIfAborted()
    return models.flat()
  }

  @Remote
  async openWindow(sessionId: string, native: string, signal: AbortSignal): Promise<WindowAddress> {
    await this.sessionOf(sessionId, signal)
    signal.throwIfAborted()
    const address = await this.windows.open(sessionId, z.enum(['true', 'false']).parse(native) === 'true')
    if (signal.aborted) { this.windows.close(sessionId, address.id); signal.throwIfAborted() }
    return address
  }

  @Remote({ mode: 'stream' })
  async *windowEvents(sessionId: string, id: string, signal: AbortSignal): AsyncGenerator<WindowEvent> {
    await this.sessionOf(sessionId, signal)
    yield* this.windows.events(sessionId, z.string().length(32).parse(id), AbortSignal.any([signal, this.lifetime.signal]))
  }

  @Remote
  async windowMessage(sessionId: string, id: string, content: string, signal: AbortSignal): Promise<void> {
    await this.sessionOf(sessionId, signal)
    signal.throwIfAborted()
    this.windows.send(sessionId, z.string().length(32).parse(id), z.string().max(32 * 1024 * 1024).parse(content))
  }

  @Remote
  async closeWindow(sessionId: string, id: string, signal: AbortSignal): Promise<void> {
    await this.sessionOf(sessionId, signal)
    signal.throwIfAborted()
    this.windows.close(sessionId, z.string().length(32).parse(id))
  }

  @Remote({ mode: 'stream' })
  async *translate(sessionId: string, content: string, signal: AbortSignal): AsyncGenerator<AssistantResult> {
    const input = parseTranslation(JSON.parse(z.string().max(12 * 1024 * 1024).parse(content)))
    const session = await this.sessionOf(sessionId, signal)
    const { llm, signal: modelSignal } = this.llmOf()
    const combined = AbortSignal.any([signal, this.lifetime.signal, modelSignal, AbortSignal.timeout(ASSISTANT_TIMEOUT_MS)])
    const model = await resolveWorkbenchModel(llm, input.model ?? this.modelOf(session), combined, input.reasoningEffort)
    yield await assistantResponse(llm.stream(translationRequest(input, model, combined)), 'ask', combined)
  }
}

export function applyWorkbench(ctx: Context): void {
  ctx.inject(['fs', 'sessions', 'sandboxPolicy'], owner => { new SuperCodeWorkbench(owner) })
}
