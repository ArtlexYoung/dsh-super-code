import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { WorkbenchRoot } from '../files.js'
import { z } from 'zod'
import { directory, environmentPaths, inspectEnvironments, join, languages, parent, parseJsonConfig, readOptional } from './config.js'
import type { Language, EnvironmentPaths } from './config.js'

const moduleName = z.string().max(1024).refine(value => !/[\\\0]/.test(value) && !value.startsWith('/') && !value.split('/').some(part => part === '..' || part === '.') && !value.includes('://'))
export const sourceRequest: z.ZodType<{ language: Language; module: string; paths: EnvironmentPaths }> = z.object({ language: z.enum(languages), module: moduleName, paths: environmentPaths, }).strict()
export type LanguageSourceEvent = { kind: 'source'; root: string; path: string; text: string; version: string; entry: boolean } | { kind: 'done'; reason: 'source' | 'no-environment' | 'no-source'; warnings: string[] }
const extensions: Record<Language, RegExp> = { python: /\.(pyi?|pyi)$/i, javascript: /\.[cm]?[jt]sx?$/i, go: /(?<!_test)\.go$/, rust: /\.rs$/, java: /\.java$/, cpp: /(?:\.(?:h|hpp|hh|c|cpp|cc)|\/[^/.]+)$/i, csharp: /\.cs$/, php: /\.php$/, ruby: /\.rb$/ }

async function firstFile(fs: FileSystem, base: FsTarget, paths: string[], signal: AbortSignal): Promise<string | undefined> {
  for (const path of paths) {
    const target = await fs.resolve(path, { cwd: fs.processPath(base), signal })
    if (fs.contains(base, target) && (await fs.stat(target, signal))?.type === 'file') return posix.normalize(path)
  }
  return undefined
}
async function jsFile(fs: FileSystem, base: FsTarget, path: string, signal: AbortSignal): Promise<string | undefined> {
  const name = path.replace(/\.[cm]?js$/, '')
  const direct = await firstFile(fs, base, [path, name + '.d.ts', name + '.ts', name + '.tsx', name + '.js', path + '/index.d.ts', path + '/index.ts', path + '/index.js'], signal)
  if (direct) return direct
  const manifestTarget = await fs.resolve(join(path, 'package.json'), { cwd: fs.processPath(base), signal })
  if (!fs.contains(base, manifestTarget)) return undefined
  const json = await readOptional(fs, fs.processPath(manifestTarget), fs.processPath(base), signal)
  if (!json) return undefined
  const manifest = parseJsonConfig(json)
  return firstFile(fs, base, [manifest.types, manifest.typings, manifest.main].filter((item): item is string => typeof item === 'string').map(item => join(path, item)), signal)
}
async function entryFiles(fs: FileSystem, base: FsTarget, language: Language, module: string, signal: AbortSignal): Promise<string[]> {
  if (language === 'python') {
    const path = module.replaceAll('.', '/')
    const found = await firstFile(fs, base, [path + '.pyi', path + '.py', path + '/__init__.pyi', path + '/__init__.py'], signal)
    return found ? [found] : []
  }
  if (language === 'javascript') {
    if (!module) return (await Promise.all(['lib.es5.d.ts', 'lib.es2015.core.d.ts', 'lib.dom.d.ts'].map(path => firstFile(fs, base, [path], signal)))).filter((path): path is string => !!path)
    const found = await jsFile(fs, base, module, signal)
    if (found) return [found]
    const typed = await jsFile(fs, base, '@types/' + module.replace(/^@/, '').replace('/', '__'), signal)
    return typed ? [typed] : []
  }
  if (language === 'cpp') { const found = await firstFile(fs, base, [module], signal); return found ? [found] : [] }
  if (language === 'java') { const found = await firstFile(fs, base, [module.replaceAll('.', '/') + '.java'], signal); return found ? [found] : [] }
  if (language === 'ruby') { const found = await firstFile(fs, base, [module + '.rb', 'lib/' + module + '.rb'], signal); return found ? [found] : [] }
  if (language === 'php') { const found = await firstFile(fs, base, [module.replaceAll('::', '/') + '.php', module + '.php'], signal); return found ? [found] : [] }
  if (language === 'rust') {
    const [crate, ...parts] = module.split('::'), path = parts.join('/'), full = module.replaceAll('::', '/')
    const found = await firstFile(fs, base, [full + '.rs', full + '/mod.rs', join(crate!, 'src', path ? path + '.rs' : 'lib.rs'), join(crate!, 'src', path, 'mod.rs')], signal)
    if (found) return [found]
  }
  let directoryPath = language === 'rust' ? module.replaceAll('::', '/') : language === 'csharp' ? module.replaceAll('.', '/') : module
  let folder = await directory(fs, directoryPath, fs.processPath(base), signal)
  if (!folder) { directoryPath = join('src', directoryPath); folder = await directory(fs, directoryPath, fs.processPath(base), signal) }
  if (!folder || !fs.contains(base, await fs.resolve(folder, { signal }))) return []
  const result: string[] = []
  for (const item of await fs.listDir(await fs.resolve(folder, { signal }), signal)) {
    if (item.type !== 'file' || !extensions[language].test(item.name)) continue
    result.push(join(directoryPath, item.name))
  }
  return result
}
function relatedFiles(path: string, text: string, language: Language): string[] {
  if (language === 'javascript') return [...text.matchAll(/\b(?:export|import)\s+[^;]*?\bfrom\s*["'](\.[^"']+)["']/g)].map(item => join(parent(path), item[1]!))
  if (language === 'python') return [...text.matchAll(/^\s*from\s+(\.+)([\w.]*)\s+import\s+/gm)].map(item => {
    let dir = parent(path); for (let i = 1; i < item[1]!.length; i++) dir = parent(dir)
    return join(dir, item[2]!.replaceAll('.', '/'))
  })
  return []
}

