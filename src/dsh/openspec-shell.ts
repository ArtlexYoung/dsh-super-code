/** Expose the installed CLI only inside enabled Super Code shell invocations. */
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ShellConstructor, ShellSpec } from './windows-shell.js'

const require = createRequire(import.meta.url)
const packageRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const bin = fileURLToPath(new URL('../../builtin/openspec/bin/', import.meta.url))

export function windowsOpenSpecEntry(root: string, cli: string): string {
  const store = dirname(dirname(dirname(root)))
  if (basename(store) !== '.pnpm') return cli
  // The official installer already exposes this package through a shorter profile link.
  const linkedCli = join(dirname(store), basename(root), relative(root, cli))
  try {
    return realpathSync.native(linkedCli) === realpathSync.native(cli) ? linkedCli : cli
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error
      && ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(String(error.code))) return cli
    throw error
  }
}

function resolveCliEnvironment(): NodeJS.ProcessEnv {
  const cli = join(dirname(require.resolve('@fission-ai/openspec')), '../bin/openspec.js')
  const entry = process.platform === 'win32' ? windowsOpenSpecEntry(packageRoot, cli) : cli
  return { SUPER_CODE_OPENSPEC_NODE: process.execPath, SUPER_CODE_OPENSPEC_CLI: entry,
    SUPER_CODE_OPENSPEC_PRESERVE_LINKS: entry !== cli ? '1' : '' }
}

export function openspecProvider(Base: ShellConstructor, enabled: () => boolean): ShellConstructor {
  return class extends Base {
    override resolve(request: ShellSpec): ShellSpec {
      const spec = super.resolve(request)
      if (!enabled()) return spec
      const supplied = { ...spec.env }
      const pathKey = process.platform === 'win32'
        ? Object.keys(supplied).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
        : 'PATH'
      const path = supplied[pathKey] ?? process.env.PATH ?? ''
      return { ...spec, env: { ...supplied, [pathKey]: bin + delimiter + path,
        ...resolveCliEnvironment(),
      } }
    }
  }
}
