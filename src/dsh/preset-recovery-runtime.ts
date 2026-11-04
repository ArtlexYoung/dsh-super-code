/** Copied to the profile so cold recovery does not depend on the removed npm package. */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { CommandId } from '@deepseek-ai/dsh-commands'
import type { createUserMessage, UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-presets'

interface Preset { id: string; broken?: string }
interface Presets {
  resolve(id?: string): Promise<Preset>
  list(): Promise<readonly Preset[]>
  readDocument?(id: string): Promise<{ agentPreset: string; content: string }>
  mount(ctx: Context, id?: string): Promise<Preset>
  composedPreset(ctx: Context): string | undefined
}
interface Query {
  listSessions(): Promise<{ header: SessionHeader }[]>
  readSession(id: SessionHeader['id']): Promise<{ session: SessionHeader; events: readonly SessionEvent[] }>
}
interface Record { preset: string; createdAt: number; cwd?: string; fingerprint: string }
interface State { plugin: 'dsh-super-code'; format: 1; sessions: { [id: string]: Record } }
export interface RecoveryConfig { statePath: string; packagePath: string }
export interface RecoveryService { remember(agent: Agent): Promise<void>; backfill(presets: readonly string[]): Promise<void> }

const noticePlugin = 'dsh-super-code/preset-recovery'
const deletionSource = 'dsh-super-code/deletion-protection'
const revokedSource = 'dsh-super-code/deletion-protection-revoked'
const official = new Set(['standard', 'ptc', 'minimal', 'cordis'])
export function fingerprint(content: string): string { return createHash('sha256').update(content).digest('hex') }

interface DeletionCursor { offset: Session['seq']; pending: Set<SessionEvent['seq']> }
const revocationCursors = new WeakMap<Session, DeletionCursor>()

function deletionCursor(session: Session): DeletionCursor {
  const cursor = revocationCursors.get(session) ?? { offset: 0 as Session['seq'], pending: new Set<SessionEvent['seq']>() }
  for (const event of session.snapshotEvents(cursor.offset)) {
    if (event.type !== 'user/message') continue
    if (event.data.source.kind === deletionSource) cursor.pending.add(event.seq)
    else if (event.data.source.kind === revokedSource) for (const seq of event.sourceEventSeqs ?? []) cursor.pending.delete(seq)
  }
  cursor.offset = session.seq
  revocationCursors.set(session, cursor)
  return cursor
}

/** The durable producer record survives cold reloads and compaction. */
export function deletionNoticeMatches(session: Session, instruction: string): boolean {
  const cursor = deletionCursor(session)
  if (cursor.pending.size !== 1) return false
  const event = session.eventAt([...cursor.pending][0]!)
  return event?.type === 'user/message' && event.data.content.length === 1
    && event.data.content[0]?.type === 'text' && event.data.content[0].text.endsWith(instruction)
}

/** Retire only producer-owned rules; keep append-origin history and user instructions intact. */
export function revokeDeletionNotices(session: Session, message: typeof createUserMessage): void {
  const cursor = deletionCursor(session)
  const notice = (): UserMessage => message({ source: { kind: revokedSource }, content: [{ type: 'text', text:
    'Super Code 先前添加的删除保护规则已撤销，不再适用；请遵循当前用户指令和宿主权限。\nEarlier deletion-protection rules added by Super Code have been revoked and no longer apply. Follow current user instructions and host permissions.' }] })
  const active = new Set(session.surface.nodes)
  for (const seq of cursor.pending) {
    if (!active.has(seq)) continue
    session.append('user/message', notice(), {
      surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq],
    })
    cursor.pending.delete(seq)
  }
  // A previous compaction may have absorbed a rule into its summary. Preserve
  // that summary and its other context; explicitly revoke the owned rule once.
  if (cursor.pending.size) {
    session.append('user/message', notice(), { surfaceOp: 'append', sourceEventSeqs: [...cursor.pending] })
    cursor.pending.clear()
  }
  cursor.offset = session.seq
  revocationCursors.set(session, cursor)
}

/** The first declarative releases predate readDocument; their Loader still owns the definition. */
export async function compositionContent(ctx: Context, id: string): Promise<string> {
  const registry = ctx.get('agentPresets') as Presets
  if (registry.readDocument) {
    const document = await registry.readDocument(id)
    return document.agentPreset === id ? document.content : ''
  }
  const entries = [...ctx.loader.entries()].filter(row => row.options.name === '@deepseek-ai/dsh-agent-preset'
    && !row.disabled && row.options.disabled !== true && (row.options.config as { id?: string })?.id === id)
  return entries.length === 1 ? JSON.stringify((entries[0]!.options.config as { plugins: unknown }).plugins) : ''
}

