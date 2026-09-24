/** Host-only preset discovery repair; never part of a model's tool surface. */
import { cp, lstat, mkdir, mkdtemp, readdir, rm, readFile, writeFile, rename, realpath } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { copyComposition, discoverPresets, writableRoot, type AgentPresets } from '@deepseek-ai/dsh-agent-presets'
import { displayCopy, migrateMetadata, type DisplayBaseline } from './preset-metadata.js'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

interface InstallationSettings {
  checked: boolean
  installedId: string
  installation?: { id: string; path: string; token: string; dev: number; ino: number }
  display?: Record<string, DisplayBaseline>
  pendingDisplay?: Record<string, DisplayBaseline>
}
export interface PresetInstallationStatus {
  state: 'available' | 'installed' | 'conflict' | 'missing' | 'broken'
  id: string
  name?: string
  authorable: boolean
  userConflict: boolean
}
export interface PresetInstallationResult {
  ok: boolean
  status: PresetInstallationStatus
  error?: 'ownership-unverified' | 'invalid-name' | 'invalid-display-name' | 'name-taken' | 'no-user-root' | 'install-failed'
}
const sourceRoot = fileURLToPath(new URL('../../presets/', import.meta.url))
const ownershipFile = '.super-code-installation.json'
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
      return { id, name: preset.name, authorable, userConflict, state: preset.broken ? 'broken' : owned ? 'available'
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

  async synchronize(language: string): Promise<{ changed: boolean }> {
    if (!/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(language)) throw new Error('Invalid language')
    return await this.enqueue(async () => {
      const stored = this.settings.get()
      const display = { ...stored.display }
      const pendingDisplay = { ...stored.pendingDisplay }
      let changed = false
      for (const preset of await this.roster.list()) {
        const bundled = preset.trust === 'system' && resolve(preset.path) === join(this.bundledRoot, 'super-code', 'agent.cordis.yml')
        const owned = preset.trust === 'user' && (preset.id === stored.installedId || Object.hasOwn(display, preset.path))
        if (!bundled && !owned) continue
        if ((await lstat(join(preset.path, '..'))).isSymbolicLink()) continue
        const metadata = join(preset.path, '..', 'preset.yml')
        let previous = display[preset.path]
        const pending = pendingDisplay[preset.path]
        if (previous && pending) {
          previous = { ...previous }
          for (const field of ['name', 'description'] as const) {
            if (pending[field] !== undefined && preset[field] === pending[field]) previous[field] = pending[field]
          }
        }
        const result = await migrateMetadata(metadata, preset.id, preset, previous, displayCopy(language), async baseline => {
          pendingDisplay[preset.path] = baseline
          await this.settings.update({ pendingDisplay: { ...pendingDisplay } })
        })
        changed ||= result.changed
        display[preset.path] = result.baseline
        delete pendingDisplay[preset.path]
      }
      if (JSON.stringify(display) !== JSON.stringify(stored.display ?? {}) || JSON.stringify(pendingDisplay) !== JSON.stringify(this.settings.get().pendingDisplay ?? {})) {
        await this.settings.update({ display, pendingDisplay })
      }
      return { changed }
    })
  }

  async install(id: unknown, name?: string): Promise<PresetInstallationResult> {
    return await this.enqueue(() => this.installNow(id, name))
  }

  async reinstall(previousId: string, id: unknown, name?: string): Promise<PresetInstallationResult> {
    return await this.enqueue(async () => {
      const reject = async (error: NonNullable<PresetInstallationResult['error']>): Promise<PresetInstallationResult> =>
        ({ ok: false, error, status: await this.status() })
      if (typeof id !== 'string' || !validId.test(id)) return reject('invalid-name')
      if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 120)) return reject('invalid-display-name')
      const stored = this.settings.get(), installation = stored.installation
      if (!installation || previousId !== stored.installedId || installation.id !== previousId) return reject('ownership-unverified')
      const roots = this.roster.roots.filter(root => root.trust === 'user')
      const expected = await Promise.all(roots
        .map(async root => {
          try { return join(await realpath(writableRoot([root], previousId)), previousId) }
          catch { return '' }
        }))
      if (!expected.includes(installation.path)) return reject('ownership-unverified')
      const originalPath = join(writableRoot([roots[expected.indexOf(installation.path)]!], previousId), previousId)
      let backup = ''
      try {
        const directory = await lstat(installation.path)
        const markerPath = join(installation.path, ownershipFile)
        const markerStat = await lstat(markerPath)
        if (!directory.isDirectory() || directory.isSymbolicLink() || !markerStat.isFile() || markerStat.isSymbolicLink()
          || await realpath(installation.path) !== installation.path
          || directory.dev !== installation.dev || directory.ino !== installation.ino) return reject('ownership-unverified')
        const marker = JSON.parse(await readFile(markerPath, 'utf8'))
        if (marker.plugin !== 'dsh-super-code' || marker.token !== installation.token || marker.id !== previousId) return reject('ownership-unverified')
        if (id !== previousId && ((await this.roster.list()).some(row => row.id === id) || await this.occupied(id))) return reject('name-taken')
        // A container without agent.cordis.yml is not a discoverable preset.
        // Retain it after success as a recovery copy of the removed preset.
        backup = await mkdtemp(join(installation.path, '..', '.super-code-backup-'))
        await rename(installation.path, join(backup, previousId))
        const moved = await lstat(join(backup, previousId))
        if (!moved.isDirectory() || moved.dev !== installation.dev || moved.ino !== installation.ino) {
          if (!await exists(installation.path)) await rename(join(backup, previousId), installation.path)
          return reject('ownership-unverified')
        }
      } catch {
        return reject('ownership-unverified')
      }
      try {
        const result = await this.installNow(id, name, originalPath)
        if (result.ok) return result
        if (await exists(installation.path)) return reject('install-failed')
        await rename(join(backup, previousId), installation.path)
        await rm(backup, { recursive: true, force: true })
        return { ...result, status: await this.status() }
      } catch {
        // Never overwrite a directory created by another actor during repair.
        if (!await exists(installation.path)) await rename(join(backup, previousId), installation.path)
        return reject('install-failed')
      }
    })
  }

  private async occupied(id: string): Promise<boolean> {
    for (const root of this.roster.roots.filter(root => root.trust === 'user')) {
      if (await exists(join(writableRoot([root], id), id))) return true
    }
    return false
  }

  private async installNow(value: unknown, name?: string, replacedPath?: string): Promise<PresetInstallationResult> {
    const reject = async (error: NonNullable<PresetInstallationResult['error']>): Promise<PresetInstallationResult> =>
      ({ ok: false, error, status: await this.status() })
    if (typeof value !== 'string' || !validId.test(value)) return reject('invalid-name')
    const id = value
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 120)) return reject('invalid-display-name')
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
      const prepared = await copyComposition([{ path: staging, trust: 'user' }], source, id, name?.trim() ?? 'Super Code')
      await mkdir(target, { mode: 0o700 })
      claimed = true
      for (const entry of await readdir(prepared)) {
        await cp(join(prepared, entry), join(target, entry), { recursive: true, force: false, errorOnExist: true })
      }
      const token = randomUUID()
      await writeFile(join(target, ownershipFile), JSON.stringify({ plugin: 'dsh-super-code', id, token }), { flag: 'wx', mode: 0o600 })
      const directory = await lstat(target)
      const installation = { id, path: await realpath(target), token, dev: directory.dev, ino: directory.ino }
      const display = { ...this.settings.get().display }, pendingDisplay = { ...this.settings.get().pendingDisplay }
      if (replacedPath) {
        delete display[join(replacedPath, 'agent.cordis.yml')]
        delete pendingDisplay[join(replacedPath, 'agent.cordis.yml')]
      }
      const status: PresetInstallationStatus = { id, authorable: true, userConflict: false, state: 'installed' }
      await this.settings.update({ checked: true, installedId: id, installation, pendingDisplay, display: {
        ...display,
        [join(target, 'agent.cordis.yml')]: {
          ...(name === undefined ? { name: 'Super Code' } : {}),
          ...(source.description === undefined ? {} : { description: source.description }),
        },
      } })
      claimed = false
      return { ok: true, status }
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

