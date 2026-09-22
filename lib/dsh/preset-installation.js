var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
/** Host-only preset discovery repair; never part of a model's tool surface. */
import { cp, lstat, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import s from '@deepseek-ai/schemastery';
import { copyComposition, discoverPresets, writableRoot } from '@deepseek-ai/dsh-agent-presets';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
const sourceRoot = fileURLToPath(new URL('../../presets/', import.meta.url));
const validId = /^[a-z0-9][a-z0-9-]{0,63}$/;
async function exists(path) {
    try {
        await lstat(path);
        return true;
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return false;
        throw error;
    }
}
/** Serialized writes protect double clicks; mkdir claims only an unoccupied name. */
export class PresetInstaller {
    roster;
    settings;
    bundledRoot;
    baseUrl;
    tail = Promise.resolve();
    constructor(roster, settings, bundledRoot = sourceRoot, baseUrl = pathToFileURL(bundledRoot).href) {
        this.roster = roster;
        this.settings = settings;
        this.bundledRoot = bundledRoot;
        this.baseUrl = baseUrl;
    }
    async status() {
        const savedId = this.settings.get().installedId;
        const id = validId.test(savedId) ? savedId : 'super-code';
        const presets = await this.roster.list();
        const preset = presets.find(row => row.id === id);
        const authorable = this.roster.roots.some(root => root.trust === 'user');
        const occupied = await this.occupied(id);
        const userConflict = occupied && this.settings.get().installedId !== id;
        if (preset) {
            const owned = preset.trust === 'system' && resolve(preset.path) === join(this.bundledRoot, 'super-code', 'agent.cordis.yml');
            return { id, authorable, userConflict, state: preset.broken ? 'broken' : owned ? 'available'
                    : preset.trust === 'user' && this.settings.get().installedId === id ? 'installed' : 'conflict' };
        }
        return { id, authorable, userConflict, state: occupied ? 'conflict' : 'missing' };
    }
    async initialize() {
        await this.enqueue(async () => {
            if (this.settings.get().checked)
                return;
            const status = await this.status();
            // Persist intent first: a failure or subsequent user deletion must not
            // trigger a new filesystem write on every host restart.
            await this.settings.update({ checked: true });
            if (status.state === 'missing' && status.authorable)
                await this.installNow('super-code');
        });
    }
    async install(id) {
        return await this.enqueue(() => this.installNow(id));
    }
    async occupied(id) {
        for (const root of this.roster.roots.filter(root => root.trust === 'user')) {
            if (await exists(join(writableRoot([root], id), id)))
                return true;
        }
        return false;
    }
    async installNow(value) {
        const reject = async (error) => ({ ok: false, error, status: await this.status() });
        if (typeof value !== 'string' || !validId.test(value))
            return reject('invalid-name');
        const id = value;
        if (!this.roster.roots.some(root => root.trust === 'user'))
            return reject('no-user-root');
        if ((await this.roster.list()).some(row => row.id === id) || await this.occupied(id))
            return reject('name-taken');
        let staging = '';
        let claimed = false;
        const target = join(writableRoot(this.roster.roots, id), id);
        try {
            const source = (await discoverPresets([{ path: this.bundledRoot, trust: 'system' }], this.baseUrl))
                .find(preset => preset.id === 'super-code' && !preset.broken);
            if (!source)
                throw new Error('Bundled super-code preset unavailable');
            const root = writableRoot(this.roster.roots, id);
            await mkdir(root, { recursive: true, mode: 0o700 });
            staging = await mkdtemp(join(root, '.super-code-install-'));
            // The host copy helper can clean up its destination on failure. Isolate
            // it from user-owned paths, then exclusively claim the final directory.
            const prepared = await copyComposition([{ path: staging, trust: 'user' }], source, id, id);
            await mkdir(target, { mode: 0o700 });
            claimed = true;
            for (const entry of await readdir(prepared)) {
                await cp(join(prepared, entry), join(target, entry), { recursive: true, force: false, errorOnExist: true });
            }
            await this.settings.update({ checked: true, installedId: id });
            claimed = false;
            return { ok: true, status: await this.status() };
        }
        catch (error) {
            if (claimed)
                await rm(target, { recursive: true, force: true });
            return reject(error.code === 'EEXIST' ? 'name-taken' : 'install-failed');
        }
        finally {
            if (staging)
                await rm(staging, { recursive: true, force: true });
        }
    }
    enqueue(run) {
        const next = this.tail.then(run);
        this.tail = next.catch(() => { });
        return next;
    }
}
let SuperCodePresets = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _status_decorators;
    let _installPreset_decorators;
    return class SuperCodePresets extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _status_decorators = [Remote];
            _installPreset_decorators = [Remote];
            __esDecorate(this, null, _status_decorators, { kind: "method", name: "status", static: false, private: false, access: { has: obj => "status" in obj, get: obj => obj.status }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _installPreset_decorators, { kind: "method", name: "installPreset", static: false, private: false, access: { has: obj => "installPreset" in obj, get: obj => obj.installPreset }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        installer = __runInitializers(this, _instanceExtraInitializers);
        constructor(ctx, installer) {
            super(ctx, 'superCodePresets');
            this.installer = installer;
        }
        status() { return this.installer.status(); }
        installPreset(id) { return this.installer.install(id); }
    };
})();
export { SuperCodePresets };
export function applyPresetInstallation(ctx) {
    ctx.inject(['agentPresets', 'settings'], async (owner) => {
        const settings = owner.settings.register('super-code', s.object({
            checked: s.boolean().default(false),
            installedId: s.string().default(''),
        }));
        const installer = new PresetInstaller(owner.agentPresets, settings, sourceRoot, owner.baseUrl);
        new SuperCodePresets(owner, installer);
        try {
            await installer.initialize();
        }
        catch {
            owner.logger.warn('Super Code preset installation unavailable; retry in plugin settings.');
        }
    });
}
//# sourceMappingURL=preset-installation.js.map