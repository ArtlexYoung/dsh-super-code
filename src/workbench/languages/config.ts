import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { WorkbenchRoot } from '../files.js'
import { MAX_FILE_BYTES } from '../files.js'
import { z } from 'zod'

export const languages = ['python', 'javascript', 'go', 'rust', 'java', 'cpp', 'csharp', 'php', 'ruby'] as const
export type Language = typeof languages[number]
export type EnvironmentPaths = Partial<Record<Language, string>>
export const environmentPaths: z.ZodType<EnvironmentPaths> = z.partialRecord(z.enum(languages), z.string().max(4096).refine(value => !value.includes('\0')))
export interface LanguageEnvironment { language: Language; roots: string[]; source: string[]; unavailable: boolean }
const absent = (error: unknown): boolean => ['ENOENT', 'ENOTDIR', 'FS_NOT_FOUND'].includes((error as { code?: string }).code || '')
export const join = (...parts: string[]): string => parts.filter(Boolean).join('/').replaceAll('\\', '/').replace(/(?<!^)\/+/g, '/')
export const parent = (path: string): string => path.replaceAll('\\', '/').replace(/\/?[^/]+\/?$/, '')

/** VS Code 的 JSONC 注释与尾逗号只在字符串之外处理。 */
export function parseJsonConfig(text: string): Record<string, any> {
  let clean = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quoted) { clean += char; if (char === '\\') clean += text[++i] || ''; else if (char === '"') quoted = false; continue }
    if (char === '"') { quoted = true; clean += char }
    else if (char === '/' && text[i + 1] === '/') { while (i < text.length && !/[\r\n]/.test(text[i]!)) i++; clean += '\n' }
    else if (char === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; if (i >= text.length) throw new Error('WORKBENCH_ENV_CONFIG'); i++; clean += ' ' }
    else clean += char
  }
  // 先去掉注释，才能识别注释前的尾逗号；完整字符串作为一个匹配保留。
  const json = clean.replace(/"(?:\\.|[^"\\])*"|,\s*(?=[}\]])/g, token => token.startsWith('"') ? token : '')
  const value: unknown = JSON.parse(json.replace(/^\uFEFF/, ''))
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('WORKBENCH_ENV_CONFIG')
  return value as Record<string, any>
}

export async function readOptional(fs: FileSystem, path: string, cwd: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    const target = await fs.resolve(path, { cwd, signal }), info = await fs.stat(target, signal)
    if (!info || info.type !== 'file') return undefined
    if ((info.size || 0) > MAX_FILE_BYTES) throw new Error('WORKBENCH_FILE_SIZE')
    return new TextDecoder('utf8', { fatal: true }).decode(await fs.readBytes(target, signal, MAX_FILE_BYTES))
  } catch (error) { signal.throwIfAborted(); if (absent(error)) return undefined; throw error }
}

export async function directory(fs: FileSystem, path: string, cwd: string, signal: AbortSignal): Promise<string | undefined> {
  try { const target = await fs.resolve(path, { cwd, signal }); return (await fs.stat(target, signal))?.type === 'directory' ? fs.processPath(target) : undefined }
  catch (error) { signal.throwIfAborted(); if (absent(error)) return undefined; throw error }
}

async function pythonRoots(fs: FileSystem, path: string, cwd: string, signal: AbortSignal): Promise<string[]> {
  const target = await fs.resolve(path, { cwd, signal }), info = await fs.stat(target, signal)
  const actual = fs.processPath(target), original = path.replaceAll('\\', '/')
  // venv 的 python 常是指向全局解释器的链接；环境根必须按用户配置的路径定位。
  const env = info?.type === 'directory' ? actual : info?.type === 'file' ? await directory(fs, /(?:^|\/)(?:bin|Scripts)\/[^/]+$/i.test(original) ? parent(parent(original)) || '.' : parent(original) || '.', cwd, signal) : undefined
  if (!env) return []
  const result = [env], config = await readOptional(fs, join(env, 'pyvenv.cfg'), cwd, signal)
  const home = config?.match(/^home\s*=\s*(.+)$/m)?.[1]?.trim(), version = config?.match(/^version\s*=\s*(\d+\.\d+)/m)?.[1]
  const bases = [env, ...(home ? [home, parent(home)] : [])]
  for (const base of bases) {
    for (const suffix of ['Lib/site-packages', 'Lib', ...(version ? ['lib/python' + version, 'lib/python' + version + '/site-packages'] : [])]) {
      const found = await directory(fs, join(base, suffix), cwd, signal); if (found) result.push(found)
    }
    const lib = await directory(fs, join(base, 'lib'), cwd, signal)
    if (lib) for (const entry of await fs.listDir(await fs.resolve(lib, { signal }), signal)) if (entry.type === 'directory' && /^python\d+\.\d+$/.test(entry.name)) {
      result.push(fs.processPath(entry.target)); const packages = await directory(fs, join(lib, entry.name, 'site-packages'), cwd, signal); if (packages) result.push(packages)
    }
  }
  return [...new Set(result)]
}

