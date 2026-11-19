import test from 'node:test'
import assert from 'node:assert/strict'
import { win32 } from 'node:path'
import { findGitBash } from '../../src/core/windows-git-bash.js'
import { windowsRuntimeEnvironment } from '../../src/core/windows-runtime.js'

const version = 'git version 2.52.0.windows.1\r\n'
const description = 'GNU bash, version 5.2.37(1)-release (x86_64-pc-msys)\n'

function fixture(root: string, located = win32.join(root, 'cmd', 'git.exe')) {
  const calls: { file: string; args: readonly string[] }[] = []
  const results = new Map([[located, version], [win32.join(root, 'usr', 'bin', 'bash.exe'), description], ['where.exe', located + '\r\n']])
  const run = async (file: string, args: readonly string[]): Promise<string | null> => { calls.push({ file, args }); return results.get(file) ?? null }
  return { calls, results, run }
}

for (const directory of ['C:\\Program Files\\Git', 'D:\\中文 目录\\PortableGit', 'C:\\Tools\\mingw64']) test(`检测并验证含空格或中文的 Git Bash：${directory}`, async () => {
  const { calls, run } = fixture(directory)
  const runtime = await findGitBash({ env: {}, arch: 'x64', run })
  assert.deepEqual(runtime, { root: directory, bin: win32.join(directory, 'usr', 'bin'), bash: win32.join(directory, 'usr', 'bin', 'bash.exe'), version: version.trim(), arch: 'x64', source: 'git' })
  assert.deepEqual(calls.find(item => item.file === runtime!.bash)!.args, ['--noprofile', '--norc', '--version'])
  assert.ok(!calls.some(item => item.file === 'reg.exe'), 'PATH 内已找到时不扫描其他安装位置')
})

test('通过 Git 的实际 exec-path 找到包管理器代理背后的 Bash', async () => {
  const root = 'C:\\Users\\Tester\\scoop\\apps\\git\\current', git = 'C:\\Users\\Tester\\scoop\\shims\\git.exe'
  const found = await findGitBash({ env: {}, run: async (file, args) => {
    if (file === 'where.exe') return git
    if (file === git) return args[0] === '--version' ? version : root.replaceAll('\\', '/') + '/mingw64/libexec/git-core'
    return file === win32.join(root, 'usr', 'bin', 'bash.exe') ? description : null
  } })
  assert.equal(found?.root, root)
})

test('支持 Git 的 mingw 可执行入口，不误选其上一级目录', async () => {
  const root = 'C:\\Tools\\Git', f = fixture(root, win32.join(root, 'mingw64', 'bin', 'git.exe'))
  assert.equal((await findGitBash({ env: {}, run: f.run }))!.root, root)
})

test('Git 不在 PATH 时可用注册表或用户目录，不修改系统环境', async () => {
  const root = 'D:\\自定义 Git', f = fixture(root)
  f.results.set('where.exe', 'not-an-absolute-path\nC:\\Windows\\System32\\bash.exe')
  f.results.set('reg.exe', '    InstallPath    REG_SZ    ' + root + '\r\n')
  assert.equal((await findGitBash({ env: {}, run: f.run }))!.root, root)
  const userRoot = 'C:\\Users\\Tester\\AppData\\Local', user = fixture(win32.join(userRoot, 'Programs', 'Git'))
  user.results.delete('where.exe')
  const env = { LocalAppData: userRoot }
  assert.ok(await findGitBash({ env, run: user.run }))
  assert.deepEqual(env, { LocalAppData: userRoot })
})

test('没有 Git、Git 只有 CLI、损坏 Bash 和 WSL 均不可选；可继续寻找有效安装', async () => {
  assert.equal(await findGitBash({ env: {}, run: async () => null }), null)
  const root = 'C:\\Bad Git', f = fixture(root)
  const bash = win32.join(root, 'usr', 'bin', 'bash.exe')
  for (const output of ['', 'GNU bash, version 5.2.37(1)-release (x86_64-pc-linux-gnu)', 'unexpected output']) {
    f.results.set(bash, output)
    assert.equal(await findGitBash({ env: {}, run: f.run }), null)
  }
  const other = fixture('C:\\Program Files\\Git')
  for (const [key, value] of other.results) if (key !== 'where.exe') f.results.set(key, value)
  assert.equal((await findGitBash({ env: { ProgramFiles: 'C:\\Program Files' }, run: f.run }))!.root, 'C:\\Program Files\\Git')
  f.results.set(win32.join(root, 'cmd', 'git.exe'), 'git version 2.52.0')
  f.results.set(bash, description)
  assert.equal(await findGitBash({ env: {}, run: f.run }), null)
})

test('Git Bash 使用自身工具和 git 入口，不注入 BusyBox 规则或泄漏环境凭据', async () => {
  const root = 'C:\\Program Files\\Git', f = fixture(root), runtime = await findGitBash({ env: {}, run: f.run })
  const env = windowsRuntimeEnvironment(runtime!, { Path: 'C:\\Node', BASH_ENV: 'startup.sh' })
  assert.equal(env.PATH, runtime!.bin + ';' + win32.join(root, 'cmd') + ';C:\\Node')
  assert.equal(env.Path, undefined)
  assert.equal(env.BASH_ENV, '')
  assert.equal(env.BB_GLOBBING, undefined)
  assert.equal(env.BB_OVERRIDE_APPLETS, undefined)
  assert.equal(Object.hasOwn(env, 'OA4_TENCENT_API_KEY'), false)
})