interface InstallationController {
  status(): Promise<PresetInstallationStatus>
  install(id: unknown, name?: string): Promise<PresetInstallationResult>
  reinstall(previousId: string, id: unknown, name?: string): Promise<PresetInstallationResult>
  synchronize(language: string): Promise<{ changed: boolean }>
}

/** The 0.1.7 registry owns declarations; this package never writes its profile. */
export class DeclaredPresetStatus implements InstallationController {
  constructor(private readonly registry: { list(): Promise<readonly { id: string; name?: string; broken?: string }[]> }) {}

  async status(): Promise<PresetInstallationStatus> {
    const preset = (await this.registry.list()).find(row => row.id === 'super-code')
    return { id: 'super-code', name: preset?.name, authorable: false, userConflict: false,
      state: preset ? preset.broken ? 'broken' : 'available' : 'missing' }
  }

  async install(_id: unknown, _name?: string): Promise<PresetInstallationResult> {
    return { ok: false, error: 'no-user-root', status: await this.status() }
  }

  async reinstall(_previousId: string, _id: unknown, _name?: string): Promise<PresetInstallationResult> {
    return { ok: false, error: 'no-user-root', status: await this.status() }
  }

  async synchronize(_language: string): Promise<{ changed: boolean }> { return { changed: false } }
}