export async function inspectEnvironments(fs: FileSystem, root: WorkbenchRoot, paths: EnvironmentPaths, signal: AbortSignal, selected?: Language): Promise<{ environments: LanguageEnvironment[]; warnings: string[] }> {
  const cwd = fs.processPath(await fs.resolve(root.cwd, { signal })), warnings: string[] = [], settings: Record<string, any> = {}
  for (const path of ['.vscode/settings.json', '.vscode/c_cpp_properties.json']) {
    const text = await readOptional(fs, path, cwd, signal)
    if (text !== undefined) try { Object.assign(settings, parseJsonConfig(text)) } catch { warnings.push(path) }
  }
  const configured: Partial<Record<Language, string[]>> = {
    python: [settings['python.defaultInterpreterPath'] || settings['python.pythonPath'], '.venv', 'venv', 'env'],
    javascript: [settings['typescript.tsdk'], 'node_modules/typescript/lib', 'node_modules'],
    go: [settings['go.goroot'], settings['go.gopath'], 'vendor'],
    rust: [settings['rust-analyzer.cargo.sysroot'], 'vendor'],
    java: [...(Array.isArray(settings['java.configuration.runtimes']) ? settings['java.configuration.runtimes'].map(item => item?.path) : []), 'src/main/java'],
    cpp: [...(Array.isArray(settings.configurations) ? settings.configurations.flatMap(item => [item?.compilerPath, ...(Array.isArray(item?.includePath) ? item.includePath : [])]) : []), 'include'],
    csharp: [settings['omnisharp.sdkPath']], php: [settings['php.validate.executablePath'], 'vendor'], ruby: [settings['ruby.interpreter.commandPath'], 'vendor/bundle'],
  }
  const idea = await directory(fs, '.idea', cwd, signal)
  if (idea) for (const entry of await fs.listDir(await fs.resolve(idea, { signal }), signal)) {
    if (entry.type !== 'file' || !/^(?:misc\.xml|workspace\.xml|.*\.iml)$/.test(entry.name)) continue
    const xml = await readOptional(fs, join(idea, entry.name), cwd, signal)
    for (const match of xml?.matchAll(/<option\b[^>]*\bname=["'](?:SDK_HOME|INTERPRETER_PATH|homePath)["'][^>]*\bvalue=["']([^"']+)["']/g) || []) {
      const language: Language = /python/i.test(xml || '') ? 'python' : /java|jdk/i.test(xml || '') ? 'java' : 'cpp'
      configured[language]!.unshift(match[1]!.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&apos;', "'"))
    }
  }
  const environments: LanguageEnvironment[] = []
  for (const language of selected ? [selected] : languages) {
    const roots: string[] = [], sources: string[] = []
    for (const raw of paths[language]?.trim() ? [paths[language]!] : configured[language] || []) {
      if (typeof raw !== 'string' || !raw) continue
      const path = raw.replaceAll('${workspaceFolder}', cwd).replaceAll('$PROJECT_DIR$', cwd).replace(/\/\*\*$/, '')
      if (/\$\{|\$[A-Z_]+\$|[*?]/.test(path)) { warnings.push(language); continue }
      let found = language === 'python' ? await pythonRoots(fs, path, cwd, signal) : [await directory(fs, path, cwd, signal)].filter((value): value is string => !!value)
      if (!found.length && language !== 'python') {
        const executable = await fs.resolve(path, { cwd, signal })
        const base = (await fs.stat(executable, signal))?.type === 'file' ? await directory(fs, parent(parent(fs.processPath(executable))), cwd, signal) : undefined
        if (base) for (const suffix of language === 'cpp' ? ['include'] : language === 'go' ? ['src'] : ['src', 'lib']) {
          const folder = await directory(fs, join(base, suffix), cwd, signal); if (folder) found.push(folder)
        }
      }
      if (language !== 'python') for (const base of [...found]) {
        const suffixes = language === 'go' ? ['src'] : language === 'rust' ? ['lib/rustlib/src/rust/library', 'src'] : language === 'java' ? ['src', 'src/main/java', 'src/java.base'] : language === 'cpp' ? ['include'] : []
        for (const suffix of suffixes) { const child = await directory(fs, join(base, suffix), cwd, signal); if (child) found.push(child) }
      }
      roots.push(...found); if (found.length) sources.push(paths[language]?.trim() ? 'configured' : raw.startsWith('.') || ['venv', 'env', 'vendor', 'include'].includes(raw) ? 'project' : 'ide')
    }
    environments.push({ language, roots: [...new Set(roots)], source: [...new Set(sources)], unavailable: !roots.length })
  }
  return { environments, warnings: [...new Set(warnings)] }
}
