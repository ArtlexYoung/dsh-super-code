/** Host-only preset discovery repair; never part of a model's tool surface. */
import { cp, lstat, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { copyComposition, discoverPresets, writableRoot, type AgentPresets } from '@deepseek-ai/dsh-agent-presets'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

interface InstallationSettings {
  checked: boolean
  installedId: string
}
export interface PresetInstallationStatus {
  state: 'available' | 'installed' | 'conflict' | 'missing' | 'broken'
  id: string
  authorable: boolean
  userConflict: boolean
}
export interface PresetInstallationResult {
  ok: boolean
  status: PresetInstallationStatus
  error?: 'invalid-name' | 'name-taken' | 'no-user-root' | 'install-failed'
}
const sourceRoot = fileURLToPath(new URL('../../presets/', import.meta.url))
const validId = /^[a-z0-9][a-z0-9-]{0,63}$/

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Serialized writes protect double clicks; mkdir claims only an unoccupied name. */
export class PresetInstaller {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly roster: Pick<AgentPresets, 'list' | 'roots'>,
    private readonly settings: SettingsScope<InstallationSettings>,
    private readonly bundledRoot: string = sourceRoot,
    private readonly baseUrl: string = pathToFileURL(bundledRoot).href,
  ) {}

  async status(): Promise<PresetInstallationStatus> {
    const savedId = this.settings.get().installedId
    const id = validId.test(savedId) ? savedId : 'super-code'
    const presets = await this.roster.list()
    const preset = presets.find(row => row.id === id)
    const authorable = this.roster.roots.some(root => root.trust === 'user')
    const occupied = await this.occupied(id)
    const userConflict = occupied && this.settings.get().installedId !== id
    if (preset) {
      const owned = preset.trust === 'system' && resolve(preset.path) === join(this.bundledRoot, 'super-code', 'agent.cordis.yml')
      return { id, authorable, userConflict, state: preset.broken ? 'broken' : owned ? 'available'
        : preset.trust === 'user' && this.settings.get().installedId === id ? 'installed' : 'conflict' }
    }
    return { id, authorable, userConflict, state: occupied ? 'conflict' : 'missing' }
  }

  async initialize(): Promise<void> {
    await this.enqueue(async () => {
      if (this.settings.get().checked) return
      const status = await this.status()
      // Persist intent first: a failure or subsequent user deletion must not
      // trigger a new filesystem write on every host restart.
      await this.settings.update({ checked: true })
      if (status.state === 'missing' && status.authorable) await this.installNow('super-code')
    })
  }

  async install(id: unknown): Promise<PresetInstallationResult> {
    return await this.enqueue(() => this.installNow(id))
  }

  private async occupied(id: string): Promise<boolean> {
    for (const root of this.roster.roots.filter(root => root.trust === 'user')) {
      if (await exists(join(writableRoot([root], id), id))) return true
    }
    return false
  }

  private async installNow(value: unknown): Promise<PresetInstallationResult> {
    const reject = async (error: NonNullable<PresetInstallationResult['error']>): Promise<PresetInstallationResult> =>
      ({ ok: false, error, status: await this.status() })
    if (typeof value !== 'string' || !validId.test(value)) return reject('invalid-name')
    const id = value
    if (!this.roster.roots.some(root => root.trust === 'user')) return reject('no-user-root')
    if ((await this.roster.list()).some(row => row.id === id) || await this.occupied(id)) return reject('name-taken')
    let staging = ''
    let claimed = false
    const target = join(writableRoot(this.roster.roots, id), id)
    try {
      const source = (await discoverPresets([{ path: this.bundledRoot, trust: 'system' }], this.baseUrl))
        .find(preset => preset.id === 'super-code' && !preset.broken)
      if (!source) throw new Error('Bundled super-code preset unavailable')
      const root = writableRoot(this.roster.roots, id)
      await mkdir(root, { recursive: true, mode: 0o700 })
      staging = await mkdtemp(join(root, '.super-code-install-'))
      // The host copy helper can clean up its destination on failure. Isolate
      // it from user-owned paths, then exclusively claim the final directory.
      const prepared = await copyComposition([{ path: staging, trust: 'user' }], source, id, id)
      await mkdir(target, { mode: 0o700 })
      claimed = true
      for (const entry of await readdir(prepared)) {
        await cp(join(prepared, entry), join(target, entry), { recursive: true, force: false, errorOnExist: true })
      }
      await this.settings.update({ checked: true, installedId: id })
      claimed = false
      return { ok: true, status: await this.status() }
    } catch (error) {
      if (claimed) await rm(target, { recursive: true, force: true })
      return reject((error as NodeJS.ErrnoException).code === 'EEXIST' ? 'name-taken' : 'install-failed')
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true })
    }
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.tail.then(run)
    this.tail = next.catch(() => {})
    return next
  }
}

export class SuperCodePresets extends TypertRemoteService {
  private readonly installer: PresetInstaller
  constructor(ctx: Context, installer: PresetInstaller) {
    super(ctx, 'superCodePresets')
    this.installer = installer
  }
  @Remote
  status(): Promise<PresetInstallationStatus> { return this.installer.status() }
  @Remote
  installPreset(id: unknown): Promise<PresetInstallationResult> { return this.installer.install(id) }
}

export function applyPresetInstallation(ctx: Context): void {
  ctx.inject(['agentPresets', 'settings'], async owner => {
    const settings = owner.settings.register('super-code', s.object({
      checked: s.boolean().default(false),
      installedId: s.string().default(''),
    }))
    const installer = new PresetInstaller(owner.agentPresets, settings, sourceRoot, owner.baseUrl)
    new SuperCodePresets(owner, installer)
    try { await installer.initialize() } catch {
      owner.logger.warn('Super Code preset installation unavailable; retry in plugin settings.')
    }
  })
}
