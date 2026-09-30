/** Copy only this plugin's bundled preset; discovery stays with the host. */
import { chmod, cp, lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import yaml from 'js-yaml'

export interface PresetRoot { path: string; trust: 'user' | 'system' }
export interface DirectoryPreset { id: string; name?: string; description?: string; path: string; trust: 'user' | 'system'; broken?: string }
export interface DirectoryPresets { roots: readonly PresetRoot[]; list(): Promise<readonly DirectoryPreset[]> }

export function writableRoot(roots: readonly PresetRoot[], _id: string): string {
  const root = roots.find(value => value.trust === 'user')
  if (!root) throw new Error('No user preset root')
  return resolve(root.path === '~' ? homedir() : root.path.startsWith('~/') ? join(homedir(), root.path.slice(2)) : root.path)
}

export async function readPresetMetadata(directory: string): Promise<{ name?: string; description?: string }> {
  try {
    const parsed = yaml.load(await readFile(join(directory, 'preset.yml'), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const value = parsed as Record<string, unknown>
    return Object.fromEntries(['name', 'description'].flatMap(key => typeof value[key] === 'string' && value[key].trim() ? [[key, value[key].trim()]] : []))
  } catch { return {} }
}

export async function copyBundledPreset(bundledRoot: string, staging: string, id: string, name: string): Promise<{ directory: string; description?: string }> {
  const source = join(bundledRoot, 'super-code')
  if (!(await lstat(join(source, 'agent.cordis.yml'))).isFile()) throw new Error('Bundled preset is unavailable')
  const metadata = await readPresetMetadata(source), directory = join(staging, id)
  await cp(source, directory, { recursive: true, dereference: false, force: false, errorOnExist: true })
  // Reject symlinks in shipped content rather than copying through another tree.
  const pending = [directory]
  while (pending.length) {
    const path = pending.pop()!, stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error('Bundled preset contains a symbolic link')
    await chmod(path, stat.isDirectory() ? 0o700 : 0o600)
    if (stat.isDirectory()) for (const entry of await readdir(path)) pending.push(join(path, entry))
  }
  await writeFile(join(directory, 'preset.yml'), yaml.dump({ name, ...(metadata.description ? { description: metadata.description } : {}) }), { mode: 0o600 })
  return { directory, ...(metadata.description ? { description: metadata.description } : {}) }
}
