/** Package switches around the host's native parser, ranking and resource loader. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configurationOf } from './budgets.js'

export const name = 'super-code-bundled-skills'
export const inject: string[] = ['skills', 'superCodeConfiguration']
export interface Config { readonly bundledSkillDir: string; readonly layout?: 'builtin' }
export const Config: z<Config> = z.object({ bundledSkillDir: z.string().required(), layout: z.union(['builtin']) })
const grillSkills = new Set(['grill-me', 'grilling'])

function legacyPackageRoot(root: string): boolean {
  if (basename(root) !== 'skills' || existsSync(root)) return false
  try {
    return realpathSync(dirname(root)) === realpathSync(new URL('../../presets/super-code/', import.meta.url))
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false
    throw error
  }
}

export function apply(ctx: Context, config: Config): void {
  if (ctx.get('superCodeSkills')) return
  registerBundledSkills(ctx, config)
}

export function registerBundledSkills(ctx: Context, config: Config,
  directory?: { ready(): Promise<void>; available(id: string): boolean; subscribe(refresh: () => void): () => void }): void {
  let root = config.bundledSkillDir.startsWith('file:') ? fileURLToPath(config.bundledSkillDir) : config.bundledSkillDir
  const migrated = config.layout !== 'builtin' && legacyPackageRoot(root)
  // Only old declarations pointing into this package follow its moved resources.
  // User copies continue to load their own original, possibly customized files.
  if (migrated) root = fileURLToPath(new URL('../../builtin/skills/', import.meta.url))
  const packages = config.layout === 'builtin' || migrated ? root : join(root, '../skill-packs')
  const packs = [
    { key: 'oilUiSkill', id: 'oil-ui', root },
    { key: 'openspecSkills', id: 'openspec', root: join(packages, 'openspec/skills') },
    { key: 'mattpocockSkills', id: 'mattpocock', root: join(packages, 'mattpocock/skills') },
    { key: 'pstackSkills', id: 'pstack', root: join(packages, 'pstack/dsh/skills') },
  ] as const
  for (const pack of packs) {
    const enabled = (): boolean => configurationOf(ctx)[pack.key] === true
    const grillEnabled = (): boolean => pack.id === 'mattpocock' && configurationOf(ctx).grillMeSkill === true
    const available = (name: string): boolean => (!directory || directory.available(pack.id)) && (enabled() || grillEnabled() && grillSkills.has(name))
    ctx.skills.registerProvider(control => {
      const provider = new FileSystemSkillProvider(ctx, control, {
        providerName: `super-code-bundled-${pack.id}`, bundledSkillDir: pack.root,
        includeDefaultRoots: false, watch: false,
      })
      let previous = [enabled(), grillEnabled()].join()
      const refresh = (): void => {
        const next = [enabled(), grillEnabled()].join()
        if (next !== previous) { previous = next; control.invalidate() }
      }
      // Legacy providers announce a document revision before committing its
      // resolved value; SettingsForms announces it after updating live fields.
      ctx.on('settings/updated', refresh)
      ctx.on('settings/document-updated', refresh)
      if (directory) ctx.effect(() => directory.subscribe(control.invalidate))
      ctx.effect(() => () => provider.dispose())
      return {
        name: provider.name,
        list: async options => {
          await directory?.ready()
          if ((!enabled() && !grillEnabled()) || directory && !directory.available(pack.id) || control.signal.aborted) return []
          const catalog = await provider.list(options)
          if (control.signal.aborted) return []
          if (enabled()) return catalog
          if (!grillEnabled()) return []
          return Array.isArray(catalog) ? catalog.filter(candidate => grillSkills.has(candidate.name))
            : { ...catalog, candidates: catalog.candidates.filter(candidate => grillSkills.has(candidate.name)) }
        },
        // Recheck at load time too: a caller may hold a catalog from before a switch.
        get: async (candidate, options) => {
          await directory?.ready()
          if (!available(candidate.name) || control.signal.aborted) return undefined
          const skill = await provider.get(candidate, options)
          return available(candidate.name) && !control.signal.aborted ? skill : undefined
        },
      }
    })
  }
}
