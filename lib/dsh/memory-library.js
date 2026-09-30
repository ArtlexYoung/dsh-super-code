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
import { SessionId } from '@deepseek-ai/dsh-session';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { LongMemoryStore, memoryWorkspace, memoryGlobalNamespace, GLOBAL_PREFERENCES_TOPIC } from '../long-memory.js';
import { z } from 'zod';
export class MemoryLibraryReader {
    ctx;
    store;
    constructor(ctx, store) {
        this.ctx = ctx;
        this.store = store;
    }
    async workspace(sessionId, scope) {
        z.enum(['project', 'global']).parse(scope);
        const id = SessionId(z.string().min(1).max(256).parse(sessionId));
        const session = this.ctx.sessions.get(id);
        // Archived conversations need only trusted metadata, not replay or an Agent.
        const persistence = this.ctx.get('sessionPersistence');
        const header = session?.header ?? (await persistence?.stat(id))?.header;
        if (!header)
            throw new Error('Select an existing conversation to view its memory');
        return scope === 'global' ? memoryGlobalNamespace() : memoryWorkspace({ header });
    }
    async list(sessionId, scope) {
        const workspace = await this.workspace(sessionId, scope);
        const topics = this.store.topics(workspace).filter(row => scope !== 'global' || row.topic === GLOBAL_PREFERENCES_TOPIC);
        return { items: topics.flatMap(({ topic }) => {
                const found = this.store.read(workspace, topic);
                if (found.kind === 'missing')
                    return [];
                return found.value.entries.map(({ id, summary, kind }) => ({ topic, revision: found.value.revision, id, summary, kind }));
            }) };
    }
    async read(sessionId, scope, topic, id) {
        const workspace = await this.workspace(sessionId, scope);
        if (scope === 'global' && topic !== GLOBAL_PREFERENCES_TOPIC)
            throw new Error('Invalid global topic');
        const found = this.store.read(workspace, topic);
        if (found.kind === 'missing')
            return { kind: 'missing' };
        const entry = found.value.entries.find(item => item.id === id);
        if (!entry)
            return { kind: 'missing' };
        return { kind: 'found', entry: { topic, revision: found.value.revision, id, kind: entry.kind, summary: entry.summary,
                detail: entry.detail, ...(entry.sourceVersion ? { sourceVersion: entry.sourceVersion } : {}),
                source: { kind: entry.source.kind, sessionId: entry.source.sessionId, eventSeq: entry.source.eventSeq } } };
    }
}
let SuperCodeMemory = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _list_decorators;
    let _read_decorators;
    return class SuperCodeMemory extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _list_decorators = [Remote];
            _read_decorators = [Remote];
            __esDecorate(this, null, _list_decorators, { kind: "method", name: "list", static: false, private: false, access: { has: obj => "list" in obj, get: obj => obj.list }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _read_decorators, { kind: "method", name: "read", static: false, private: false, access: { has: obj => "read" in obj, get: obj => obj.read }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        reader = __runInitializers(this, _instanceExtraInitializers);
        constructor(ctx, store) {
            super(ctx, 'superCodeMemory');
            this.reader = new MemoryLibraryReader(ctx, store);
        }
        list(sessionId, scope) { return this.reader.list(sessionId, scope); }
        read(sessionId, scope, topic, id) { return this.reader.read(sessionId, scope, topic, id); }
    };
})();
export { SuperCodeMemory };
//# sourceMappingURL=memory-library.js.map