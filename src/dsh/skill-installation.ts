/** Own only the copies installed below DSH's user Skill directory. */
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { isDirectoryMetadata } from './directory-metadata.js'

const marker = '.super-code-skill.json'
const owner = 'dsh-super-code'
const metadata = z.object({ owner: z.literal(owner), digest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict()
export type SkillCopyError = 'conflict' | 'modified' | 'write-failed'

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

/** Include every resource and executable bit; never follow user-provided links. */
async function digest(root: string): Promise<string> {
  const hash = createHash('sha256')
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (isDirectoryMetadata(entry)) continue
      if (!prefix && entry.name === marker) continue
      const path = join(directory, entry.name), name = prefix + entry.name
      if (entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) throw new Error('Unsupported Skill resource')
      if (entry.isDirectory()) { hash.update(JSON.stringify([name, 'directory'])); await walk(path, name + '/') }
      else hash.update(JSON.stringify([name, 'file', (await lstat(path)).mode & 0o111,
        createHash('sha256').update(await readFile(path)).digest('hex')]))
    }
  }
  await walk(root, '')
  return hash.digest('hex')
}

async function readMarker(directory: string): Promise<z.infer<typeof metadata> | false> {
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) return false
  const file = join(directory, marker)
  if (!await exists(file)) return false
  const infoFile = await lstat(file)
  if (!infoFile.isFile() || infoFile.isSymbolicLink()) return false
  try {
    const parsed = metadata.safeParse(JSON.parse(await readFile(file, 'utf8')))
    return parsed.success ? parsed.data : false
  } catch (error) { if (error instanceof SyntaxError) return false; throw error }
}

/** An unmarked root is never adopted, even if its name matches ours. */
export async function prepareSkillDirectory(directory: string): Promise<void> {
  if (!await exists(directory)) {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, marker), JSON.stringify({ owner }), { flag: 'wx' })
  }
  if (!await readMarker(directory)) throw new Error('Skill directory conflict')
}

async function replaceCopy(target: string, source: string, directory: string, present: boolean): Promise<void> {
  const staging = await mkdtemp(join(directory, '.stage-'))
  const old = join(directory, '.retired-' + randomUUID())
  try {
    const next = join(staging, 'content')
    await cp(source, next, { recursive: true, errorOnExist: true, force: false })
    await writeFile(join(next, marker), JSON.stringify({ owner, digest: await digest(next) }))
    if (present) await rename(target, old)
    try { await rename(next, target) }
    catch (error) { if (present) await rename(old, target); throw error }
    if (present) await rm(old, { recursive: true })
  } finally { await rm(staging, { recursive: true, force: true }) }
}

export async function synchronizeSkillCopy(directory: string, id: string, source: string, enabled: boolean): Promise<{ available: boolean; error?: SkillCopyError }> {
  const target = join(directory, id)
  try {
    const present = await exists(target), record = present && await readMarker(target)
    const recorded = record && record.digest
    if (present && !recorded) return { available: false, error: 'conflict' }
    if (present) {
      let current: string
      try { current = await digest(target) }
      catch { return { available: enabled, error: 'modified' } }
      if (current !== recorded) return { available: enabled, error: 'modified' }
      if (!enabled) { await rm(target, { recursive: true }); return { available: false } }
      if (current === await digest(source)) return { available: true }
    } else if (!enabled) return { available: false }
    await replaceCopy(target, source, directory, present)
    return { available: true }
  } catch { return { available: false, error: 'write-failed' } }
}
