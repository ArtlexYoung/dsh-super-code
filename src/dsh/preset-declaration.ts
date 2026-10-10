/** Manage this plugin's declarations through the host's profile patch layer. */
import { randomUUID } from 'node:crypto'
import { lstat, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'
import { displayCopy, type DisplayBaseline } from './preset-metadata.js'
import { compositionVersion, pluginVersion } from './preset-version.js'
import type { DeclaredPresetRegistry, PresetInstallationResult, PresetInstallationStatus } from './preset-installation.js'

const presetModule = '@deepseek-ai/dsh-agent-preset'
const bundledToken = 'bundle:dsh-super-code'
const validId = /^[a-z0-9][a-z0-9-]{0,63}$/

// Round-trip Loader expressions as data; evaluation belongs to the host.
export const declarationSchema: yaml.Schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar', construct: (value: string) => ({ __jsExpr: value }),
  predicate: (value: unknown) => !!value && typeof value === 'object'
    && Object.keys(value).length === 1 && typeof (value as { __jsExpr?: unknown }).__jsExpr === 'string',
  represent: (value: object) => (value as { __jsExpr: string }).__jsExpr,
}))

export interface DeclarationConfig {
  id: string
  name?: string
  description?: string
  order?: number
  plugins: Array<{ name?: string; config?: Record<string, unknown>; [key: string]: unknown }>
}
export interface DeclarationEntry {
  id: string
  disabled?: boolean
  options: { name: string; config?: DeclarationConfig }
}
export interface DeclarationHost {
  patchPath: string
  entries(): readonly DeclarationEntry[]
  reload(): Promise<void>
  exclusive<T>(run: () => Promise<T>): Promise<T>
}
export interface DeclarationSettings {
  declaration?: { entryId: string; id: string; token: string }
  declarationDisplay?: DisplayBaseline
}
export interface DeclarationState {
  get(): DeclarationSettings
  update(patch: Partial<DeclarationSettings>): Promise<void>
}