export class SuperCodePresets extends TypertRemoteService {
  private readonly installer: InstallationController
  constructor(ctx: Context, installer: InstallationController) {
    super(ctx, 'superCodePresets')
    this.installer = installer
  }
  @Remote
  status(): Promise<PresetInstallationStatus> { return this.installer.status() }
  @Remote
  installPreset(id: unknown, name?: string): Promise<PresetInstallationResult> { return this.installer.install(id, name === '' ? undefined : name) }
  @Remote
  reinstallPreset(previousId: string, id: unknown, name?: string): Promise<PresetInstallationResult> { return this.installer.reinstall(previousId, id, name === '' ? undefined : name) }
  @Remote
  synchronize(language: string): Promise<{ changed: boolean }> { return this.installer.synchronize(language) }
}

export function applyPresetInstallation(ctx: Context): void {
  ctx.inject(['agentPresets', 'settings'], async owner => {
    const registry = owner.agentPresets as unknown as { roots?: unknown; list(): Promise<readonly { id: string; name?: string; broken?: string }[]> }
    if (!Array.isArray(registry.roots)) {
      new SuperCodePresets(owner, new DeclaredPresetStatus(registry))
      return
    }
    const settings = owner.settings.register('super-code', s.object({
      checked: s.boolean().default(false),
      installedId: s.string().default(''),
      installation: s.object({ id: s.string(), path: s.string(), token: s.string(), dev: s.number(), ino: s.number() }).required(false),
      pendingDisplay: s.dict(s.object({ name: s.string().required(false), description: s.string().required(false) })).default({}),
      display: s.dict(s.object({ name: s.string().required(false), description: s.string().required(false) })).default({}),
    }))
    const installer = new PresetInstaller(owner.agentPresets, settings, sourceRoot, owner.baseUrl)
    new SuperCodePresets(owner, installer)
    try {
      await installer.initialize()
      const language = owner.settings.get('locale') as { preference?: string } | undefined
      if (language?.preference) await installer.synchronize(language.preference)
    } catch {
      owner.logger.warn('Super Code preset installation unavailable; retry in plugin settings.')
    }
  })
}
