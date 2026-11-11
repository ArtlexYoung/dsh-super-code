/** Package switches around the host's native parser, ranking and resource loader. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { join } from 'node:path'
import { configurationOf } from './budgets.js'

export const name = 'super-code-bundled-skills'
export const inject: string[] = ['skills', 'superCodeConfiguration']
export interface Config { readonly bundledSkillDir: string }
export const Config: z<Config> = z.object({ bundledSkillDir: z.string().required() })

export function apply(ctx: Context, config: Config): void {
  const packs = [
    { key: 'oilUiSkill', id: 'oil-ui', fallback: true, root: config.bundledSkillDir },
    { key: 'openspecSkills', id: 'openspec', fallback: false, root: join(config.bundledSkillDir, '../skill-packs/openspec/skills') },
    { key: 'mattpocockSkills', id: 'mattpocock', fallback: false, root: join(config.bundledSkillDir, '../skill-packs/mattpocock/skills') },
    { key: 'pstackSkills', id: 'pstack', fallback: false, root: join(config.bundledSkillDir, '../skill-packs/pstack/dsh/skills') },
  ] as const
  for (const pack of packs) {
    const enabled = (): boolean => configurationOf(ctx)[pack.key] ?? pack.fallback
    ctx.skills.registerProvider(control => {
      const provider = new FileSystemSkillProvider(ctx, control, {
        providerName: `super-code-bundled-${pack.id}`, bundledSkillDir: pack.root,
        includeDefaultRoots: false, watch: false,
      })
      let previous = enabled()
      const refresh = (): void => {
        const next = enabled()
        if (next !== previous) { previous = next; control.invalidate() }
      }
      // Legacy providers announce a document revision before committing its
      // resolved value; SettingsForms announces it after updating live fields.
      ctx.on('settings/updated', refresh)
      ctx.on('settings/document-updated', refresh)
      ctx.effect(() => () => provider.dispose())
      return {
        name: provider.name,
        list: async options => {
          if (!enabled() || control.signal.aborted) return []
          const catalog = await provider.list(options)
          return enabled() && !control.signal.aborted ? catalog : []
        },
        // Recheck at load time too: a caller may hold a catalog from before a switch.
        get: async (candidate, options) => {
          if (!enabled() || control.signal.aborted) return undefined
          const skill = await provider.get(candidate, options)
          return enabled() && !control.signal.aborted ? skill : undefined
        },
      }
    })
  }
}
