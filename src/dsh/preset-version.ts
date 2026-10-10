/** Read composition metadata without evaluating the host's !!js expressions. */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import yaml from 'js-yaml'

export const pluginVersion: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

const compositionSchema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar', construct: () => ({}),
}))

export interface PresetVersion { presetVersion?: string }

export function compositionVersion(content: string): PresetVersion {
  try {
    const rows = yaml.load(content, { schema: compositionSchema })
    if (!Array.isArray(rows)) return {}
    const matches = rows.filter(row => row && typeof row === 'object' && row.name === 'dsh-super-code/super-code')
    // An ambiguous or unrelated composition cannot establish our preset version.
    if (matches.length !== 1) return {}
    const version = matches[0].config?.presetVersion
    if (typeof version !== 'string' || version.length > 100
      || !/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(version)) return {}
    return { presetVersion: version }
  } catch { return {} }
}

export async function directoryVersion(path: string): Promise<PresetVersion> {
  try { return compositionVersion(await readFile(path, 'utf8')) }
  catch { return {} }
}
