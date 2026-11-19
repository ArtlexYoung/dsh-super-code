import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'

const exec = promisify(execFile)
type FontCommand = (file: string, args: string[], signal: AbortSignal) => Promise<string>
const execute: FontCommand = async (file, args, signal) => (await exec(file, args, { signal, timeout: 15000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', windowsHide: true })).stdout

/** 只返回字体家族名，不读取或传输字体文件及系统路径。 */
export async function listSystemFonts(signal: AbortSignal, platform: string = process.platform, run: FontCommand = execute): Promise<string[]> {
  signal.throwIfAborted()
  try {
    let families: string[]
    if (platform === 'darwin') {
      const output = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', 'ObjC.import("AppKit"); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies));'], signal)
      const data: unknown = JSON.parse(output)
      families = z.array(z.string()).parse(data)
    } else if (platform === 'win32') {
      const output = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Drawing; $fonts = [System.Drawing.Text.InstalledFontCollection]::new(); try { ConvertTo-Json -Compress -InputObject @($fonts.Families | ForEach-Object { $_.Name }) } finally { $fonts.Dispose() }'], signal)
      const data: unknown = JSON.parse(output.replace(/^\uFEFF/, ''))
      families = z.array(z.string()).parse(data)
    } else if (platform === 'linux') {
      families = (await run('fc-list', ['--format=%{family[0]}\n'], signal)).split(/\r?\n/)
    } else throw new Error('Unsupported system')
    signal.throwIfAborted()
    const unique = new Map<string, string>()
    for (const raw of families) {
      const name = raw.trim()
      if (name && name.length <= 256 && !/^[.@]|[\x00-\x1f\x7f]/.test(name)) unique.set(name.toLowerCase(), name)
    }
    return [...unique.values()].sort((a, b) => a.localeCompare(b, 'en'))
  } catch (cause) {
    signal.throwIfAborted()
    throw new Error('WORKBENCH_FONTS_UNAVAILABLE', { cause })
  }
}
