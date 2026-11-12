import { isDirectoryMetadata } from './directory-metadata.js'
/** Install a profile-owned continuation shim without modifying the host or old conversation logs. */
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import yaml from 'js-yaml'
import { appendProfilePatches, declarationSchema } from './preset-declaration.js'
import { RecoveryState, compositionContent, fingerprint } from './preset-recovery-runtime.js'
import type { RecoveryConfig } from './preset-recovery-runtime.js'

const entryId = 'super-code-session-recovery'
const ownedEntryId = new RegExp(`^${entryId}(?:-[a-f0-9]{24})?$`)
interface PreparedRecovery { modulePath: string; config: RecoveryConfig & { owner: 'dsh-super-code' } }
interface RecoveryEntry { id: string; name: string; config: PreparedRecovery['config']; disabled?: boolean }
interface ProfileRow { id?: string; name?: string; disabled?: boolean; config?: unknown; group?: boolean; insert?: ProfileRow[] }

/** Track only root recovery definitions and the overrides that the Loader applies to them. */
function recoveryEntries(rows: ProfileRow[], directory: string, statePath: string): Map<string, RecoveryEntry> {
  const entries = new Map<string, RecoveryEntry>()
  const conflict = () => { throw new Error('Recovery entry conflict') }
  const reserved = (id: unknown): id is string => typeof id === 'string' && ownedEntryId.test(id)
  const owned = (value: unknown): value is PreparedRecovery['config'] => {
    const config = value as Partial<PreparedRecovery['config']> | undefined
    return config?.owner === 'dsh-super-code' && config.statePath === statePath && typeof config.packagePath === 'string'
  }
  const seen = new Set<unknown>()
  const rejectNested = (value: unknown): void => {
    if (!Array.isArray(value) || seen.has(value)) return
    seen.add(value)
    for (const row of value as ProfileRow[]) {
      if (reserved(row?.id)) conflict()
      if (row?.group) rejectNested(row.config)
    }
  }
  for (const row of rows) {
    if (Array.isArray(row?.insert)) {
      if (row.id) {
        if (reserved(row.id)) conflict()
        rejectNested(row.insert)
        continue
      }
      for (const item of row.insert) {
        if (item?.group) rejectNested(item.config)
        if (!reserved(item?.id)) continue
        const generation = typeof item.name === 'string' && /\/recovery-([a-f0-9]{24})\.mjs$/.exec(item.name)?.[1]
        if (!generation || item.name !== pathToFileURL(join(directory, `recovery-${generation}.mjs`)).href
          || item.id !== entryId && item.id !== `${entryId}-${generation}`
          || item.group || entries.has(item.id) || !owned(item.config)) throw new Error('Recovery entry conflict')
        entries.set(item.id, { id: item.id, name: item.name, config: item.config, disabled: item.disabled })
      }
    } else if (reserved(row?.id)) {
      const entry = entries.get(row.id)
      if (!entry) throw new Error('Recovery entry conflict')
      if (row.name && row.name !== entry.name) continue // Name is a guard, not a rename.
      if (Object.hasOwn(row, 'config')) {
        if (!owned(row.config)) throw new Error('Recovery entry conflict')
        entry.config = row.config
      }
      if (row.group) conflict()
      if (Object.hasOwn(row, 'disabled')) entry.disabled = row.disabled
    } else if (row?.group) rejectNested(row.config)
  }
  return entries
}

