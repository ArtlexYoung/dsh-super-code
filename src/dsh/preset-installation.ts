/** Host-only preset discovery repair; never part of a model's tool surface. */
import { cp, lstat, mkdir, mkdtemp, readdir, rm, readFile, writeFile, rename, realpath } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import s from '@deepseek-ai/schemastery'
import { copyBundledPreset, writableRoot, type DirectoryPreset, type DirectoryPresets } from './preset-files.js'
import { displayCopy, migrateMetadata, type DisplayBaseline } from './preset-metadata.js'
import { compositionVersion, directoryVersion, pluginVersion } from './preset-version.js'
import { DeclarationStateFile, DeclaredPresetInstaller, type DeclarationHost } from './preset-declaration.js'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

interface InstallationIdentity { id: string; path: string; token: string; dev: number; ino: number }
interface InstallationSettings {
  checked: boolean
  installedId: string
  installation?: InstallationIdentity
  installations?: Record<string, InstallationIdentity>
  display?: Record<string, DisplayBaseline>
  pendingDisplay?: Record<string, DisplayBaseline>
}
export interface PresetInstallationStatus {
  state: 'available' | 'installed' | 'conflict' | 'missing' | 'broken'
  id: string
  name?: string
  authorable: boolean
  userConflict: boolean
  delivery: 'directory' | 'declaration'
  pluginVersion: string
  presetVersion?: string
  reinstallable?: boolean
}
export interface PresetInstallationResult {
  ok: boolean
  status: PresetInstallationStatus
  error?: 'ownership-unverified' | 'invalid-name' | 'invalid-display-name' | 'name-taken' | 'no-user-root' | 'management-unavailable' | 'install-failed'
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

function installationRecords(settings: InstallationSettings): Record<string, InstallationIdentity> {
  return { ...settings.installations, ...(settings.installation ? { [settings.installation.id]: settings.installation } : {}) }
}

async function sameDirectory(path: string, identity: { dev: number; ino: number }): Promise<boolean> {
  try {
    const stat = await lstat(path)
    return stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === identity.dev && stat.ino === identity.ino
  } catch { return false }
}

/** Serialized writes protect double clicks; mkdir claims only an unoccupied name. */
export class PresetInstaller {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly roster: DirectoryPresets,
    private readonly settings: SettingsScope<InstallationSettings>,
    private readonly bundledRoot: string = sourceRoot,
    private readonly baseUrl: string = pathToFileURL(bundledRoot).href,
  ) {}

  async status(): Promise<PresetInstallationStatus> {
    const stored = this.settings.get(), savedId = stored.installedId
    const id = validId.test(savedId) ? savedId : 'super-code'
    const presets = await this.roster.list()
    const preset = presets.find(row => row.id === id)
    const authorable = this.roster.roots.some(root => root.trust === 'user')
    const occupied = await this.occupied(id)
    const ownedCopy = !!preset && await this.owns(preset, installationRecords(stored)[id])
    const userConflict = occupied && !ownedCopy
    if (preset) {
      const owned = preset.trust === 'system' && resolve(preset.path) === join(this.bundledRoot, 'super-code', 'agent.cordis.yml')
      return { id, name: preset.name, authorable, userConflict, delivery: 'directory', pluginVersion,
        ...await directoryVersion(preset.path), state: preset.broken ? 'broken' : owned ? 'available'
        : ownedCopy ? 'installed' : 'conflict' }
    }
    return { id, authorable, userConflict, delivery: 'directory', pluginVersion, state: occupied ? 'conflict' : 'missing' }
  }

