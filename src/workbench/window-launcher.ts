import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 只启动包内组件；系统缺少 WebView 时由窗口入口恢复内嵌，不下载环境。 */
export async function launchWindow(url: string): Promise<ChildProcess> {
  const root = new URL('../../builtin/workbench/native/', import.meta.url)
  const programs: Record<string, [string, string[]]> = {
    darwin: [fileURLToPath(new URL('darwin/Super Code.app/Contents/MacOS/Super Code', root)), []],
    win32: [fileURLToPath(new URL('win32/SuperCode.Window.exe', root)), []],
    linux: [fileURLToPath(new URL(`linux-${process.arch}/super-code-window`, root)), []],
  }
  const program = programs[process.platform]
  if (!program) throw new Error('WORKBENCH_WINDOW_UNSUPPORTED')
  await access(program[0], process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    .catch(() => { throw new Error('WORKBENCH_WINDOW_COMPONENT') })
  const inherited = new Set(['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME'])
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => inherited.has(key.toUpperCase())))
  const child = spawn(program[0], program[1], { env: { ...env, SC_WINDOW_URL: url }, stdio: 'ignore', windowsHide: false })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', () => reject(new Error('WORKBENCH_WINDOW_START')))
  })
  return child
}
