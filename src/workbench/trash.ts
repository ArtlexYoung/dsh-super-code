import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const TRASH_TIMEOUT = 120000
interface TrashCommand { executable: string; args: string[]; input?: string }

export function trashCommands(platform: string, path: string, directory: boolean): TrashCommand[] {
  if (platform === 'darwin') return [{ executable: '/usr/bin/osascript', args: ['-l', 'AppleScript', '-e', `use framework "Foundation"
on run argv
  set sourceURL to current application's NSURL's fileURLWithPath:(item 1 of argv)
  set {succeeded, destination, failure} to current application's NSFileManager's defaultManager()'s trashItemAtURL:sourceURL resultingItemURL:(reference) |error|:(reference)
  if not succeeded then error (failure's localizedDescription() as text)
  return destination's |path|() as text
end run`, path] }]
  if (platform === 'win32') return [{ executable: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$recycleRequest = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName Microsoft.VisualBasic
$recycleOption = [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
$recycleUI = [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs
if ($recycleRequest.directory) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($recycleRequest.path, $recycleUI, $recycleOption)
} else {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($recycleRequest.path, $recycleUI, $recycleOption)
}`], input: JSON.stringify({ path, directory }) }]
  if (platform === 'linux') return [{ executable: 'gio', args: ['trash', '--', path] }, { executable: 'trash-put', args: ['--', path] }]
  throw new Error('WORKBENCH_TRASH_UNAVAILABLE')
}

/** 只调用系统回收站；不可用时明确报错，不退回永久删除。 */
export async function moveToTrash(path: string, directory: boolean, signal: AbortSignal): Promise<string | null> {
  for (const command of trashCommands(process.platform, path, directory)) {
    try {
      const task = execute(command.executable, command.args, { signal, windowsHide: true, timeout: TRASH_TIMEOUT, maxBuffer: 16384 })
      task.child.stdin?.end(command.input ?? '')
      const { stdout } = await task
      return process.platform === 'darwin' ? stdout.trim() : null
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw new Error('WORKBENCH_TRASH_FAILED', { cause: error })
    }
  }
  throw new Error('WORKBENCH_TRASH_UNAVAILABLE')
}
