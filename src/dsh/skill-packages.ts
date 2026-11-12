/** Versions belong to the vendored packages, independently of the plugin version. */
import { readFileSync } from 'node:fs'

export interface SkillPackageVersion { readonly version: string; readonly revision: string }

export const skillPackages: Readonly<Record<string, SkillPackageVersion>> = Object.fromEntries(
  Object.entries({ grillMeSkill: 'mattpocock', openspecSkills: 'openspec', oilUiSkill: 'oil-ui', mattpocockSkills: 'mattpocock', pstackSkills: 'pstack' })
    .map(([key, id]) => {
      const { version, revision } = JSON.parse(readFileSync(new URL(`../../builtin/skills/${id}/distribution.json`, import.meta.url), 'utf8'))
      return [key, { version, revision }]
    }),
)