/** Invalid or unrelated records fail closed; never replace them with an empty ownership record. */
export class RecoveryState {
  private tail: Promise<void> = Promise.resolve()
  private constructor(readonly path: string, readonly value: State) {}
  static async open(path: string): Promise<RecoveryState> {
    let value: State = { plugin: 'dsh-super-code', format: 1, sessions: {} }
    try {
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe recovery record')
      const data = JSON.parse(await readFile(path, 'utf8')) as State
      if (data?.plugin !== 'dsh-super-code' || data.format !== 1 || !data.sessions || typeof data.sessions !== 'object' || Array.isArray(data.sessions)) throw new Error('Invalid recovery record')
      for (const [id, row] of Object.entries(data.sessions)) {
        if (!id || !row || typeof row.preset !== 'string' || !row.preset || official.has(row.preset)
          || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || row.cwd !== undefined && typeof row.cwd !== 'string'
          || typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint)) throw new Error('Invalid recovery session')
      }
      value = data
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return new RecoveryState(path, value)
  }
  async save(id: string, record: Record): Promise<void> {
    const next = this.tail.then(async () => {
      if (JSON.stringify(this.value.sessions[id]) === JSON.stringify(record)) return
      const value: State = { ...this.value, sessions: { ...this.value.sessions, [id]: record } }
      try {
        const stat = await lstat(this.path)
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe recovery record')
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const stage = await mkdtemp(join(dirname(this.path), '.state-'))
      try {
        const file = join(stage, 'state.json')
        await writeFile(file, JSON.stringify(value), { mode: 0o600 })
        await rename(file, this.path)
        this.value.sessions = value.sessions
      } finally { await rm(stage, { recursive: true, force: true }) }
    })
    this.tail = next.catch(() => {})
    await next
  }
}

function selected(session: Session, ctx: Context): string | undefined {
  return ctx.sessionProjections.stateOf(session, 'agentPreset') ?? session.header.agentPreset
}

/** Wrap only the public roster seam; mounting still belongs to the running host. */
export function installRecovery(ctx: Context, state: RecoveryState, config: RecoveryConfig,
  host: { scopeOf(ctx: Context): unknown; message: typeof createUserMessage }): RecoveryService {
  const registry = ctx.get('agentPresets') as Presets
  const originalResolve = registry.resolve, originalMount = registry.mount
  const resolveDescriptor = Object.getOwnPropertyDescriptor(registry, 'resolve')
  const mountDescriptor = Object.getOwnPropertyDescriptor(registry, 'mount')
  const unavailable = (): boolean => !existsSync(config.packagePath) && !ctx.get('superCodeConfiguration')
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    // Disabling a bundle leaves its package on disk but removes its policy owner.
    if (!ctx.get('superCodeConfiguration')) { signal.throwIfAborted(); revokeDeletionNotices(agent.session, host.message) }
    return next()
  }, true)
  const known = (id: string): boolean => Object.values(state.value.sessions).some(row => row.preset === id)
  const documentHash = async (id: string): Promise<string> => {
    const content = await compositionContent(ctx, id)
    return content ? fingerprint(content) : ''
  }
  const rememberHeader = async (header: SessionHeader, preset: string): Promise<void> => {
    if (official.has(preset)) return
    const hash = await documentHash(preset)
    if (hash) await state.save(header.id, { preset, createdAt: header.createdAt, ...(header.cwd === undefined ? {} : { cwd: header.cwd }), fingerprint: hash })
  }
  const service: RecoveryService = {
    async remember(agent) {
      if (!ctx.get('tools')?.get('super_code_task', agent)) return
      const preset = registry.composedPreset(agent.ctx)
      if (preset) await rememberHeader(agent.session.header, preset)
    },
    async backfill(presets) {
      const query = ctx.get('sessionQuery') as Query | undefined
      if (!query || !presets.length) return
      const owned = new Set(presets)
      for (const { header } of await query.listSessions()) {
        // A blank conversation can switch from an official preset before its
        // first turn; its immutable header then differs from the selected one.
        try {
          const history = await query.readSession(header.id)
          let preset = history.session.agentPreset
          for (const event of history.events) if (event.type === 'agent-preset/selected') preset = event.data.agentPreset
          if (preset && owned.has(preset)) await rememberHeader(history.session, preset)
        } catch { ctx.logger.warn('A historical Super Code session could not be registered for uninstall recovery.') }
      }
    },
  }
  const resolve: Presets['resolve'] = async function (this: Presets, id) {
    try { return await originalResolve.call(this, id) }
    catch (error) {
      if (!id || !unavailable() || !known(id) || (await this.list()).some(row => row.id === id)) throw error
      // The actual mount below requires an exact previously recorded Session.
      return { id }
    }
  }
  const mount: Presets['mount'] = async function (this: Presets, agentCtx, id) {
    const scope = host.scopeOf(agentCtx)
    const agent = scope && typeof scope === 'object' && 'session' in scope ? scope as Agent : undefined
    const saved = agent && state.value.sessions[agent.session.id]
    if (!agent || !id || !saved || !unavailable() || saved.preset !== id || selected(agent.session, ctx) !== id
      || saved.createdAt !== agent.session.header.createdAt || saved.cwd !== agent.session.header.cwd) return originalMount.call(this, agentCtx, id)
    const preset = (await this.list()).find(row => row.id === id)
    if (preset && (!preset.broken || await documentHash(id) !== saved.fingerprint)) return originalMount.call(this, agentCtx, id)
    const mounted = await originalMount.call(this, agentCtx, 'standard')
    if (selected(agent.session, ctx) !== id) return mounted
    const settings = ctx.get('settings') as { get?(namespace: string): { preference?: string } | undefined
      describe?(): { ns: string; value?: { preference?: string } }[] } | undefined
    const language = (settings?.get ? settings.get('locale')?.preference
      : settings?.describe?.().find(row => row.ns === 'locale')?.value?.preference) ?? 'zh'
    const chinese = language.toLowerCase().startsWith('zh') || language === 'auto' || language === 'system'
    // Native command-result records remain visible outside collapsed work
    // steps. Attribute this automatic operation to the plugin, never the user;
    // it adds no model-facing message and schedules no extra turn.
    const commandId = randomUUID() as CommandId
    agent.session.append('command/run', { commandId, name: 'super-code-recovery', source: { kind: noticePlugin } })
    agent.session.append('agent-preset/selected', { agentPreset: 'standard' })
    agent.session.append('command/done', { commandId, kind: 'success', text: chinese
      ? 'Super Code 插件已卸载，本对话将使用官方标准预设继续。已有历史记录保留。'
      : 'The Super Code plugin has been uninstalled. This conversation will continue with the official Standard preset. Existing history is preserved.' })
    return mounted
  }
  registry.resolve = resolve
  registry.mount = mount
  ctx.effect(() => () => {
    for (const [key, wrapper, descriptor] of [['resolve', resolve, resolveDescriptor], ['mount', mount, mountDescriptor]] as const) {
      if (registry[key] !== wrapper) continue
      if (descriptor) Object.defineProperty(registry, key, descriptor)
      else Reflect.deleteProperty(registry, key)
    }
  })
  return service
}

