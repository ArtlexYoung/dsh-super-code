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
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { fileURLToPath } from 'node:url';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ConnectionService } from '../connection/service.js';
import { ConnectionError, defaultConnectionConfig } from '../connection/types.js';
import { ConnectionStore } from '../connection/store.js';
import { ConnectionHost } from './connection-host.js';
import { applyConnectionApproval } from './connection-approval.js';
let SuperCodeConnection = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _readConfig_decorators;
    let _saveConfig_decorators;
    let _revealToken_decorators;
    let _rotateToken_decorators;
    let _overview_decorators;
    let _disconnectClient_decorators;
    let _pendingDirectories_decorators;
    let _resolveDirectory_decorators;
    let _directories_decorators;
    let _pickDirectory_decorators;
    let _browseDirectory_decorators;
    return class SuperCodeConnection extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _readConfig_decorators = [Remote];
            _saveConfig_decorators = [Remote];
            _revealToken_decorators = [Remote];
            _rotateToken_decorators = [Remote];
            _overview_decorators = [Remote];
            _disconnectClient_decorators = [Remote];
            _pendingDirectories_decorators = [Remote];
            _resolveDirectory_decorators = [Remote];
            _directories_decorators = [Remote];
            _pickDirectory_decorators = [Remote];
            _browseDirectory_decorators = [Remote];
            __esDecorate(this, null, _readConfig_decorators, { kind: "method", name: "readConfig", static: false, private: false, access: { has: obj => "readConfig" in obj, get: obj => obj.readConfig }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _saveConfig_decorators, { kind: "method", name: "saveConfig", static: false, private: false, access: { has: obj => "saveConfig" in obj, get: obj => obj.saveConfig }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _revealToken_decorators, { kind: "method", name: "revealToken", static: false, private: false, access: { has: obj => "revealToken" in obj, get: obj => obj.revealToken }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _rotateToken_decorators, { kind: "method", name: "rotateToken", static: false, private: false, access: { has: obj => "rotateToken" in obj, get: obj => obj.rotateToken }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _overview_decorators, { kind: "method", name: "overview", static: false, private: false, access: { has: obj => "overview" in obj, get: obj => obj.overview }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _disconnectClient_decorators, { kind: "method", name: "disconnectClient", static: false, private: false, access: { has: obj => "disconnectClient" in obj, get: obj => obj.disconnectClient }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _pendingDirectories_decorators, { kind: "method", name: "pendingDirectories", static: false, private: false, access: { has: obj => "pendingDirectories" in obj, get: obj => obj.pendingDirectories }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _resolveDirectory_decorators, { kind: "method", name: "resolveDirectory", static: false, private: false, access: { has: obj => "resolveDirectory" in obj, get: obj => obj.resolveDirectory }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _directories_decorators, { kind: "method", name: "directories", static: false, private: false, access: { has: obj => "directories" in obj, get: obj => obj.directories }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _pickDirectory_decorators, { kind: "method", name: "pickDirectory", static: false, private: false, access: { has: obj => "pickDirectory" in obj, get: obj => obj.pickDirectory }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _browseDirectory_decorators, { kind: "method", name: "browseDirectory", static: false, private: false, access: { has: obj => "browseDirectory" in obj, get: obj => obj.browseDirectory }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        current = __runInitializers(this, _instanceExtraInitializers);
        environment;
        constructor(ctx, current, environment = { workspaces: false, picker: false }) {
            super(ctx, 'superCodeConnection');
            this.current = current;
            this.environment = environment;
        }
        service() { const service = this.current(); if (!service)
            throw new ConnectionError('unavailable'); return service; }
        readConfig() { return this.current() ? this.service().read() : { configuration: structuredClone(defaultConnectionConfig), revision: 0, writable: false, state: 'error', error: 'unavailable', url: '' }; }
        saveConfig(content, expected) { return this.service().save(content, expected); }
        revealToken() { return this.service().reveal(); }
        rotateToken(expected) { return this.service().rotate(expected); }
        overview() { return this.current() ? this.service().overview() : { connections: [], sessions: [] }; }
        disconnectClient(id) { return this.service().disconnect(id); }
        pendingDirectories() { return this.current() ? this.service().pendingDirectories() : []; }
        resolveDirectory(id, decision) { return this.service().resolveDirectory(id, decision); }
        async directories() {
            const workspaces = this.environment.workspaces ? this.environment.workspaces.list() : [];
            const config = this.current() ? this.service().read().configuration : defaultConnectionConfig;
            // Registry entities expose these fields through prototype getters.
            const rows = [...workspaces.map(row => ({ path: row.path, title: row.title, workspace: true })),
                ...[...config.knownDirectories, ...config.allowedDirectories].map(path => ({ path, title: '', workspace: false }))];
            const items = await Promise.all(rows.slice(0, 500).map(async (row) => {
                try {
                    const path = await realpath(row.path);
                    return { path, title: row.title, workspace: row.workspace, available: (await stat(path)).isDirectory() };
                }
                catch {
                    return { path: row.path, title: row.title, workspace: row.workspace, available: false };
                }
            }));
            return { items: items.filter((row, index) => items.findIndex(other => other.path === row.path) === index),
                picker: this.environment.picker ? this.environment.picker.capability().kind : 'unavailable', available: !!this.environment.workspaces };
        }
        async pickDirectory(signal) {
            const picker = this.environment.picker && this.environment.picker.capability();
            if (!picker || picker.kind !== 'native' || !picker.pick)
                throw new ConnectionError('picker-unavailable');
            const path = await picker.pick(signal);
            return path === null ? { kind: 'cancelled' } : { kind: 'selected', path };
        }
        async browseDirectory(path, signal) {
            const picker = this.environment.picker && this.environment.picker.capability();
            if (!picker || picker.kind !== 'browse' || !picker.list)
                throw new ConnectionError('picker-unavailable');
            return picker.list(path || undefined, signal);
        }
    };
})();
export { SuperCodeConnection };
export function applyConnection(ctx) {
    let service = false;
    const environment = { workspaces: false, picker: false };
    new SuperCodeConnection(ctx, () => service, environment);
    applyConnectionApproval(ctx, () => service);
    ctx.inject(['workspaceRegistry'], owner => {
        environment.workspaces = owner.get('workspaceRegistry');
        owner.effect(() => () => { environment.workspaces = false; });
    });
    ctx.inject(['directoryPicker'], owner => {
        environment.picker = owner.get('directoryPicker');
        owner.effect(() => () => { environment.picker = false; });
    });
    const profileServices = 'profileContext' in ctx ? ['profileContext'] : [];
    ctx.inject([...profileServices, 'sessionController', 'agents', 'sessionQuery', 'subagents', 'superCodePresets'], async (owner) => {
        let directory;
        try {
            if (profileServices.length) {
                const profile = owner.get('profileContext');
                directory = dirname(profile.patchPath);
            }
            else {
                // Early hosts expose the profile only as the boot context base URL. Verify its manifest.
                const baseUrl = owner.root.baseUrl;
                if (!baseUrl)
                    throw new Error('Profile base URL unavailable');
                directory = fileURLToPath(baseUrl);
                const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
                if (!Array.isArray(manifest.dsh?.profile?.bundles))
                    throw new Error('Not a profile');
            }
        }
        catch {
            owner.logger.warn('Super Code connection requires a persistent host profile.');
            return;
        }
        const host = new ConnectionHost({ presets: owner.get('superCodePresets'), controller: owner.get('sessionController'),
            workspaceRegistry: owner.get('workspaceRegistry'), agents: owner.get('agents'), query: owner.get('sessionQuery'),
            subagents: owner.get('subagents') });
        const connection = new ConnectionService(new ConnectionStore(join(directory, 'super-code-connection')), host);
        try {
            await connection.initialize();
            service = connection;
            owner.effect(() => () => { service = false; return connection.close(); });
        }
        catch {
            owner.logger.warn('Super Code connection storage is unavailable or already owned by another host. No endpoint was started.');
        }
    });
}
//# sourceMappingURL=connection.js.map