/** Newer settings providers edit Loader forms; installation records stay local. */
export class DeclarationStateFile implements DeclarationState {
  private constructor(private readonly path: string, private value: DeclarationSettings) {}
  static async open(path: string): Promise<DeclarationStateFile> {
    let value: DeclarationSettings = {}
    try {
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe installation record')
      const record = JSON.parse(await readFile(path, 'utf8'))
      if (!record || record.plugin !== 'dsh-super-code' || record.format !== 1) throw new Error('Unknown installation record')
      const saved = record.declaration
      if (saved !== undefined && (!saved || typeof saved !== 'object' || Array.isArray(saved)
        || typeof saved.entryId !== 'string' || typeof saved.id !== 'string' || !validId.test(saved.id)
        || typeof saved.token !== 'string' || !/^[0-9a-f-]{36}$/.test(saved.token))) throw new Error('Invalid installation record')
      const display = record.declarationDisplay
      if (display && (typeof display !== 'object' || Array.isArray(display)
        || ['name', 'description'].some(key => display[key] !== undefined && typeof display[key] !== 'string'))) throw new Error('Invalid display record')
      value = { declaration: saved, declarationDisplay: display }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return new DeclarationStateFile(path, value)
  }
  get(): DeclarationSettings { return structuredClone(this.value) }
  async update(patch: Partial<DeclarationSettings>): Promise<void> {
    try {
      const stat = await lstat(this.path)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe installation record')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const value = { ...this.value, ...patch }
    const stage = await mkdtemp(join(dirname(this.path), '.super-code-record-'))
    try {
      const file = join(stage, 'record.json')
      await writeFile(file, JSON.stringify({ plugin: 'dsh-super-code', format: 1, ...value }), { mode: 0o600 })
      await rename(file, this.path)
      this.value = value
    } finally { await rm(stage, { recursive: true, force: true }) }
  }
}

function tokenOf(config?: DeclarationConfig): string {
  const rows = Array.isArray(config?.plugins)
    ? config.plugins.filter(row => row && row.name === 'dsh-super-code/super-code') : []
  const value = rows.length === 1 ? rows[0]?.config?.presetInstallation : ''
  return typeof value === 'string' ? value : ''
}
function dump(value: unknown): string { return yaml.dump(value, { schema: declarationSchema, noRefs: true, lineWidth: -1 }) }

/** Only marked bundle rows or UUID-matched manual installations may be replaced. */
export class DeclaredPresetInstaller {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly registry: DeclaredPresetRegistry,
    private readonly settings: DeclarationState,
    private readonly host: DeclarationHost,
    private readonly bundlePath: string,
  ) {}

  private entry(): DeclarationEntry | false {
    const saved = this.settings.get().declaration
    const entries = this.host.entries().filter(row => row.options.name === presetModule)
    const candidates = saved ? entries.filter(row => row.id === saved.entryId
      && row.options.config?.id === saved.id && tokenOf(row.options.config) === saved.token)
      : entries.filter(row => row.id === 'preset-super-code'
        && row.options.config?.id === 'super-code' && tokenOf(row.options.config) === bundledToken)
    return candidates.length === 1 ? candidates[0]! : false
  }

  private async document(id: string): Promise<{ presetVersion?: string; token?: string }> {
    try {
      if (!this.registry.readDocument) {
        // 0.1.7 alpha hosts have no document reader. Only a unique enabled
        // Loader declaration can account for their active registry identity.
        const entries = this.host.entries().filter(row => row.options.name === presetModule
          && !row.disabled && (row.options as { disabled?: unknown }).disabled !== true
          && row.options.config?.id === id)
        if (entries.length !== 1) return {}
        const config = entries[0]!.options.config!
        return { ...compositionVersion(dump(config.plugins)), token: tokenOf(config) }
      }
      const document = await this.registry.readDocument(id)
      if (document.agentPreset !== id) return {}
      const plugins = yaml.load(document.content, { schema: declarationSchema })
      if (!Array.isArray(plugins)) return {}
      return { ...compositionVersion(document.content), token: tokenOf({ id, plugins }) }
    } catch { return {} }
  }

  async status(): Promise<PresetInstallationStatus> {
    const saved = this.settings.get().declaration
    const entry = this.entry()
    const id = entry ? entry.options.config!.id : saved?.id ?? 'super-code'
    const preset = (await this.registry.list()).find(row => row.id === id)
    const document = preset ? await this.document(id) : {}
    const owned = !!entry && !!document.token && document.token === tokenOf(entry.options.config)
    return { id, name: preset?.name, authorable: true, userConflict: !!preset && !owned,
      delivery: 'declaration', pluginVersion, ...(document.presetVersion ? { presetVersion: document.presetVersion } : {}),
      reinstallable: !!preset && owned,
      state: preset ? !owned ? 'conflict' : preset.broken ? 'broken' : 'installed' : 'missing' }
  }

  async install(id: unknown, name?: string): Promise<PresetInstallationResult> {
    return this.enqueue(async () => {
      try { return await this.replace(false, id, name) }
      catch { return this.reject('install-failed') }
    })
  }

  async reinstall(previousId: string, id: unknown, name?: string): Promise<PresetInstallationResult> {
    return this.enqueue(async () => {
      try { return await this.replace(previousId, id, name) }
      catch { return this.reject('install-failed') }
    })
  }

  private async reject(error: NonNullable<PresetInstallationResult['error']>): Promise<PresetInstallationResult> {
    return { ok: false, error, status: await this.status() }
  }

  private async replace(previousId: string | false, id: unknown, name?: string): Promise<PresetInstallationResult> {
    if (typeof id !== 'string' || !validId.test(id)) return this.reject('invalid-name')
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 120)) return this.reject('invalid-display-name')
    const entry = this.entry()
    const roster = await this.registry.list()
    if (previousId && (!entry || entry.options.config?.id !== previousId
      || !(await this.status()).reinstallable)) return this.reject('ownership-unverified')
    if (roster.some(row => row.id === id && row.id !== previousId)) return this.reject('name-taken')
    if (!previousId && entry && roster.some(row => row.id === entry.options.config?.id)) return this.reject('name-taken')
    const rows = yaml.load(await readFile(this.bundlePath, 'utf8'), { schema: declarationSchema }) as Array<{ insert?: DeclarationEntry['options'][] }>
    const template = rows.flatMap(row => row.insert ?? []).find(row => row.name === presetModule)?.config
    if (!template || !Array.isArray(template.plugins) || tokenOf(template) !== bundledToken) return this.reject('install-failed')
    const token = randomUUID()
    const config: DeclarationConfig = { ...template, id, name: name?.trim() ?? displayCopy('en').name }
    config.plugins = template.plugins.map(row => row.name === 'dsh-super-code/super-code'
      ? { ...row, config: { ...row.config, presetInstallation: token } } : row)
    const entryId = entry ? entry.id : `super-code-preset-${randomUUID()}`
    const patch = entry ? { id: entryId, name: presetModule, disabled: false, config }
      : { insert: [{ id: entryId, name: presetModule, config }] }
    try {
      await this.save(patch, entry, async () => {
        await this.settings.update({ declaration: { entryId, id, token }, declarationDisplay: {
          ...(name === undefined ? { name: config.name } : {}), description: config.description,
        } })
      }, async () => {
        if ((await this.status()).state !== 'installed') throw new Error('Preset activation failed')
      })
      const status = await this.status()
      return { ok: status.state === 'installed', ...(status.state === 'installed' ? {} : { error: 'install-failed' as const }), status }
    } catch { return this.reject('install-failed') }
  }

  async synchronize(language: string): Promise<{ changed: boolean }> {
    if (!/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(language)) throw new Error('Invalid language')
    return this.enqueue(async () => {
      const entry = this.entry()
      if (!entry || !(await this.registry.list()).some(row => row.id === entry.options.config?.id)) return { changed: false }
      if (!(await this.status()).reinstallable) return { changed: false }
      const current = entry.options.config!, copy = displayCopy(language)
      const previous = this.settings.get().declarationDisplay
      const baseline: DisplayBaseline = {}, config = { ...current }
      for (const field of ['name', 'description'] as const) {
        const defaults = [displayCopy('en')[field], displayCopy('zh')[field]]
        const managed = previous ? previous[field] !== undefined && current[field] === previous[field]
          : current[field] !== undefined && defaults.includes(current[field]!)
        if (managed) { config[field] = copy[field]; baseline[field] = copy[field] }
      }
      const changed = config.name !== current.name || config.description !== current.description
      if (!changed) {
        await this.settings.update({ declarationDisplay: baseline })
        return { changed: false }
      }
      await this.save({ id: entry.id, name: presetModule, config }, entry,
        () => this.settings.update({ declarationDisplay: baseline }))
      return { changed: true }
    })
  }

  /** Back up first, refuse a stale file, and restore only our own failed write. */
  private async save(patch: object, entry: DeclarationEntry | false, persist: () => Promise<void>, validate?: () => Promise<void>): Promise<void> {
    const path = this.host.patchPath
    const expectedEntry = entry ? dump(entry.options) : ''
    let original = ''
    try {
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe patch path')
      original = await readFile(path, 'utf8')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const rows = original.trim() ? yaml.load(original, { schema: declarationSchema }) : []
    if (!Array.isArray(rows)) throw new Error('Invalid profile patch')
    // Block YAML can be extended without changing the user's comments or fields.
    const prefix = rows.length && /^[ \t]*-/m.test(original) ? original.trimEnd() + '\n'
      : rows.length ? dump(rows) : original.replace(/^[ \t]*\[\][ \t]*(?:#.*)?$/m, '').trimEnd() + '\n'
    const content = prefix + dump([patch])
    const backup = await mkdtemp(join(dirname(path), '.super-code-backup-'))
    await writeFile(join(backup, 'cordis.patch.yml'), original, { flag: 'wx', mode: 0o600 })
    if (entry) await writeFile(join(backup, 'preset.yml'), dump(entry.options.config), { flag: 'wx', mode: 0o600 })
    const stored = this.settings.get()
    let committed = false, persisted = false
    try {
      const actual = this.entry()
      if (await this.readPatch() !== original || entry && (!actual || actual.id !== entry.id || dump(actual.options) !== expectedEntry)) throw new Error('Preset changed during installation')
      await this.atomicWrite(content)
      committed = true
      await persist()
      persisted = true
      await this.host.reload()
      if (validate) await validate()
    } catch (error) {
      if (committed && await this.readPatch() === content) {
        await this.atomicWrite(original)
        if (persisted) await this.settings.update({ declaration: stored.declaration, declarationDisplay: stored.declarationDisplay })
        await this.host.reload()
      }
      throw error
    }
  }

  private async readPatch(): Promise<string> {
    try { return await readFile(this.host.patchPath, 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error }
  }

  private async atomicWrite(content: string): Promise<void> {
    const staging = await mkdtemp(join(dirname(this.host.patchPath), '.super-code-patch-'))
    try {
      const file = join(staging, 'cordis.patch.yml')
      await writeFile(file, content, { mode: 0o600 })
      await rename(file, this.host.patchPath)
    } finally { await rm(staging, { recursive: true, force: true }) }
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.tail.then(() => this.host.exclusive(run))
    this.tail = next.catch(() => {})
    return next
  }
}
