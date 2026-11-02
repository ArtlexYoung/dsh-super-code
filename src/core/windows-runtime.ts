/** Prepare the packaged Windows shell without an installer or changes to the system PATH. */
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, mkdtemp, readFile, writeFile, link, lstat, rename, rm } from 'node:fs/promises'

interface PayloadFile { readonly name: string; readonly asset: string; readonly arch: string; readonly bytes: number; readonly sha256: string }
interface Manifest { readonly id: string; readonly files: readonly PayloadFile[]; readonly applets: readonly string[] }
export interface WindowsRuntime {
  readonly root: string
  readonly bin: string
  readonly bash: string
  readonly version: string
  readonly arch: string
}

const packagedRoot = fileURLToPath(new URL('../../runtime/windows/', import.meta.url))
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

async function manifestAt(source: string): Promise<Manifest> {
  const value = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')) as Manifest
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(value.id)
    || !Array.isArray(value.files) || !Array.isArray(value.applets)
    || value.files.length > 20 || value.applets.length > 256
    || value.files.some(file => !file || typeof file !== 'object'
      || typeof file.name !== 'string' || !/^[a-z0-9.-]+\.(exe|dll)$/.test(file.name)
      || typeof file.asset !== 'string' || !/^[a-z0-9.-]+\.gz$/.test(file.asset)
      || !['all', 'x64', 'arm64'].includes(file.arch) || !/^[a-f0-9]{64}$/.test(file.sha256)
      || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 16 * 1024 * 1024)
    || new Set(value.applets).size !== value.applets.length
    || value.applets.some(name => typeof name !== 'string' || !/^[a-z0-9_-]+$/.test(name) || ['bash', 'sh', 'busybox'].includes(name))) {
    throw new Error('Invalid bundled Bash manifest')
  }
  return value
}

async function verify(root: string, files: readonly PayloadFile[], applets: readonly string[]): Promise<void> {
  const directory = await lstat(root)
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Unsafe bundled Bash cache')
  const bin = join(root, 'usr', 'bin')
  for (const directoryPath of [join(root, 'usr'), bin, join(root, 'tmp')]) {
    const stat = await lstat(directoryPath)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe bundled Bash directory')
  }
  for (const file of files) {
    const path = join(bin, file.name), stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes || digest(await readFile(path)) !== file.sha256) {
      throw new Error(`Bundled Bash file failed verification: ${file.name}`)
    }
  }
  const busybox = await lstat(join(bin, 'busybox.exe'), { bigint: true }), bash = await lstat(join(bin, 'bash.exe'), { bigint: true })
  for (const name of [...applets, 'sh']) {
    const target = name === 'sh' ? bash : busybox, stat = await lstat(join(bin, name + '.exe'), { bigint: true })
    if (!stat.isFile() || stat.isSymbolicLink() || stat.ino !== target.ino || stat.dev !== target.dev) {
      throw new Error(`Invalid bundled Bash command entry: ${name}`)
    }
  }
}

/** Decode only the manifest's fixed files, then publish the complete private runtime. */
export async function prepareWindowsRuntime(options: { cacheRoot?: string; arch?: string; source?: string } = {}): Promise<WindowsRuntime> {
  const arch = options.arch ?? process.arch
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`Bundled Bash does not support Windows ${arch}`)
  const source = options.source ?? packagedRoot, manifest = await manifestAt(source)
  const files = manifest.files.filter(file => file.arch === 'all' || file.arch === arch)
  if (new Set(files.map(file => file.name)).size !== files.length
    || !['bash.exe', 'msys-2.0.dll', 'busybox.exe'].every(name => files.some(file => file.name === name))) {
    throw new Error('Incomplete bundled Bash payload')
  }
  const cache = options.cacheRoot ?? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'dsh-super-code', 'shell')
  if (!isAbsolute(cache)) throw new Error('Bundled Bash cache must be an absolute path')
  await mkdir(cache, { recursive: true, mode: 0o700 })
  const root = join(cache, manifest.id + '-' + arch), bin = join(root, 'usr', 'bin')
  const runtime = { root, bin, bash: join(bin, 'bash.exe'), version: manifest.id, arch }
  try {
    await lstat(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const staging = await mkdtemp(join(cache, '.prepare-'))
    try {
      const target = join(staging, 'usr', 'bin')
      await mkdir(target, { recursive: true })
      await mkdir(join(staging, 'tmp'))
      for (const file of files) {
        const bytes = gunzipSync(await readFile(join(source, file.asset)), { maxOutputLength: file.bytes })
        if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error(`Corrupt bundled Bash payload: ${file.name}`)
        await writeFile(join(target, file.name), bytes, { flag: 'wx', mode: 0o700 })
      }
      for (const name of manifest.applets) await link(join(target, 'busybox.exe'), join(target, name + '.exe'))
      await link(join(target, 'bash.exe'), join(target, 'sh.exe'))
      await verify(staging, files, manifest.applets)
      try { await rename(staging, root) }
      catch (error) {
        // Another process may have completed the same immutable runtime first.
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        await verify(root, files, manifest.applets)
      }
    } finally { await rm(staging, { recursive: true, force: true }) }
  }
  await verify(root, files, manifest.applets)
  return runtime
}

/** Supply only shell-specific overrides; the host still scrubs its ambient credentials. */
export function windowsRuntimeEnvironment(runtime: WindowsRuntime, supplied: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const pathKey = Object.keys(supplied).sort().find(key => key.toUpperCase() === 'PATH')
  const parentKey = Object.keys(process.env).sort().find(key => key.toUpperCase() === 'PATH')
  const existing = pathKey ? supplied[pathKey] : parentKey ? process.env[parentKey] : ''
  const env: NodeJS.ProcessEnv = { ...supplied }
  for (const key of new Set([...Object.keys(process.env), ...Object.keys(supplied)])) {
    if (['PATH', 'BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS'].includes(key.toUpperCase()) || key.toUpperCase().startsWith('BASH_FUNC_')) env[key] = undefined
  }
  const overrides = { PATH: runtime.bin + ';' + (existing ?? ''), BB_GLOBBING: '0', BB_OVERRIDE_APPLETS: 'bash,sh',
    TERM: 'dumb', BASH_ENV: '', ENV: '' }
  // Newer hosts fold Windows aliases in insertion order before Node sorts keys.
  // Updating an existing property does not move it after a later alias/tombstone.
  for (const key of Object.keys(overrides)) delete env[key]
  return { ...env, ...overrides }
}
