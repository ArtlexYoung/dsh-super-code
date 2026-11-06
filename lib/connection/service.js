import { randomBytes } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { ConnectionError, connectionConfigSchema } from './types.js';
import { ConnectionStore } from './store.js';
import { DelegatedTasks } from './tasks.js';
import { ConnectionHttp } from './http.js';
import { DirectoryRequests } from './directories.js';
async function canonicalKnownDirectories(paths) {
    // Known entries are not grants: keep missing/inaccessible paths visible for removal.
    return [...new Set(await Promise.all(paths.map(path => realpath(path).catch(() => path))))];
}
export class ConnectionService {
    store;
    host;
    settings;
    tasks;
    http;
    directoryRequests;
    timer = false;
    tail = Promise.resolve();
    closing = false;
    cleanupFailed = false;
    state = 'disabled';
    error = '';
    observing = false;
    constructor(store, host) {
        this.store = store;
        this.host = host;
    }
    async initialize() {
        await this.store.initialize();
        try {
            this.settings = await this.store.settings();
            this.settings.config.knownDirectories = await canonicalKnownDirectories(this.settings.config.knownDirectories);
            this.tasks = new DelegatedTasks(this.store, this.host, () => this.closing ? { ...this.settings.config, enabled: false } : this.settings.config);
            await this.tasks.initialize();
            this.directoryRequests = new DirectoryRequests(() => this.settings.config.allowedDirectories);
            this.http = new ConnectionHttp(this.tasks, (input, client) => this.exclusive(async () => {
                if (this.closing || !this.settings.config.enabled)
                    throw new ConnectionError('connection-disabled');
                return this.directoryRequests.request(input, client);
            }));
            await this.listen();
            this.timer = setInterval(() => {
                if (this.closing || this.observing)
                    return;
                this.observing = true;
                void this.tasks.tick().catch(() => { if (!this.closing)
                    this.error = 'storage-unavailable'; }).finally(() => { this.observing = false; });
            }, 1000);
            this.timer.unref();
        }
        catch (error) {
            await this.store.close();
            throw error;
        }
    }
    read() {
        return { configuration: structuredClone(this.settings.config), revision: this.settings.revision, writable: !this.closing,
            state: this.closing ? 'disabled' : this.state, error: this.error, url: `http://127.0.0.1:${this.settings.config.port}/mcp` };
    }
    overview() { return { connections: this.http.connections(), sessions: this.tasks.overview() }; }
    requestApproval(input, roots, signal) {
        if (this.closing || this.state !== 'listening')
            return Promise.resolve('host');
        return this.tasks.requestApproval(input, roots, signal);
    }
    async disconnect(id) { await this.http.disconnect(id); return { disconnected: true }; }
    pendingDirectories() { return this.directoryRequests.pending(); }
    async resolveDirectory(id, decision) {
        if (decision !== 'approved' && decision !== 'rejected')
            throw new ConnectionError('invalid-decision');
        return this.exclusive(() => {
            if (this.closing)
                throw new ConnectionError('unavailable');
            return this.directoryRequests.resolve(id, decision, async (path) => {
                if (this.closing || !this.settings.config.enabled)
                    throw new ConnectionError('connection-disabled');
                const allowedDirectories = [...new Set([...this.settings.config.allowedDirectories, path])];
                if (allowedDirectories.length > 32)
                    throw new ConnectionError('directory-limit');
                const next = { ...this.settings, revision: this.settings.revision + 1,
                    config: { ...this.settings.config, directoriesConfigured: true, allowedDirectories,
                        knownDirectories: [...new Set([...this.settings.config.knownDirectories, path])].slice(-128) } };
                await this.store.saveSettings(next);
                this.settings = next;
            });
        });
    }
    exclusive(run) {
        const operation = this.tail.then(run);
        this.tail = operation.catch(() => { });
        return operation;
    }
    async save(content, revision) {
        return this.exclusive(async () => {
            if (this.closing)
                return { ok: false, error: 'unavailable' };
            if (revision !== String(this.settings.revision))
                return { ok: false, error: 'conflict' };
            let config;
            try {
                if (content.length > 131072)
                    throw new Error();
                config = connectionConfigSchema.parse(JSON.parse(content));
                config.maxConcurrent = config.maxConnections;
                if (config.knownDirectories.some(path => !isAbsolute(path)))
                    throw new Error();
                config.knownDirectories = await canonicalKnownDirectories(config.knownDirectories);
                config.allowedDirectories = [...new Set(await Promise.all(config.allowedDirectories.map(async (path) => {
                        if (!isAbsolute(path))
                            throw new Error();
                        const canonical = await realpath(path);
                        if (!(await stat(canonical)).isDirectory())
                            throw new Error();
                        return canonical;
                    })))].sort();
                if (config.enabled && !config.allowedDirectories.length)
                    throw new Error();
            }
            catch {
                return { ok: false, error: 'invalid' };
            }
            if (this.closing)
                return { ok: false, error: 'unavailable' };
            const previous = this.settings.config;
            const next = { ...this.settings, revision: this.settings.revision + 1, config };
            try {
                await this.store.saveSettings(next);
            }
            catch {
                return { ok: false, error: 'save-failed' };
            }
            this.settings = next;
            if (!config.enabled || !config.allowCallerApproval || JSON.stringify(config.allowedDirectories) !== JSON.stringify(previous.allowedDirectories))
                this.tasks.approvalsChanged();
            if (!config.enabled)
                this.directoryRequests.rejectPending();
            const transportChanged = this.state === 'error' || config.enabled !== previous.enabled || config.port !== previous.port || config.maxConnections !== previous.maxConnections;
            if (transportChanged)
                await this.restart();
            return { ok: true, snapshot: this.read() };
        });
    }
    reveal() { return { token: this.settings.token }; }
    async rotate(revision) {
        return this.exclusive(async () => {
            if (this.closing)
                return { ok: false, error: 'unavailable' };
            if (revision !== String(this.settings.revision))
                return { ok: false, error: 'conflict' };
            const next = { ...this.settings, revision: this.settings.revision + 1, token: randomBytes(32).toString('hex') };
            try {
                await this.store.saveSettings(next);
            }
            catch {
                return { ok: false, error: 'save-failed' };
            }
            this.settings = next;
            this.tasks.approvalsChanged();
            await this.restart();
            return { ok: true, snapshot: this.read() };
        });
    }
    async restart() {
        if (this.closing)
            return;
        this.state = 'disabled';
        this.error = '';
        try {
            await this.http.close();
        }
        catch {
            this.state = 'error';
            this.error = 'cleanup-failed';
            return;
        }
        if (!this.closing)
            await this.listen();
    }
    async listen() {
        this.error = '';
        this.state = 'disabled';
        if (!this.settings.config.enabled)
            return;
        try {
            await this.http.start(this.settings.config.port, this.settings.token, this.settings.config.maxConnections);
            this.state = 'listening';
        }
        catch (error) {
            this.state = 'error';
            this.error = error instanceof ConnectionError ? error.code : 'unavailable';
        }
    }
    close() {
        if (this.closing && !this.cleanupFailed)
            return this.closing;
        this.cleanupFailed = false;
        this.closing = this.exclusive(async () => {
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = false;
            }
            this.state = 'disabled';
            this.directoryRequests.rejectPending();
            const failures = [];
            // A transport or persistence error must not strand the profile lock.
            for (const release of [() => this.http.close(), () => this.tasks.close(), () => this.store.close()]) {
                try {
                    await release();
                }
                catch (error) {
                    failures.push(error);
                }
            }
            if (failures.length === 1)
                throw failures[0];
            if (failures.length > 1)
                throw new AggregateError(failures, 'MCP resource cleanup failed');
        }).catch(error => { this.cleanupFailed = true; throw error; });
        return this.closing;
    }
}
//# sourceMappingURL=service.js.map