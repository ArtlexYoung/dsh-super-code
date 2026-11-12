/** Expose the installed CLI only inside enabled Super Code shell invocations. */
import { createRequire } from 'node:module'
import { dirname, join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ShellConstructor, ShellSpec } from './windows-shell.js'

const require = createRequire(import.meta.url)
const bin = fileURLToPath(new URL('../../runtime/skills/openspec/bin/', import.meta.url))

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
        SUPER_CODE_OPENSPEC_NODE: process.execPath,
        SUPER_CODE_OPENSPEC_CLI: join(dirname(require.resolve('@fission-ai/openspec')), '../bin/openspec.js'),
      } }
    }
  }
}