  private async owns(preset: DirectoryPreset, identity?: InstallationIdentity): Promise<boolean> {
    if (preset.trust !== 'user' || !identity || identity.id !== preset.id) return false
    const directory = join(preset.path, '..')
    try {
      if (!await sameDirectory(directory, identity) || await realpath(directory) !== identity.path) return false
      const roots = await Promise.all(this.roster.roots.filter(root => root.trust === 'user')
        .map(async root => {
          try { return join(await realpath(writableRoot([root], preset.id)), preset.id) }
          catch { return false }
        }))
      if (!roots.includes(identity.path)) return false
      const path = join(directory, ownershipFile), stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink()) return false
      const marker = JSON.parse(await readFile(path, 'utf8'))
      return marker?.plugin === 'dsh-super-code' && marker.id === identity.id && marker.token === identity.token
    } catch { return false }
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
      const installations = installationRecords(stored)
      const display = { ...stored.display }
      const pendingDisplay = { ...stored.pendingDisplay }
      let changed = false
      for (const preset of await this.roster.list()) {
        const bundled = preset.trust === 'system' && resolve(preset.path) === join(this.bundledRoot, 'super-code', 'agent.cordis.yml')
        const owned = await this.owns(preset, installations[preset.id])
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
          if (owned && !await this.owns(preset, installations[preset.id])) throw new Error('Preset ownership changed during migration')
          pendingDisplay[preset.path] = baseline
          await this.settings.update({ pendingDisplay: { ...pendingDisplay } })
          if (owned && !await this.owns(preset, installations[preset.id])) throw new Error('Preset ownership changed during migration')
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
      const preset = (await this.roster.list()).find(row => row.id === previousId)
      if (!preset || !await this.owns(preset, installation)) return reject('ownership-unverified')
      const originalPath = join(preset.path, '..')
      let backup = ''
      try {
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
    let claimed: { dev: number; ino: number } | false = false
    const target = join(writableRoot(this.roster.roots, id), id)
    try {
      const root = writableRoot(this.roster.roots, id)
      await mkdir(root, { recursive: true, mode: 0o700 })
      staging = await mkdtemp(join(root, '.super-code-install-'))
      // The host copy helper can clean up its destination on failure. Isolate
      // it from user-owned paths, then exclusively claim the final directory.
      const source = await copyBundledPreset(this.bundledRoot, staging, id, name?.trim() ?? 'Super Code')
      const prepared = source.directory
      await mkdir(target, { mode: 0o700 })
      const claim = await lstat(target)
      if (!claim.isDirectory() || claim.isSymbolicLink()) throw new Error('Installation directory changed')
      claimed = { dev: claim.dev, ino: claim.ino }
      for (const entry of await readdir(prepared)) {
        await cp(join(prepared, entry), join(target, entry), { recursive: true, force: false, errorOnExist: true })
      }
      const token = randomUUID()
      await writeFile(join(target, ownershipFile), JSON.stringify({ plugin: 'dsh-super-code', id, token }), { flag: 'wx', mode: 0o600 })
      const directory = await lstat(target)
      if (!await sameDirectory(target, claimed)) throw new Error('Installation directory changed')
      const installation = { id, path: await realpath(target), token, dev: directory.dev, ino: directory.ino }
      const stored = this.settings.get(), installations = installationRecords(stored)
      const display = { ...stored.display }, pendingDisplay = { ...stored.pendingDisplay }
      if (replacedPath) {
        delete display[join(replacedPath, 'agent.cordis.yml')]
        delete pendingDisplay[join(replacedPath, 'agent.cordis.yml')]
        if (stored.installation) delete installations[stored.installation.id]
      }
      const status: PresetInstallationStatus = { id, authorable: true, userConflict: false, state: 'installed',
        delivery: 'directory', pluginVersion, ...await directoryVersion(join(target, 'agent.cordis.yml')) }
      await this.settings.update({ checked: true, installedId: id, installation, installations: { ...installations, [id]: installation }, pendingDisplay, display: {
        ...display,
        [join(target, 'agent.cordis.yml')]: {
          ...(name === undefined ? { name: 'Super Code' } : {}),
          ...(source.description === undefined ? {} : { description: source.description }),
        },
      } })
      claimed = false
      return { ok: true, status }
    } catch (error) {
      if (claimed && await sameDirectory(target, claimed)) await rm(target, { recursive: true, force: true })
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

export interface DeclaredPresetRegistry {
  list(): Promise<readonly { id: string; name?: string; broken?: string }[]>
  readDocument?(id: string): Promise<{ agentPreset: string; content: string }>
}

/** Read-only fallback when a declarative host exposes no profile management. */
export class DeclaredPresetStatus implements InstallationController {
  constructor(private readonly registry: DeclaredPresetRegistry) {}

  async status(): Promise<PresetInstallationStatus> {
    const preset = (await this.registry.list()).find(row => row.id === 'super-code')
    let version = {}
    if (preset && this.registry.readDocument) {
      try {
        const document = await this.registry.readDocument(preset.id)
        if (document.agentPreset === preset.id) version = compositionVersion(document.content)
      } catch { /* A missing or unreadable declaration has an unknown version. */ }
    }
    return { id: 'super-code', name: preset?.name, authorable: false, userConflict: false,
      delivery: 'declaration', pluginVersion, ...version,
      state: preset ? preset.broken ? 'broken' : 'available' : 'missing' }
  }

  async install(_id: unknown, _name?: string): Promise<PresetInstallationResult> {
    return { ok: false, error: 'management-unavailable', status: await this.status() }
  }

  async reinstall(_previousId: string, _id: unknown, _name?: string): Promise<PresetInstallationResult> {
    return { ok: false, error: 'management-unavailable', status: await this.status() }
  }

  async synchronize(_language: string): Promise<{ changed: boolean }> { return { changed: false } }
}

async function declarationHost(owner: Context): Promise<DeclarationHost | false> {
  const profile = owner.get('profileContext') as { patchPath?: string; installAnchor?: string } | undefined
  const loader = owner.get('loader') as Context['loader'] | undefined
  if (!profile?.patchPath || !loader) return false
  try {
    // Resolve the running host's public API, rather than a second bundled host.
    const require = createRequire(profile.installAnchor ?? new URL('package.json', owner.baseUrl))
    const boot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
    if (typeof boot.readProfilePatches !== 'function' || typeof boot.reconcileProfilePatches !== 'function') return false
    const hmr = owner.get('hmr') as { runExclusive<T>(run: () => Promise<T>): Promise<T> } | undefined
    return {
      patchPath: profile.patchPath,
      entries: () => [...loader.entries()].map(row => ({ id: row.options.id, disabled: row.disabled, options: row.options })),
      reload: async () => { await boot.reconcileProfilePatches(owner.root, boot.readProfilePatches('dsh', profile), 'dsh') },
      exclusive: run => hmr ? hmr.runExclusive(run) : run(),
    }
  } catch { return false }
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
    const registry = owner.get('agentPresets') as DeclaredPresetRegistry & { roots?: unknown }
    if (!Array.isArray(registry.roots)) {
      const host = await declarationHost(owner)
      if (!host) { new SuperCodePresets(owner, new DeclaredPresetStatus(registry)); return }
      try {
        const settings = await DeclarationStateFile.open(join(host.patchPath, '..', '.super-code-presets.json'))
        new SuperCodePresets(owner, new DeclaredPresetInstaller(registry, settings, host,
          fileURLToPath(new URL('../../cordis.patch.yml', import.meta.url))))
      } catch {
        new SuperCodePresets(owner, new DeclaredPresetStatus(registry))
        owner.logger.warn('Super Code preset management unavailable; check the local installation record.')
      }
      return
    }
    const settings = owner.settings.register('super-code', s.object({
      checked: s.boolean().default(false),
      installedId: s.string().default(''),
      installation: s.object({ id: s.string(), path: s.string(), token: s.string(), dev: s.number(), ino: s.number() }).required(false),
      installations: s.dict(s.object({ id: s.string(), path: s.string(), token: s.string(), dev: s.number(), ino: s.number() })).required(false),
      pendingDisplay: s.dict(s.object({ name: s.string().required(false), description: s.string().required(false) })).default({}),
      display: s.dict(s.object({ name: s.string().required(false), description: s.string().required(false) })).default({}),
    }))
    const installer = new PresetInstaller(registry as DirectoryPresets, settings, sourceRoot, owner.baseUrl)
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
