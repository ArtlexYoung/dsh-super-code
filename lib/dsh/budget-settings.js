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
import { settingsConfigurationSchema, configurationValues, validateConfiguration } from './budgets.js';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
const namespace = 'super-code-budgets';
/** Keep the evaluated budgets independent of changes to the host's defaults. */
function withLegacyBudgets(config, ptcCeiling) {
    const maxTimeout = ptcCeiling === false ? false : Math.min(ptcCeiling, config.budgets?.ptcMaxTimeoutMs ?? Math.max(600000, config.budgets?.ptcTimeoutMs ?? 0));
    return {
        applyToOfficialPresets: false, maxTasks: 32, maxContextBytes: 32768, ...config,
        budgets: { pressureBasis: 'window', thresholdRatio: 0.8, retainRatio: 0.16,
            summaryMaxTokens: 8192, compactionRetries: 1, maxOverflowRetries: 1,
            ...(maxTimeout === false ? {} : { ptcTimeoutMs: Math.min(600000, maxTimeout), ptcMaxTimeoutMs: maxTimeout }),
            ...config.budgets,
        },
    };
}
export class BudgetSettings {
    settings;
    scope;
    ptcCeiling;
    key;
    defaults;
    constructor(settings, scope, ptcCeiling, key = namespace, defaults = () => ({})) {
        this.settings = settings;
        this.scope = scope;
        this.ptcCeiling = ptcCeiling;
        this.key = key;
        this.defaults = defaults;
    }
    read() {
        const descriptor = this.settings.describe({ redactSecrets: true }).find(row => row.ns === this.key);
        if (!descriptor)
            throw new Error('Super Code budget settings are unavailable');
        return { configuration: structuredClone(this.scope.get()), revision: descriptor.revision,
            writable: this.settings.writable, ptcMaxTimeoutMs: this.ptcCeiling(), defaults: structuredClone(this.defaults()) };
    }
    async save(content, expected) {
        if (!this.settings.writable)
            return { ok: false, error: 'read-only' };
        let config;
        try {
            if (content.length > 4096)
                throw new Error('Configuration is too large');
            config = validateConfiguration(JSON.parse(content));
        }
        catch {
            return { ok: false, error: 'invalid' };
        }
        const budgets = config.budgets;
        if (budgets?.ptcTimeoutMs !== undefined || budgets?.ptcMaxTimeoutMs !== undefined) {
            const ceiling = this.ptcCeiling();
            if (ceiling === false)
                return { ok: false, error: 'ptc-unavailable' };
            if ((budgets.ptcTimeoutMs ?? 0) > ceiling || (budgets.ptcMaxTimeoutMs ?? 0) > ceiling)
                return { ok: false, error: 'ptc-ceiling' };
        }
        return this.replace(config, expected);
    }
    async reset(expected) { return this.replace({}, expected); }
    async replace(config, expected) {
        if (!this.settings.writable)
            return { ok: false, error: 'read-only' };
        if (!/^(0|[1-9]\d*)$/.test(expected) || !Number.isSafeInteger(Number(expected)))
            return { ok: false, error: 'invalid' };
        try {
            await this.settings.replace(this.key, config, Number(expected));
            return { ok: true, snapshot: this.read() };
        }
        catch (error) {
            return { ok: false, error: error.code === 'SETTINGS_CONFLICT' ? 'conflict' : 'save-failed' };
        }
    }
}
let SuperCodeBudgets = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _readConfig_decorators;
    let _saveConfig_decorators;
    let _resetConfig_decorators;
    return class SuperCodeBudgets extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _readConfig_decorators = [Remote];
            _saveConfig_decorators = [Remote];
            _resetConfig_decorators = [Remote];
            __esDecorate(this, null, _readConfig_decorators, { kind: "method", name: "readConfig", static: false, private: false, access: { has: obj => "readConfig" in obj, get: obj => obj.readConfig }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _saveConfig_decorators, { kind: "method", name: "saveConfig", static: false, private: false, access: { has: obj => "saveConfig" in obj, get: obj => obj.saveConfig }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _resetConfig_decorators, { kind: "method", name: "resetConfig", static: false, private: false, access: { has: obj => "resetConfig" in obj, get: obj => obj.resetConfig }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        settings = __runInitializers(this, _instanceExtraInitializers);
        constructor(ctx, settings) {
            super(ctx, 'superCodeBudgets');
            this.settings = settings;
        }
        readConfig() { return this.settings.read(); }
        saveConfig(content, expected) { return this.settings.save(content, expected); }
        resetConfig(expected) { return this.settings.reset(expected); }
    };
})();
export { SuperCodeBudgets };
export function applyBudgetSettings(ctx, config) {
    const base = configurationValues(config);
    const hostDefaults = new BasicCompactionEngine(ctx.isolate('compaction'), { auto: false }).config;
    const snapshots = new WeakMap();
    let timeout = false;
    let read = () => configurationValues(config);
    const source = {
        get: () => withLegacyBudgets(read(), timeout ? timeout.maxMs : false),
        forAgent(agent) {
            let snapshot = snapshots.get(agent);
            if (!snapshot) {
                snapshot = structuredClone(source.get());
                snapshots.set(agent, snapshot);
            }
            return structuredClone(snapshot);
        },
    };
    ctx.provide('superCodeConfiguration', source);
    ctx.inject(['ptcRuntime'], ready => {
        const runtime = ready.get('ptcRuntime');
        timeout = runtime.timeout ?? false;
        ready.effect(() => () => { timeout = false; });
    });
    // Recent hosts retain a preset generation across Agents; plugin apply is not an Agent boundary.
    ctx.on('agent/created', ({ agent }) => { source.forAgent(agent); });
    ctx.inject(['settings'], owner => {
        const settings = owner.settings;
        let key = namespace;
        if (typeof settings.register === 'function') {
            const scope = settings.register(namespace, settingsConfigurationSchema, { base, validate: validateConfiguration });
            read = () => structuredClone(scope.get());
            owner.effect(() => () => { read = () => structuredClone(base); });
        }
        else {
            // SettingsForms edits this Loader entry's volatile values without remounting Agents.
            const forms = settings;
            const entryId = ctx.fiber.entry?.options.id;
            if (!entryId)
                throw new Error('Super Code budgets require a profile plugin entry');
            key = entryId;
            owner.effect(() => forms.configure({ auto: false }, ctx.fiber));
        }
        new SuperCodeBudgets(owner, new BudgetSettings(settings, source, () => timeout ? timeout.maxMs : false, key, () => ({
            applyToOfficialPresets: false, maxTasks: 32, maxContextBytes: 32768,
            budgets: { pressureBasis: 'host', thresholdRatio: hostDefaults.thresholdRatio, retainRatio: hostDefaults.retainRatio,
                summaryMaxTokens: hostDefaults.maxTokens, compactionRetries: hostDefaults.compactionRetries,
                maxOverflowRetries: hostDefaults.maxOverflowRetries,
                ...(timeout ? { ptcTimeoutMs: timeout.defaultMs, ptcMaxTimeoutMs: timeout.maxMs } : {}),
            },
        })));
    });
}
//# sourceMappingURL=budget-settings.js.map