export const name = 'super-code-session-recovery'
export function apply(ctx: Context, config: RecoveryConfig): void {
  ctx.inject(['agentPresets', 'sessionProjections', 'tools'], async owner => {
    try {
      if (owner.get('superCodeSessionRecovery')) return
      const state = await RecoveryState.open(config.statePath)
      const profile = owner.get('profileContext') as { installAnchor?: string } | undefined
      const require = createRequire(profile?.installAnchor ?? new URL('package.json', owner.root.baseUrl))
      const scope = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-scope')).href)
      const llm = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)
      if (owner.get('superCodeSessionRecovery')) return
      const service = installRecovery(owner, state, config, { scopeOf: scope.scopeOf, message: llm.createUserMessage })
      owner.provide('superCodeSessionRecovery', service)
      const remember = async (agent: Agent): Promise<void> => {
        try { await service.remember(agent) }
        catch { owner.logger.warn('Super Code session recovery record could not be saved.') }
      }
      owner.on('agent/created', async ({ agent }) => { await remember(agent) })
      owner.on('agent/pre-step', async ({ agent }, next) => { await remember(agent); return next() }, true)
    } catch { owner.logger.warn('Super Code continuation recovery is unavailable; the local recovery record could not be loaded.') }
  })
}

declare module '@deepseek-ai/cordis' { interface Context { superCodeSessionRecovery: RecoveryService } }

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-super-code/deletion-protection-revoked': { kind: 'dsh-super-code/deletion-protection-revoked' }
  }
}

/** Automatic local recovery owns this command; it is not a user submission. */
declare module '@deepseek-ai/dsh-commands' {
  interface CommandSourceMap {
    'dsh-super-code/preset-recovery': { kind: 'dsh-super-code/preset-recovery' }
  }
}
