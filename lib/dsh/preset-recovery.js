/** Install a profile-owned continuation shim without modifying the host or old conversation logs. */
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { declarationSchema } from './preset-declaration.js';
import { RecoveryState, compositionContent, fingerprint } from './preset-recovery-runtime.js';
const entryId = 'super-code-session-recovery';
async function regularContent(path) {
    try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink())
            throw new Error('Unsafe recovery file');
        return await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return '';
        throw error;
    }
}
async function createOwnedFile(path, content) {
    try {
        await writeFile(path, content, { flag: 'wx', mode: 0o600 });
    }
    catch (error) {
        if (error.code !== 'EEXIST' || await regularContent(path) !== content)
            throw error;
    }
}
/** Preserve the user's YAML and expressions, with a concrete backup and stale-write check. */
export async function prepareRecovery(patchPath, packagePath, source) {
    const directory = join(dirname(patchPath), '.super-code-recovery');
    let created = false;
    try {
        await mkdir(directory, { mode: 0o700 });
        created = true;
    }
    catch (error) {
        if (error.code !== 'EEXIST')
            throw error;
    }
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('Unsafe recovery directory');
    const statePath = join(directory, 'state.json');
    if (!await regularContent(statePath)) {
        if (!created && (await readdir(directory)).length)
            throw new Error('Unowned recovery directory');
        await createOwnedFile(statePath, JSON.stringify({ plugin: 'dsh-super-code', format: 1, sessions: {} }));
    }
    await RecoveryState.open(statePath);
    const modulePath = join(directory, `recovery-${fingerprint(source).slice(0, 24)}.mjs`);
    await createOwnedFile(modulePath, source);
    const config = { owner: 'dsh-super-code', statePath, packagePath };
    const entry = { id: entryId, name: pathToFileURL(modulePath).href, config };
    const original = await regularContent(patchPath);
    const rows = original.trim() ? yaml.load(original, { schema: declarationSchema }) : [];
    if (!Array.isArray(rows))
        throw new Error('Invalid profile patch');
    const existing = rows.flatMap(row => row?.insert ?? [row]).filter(row => row?.id === entryId);
    if (existing.some(row => row.config?.owner !== 'dsh-super-code' || row.config?.statePath !== statePath))
        throw new Error('Recovery entry conflict');
    if (existing.length && JSON.stringify(existing.at(-1)) === JSON.stringify(entry))
        return { modulePath, config };
    const patch = existing.length ? entry : { insert: [entry] };
    const prefix = rows.length && /^[ \t]*-/m.test(original) ? original.trimEnd() + '\n'
        : rows.length ? yaml.dump(rows, { schema: declarationSchema, noRefs: true, lineWidth: -1 })
            : original.replace(/^[ \t]*\[\][ \t]*(?:#.*)?$/m, '').trimEnd() + '\n';
    const content = prefix + yaml.dump([patch], { schema: declarationSchema, noRefs: true, lineWidth: -1 });
    await createOwnedFile(join(directory, `patch-before-${fingerprint(original).slice(0, 24)}.yml`), original);
    const staging = await mkdtemp(join(directory, '.patch-'));
    try {
        const file = join(staging, 'cordis.patch.yml');
        await writeFile(file, content, { mode: 0o600 });
        if (await regularContent(patchPath) !== original)
            throw new Error('Profile patch changed during recovery setup');
        await rename(file, patchPath);
    }
    finally {
        await rm(staging, { recursive: true, force: true });
    }
    return { modulePath, config };
}
export function applyPresetRecovery(ctx) {
    ctx.inject(['agentPresets', 'sessionProjections', 'tools'], async (owner) => {
        const profile = owner.get('profileContext');
        let patchPath = profile?.patchPath;
        if (!patchPath) {
            // Early directory-preset releases expose the profile only through root.baseUrl.
            try {
                if (!owner.root.baseUrl)
                    return;
                const directory = fileURLToPath(owner.root.baseUrl);
                const manifest = JSON.parse(await regularContent(join(directory, 'package.json')));
                if (!Array.isArray(manifest.dsh?.profile?.bundles) || !manifest.dsh.profile.bundles.includes('dsh-super-code'))
                    return;
                patchPath = join(directory, 'cordis.patch.yml');
            }
            catch {
                return;
            }
        }
        try {
            const source = await readFile(new URL('./preset-recovery-runtime.js', import.meta.url), 'utf8');
            const prepare = () => prepareRecovery(patchPath, join(dirname(patchPath), 'node_modules/dsh-super-code/package.json'), source);
            const hmr = owner.get('hmr');
            const prepared = await (hmr ? hmr.runExclusive(prepare) : prepare());
            // Owned by the host root, so removing the main plugin does not dispose recovery.
            await owner.root.plugin(await import(pathToFileURL(prepared.modulePath).href), prepared.config);
            owner.inject(['superCodeSessionRecovery', 'sessionQuery'], async (ready) => {
                try {
                    const registry = ready.get('agentPresets');
                    const ids = [];
                    for (const row of await registry.list()) {
                        const plugins = yaml.load(await compositionContent(ready, row.id), { schema: declarationSchema });
                        if (Array.isArray(plugins) && plugins.filter(plugin => plugin?.name === 'dsh-super-code/super-code').length === 1)
                            ids.push(row.id);
                    }
                    await ready.superCodeSessionRecovery.backfill(ids);
                }
                catch {
                    ready.logger.warn('Some existing Super Code sessions could not be registered for uninstall recovery.');
                }
            });
        }
        catch {
            owner.logger.warn('Super Code uninstall recovery is unavailable; check the profile recovery files and patch permissions.');
        }
    });
}
//# sourceMappingURL=preset-recovery.js.map