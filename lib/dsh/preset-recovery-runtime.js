/** Copied to the profile so cold recovery does not depend on the removed npm package. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const noticePlugin = 'dsh-super-code/preset-recovery';
const deletionSource = 'dsh-super-code/deletion-protection';
const revokedSource = 'dsh-super-code/deletion-protection-revoked';
const official = new Set(['standard', 'ptc', 'minimal', 'cordis']);
export function fingerprint(content) { return createHash('sha256').update(content).digest('hex'); }
const revocationCursors = new WeakMap();
function deletionCursor(session) {
    const cursor = revocationCursors.get(session) ?? { offset: 0, pending: new Set() };
    for (const event of session.snapshotEvents(cursor.offset)) {
        if (event.type !== 'user/message')
            continue;
        if (event.data.source.kind === deletionSource)
            cursor.pending.add(event.seq);
        else if (event.data.source.kind === revokedSource)
            for (const seq of event.sourceEventSeqs ?? [])
                cursor.pending.delete(seq);
    }
    cursor.offset = session.seq;
    revocationCursors.set(session, cursor);
    return cursor;
}
/** The durable producer record survives cold reloads and compaction. */
export function deletionNoticeMatches(session, instruction) {
    const cursor = deletionCursor(session);
    if (cursor.pending.size !== 1)
        return false;
    const event = session.eventAt([...cursor.pending][0]);
    return event?.type === 'user/message' && event.data.content.length === 1
        && event.data.content[0]?.type === 'text' && event.data.content[0].text.endsWith(instruction);
}
/** Retire only producer-owned rules; keep append-origin history and user instructions intact. */
export function revokeDeletionNotices(session, message) {
    const cursor = deletionCursor(session);
    const notice = () => message({ source: { kind: revokedSource }, content: [{ type: 'text', text: 'Super Code 先前添加的删除保护规则已撤销，不再适用；请遵循当前用户指令和宿主权限。\nEarlier deletion-protection rules added by Super Code have been revoked and no longer apply. Follow current user instructions and host permissions.' }] });
    const active = new Set(session.surface.nodes);
    for (const seq of cursor.pending) {
        if (!active.has(seq))
            continue;
        session.append('user/message', notice(), {
            surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq],
        });
        cursor.pending.delete(seq);
    }
    // A previous compaction may have absorbed a rule into its summary. Preserve
    // that summary and its other context; explicitly revoke the owned rule once.
    if (cursor.pending.size) {
        session.append('user/message', notice(), { surfaceOp: 'append', sourceEventSeqs: [...cursor.pending] });
        cursor.pending.clear();
    }
    cursor.offset = session.seq;
    revocationCursors.set(session, cursor);
}
/** The first declarative releases predate readDocument; their Loader still owns the definition. */
export async function compositionContent(ctx, id) {
    const registry = ctx.get('agentPresets');
    if (registry.readDocument) {
        const document = await registry.readDocument(id);
        return document.agentPreset === id ? document.content : '';
    }
    const entries = [...ctx.loader.entries()].filter(row => row.options.name === '@deepseek-ai/dsh-agent-preset'
        && !row.disabled && row.options.disabled !== true && row.options.config?.id === id);
    return entries.length === 1 ? JSON.stringify(entries[0].options.config.plugins) : '';
}
async function recoveryContent(path) {
    try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink())
            throw new Error('Unsafe recovery record');
        return await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return false;
        throw error;
    }
}
/** Invalid or unrelated records fail closed; never replace them with an empty ownership record. */
export class RecoveryState {
    path;
    value;
    content;
    tail = Promise.resolve();
    constructor(path, value, content) {
        this.path = path;
        this.value = value;
        this.content = content;
    }
    static async open(path, required = false) {
        let value = { plugin: 'dsh-super-code', format: 1, sessions: {} };
        const content = await recoveryContent(path);
        if (content === false && required)
            throw new Error('Missing recovery record');
        if (content !== false) {
            const data = JSON.parse(content);
            if (data?.plugin !== 'dsh-super-code' || data.format !== 1 || !data.sessions || typeof data.sessions !== 'object' || Array.isArray(data.sessions))
                throw new Error('Invalid recovery record');
            for (const [id, row] of Object.entries(data.sessions)) {
                if (!id || !row || typeof row.preset !== 'string' || !row.preset || official.has(row.preset)
                    || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || row.cwd !== undefined && typeof row.cwd !== 'string'
                    || typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint))
                    throw new Error('Invalid recovery session');
            }
            value = data;
        }
        return new RecoveryState(path, value, content);
    }
    async save(id, record) {
        const next = this.tail.then(async () => {
            if (JSON.stringify(this.value.sessions[id]) === JSON.stringify(record))
                return;
            const value = { ...this.value, sessions: { ...this.value.sessions, [id]: record } };
            if (await recoveryContent(this.path) !== this.content)
                throw new Error('Recovery record changed since loading');
            const stage = await mkdtemp(join(dirname(this.path), '.state-'));
            try {
                const file = join(stage, 'state.json'), content = JSON.stringify(value);
                await writeFile(file, content, { mode: 0o600 });
                if (await recoveryContent(this.path) !== this.content)
                    throw new Error('Recovery record changed during save');
                await rename(file, this.path);
                this.content = content;
                this.value.sessions = value.sessions;
            }
            finally {
                await rm(stage, { recursive: true, force: true });
            }
        });
        this.tail = next.catch(() => { });
        await next;
    }
    async flush() { await this.tail; }
}
function selected(session, ctx) {
    return ctx.sessionProjections.stateOf(session, 'agentPreset') ?? session.header.agentPreset;
}
/** Wrap only the public roster seam; mounting still belongs to the running host. */
export function installRecovery(ctx, state, config, host) {
    const registry = ctx.get('agentPresets');
    const originalResolve = registry.resolve, originalMount = registry.mount;
    const resolveDescriptor = Object.getOwnPropertyDescriptor(registry, 'resolve');
    const mountDescriptor = Object.getOwnPropertyDescriptor(registry, 'mount');
    let active = true;
    const unavailable = () => active && !existsSync(config.packagePath) && !ctx.get('superCodeConfiguration');
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
        // Disabling a bundle leaves its package on disk but removes its policy owner.
        if (!ctx.get('superCodeConfiguration')) {
            signal.throwIfAborted();
            revokeDeletionNotices(agent.session, host.message);
        }
        return next();
    }, true);
    const known = (id) => Object.values(state.value.sessions).some(row => row.preset === id);
    const documentHash = async (id) => {
        const content = await compositionContent(ctx, id);
        return content ? fingerprint(content) : '';
    };
    const rememberHeader = async (header, preset) => {
        if (!active || official.has(preset))
            return;
        const hash = await documentHash(preset);
        if (active && hash)
            await state.save(header.id, { preset, createdAt: header.createdAt, ...(header.cwd === undefined ? {} : { cwd: header.cwd }), fingerprint: hash });
    };
    const service = {
        async remember(agent) {
            if (!active || !ctx.get('tools')?.get('super_code_task', agent))
                return;
            const preset = registry.composedPreset(agent.ctx);
            if (preset)
                await rememberHeader(agent.session.header, preset);
        },
        async backfill(presets) {
            const query = ctx.get('sessionQuery');
            if (!active || !query || !presets.length)
                return;
            const owned = new Set(presets);
            for (const { header } of await query.listSessions()) {
                if (!active)
                    return;
                // A blank conversation can switch from an official preset before its
                // first turn; its immutable header then differs from the selected one.
                try {
                    const history = await query.readSession(header.id);
                    let preset = history.session.agentPreset;
                    for (const event of history.events)
                        if (event.type === 'agent-preset/selected')
                            preset = event.data.agentPreset;
                    if (preset && owned.has(preset))
                        await rememberHeader(history.session, preset);
                }
                catch {
                    ctx.logger.warn('A historical Super Code session could not be registered for uninstall recovery.');
                }
            }
        },
    };
    const resolve = async function (id) {
        try {
            return await originalResolve.call(this, id);
        }
        catch (error) {
            if (!id || !unavailable() || !known(id) || (await this.list()).some(row => row.id === id))
                throw error;
            if (!unavailable() || !known(id))
                throw error;
            // The actual mount below requires an exact previously recorded Session.
            return { id };
        }
    };
    const mount = async function (agentCtx, id) {
        const scope = host.scopeOf(agentCtx);
        const agent = scope && typeof scope === 'object' && 'session' in scope ? scope : undefined;
        const saved = agent && state.value.sessions[agent.session.id];
        if (!agent || !id || !saved)
            return originalMount.call(this, agentCtx, id);
        const eligible = () => unavailable() && state.value.sessions[agent.session.id] === saved && saved.preset === id
            && selected(agent.session, ctx) === id && saved.createdAt === agent.session.header.createdAt && saved.cwd === agent.session.header.cwd;
        if (!eligible())
            return originalMount.call(this, agentCtx, id);
        const preset = (await this.list()).find(row => row.id === id);
        if (preset && (!preset.broken || await documentHash(id) !== saved.fingerprint))
            return originalMount.call(this, agentCtx, id);
        // Roster/document reads can yield to reinstallation, a selection change or
        // teardown. A stale wrapper must return control to the host in each case.
        if (!eligible())
            return originalMount.call(this, agentCtx, id);
        const mounted = await originalMount.call(this, agentCtx, 'standard');
        const current = selected(agent.session, ctx);
        if (!unavailable())
            return originalMount.call(this, agentCtx, current ?? id);
        if (current !== id)
            return current === 'standard' ? mounted : originalMount.call(this, agentCtx, current);
        if (!eligible())
            return originalMount.call(this, agentCtx, id);
        const settings = ctx.get('settings');
        const language = (settings?.get ? settings.get('locale')?.preference
            : settings?.describe?.().find(row => row.ns === 'locale')?.value?.preference) ?? 'zh';
        const chinese = language.toLowerCase().startsWith('zh') || language === 'auto' || language === 'system';
        // Native command-result records remain visible outside collapsed work
        // steps. Attribute this automatic operation to the plugin, never the user;
        // it adds no model-facing message and schedules no extra turn.
        const commandId = randomUUID();
        agent.session.append('command/run', { commandId, name: 'super-code-recovery', source: { kind: noticePlugin } });
        agent.session.append('agent-preset/selected', { agentPreset: 'standard' });
        agent.session.append('command/done', { commandId, kind: 'success', text: chinese
                ? 'Super Code 插件已卸载，本对话将使用官方标准预设继续。已有历史记录保留。'
                : 'The Super Code plugin has been uninstalled. This conversation will continue with the official Standard preset. Existing history is preserved.' });
        return mounted;
    };
    registry.resolve = resolve;
    registry.mount = mount;
    ctx.effect(() => async () => {
        active = false;
        for (const [key, wrapper, descriptor] of [['resolve', resolve, resolveDescriptor], ['mount', mount, mountDescriptor]]) {
            if (registry[key] !== wrapper)
                continue;
            if (descriptor)
                Object.defineProperty(registry, key, descriptor);
            else
                Reflect.deleteProperty(registry, key);
        }
        await state.flush();
    });
    return service;
}
export const name = 'super-code-session-recovery';
export function apply(ctx, config) {
    // Duplicate or failed loaders remain subscribed to host services; they must
    // never compete with a newer generation when those services return.
    let redundant = false;
    ctx.inject(['agentPresets', 'sessionProjections', 'tools'], async (owner) => {
        if (redundant)
            return;
        try {
            const profile = owner.get('profileContext');
            const require = createRequire(profile?.installAnchor ?? new URL('package.json', owner.root.baseUrl));
            const scope = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-scope')).href);
            const llm = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
            const previous = owner.get('superCodeSessionRecovery')?.lifetime;
            if (owner.get('superCodeSessionRecovery')) {
                if (!previous || previous.source === import.meta.url || previous.statePath !== config.statePath || previous.packagePath !== config.packagePath) {
                    redundant = true;
                    return;
                }
                // A content-addressed runtime is rooted outside the main bundle. Retire
                // its hooks and drain its writer before loading the next generation.
                await RecoveryState.open(config.statePath, true);
                await previous.dispose();
            }
            const state = await RecoveryState.open(config.statePath, !!previous);
            if (owner.get('superCodeSessionRecovery')) {
                redundant = true;
                return;
            }
            const service = installRecovery(owner, state, config, { scopeOf: scope.scopeOf, message: llm.createUserMessage });
            service.lifetime = { ...config, source: import.meta.url, dispose: () => ctx.fiber.dispose() };
            owner.provide('superCodeSessionRecovery', service);
            const remember = async (agent) => {
                try {
                    await service.remember(agent);
                }
                catch {
                    owner.logger.warn('Super Code session recovery record could not be saved.');
                }
            };
            owner.on('agent/created', async ({ agent }) => { await remember(agent); });
            owner.on('agent/pre-step', async ({ agent }, next) => { await remember(agent); return next(); }, true);
        }
        catch {
            redundant = true;
            owner.logger.warn('Super Code continuation recovery could not be loaded; check the local recovery record and restart DSH.');
        }
    });
}
//# sourceMappingURL=preset-recovery-runtime.js.map