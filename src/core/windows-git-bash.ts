import { execFile } from 'node:child_process'
import { win32 } from 'node:path'
import type { WindowsRuntime } from './windows-runtime.js'

type Run = (file: string, args: readonly string[]) => Promise<string | null>

const runCommand: Run = (file, args) => new Promise(resolve => {
  execFile(file, [...args], { timeout: 3000, maxBuffer: 16384, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout) => resolve(error ? null : stdout))
})

async function* installations(env: NodeJS.ProcessEnv, run: Run): AsyncGenerator<{ root: string; git: string }> {
  for (const file of (await run('where.exe', ['git.exe']) ?? '').split(/\r?\n/).map(value => value.trim()).filter(value => win32.isAbsolute(value) && /[\\/]git\.exe$/i.test(value))) {
    let root = win32.dirname(win32.dirname(file))
    if (win32.basename(win32.dirname(file)).toLowerCase() === 'bin' && /^(mingw32|mingw64|clangarm64)$/i.test(win32.basename(root))) root = win32.dirname(root)
    yield { root, git: file }
  }
  for (const [key, ...view] of [['HKCU\\Software\\GitForWindows'], ['HKLM\\Software\\GitForWindows', '/reg:64'], ['HKLM\\Software\\GitForWindows', '/reg:32']]) {
    const record = await run('reg.exe', ['query', key!, '/v', 'InstallPath', ...view])
    const installed = record?.match(/^\s*InstallPath\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/mi)?.[1]
    if (installed && win32.isAbsolute(installed)) yield { root: installed, git: win32.join(installed, 'cmd', 'git.exe') }
  }
  const field = (key: string): string | undefined => env[Object.keys(env).find(name => name.toUpperCase() === key.toUpperCase()) ?? key]
  for (const key of ['ProgramW6432', 'ProgramFiles', 'ProgramFiles(x86)']) {
    const directory = field(key)
    if (directory && win32.isAbsolute(directory)) {
      const root = win32.join(directory, 'Git')
      yield { root, git: win32.join(root, 'cmd', 'git.exe') }
    }
  }
  const local = field('LOCALAPPDATA')
  if (local && win32.isAbsolute(local)) {
    const root = win32.join(local, 'Programs', 'Git')
    yield { root, git: win32.join(root, 'cmd', 'git.exe') }
  }
}

/** 只选择实际可运行的 Git for Windows，不把 WSL 的 bash.exe 当成本机 Bash。 */
export async function findGitBash(options: { env?: NodeJS.ProcessEnv; run?: Run; arch?: string } = {}): Promise<WindowsRuntime | null> {
  const env = options.env ?? process.env, run = options.run ?? runCommand, seen = new Set<string>()
  for await (const { root, git } of installations(env, run)) {
    if (seen.has(git.toLowerCase())) continue
    seen.add(git.toLowerCase())
    const version = (await run(git, ['--version']))?.trim()
    if (!version || !/^git version [\w.+-]+\.windows\.[\w.+-]+$/.test(version)) continue
    const candidates = [root]
    for (let i = 0; i < candidates.length; i++) {
      const selected = candidates[i]!, bin = win32.join(selected, 'usr', 'bin'), bash = win32.join(bin, 'bash.exe')
      const description = await run(bash, ['--noprofile', '--norc', '--version'])
      if (description && /^GNU bash, version [^\r\n]+\([^\r\n]*-msys\)/m.test(description)) {
        return { root: selected, bin, bash, version, arch: options.arch ?? process.arch, source: 'git' }
      }
      if (i === 0) {
        const path = (await run(git, ['--exec-path']))?.trim().replaceAll('/', '\\')
        const directory = path?.match(/^(.*)\\(?:mingw32|mingw64|clangarm64)\\libexec\\git-core$/i)?.[1]
        if (directory && win32.isAbsolute(directory) && directory.toLowerCase() !== root.toLowerCase()) candidates.push(directory)
      }
    }
  }
  return null
}
