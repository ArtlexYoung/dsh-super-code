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
import { cp, lstat, mkdir, mkdtemp, readdir, rm, readFile, writeFile, rename, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import s from '@deepseek-ai/schemastery';
import { copyBundledPreset, writableRoot } from './preset-files.js';
import { displayCopy, migrateMetadata } from './preset-metadata.js';
import { compositionVersion, directoryVersion, pluginVersion } from './preset-version.js';
import { DeclarationStateFile, DeclaredPresetInstaller } from './preset-declaration.js';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
const sourceRoot = fileURLToPath(new URL('../../presets/', import.meta.url));
const ownershipFile = '.super-code-installation.json';
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
function installationRecords(settings) {
    return { ...settings.installations, ...(settings.installation ? { [settings.installation.id]: settings.installation } : {}) };
}
async function sameDirectory(path, identity) {
    try {
        const stat = await lstat(path);
        return stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === identity.dev && stat.ino === identity.ino;
    }
    catch {
        return false;
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
        const stored = this.settings.get(), savedId = stored.installedId;
        const id = validId.test(savedId) ? savedId : 'super-code';
        const presets = await this.roster.list();
        const preset = presets.find(row => row.id === id);
        const authorable = this.roster.roots.some(root => root.trust === 'user');
        const occupied = await this.occupied(id);
        const ownedCopy = !!preset && await this.owns(preset, installationRecords(stored)[id]);
        const userConflict = occupied && !ownedCopy;
        if (preset) {
            const owned = preset.trust === 'system' && resolve(preset.path) === join(this.bundledRoot, 'super-code', 'agent.cordis.yml');
            return { id, name: preset.name, authorable, userConflict, delivery: 'directory', pluginVersion,
                ...await directoryVersion(preset.path), state: preset.broken ? 'broken' : owned ? 'available'
                    : ownedCopy ? 'installed' : 'conflict' };
        }
        return { id, authorable, userConflict, delivery: 'directory', pluginVersion, state: occupied ? 'conflict' : 'missing' };
    }
    async owns(preset, identity) {
        if (preset.trust !== 'user' || !identity || identity.id !== preset.id)
            return false;
        const directory = join(preset.path, '..');
        try {
            if (!await sameDirectory(directory, identity) || await realpath(directory) !== identity.path)
                return false;
            const roots = await Promise.all(this.roster.roots.filter(root => root.trust === 'user')
                .map(async (root) => {
                try {
                    return join(await realpath(writableRoot([root], preset.id)), preset.id);
                }
                catch {
                    return false;
                }
            }));
            if (!roots.includes(identity.path))
                return false;
            const path = join(directory, ownershipFile), stat = await lstat(path);
            if (!stat.isFile() || stat.isSymbolicLink())
                return false;
            const marker = JSON.parse(await readFile(path, 'utf8'));
            return marker?.plugin === 'dsh-super-code' && marker.id === identity.id && marker.token === identity.token;
        }
        catch {
            return false;
        }
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
    async synchronize(language) {
        if (!/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(language))
            throw new Error('Invalid language');
        return await this.enqueue(async () => {
            const stored = this.settings.get();
            const installations = installationRecords(stored);
            const display = { ...stored.display };
            const pendingDisplay = { ...stored.pendingDisplay };
            let changed = false;
            for (const preset of await this.roster.list()) {
                const bundled = preset.trust === 'system' && resolve(preset.path) === join(this.bundledRoot, 'super-code', 'agent.cordis.yml');
                const owned = await this.owns(preset, installations[preset.id]);
                if (!bundled && !owned)
                    continue;
                if ((await lstat(join(preset.path, '..'))).isSymbolicLink())
                    continue;
                const metadata = join(preset.path, '..', 'preset.yml');
                let previous = display[preset.path];
                const pending = pendingDisplay[preset.path];
                if (previous && pending) {
                    previous = { ...previous };
                    for (const field of ['name', 'description']) {
                        if (pending[field] !== undefined && preset[field] === pending[field])
                            previous[field] = pending[field];
                    }
                }
                const result = await migrateMetadata(metadata, preset.id, preset, previous, displayCopy(language), async (baseline) => {
                    if (owned && !await this.owns(preset, installations[preset.id]))
                        throw new Error('Preset ownership changed during migration');
                    pendingDisplay[preset.path] = baseline;
                    await this.settings.update({ pendingDisplay: { ...pendingDisplay } });
                    if (owned && !await this.owns(preset, installations[preset.id]))
                        throw new Error('Preset ownership changed during migration');
                });
                changed ||= result.changed;
                display[preset.path] = result.baseline;
                delete pendingDisplay[preset.path];
            }
            if (JSON.stringify(display) !== JSON.stringify(stored.display ?? {}) || JSON.stringify(pendingDisplay) !== JSON.stringify(this.settings.get().pendingDisplay ?? {})) {
                await this.settings.update({ display, pendingDisplay });
            }
            return { changed };
        });
    }
    async install(id, name) {
        return await this.enqueue(() => this.installNow(id, name));
    }
    async reinstall(previousId, id, name) {
        return await this.enqueue(async () => {
            const reject = async (error) => ({ ok: false, error, status: await this.status() });
            if (typeof id !== 'string' || !validId.test(id))
                return reject('invalid-name');
            if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 120))
                return reject('invalid-display-name');
            const stored = this.settings.get(), installation = stored.installation;
            if (!installation || previousId !== stored.installedId || installation.id !== previousId)
                return reject('ownership-unverified');
            const preset = (await this.roster.list()).find(row => row.id === previousId);
            if (!preset || !await this.owns(preset, installation))
                return reject('ownership-unverified');
            const originalPath = join(preset.path, '..');
            let backup = '';
            try {
                if (id !== previousId && ((await this.roster.list()).some(row => row.id === id) || await this.occupied(id)))
                    return reject('name-taken');
                // A container without agent.cordis.yml is not a discoverable preset.
                // Retain it after success as a recovery copy of the removed preset.
                backup = await mkdtemp(join(installation.path, '..', '.super-code-backup-'));
                await rename(installation.path, join(backup, previousId));
                const moved = await lstat(join(backup, previousId));
                if (!moved.isDirectory() || moved.dev !== installation.dev || moved.ino !== installation.ino) {
                    if (!await exists(installation.path))
                        await rename(join(backup, previousId), installation.path);
                    return reject('ownership-unverified');
                }
            }
            catch {
                return reject('ownership-unverified');
            }
            try {
                const result = await this.installNow(id, name, originalPath);
                if (result.ok)
                    return result;
                if (await exists(installation.path))
                    return reject('install-failed');
                await rename(join(backup, previousId), installation.path);
                await rm(backup, { recursive: true, force: true });
                return { ...result, status: await this.status() };
            }
            catch {
                // Never overwrite a directory created by another actor during repair.
                if (!await exists(installation.path))
                    await rename(join(backup, previousId), installation.path);
                return reject('install-failed');
            }
        });
    }
    async occupied(id) {
        for (const root of this.roster.roots.filter(root => root.trust === 'user')) {
            if (await exists(join(writableRoot([root], id), id)))
                return true;
        }
        return false;
    }
    async installNow(value, name, replacedPath) {
        const reject = async (error) => ({ ok: false, error, status: await this.status() });
        if (typeof value !== 'string' || !validId.test(value))
            return reject('invalid-name');
        const id = value;
        if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 120))
            return reject('invalid-display-name');
        if (!this.roster.roots.some(root => root.trust === 'user'))
            return reject('no-user-root');
        if ((await this.roster.list()).some(row => row.id === id) || await this.occupied(id))
            return reject('name-taken');
        let staging = '';
        let claimed = false;
        const target = join(writableRoot(this.roster.roots, id), id);
        try {
            const root = writableRoot(this.roster.roots, id);
            await mkdir(root, { recursive: true, mode: 0o700 });
            staging = await mkdtemp(join(root, '.super-code-install-'));
            // The host copy helper can clean up its destination on failure. Isolate
            // it from user-owned paths, then exclusively claim the final directory.
            const source = await copyBundledPreset(this.bundledRoot, staging, id, name?.trim() ?? 'Super Code');
            const prepared = source.directory;
            await mkdir(target, { mode: 0o700 });
            const claim = await lstat(target);
            if (!claim.isDirectory() || claim.isSymbolicLink())
                throw new Error('Installation directory changed');
            claimed = { dev: claim.dev, ino: claim.ino };
            for (const entry of await readdir(prepared)) {
                await cp(join(prepared, entry), join(target, entry), { recursive: true, force: false, errorOnExist: true });
            }
            const token = randomUUID();
            await writeFile(join(target, ownershipFile), JSON.stringify({ plugin: 'dsh-super-code', id, token }), { flag: 'wx', mode: 0o600 });
            const directory = await lstat(target);
            if (!await sameDirectory(target, claimed))
                throw new Error('Installation directory changed');
            const installation = { id, path: await realpath(target), token, dev: directory.dev, ino: directory.ino };
            const stored = this.settings.get(), installations = installationRecords(stored);
            const display = { ...stored.display }, pendingDisplay = { ...stored.pendingDisplay };
            if (replacedPath) {
                delete display[join(replacedPath, 'agent.cordis.yml')];
                delete pendingDisplay[join(replacedPath, 'agent.cordis.yml')];
                if (stored.installation)
                    delete installations[stored.installation.id];
            }
            const status = { id, authorable: true, userConflict: false, state: 'installed',
                delivery: 'directory', pluginVersion, ...await directoryVersion(join(target, 'agent.cordis.yml')) };
            await this.settings.update({ checked: true, installedId: id, installation, installations: { ...installations, [id]: installation }, pendingDisplay, display: {
                    ...display,
                    [join(target, 'agent.cordis.yml')]: {
                        ...(name === undefined ? { name: 'Super Code' } : {}),
                        ...(source.description === undefined ? {} : { description: source.description }),
                    },
                } });
            claimed = false;
            return { ok: true, status };
        }
        catch (error) {
            if (claimed && await sameDirectory(target, claimed))
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
/** Read-only fallback when a declarative host exposes no profile management. */
export class DeclaredPresetStatus {
    registry;
    constructor(registry) {
        this.registry = registry;
    }
    async status() {
        const preset = (await this.registry.list()).find(row => row.id === 'super-code');
        let version = {};
        if (preset && this.registry.readDocument) {
            try {
                const document = await this.registry.readDocument(preset.id);
                if (document.agentPreset === preset.id)
                    version = compositionVersion(document.content);
            }
            catch { /* A missing or unreadable declaration has an unknown version. */ }
        }
        return { id: 'super-code', name: preset?.name, authorable: false, userConflict: false,
            delivery: 'declaration', pluginVersion, ...version,
            state: preset ? preset.broken ? 'broken' : 'available' : 'missing' };
    }
    async install(_id, _name) {
        return { ok: false, error: 'management-unavailable', status: await this.status() };
    }
    async reinstall(_previousId, _id, _name) {
        return { ok: false, error: 'management-unavailable', status: await this.status() };
    }
    async synchronize(_language) { return { changed: false }; }
}
async function declarationHost(owner) {
    const profile = owner.get('profileContext');
    const loader = owner.get('loader');
    if (!profile?.patchPath || !loader)
        return false;
    try {
        // Resolve the running host's public API, rather than a second bundled host.
        const require = createRequire(profile.installAnchor ?? new URL('package.json', owner.baseUrl));
        const boot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href);
        if (typeof boot.readProfilePatches !== 'function' || typeof boot.reconcileProfilePatches !== 'function')
            return false;
        const hmr = owner.get('hmr');
        return {
            patchPath: profile.patchPath,
            entries: () => [...loader.entries()].map(row => ({ id: row.options.id, disabled: row.disabled, options: row.options })),
            reload: async () => { await boot.reconcileProfilePatches(owner.root, boot.readProfilePatches('dsh', profile), 'dsh'); },
            exclusive: run => hmr ? hmr.runExclusive(run) : run(),
        };
    }
    catch {
        return false;
    }
}
let SuperCodePresets = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _status_decorators;
    let _installPreset_decorators;
    let _reinstallPreset_decorators;
    let _synchronize_decorators;
    return class SuperCodePresets extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _status_decorators = [Remote];
            _installPreset_decorators = [Remote];
            _reinstallPreset_decorators = [Remote];
            _synchronize_decorators = [Remote];
            __esDecorate(this, null, _status_decorators, { kind: "method", name: "status", static: false, private: false, access: { has: obj => "status" in obj, get: obj => obj.status }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _installPreset_decorators, { kind: "method", name: "installPreset", static: false, private: false, access: { has: obj => "installPreset" in obj, get: obj => obj.installPreset }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _reinstallPreset_decorators, { kind: "method", name: "reinstallPreset", static: false, private: false, access: { has: obj => "reinstallPreset" in obj, get: obj => obj.reinstallPreset }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _synchronize_decorators, { kind: "method", name: "synchronize", static: false, private: false, access: { has: obj => "synchronize" in obj, get: obj => obj.synchronize }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        installer = __runInitializers(this, _instanceExtraInitializers);
        constructor(ctx, installer) {
            super(ctx, 'superCodePresets');
            this.installer = installer;
        }
        status() { return this.installer.status(); }
        installPreset(id, name) { return this.installer.install(id, name === '' ? undefined : name); }
        reinstallPreset(previousId, id, name) { return this.installer.reinstall(previousId, id, name === '' ? undefined : name); }
        synchronize(language) { return this.installer.synchronize(language); }
    };
})();
export { SuperCodePresets };
export function applyPresetInstallation(ctx) {
    ctx.inject(['agentPresets', 'settings'], async (owner) => {
        const registry = owner.get('agentPresets');
        if (!Array.isArray(registry.roots)) {
            const host = await declarationHost(owner);
            if (!host) {
                new SuperCodePresets(owner, new DeclaredPresetStatus(registry));
                return;
            }
            try {
                const settings = await DeclarationStateFile.open(join(host.patchPath, '..', '.super-code-presets.json'));
                new SuperCodePresets(owner, new DeclaredPresetInstaller(registry, settings, host, fileURLToPath(new URL('../../cordis.patch.yml', import.meta.url))));
            }
            catch {
                new SuperCodePresets(owner, new DeclaredPresetStatus(registry));
                owner.logger.warn('Super Code preset management unavailable; check the local installation record.');
            }
            return;
        }
        const settings = owner.settings.register('super-code', s.object({
            checked: s.boolean().default(false),
            installedId: s.string().default(''),
            installation: s.object({ id: s.string(), path: s.string(), token: s.string(), dev: s.number(), ino: s.number() }).required(false),
            installations: s.dict(s.object({ id: s.string(), path: s.string(), token: s.string(), dev: s.number(), ino: s.number() })).required(false),
            pendingDisplay: s.dict(s.object({ name: s.string().required(false), description: s.string().required(false) })).default({}),
            display: s.dict(s.object({ name: s.string().required(false), description: s.string().required(false) })).default({}),
        }));
        const installer = new PresetInstaller(registry, settings, sourceRoot, owner.baseUrl);
        new SuperCodePresets(owner, installer);
        try {
            await installer.initialize();
            const language = owner.settings.get('locale');
            if (language?.preference)
                await installer.synchronize(language.preference);
        }
        catch {
            owner.logger.warn('Super Code preset installation unavailable; retry in plugin settings.');
        }
    });
}
//# sourceMappingURL=preset-installation.js.map