async function regularContent(path: string): Promise<string> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe recovery file')
    return await readFile(path, 'utf8')
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error }
}
async function createOwnedFile(path: string, content: string): Promise<void> {
  try { await writeFile(path, content, { flag: 'wx', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await regularContent(path) !== content) throw error }
}

/** Preserve the user's YAML and expressions, with a concrete backup and stale-write check. */
export async function prepareRecovery(patchPath: string, packagePath: string, source: string): Promise<PreparedRecovery> {
  const directory = join(dirname(patchPath), '.super-code-recovery')
  let created = false
  try { await mkdir(directory, { mode: 0o700 }); created = true }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe recovery directory')
  const statePath = join(directory, 'state.json')
  if (!await regularContent(statePath)) {
    if (!created && (await readdir(directory, { withFileTypes: true })).some(entry => !isDirectoryMetadata(entry))) throw new Error('Unowned recovery directory')
    await createOwnedFile(statePath, JSON.stringify({ plugin: 'dsh-super-code', format: 1, sessions: {} }))
  }
  await RecoveryState.open(statePath)
  const generation = fingerprint(source).slice(0, 24)
  const modulePath = join(directory, `recovery-${generation}.mjs`)
  await createOwnedFile(modulePath, source)
  const config: PreparedRecovery['config'] = { owner: 'dsh-super-code', statePath, packagePath }
  const entry = { id: `${entryId}-${generation}`, name: pathToFileURL(modulePath).href, config }
  const original = await regularContent(patchPath)
  const rows = original.trim() ? yaml.load(original, { schema: declarationSchema }) : []
  if (!Array.isArray(rows)) throw new Error('Invalid profile patch')
  const latest = recoveryEntries(rows, directory, statePath)
  const current = latest.get(entry.id)
  const retired = [...latest.values()].filter(row => row.id !== entry.id && row.disabled !== true)
  if (!retired.length && current && current.disabled !== true && current.config.packagePath === packagePath) return { modulePath, config }
  // Loader patch names are guards, not renames. Each immutable runtime gets
  // its own entry; retire only verified owned predecessors, including legacy IDs.
  const patches = [...retired.map(row => ({ id: row.id, name: row.name, disabled: true })),
    current ? { ...entry, disabled: false } : { insert: [entry] }]
  const content = appendProfilePatches(original, patches)
  await createOwnedFile(join(directory, `patch-before-${fingerprint(original).slice(0, 24)}.yml`), original)
  const staging = await mkdtemp(join(directory, '.patch-'))
  try {
    const file = join(staging, 'cordis.patch.yml')
    await writeFile(file, content, { mode: 0o600 })
    if (await regularContent(patchPath) !== original) throw new Error('Profile patch changed during recovery setup')
    await rename(file, patchPath)
  } finally { await rm(staging, { recursive: true, force: true }) }
  return { modulePath, config }
}

export async function registerRecoverySessions(ctx: Context): Promise<void> {
  const registry = ctx.get('agentPresets') as { list(): Promise<{ id: string }[]> }
  const ids: string[] = []
  for (const row of await registry.list()) {
    try {
      const plugins = yaml.load(await compositionContent(ctx, row.id), { schema: declarationSchema })
      if (Array.isArray(plugins) && plugins.filter(plugin => plugin?.name === 'dsh-super-code/super-code' && plugin.disabled !== true).length === 1) ids.push(row.id)
    } catch { ctx.logger.warn('A preset could not be inspected for Super Code uninstall recovery; other presets will still be registered.') }
  }
  await ctx.superCodeSessionRecovery.backfill(ids)
}

export function applyPresetRecovery(ctx: Context): void {
  ctx.inject(['agentPresets', 'sessionProjections', 'tools'], async owner => {
    const profile = owner.get('profileContext') as { patchPath?: string } | undefined
    let patchPath = profile?.patchPath
    if (!patchPath) {
      // Early directory-preset releases expose the profile only through root.baseUrl.
      try {
        if (!owner.root.baseUrl) return
        const directory = fileURLToPath(owner.root.baseUrl)
        const manifest = JSON.parse(await regularContent(join(directory, 'package.json')))
        if (!Array.isArray(manifest.dsh?.profile?.bundles) || !manifest.dsh.profile.bundles.includes('dsh-super-code')) return
        patchPath = join(directory, 'cordis.patch.yml')
      } catch { return }
    }
    try {
      const source = await readFile(new URL('./preset-recovery-runtime.js', import.meta.url), 'utf8')
      const prepare = () => prepareRecovery(patchPath!, join(dirname(patchPath!), 'node_modules/dsh-super-code/package.json'), source)
      const hmr = owner.get('hmr') as { runExclusive<T>(run: () => Promise<T>): Promise<T> } | undefined
      const prepared = await (hmr ? hmr.runExclusive(prepare) : prepare())
      // Owned by the host root, so removing the main plugin does not dispose recovery.
      await owner.root.plugin(await import(pathToFileURL(prepared.modulePath).href) as Plugin.Object, prepared.config)
      owner.inject(['superCodeSessionRecovery', 'sessionQuery'], async ready => {
        try {
          await registerRecoverySessions(ready)
        } catch { ready.logger.warn('Some existing Super Code sessions could not be registered for uninstall recovery.') }
      })
    } catch { owner.logger.warn('Super Code uninstall recovery is unavailable; check the profile recovery files and patch permissions.') }
  })
}
