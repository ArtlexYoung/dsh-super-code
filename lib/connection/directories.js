import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { ConnectionError } from './types.js';
import { withinDirectory } from './tasks.js';
/** Pending consent is deliberately ephemeral; only an approved allowlist is persisted. */
export class DirectoryRequests {
    allowed;
    now;
    requests = new Map();
    sources = new Map();
    constructor(allowed, now = Date.now) {
        this.allowed = allowed;
        this.now = now;
    }
    expire() {
        for (const row of this.requests.values()) {
            if (row.status === 'pending' && this.now() - row.createdAt >= 5 * 60 * 1000)
                row.status = 'expired';
            if (row.status === 'approved' && !this.allowed().some(parent => withinDirectory(parent, row.path)))
                row.status = 'rejected';
        }
    }
    async request(input, client) {
        this.expire();
        const existing = this.requests.get(input.requestId);
        if (existing) {
            if (this.sources.get(input.requestId)?.path !== input.path || existing.reason !== input.reason)
                throw new ConnectionError('request-conflict');
            return { ...existing };
        }
        if (!isAbsolute(input.path))
            throw new ConnectionError('absolute-directory-required');
        let path, identity;
        try {
            path = await realpath(input.path);
            identity = await stat(path, { bigint: true });
            if (!identity.isDirectory())
                throw new Error();
        }
        catch {
            throw new ConnectionError('directory-unavailable');
        }
        if (this.pending().length >= 8)
            throw new ConnectionError('directory-request-limit');
        if (this.requests.size >= 100) {
            const oldest = [...this.requests.entries()].find(([, row]) => row.status !== 'pending');
            if (oldest) {
                this.requests.delete(oldest[0]);
                this.sources.delete(oldest[0]);
            }
        }
        const row = { id: randomUUID(), ...input, path, client: client.slice(0, 80), createdAt: this.now(),
            status: this.allowed().some(parent => withinDirectory(parent, path)) ? 'approved' : 'pending' };
        this.requests.set(input.requestId, row);
        this.sources.set(input.requestId, { path: input.path, dev: identity.dev, ino: identity.ino });
        return { ...row };
    }
    pending() { this.expire(); return [...this.requests.values()].filter(row => row.status === 'pending').map(row => ({ ...row })); }
    async resolve(id, decision, grant) {
        this.expire();
        const row = [...this.requests.values()].find(row => row.id === id);
        if (!row)
            throw new ConnectionError('directory-request-not-found');
        if (row.status !== 'pending')
            return { status: row.status };
        if (decision === 'approved') {
            try {
                if (await realpath(row.path) !== row.path)
                    throw new Error();
                const source = this.sources.get(row.requestId), identity = await stat(row.path, { bigint: true });
                if (!source || !identity.isDirectory() || identity.dev !== source.dev || identity.ino !== source.ino)
                    throw new Error();
            }
            catch {
                row.status = 'rejected';
                throw new ConnectionError('directory-changed');
            }
            this.expire();
            if (row.status !== 'pending')
                return { status: row.status };
            await grant(row.path);
        }
        row.status = decision;
        return { status: row.status };
    }
    rejectPending() { for (const row of this.requests.values())
        if (row.status === 'pending')
            row.status = 'rejected'; }
}
//# sourceMappingURL=directories.js.map