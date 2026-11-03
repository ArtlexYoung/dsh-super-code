/** Select the host's standard shell tool; Windows can use the bundled Bash executable. */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { configurationOf } from './budgets.js';
import { prepareWindowsRuntime, windowsRuntimeEnvironment } from '../core/windows-runtime.js';
/** Use the host provider's argv extension point, including its sandboxed implementation. */
export function bundledBashProvider(Base, runtime) {
    const current = () => typeof runtime === 'function' ? runtime() : runtime;
    return class extends Base {
        resolve(request) {
            const spec = super.resolve(request);
            const mode = spec.sandboxPolicy?.mode ?? this.sandboxMode;
            // MSYS needs named pipes that Windows restricted tokens cannot create.
            // The standard tool resolves an approved per-call mode before this point.
            if (process.platform === 'win32' && mode !== undefined && mode !== 'danger-full-access') {
                throw new Error('SUPER_CODE_BASH_SANDBOX: The Windows sandbox cannot start bundled Bash because MSYS requires internal named pipes. '
                    + 'This command was not executed. If it is still needed and approvals are available, request DSH approval for the exact same command '
                    + 'with sandbox_permissions="danger-full-access" and a justification. Approval applies only to that invocation; do not change the session permission or switch shells. '
                    + 'If approval is rejected, cancelled or disabled, stop this command.');
            }
            return { ...spec, env: windowsRuntimeEnvironment(current(), spec.env) };
        }
        argv(spec) {
            return [current().bash, '--noprofile', '--norc', '-c', spec.command];
        }
    };
}
/** Resolve the running host's modules, including installed directory presets and Desktop profiles. */
export async function hostModule(ctx, name) {
    const profile = ctx.get('profileContext');
    // Directory-preset hosts predate profileContext; their root retains the profile's module fallback links.
    const anchor = profile?.installAnchor ?? (ctx.root.baseUrl
        ? new URL('package.json', ctx.root.baseUrl)
        : new URL('../../package.json', import.meta.url));
    const require = createRequire(anchor);
    return await import(pathToFileURL(require.resolve(name)).href);
}
async function hostTool(ctx, name) {
    const module = await hostModule(ctx, name);
    if (typeof module.apply !== 'function')
        throw new Error(`Invalid host shell tool: ${name}`);
    return module;
}
/** One shared preparation result; no installation subprocess or global environment mutation. */
export function applyWindowsShell(ctx) {
    let status = { platform: process.platform, state: process.platform === 'win32' ? 'pending' : 'host' };
    let preparing = false;
    ctx.provide('superCodeShell', {
        status: () => ({ ...status }),
        prepare: () => {
            if (!preparing) {
                status = { platform: process.platform, state: 'pending' };
                preparing = prepareWindowsRuntime().then(runtime => {
                    status = { platform: process.platform, state: 'ready', version: runtime.version };
                    return runtime;
                }, (error) => {
                    preparing = false;
                    status = { platform: process.platform, state: 'error', error: error instanceof Error ? error.message : 'Bundled Bash preparation failed' };
                    throw error;
                });
            }
            return preparing;
        },
    });
}
export const name = 'super-code-shell';
export const inject = ['tools', 'systemPrompt', 'shell'];
/** Runtime ownership is distinct from durable session lineage or shared preset scope. */
export function creatorOf(ctx, agent) {
    const agents = ctx.get('agents');
    return agents?.list().find(candidate => agents.isOwnedBy(agent.id, candidate)) ?? false;
}
/** Contribute an inherited tool without changing the host provider or session policy. */
export async function mountBundledBash(ctx) {
    const host = ctx.get('shell');
    const provider = await hostModule(ctx, host.sandboxMode === undefined ? '@deepseek-ai/dsh-pwsh-local' : '@deepseek-ai/dsh-pwsh-sandbox');
    const Base = provider.default;
    if (typeof Base !== 'function' || !(host instanceof Base))
        return false;
    let runtime = false;
    const Bundled = bundledBashProvider(Base, () => {
        if (!runtime)
            throw new Error('Bundled Bash is not ready for this conversation');
        return runtime;
    });
    const bash = ctx.isolate('shell').isolate('settings');
    await bash.plugin({ inject: [...Base.inject ?? []], apply(scope) { new Bundled(scope, host.config); } });
    await bash.plugin(await hostTool(ctx, '@deepseek-ai/dsh-tool-bash'));
    return async () => {
        const service = ctx.get('superCodeShell');
        if (!service)
            throw new Error('Super Code shell service is unavailable');
        runtime = await service.prepare();
    };
}
/** Keep tools inherited so both root and child capability restrictions still apply. */
export async function apply(ctx) {
    if (process.platform !== 'win32') {
        await ctx.plugin(await hostTool(ctx, '@deepseek-ai/dsh-tool-bash'));
        return;
    }
    const { scopeParentOf } = await hostModule(ctx, '@deepseek-ai/dsh-scope');
    const prepare = await mountBundledBash(ctx);
    if (!prepare) {
        await ctx.plugin(await hostTool(ctx, '@deepseek-ai/dsh-tool-pwsh'));
        const choices = new WeakMap();
        const check = (agent) => {
            const creator = creatorOf(ctx, agent);
            let enabled = creator ? choices.get(creator) : undefined;
            for (let current = agent; current; current = scopeParentOf(current)) {
                if (choices.has(current)) {
                    enabled = choices.get(current);
                    break;
                }
            }
            enabled ??= configurationOf(ctx, agent).windowsBash !== false;
            choices.set(agent, enabled);
            if (enabled) {
                agent.ctx.get('tools').restrict({ deny: ['pwsh'] });
                throw new Error('Unsupported host shell provider; disable bundled Bash to use the host shell');
            }
        };
        ctx.on('agent/created', ({ agent }) => { check(agent); });
        ctx.on('agent/pre-step', async ({ agent }, next) => { check(agent); return next(); });
        return;
    }
    const installed = new WeakMap();
    const choice = (agent) => {
        for (let current = agent; current; current = scopeParentOf(current)) {
            const state = installed.get(current);
            if (state)
                return state.enabled;
        }
        return configurationOf(ctx, agent).windowsBash !== false;
    };
    await ctx.plugin(await hostTool(ctx, '@deepseek-ai/dsh-tool-pwsh'));
    ctx.systemPrompt.section({ name: 'super-code:windows-shell', order: 94,
        text: ({ agent }) => agent && choice(agent)
            ? 'Command environment: Windows with GNU Bash and BusyBox utilities. Native programs still run on Windows.' : '' });
    ctx.on('system-prompt/assemble', async (_assembly, { agent }, next) => {
        const assembled = await next();
        const hidden = choice(agent) ? 'tool:pwsh' : 'tool:bash';
        return { ...assembled, sections: assembled.sections.filter(section => section.name !== hidden) };
    });
    const install = (agent) => {
        const existing = installed.get(agent);
        if (existing)
            return existing.ready;
        // Descendants retain their conversation's shell and capability filters.
        for (let parent = scopeParentOf(agent); parent; parent = scopeParentOf(parent)) {
            const inherited = installed.get(parent);
            if (inherited) {
                installed.set(agent, inherited);
                return inherited.ready;
            }
        }
        const creator = creatorOf(ctx, agent), inherited = creator && installed.get(creator);
        const enabled = inherited ? inherited.enabled : configurationOf(ctx, agent).windowsBash !== false;
        const tools = agent.ctx.get('tools');
        tools.restrict({ deny: [enabled ? 'pwsh' : 'bash'] });
        const ready = (async () => {
            if (enabled || inherited) {
                try {
                    if (inherited)
                        await inherited.ready;
                    else
                        await prepare();
                }
                catch (error) {
                    // Sibling recovery must not activate a conversation that failed preparation.
                    tools.restrict({ deny: ['bash'] });
                    throw error;
                }
            }
        })();
        installed.set(agent, { enabled, ready });
        return ready;
    };
    ctx.on('agent/created', async ({ agent }) => { await install(agent); });
    ctx.on('agent/pre-step', async ({ agent }, next) => { await install(agent); return next(); });
}
//# sourceMappingURL=windows-shell.js.map