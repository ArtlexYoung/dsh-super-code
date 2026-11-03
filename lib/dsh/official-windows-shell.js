import { configurationOf } from './budgets.js';
import { hostModule, mountBundledBash, creatorOf } from './windows-shell.js';
// Minimal has a persistent PTY, with a different execution and approval contract.
const presets = new Set(['standard', 'ptc', 'cordis']);
export function applyOfficialWindowsShell(ctx) {
    if (process.platform !== 'win32')
        return;
    ctx.inject(['agentPresets', 'agents', 'tools', 'systemPrompt', 'shell'], async (owner) => {
        const registry = owner.get('agentPresets');
        const { scopeParentOf, createScope } = await hostModule(owner, '@deepseek-ai/dsh-scope');
        const mounts = new WeakMap(), selected = new WeakMap();
        const acquire = async (key) => {
            let mount = mounts.get(key);
            if (mount?.closing) {
                await mount.closing;
                return acquire(key);
            }
            if (!mount) {
                // Same generation key: tools remain inherited and capability filters still apply.
                const scope = createScope(owner, key);
                mount = { scope, ready: mountBundledBash(scope.ctx), users: 0 };
                mounts.set(key, mount);
            }
            const entry = mount;
            entry.users++;
            let released = false;
            return { mount: entry, release() {
                    if (released)
                        return;
                    released = true;
                    if (--entry.users)
                        return;
                    // Wait for in-flight registration before removing it. A new user awaits teardown.
                    entry.closing = entry.ready.then(() => { }, () => { }).then(() => entry.scope.dispose()).finally(() => {
                        if (mounts.get(key) === entry)
                            mounts.delete(key);
                    });
                } };
        };
        const install = (agent) => {
            const previous = selected.get(agent);
            const id = registry.composedPreset(agent.ctx);
            const key = presets.has(id ?? '') ? scopeParentOf(agent) : undefined;
            if (previous && previous.key === key)
                return previous.ready;
            previous?.release();
            selected.delete(agent);
            if (!key)
                return Promise.resolve();
            const config = configurationOf(owner, agent);
            const creator = creatorOf(owner, agent);
            const parent = creator ? selected.get(creator) : undefined;
            const enabled = parent?.key === key ? parent.enabled : config.windowsBash !== false && config.windowsBashForOfficialPresets === true;
            const cleanups = [];
            const state = { key, enabled, ready: Promise.resolve(), disposed: false, release() {
                    if (state.disposed)
                        return;
                    state.disposed = true;
                    for (const cleanup of cleanups.splice(0).reverse())
                        cleanup();
                } };
            selected.set(agent, state);
            agent.ctx.effect(() => state.release);
            // Plugin unload restores filters even while the owning Agent remains alive.
            cleanups.push(owner.effect(() => state.release));
            state.ready = (async () => {
                const lease = await acquire(key);
                cleanups.push(lease.release);
                if (state.disposed) {
                    lease.release();
                    return;
                }
                let prepare;
                try {
                    prepare = await lease.mount.ready;
                }
                catch (error) {
                    if (!state.disposed) {
                        const tools = agent.ctx.get('tools');
                        const deny = (enabled ? ['pwsh', 'bash'] : ['bash']).filter(name => tools.get(name, key));
                        if (deny.length)
                            cleanups.push(tools.restrict({ deny }));
                    }
                    if (enabled)
                        throw error;
                    return;
                }
                if (state.disposed)
                    return;
                const tools = agent.ctx.get('tools');
                if (!prepare) {
                    if (!enabled)
                        return;
                    cleanups.push(tools.restrict({ deny: ['pwsh'] }));
                    throw new Error('Unsupported host shell provider; disable bundled Bash to use the host shell');
                }
                cleanups.push(tools.restrict({ deny: [enabled ? 'pwsh' : 'bash'] }));
                if (!enabled)
                    return;
                try {
                    if (parent?.key === key)
                        await parent.ready;
                    await prepare();
                }
                catch (error) {
                    if (!state.disposed)
                        cleanups.push(tools.restrict({ deny: ['bash'] }));
                    throw error;
                }
            })();
            return state.ready;
        };
        owner.on('agent/created', ({ agent }) => install(agent));
        // Blank conversations can switch preset before their first step.
        owner.on('agent/pre-step', async ({ agent }, next) => { await install(agent); return next(); }, true);
        owner.systemPrompt.section({ name: 'super-code:official-windows-shell', order: 94,
            text: ({ agent }) => agent && selected.get(agent)?.enabled
                ? 'Command environment: Windows with GNU Bash and BusyBox utilities. Native programs still run on Windows.' : '' });
        owner.on('system-prompt/assemble', async (_assembly, { agent }, next) => {
            const assembled = await next(), state = agent && selected.get(agent);
            if (!state || state.disposed)
                return assembled;
            const hidden = state.enabled ? 'tool:pwsh' : 'tool:bash';
            return { ...assembled, sections: assembled.sections.filter(section => section.name !== hidden) };
        });
    });
}
//# sourceMappingURL=official-windows-shell.js.map