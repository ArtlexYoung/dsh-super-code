import z from '@deepseek-ai/schemastery';
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem';
import { join } from 'node:path';
import { configurationOf } from './budgets.js';
export const name = 'super-code-bundled-skills';
export const inject = ['skills', 'superCodeConfiguration'];
export const Config = z.object({ bundledSkillDir: z.string().required() });
export function apply(ctx, config) {
    const packs = [
        { key: 'oilUiSkill', id: 'oil-ui', fallback: true, root: config.bundledSkillDir },
        { key: 'openspecSkills', id: 'openspec', fallback: false, root: join(config.bundledSkillDir, '../skill-packs/openspec/skills') },
        { key: 'mattpocockSkills', id: 'mattpocock', fallback: false, root: join(config.bundledSkillDir, '../skill-packs/mattpocock/skills') },
    ];
    for (const pack of packs) {
        const enabled = () => configurationOf(ctx)[pack.key] ?? pack.fallback;
        ctx.skills.registerProvider(control => {
            const provider = new FileSystemSkillProvider(ctx, control, {
                providerName: `super-code-bundled-${pack.id}`, bundledSkillDir: pack.root,
                includeDefaultRoots: false, watch: false,
            });
            let previous = enabled();
            const refresh = () => {
                const next = enabled();
                if (next !== previous) {
                    previous = next;
                    control.invalidate();
                }
            };
            // Legacy providers announce a document revision before committing its
            // resolved value; SettingsForms announces it after updating live fields.
            ctx.on('settings/updated', refresh);
            ctx.on('settings/document-updated', refresh);
            ctx.effect(() => () => provider.dispose());
            return {
                name: provider.name,
                list: options => enabled() ? provider.list(options) : Promise.resolve([]),
                // Recheck at load time too: a caller may hold a catalog from before a switch.
                get: async (candidate, options) => {
                    if (!enabled())
                        return undefined;
                    const skill = await provider.get(candidate, options);
                    return enabled() ? skill : undefined;
                },
            };
        });
    }
}
//# sourceMappingURL=bundled-skills.js.map