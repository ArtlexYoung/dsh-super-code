/** Update only recognized or previously managed display fields, preserving YAML around them. */
import { lstat, readFile, open, mkdtemp, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { readPresetMetadata } from '@deepseek-ai/dsh-agent-presets'

export interface DisplayBaseline {
  name?: string
  description?: string
}
export interface DisplayCopy { name: string; description: string }
export function displayCopy(language: string): DisplayCopy {
  return language.toLowerCase().startsWith('zh')
    ? { name: 'Super Code 模式', description: '更快、更省、更聪明的编码模式。' }
    : { name: 'Super Code', description: 'A faster, more efficient, smarter coding mode.' }
}
const legacyDescriptions = [
  'Coding with on-demand research, design, development, testing and optimization expertise.',
  'A faster, more efficient, smarter coding mode.',
  '更快、更省、更聪明的编码模式。',
  '按需协同调研、设计、开发、测试与优化的编码助手。',
]

export interface MetadataMigration { changed: boolean; baseline: DisplayBaseline }
export async function migrateMetadata(
  path: string, id: string, current: DisplayBaseline, previous: DisplayBaseline | undefined, copy: DisplayCopy,
  beforeWrite: (baseline: DisplayBaseline) => Promise<void> = async () => {},
): Promise<MetadataMigration> {
  const baseline: DisplayBaseline = {}
  let original: string
  try {
    if (!(await lstat(path)).isFile()) return { changed: false, baseline: previous ?? {} }
    original = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { changed: false, baseline: previous ?? {} }
    throw error
  }
  // Discovery may predate a user edit; re-read the metadata before deciding ownership.
  current = await readPresetMetadata(dirname(path))
  let updated = original
  for (const field of ['name', 'description'] as const) {
    const value = current[field]
    const managed = previous === undefined
      ? value !== undefined && (field === 'name'
        ? [id, 'Super Code', 'Super Code 模式', '超级编码'].includes(value)
        : legacyDescriptions.includes(value))
      : previous[field] !== undefined && value === previous[field]
    if (!managed) continue
    // A single top-level scalar only: preserve comments/unknown fields; leave
    // aliases, multiline values and duplicate keys untouched for user review.
    const pattern = new RegExp(`^${field}:[ \\t]*([^\\r\\n]*)$`, 'gm')
    const matches = [...updated.matchAll(pattern)]
    const match = matches[0]
    if (matches.length !== 1 || !match || /^[>|&*]/.test(match[1]!.trim())) continue
    baseline[field] = copy[field]
    if (value === copy[field]) continue
    const comment = match[1]!.match(/\s+#.*$/)?.[0] ?? ''
    updated = updated.replace(pattern, () => `${field}: ${JSON.stringify(copy[field])}${comment}`)
  }
  if (updated === original) return { changed: false, baseline }
  // Stage beside the original so interruption cannot leave a partial YAML file.
  const staging = await mkdtemp(join(dirname(path), '.super-code-metadata-'))
  try {
    const temporary = join(staging, 'preset.yml')
    const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    try { await file.writeFile(updated); await file.sync() } finally { await file.close() }
    if (!(await lstat(path)).isFile() || await readFile(path, 'utf8') !== original) {
      throw new Error('Preset metadata changed during migration')
    }
    await beforeWrite(baseline)
    // Persistence can await I/O; check once more before replacing the file.
    if (await readFile(path, 'utf8') !== original) throw new Error('Preset metadata changed during migration')
    await rename(temporary, path)
  } finally { await rm(staging, { recursive: true, force: true }) }
  return { changed: true, baseline }
}