/** 每次只读取导入模块及其项目内转发，不运行解释器或建立依赖全库索引。 */
export async function* languageSources(fs: FileSystem, root: WorkbenchRoot, input: unknown, signal: AbortSignal): AsyncGenerator<LanguageSourceEvent> {
  const request = sourceRequest.parse(input)
  const { environments, warnings } = await inspectEnvironments(fs, root, request.paths, signal, request.language)
  const environment = environments.find(item => item.language === request.language)!
  let count = 0
  for (const path of environment.roots) {
    const base = await fs.resolve(path, { signal }), rootId = createHash('sha256').update(base.targetKey).digest('hex').slice(0, 16)
    const entries = await entryFiles(fs, base, request.language, request.module, signal), queue = [...entries], seen = new Set<string>()
    for (let i = 0; i < queue.length; i++) {
      signal.throwIfAborted()
      const file = queue[i]!, target = await fs.resolve(file, { cwd: fs.processPath(base), signal })
      if (seen.has(target.targetKey) || !fs.contains(base, target)) continue
      seen.add(target.targetKey)
      const before = await fs.stat(target, signal)
      if (!before || before.type !== 'file') continue
      const text = await readOptional(fs, file, fs.processPath(base), signal)
      if (text === undefined || text.includes('\0')) continue
      if ((await fs.stat(target, signal))?.version !== before.version) throw new Error('WORKBENCH_CONFLICT')
      yield { kind: 'source', root: rootId, path: file, text, version: before.version, entry: entries.includes(file) }; count++
      for (const related of relatedFiles(file, text, request.language)) {
        const next = request.language === 'javascript' ? await jsFile(fs, base, related, signal) : await firstFile(fs, base, [related + '.pyi', related + '.py', related + '/__init__.py'], signal)
        if (next) queue.push(next)
      }
    }
  }
  yield { kind: 'done', reason: count ? 'source' : environment.unavailable ? 'no-environment' : 'no-source', warnings }
}
