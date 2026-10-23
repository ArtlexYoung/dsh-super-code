/** Optional policy overrides. Missing values remain owned by the host. */
import z from '@deepseek-ai/schemastery';
import { z as json } from 'zod';
export const budgetSchema = z.object({
    pressureBasis: z.union(['host', 'window']).description('Compression budget basis: host policy or full context window.'),
    thresholdRatio: z.number().min(0.01).max(1).description('Context fraction at which compression starts.'),
    retainRatio: z.number().min(0).max(1).description('Recent context fraction retained verbatim.'),
    summaryMaxTokens: z.number().step(1).min(1).description('Maximum summary output tokens.'),
    compactionRetries: z.number().step(1).min(0).max(10),
    maxOverflowRetries: z.number().step(1).min(0).max(10),
    ptcTimeoutMs: z.number().step(1).min(1).description('Default PTC elapsed deadline, including tool waits, in milliseconds.'),
    ptcMaxTimeoutMs: z.number().step(1).min(1).description('PTC elapsed ceiling; the host ceiling remains authoritative.'),
});
// SettingsProvider resolves plain data; volatile references belong only to Loader entries.
export const settingsConfigurationSchema = z.object({
    applyToOfficialPresets: z.boolean().description('Apply common runtime budgets to Standard, PTC, Minimal and Create presets (default: off).'),
    deletionProtection: z.union(['off', 'relaxed', 'strict', z.boolean()]).description('Deletion protection: off, relaxed (default; prefer trash, honor explicit rm requests), or strict (one-time confirmation). Legacy false/true mean off/strict.'),
    deletionProtectionForOfficialPresets: z.boolean().description('Also protect official presets, independently of budget settings (default: off).'),
    budgets: budgetSchema.description('Optional runtime budgets; leave blank to follow the host.'),
    maxTasks: z.number().step(1).min(1).max(128),
    maxContextBytes: z.number().step(1).min(1024).max(262144),
});
export const configurationSchema = z.object({
    applyToOfficialPresets: settingsConfigurationSchema.dict.applyToOfficialPresets.extra('volatile', true),
    deletionProtection: settingsConfigurationSchema.dict.deletionProtection.extra('volatile', true),
    deletionProtectionForOfficialPresets: settingsConfigurationSchema.dict.deletionProtectionForOfficialPresets.extra('volatile', true),
    budgets: settingsConfigurationSchema.dict.budgets.extra('volatile', true),
    maxTasks: settingsConfigurationSchema.dict.maxTasks.extra('volatile', true),
    maxContextBytes: settingsConfigurationSchema.dict.maxContextBytes.extra('volatile', true),
});
const validConfiguration = json.object({
    applyToOfficialPresets: json.boolean().optional(),
    deletionProtection: json.union([json.enum(['off', 'relaxed', 'strict']), json.boolean()]).optional(),
    deletionProtectionForOfficialPresets: json.boolean().optional(),
    budgets: json.object({
        pressureBasis: json.enum(['host', 'window']).optional(),
        thresholdRatio: json.number().min(0.01).max(1).optional(),
        retainRatio: json.number().min(0).max(1).optional(),
        summaryMaxTokens: json.number().int().positive().safe().optional(),
        compactionRetries: json.number().int().min(0).max(10).optional(),
        maxOverflowRetries: json.number().int().min(0).max(10).optional(),
        ptcTimeoutMs: json.number().int().positive().safe().optional(),
        ptcMaxTimeoutMs: json.number().int().positive().safe().optional(),
    }).strict().optional(),
    maxTasks: json.number().int().min(1).max(128).optional(),
    maxContextBytes: json.number().int().min(1024).max(262144).optional(),
}).strict().superRefine((config, ctx) => {
    const b = config.budgets;
    if (!b)
        return;
    if ((b.retainRatio ?? 0.16) >= (b.thresholdRatio ?? 0.8))
        ctx.addIssue({ code: 'custom', message: 'Retention must be below the compression threshold.' });
    if (b.ptcTimeoutMs !== undefined && b.ptcMaxTimeoutMs !== undefined && b.ptcTimeoutMs > b.ptcMaxTimeoutMs)
        ctx.addIssue({ code: 'custom', message: 'PTC default deadline exceeds its ceiling.' });
});
export function validateConfiguration(config) {
    return validConfiguration.parse(config);
}
/** Preserve saved boolean choices while new installations default to prompt-only guidance. */
export function deletionProtectionMode(config) {
    const value = config.deletionProtection;
    return value === true ? 'strict' : value === false ? 'off' : value ?? 'relaxed';
}
/** Newer Loader schemas expose volatile fields as references; older hosts return plain values. */
export function configurationValues(config) {
    return validateConfiguration(Object.fromEntries(Object.entries(config).flatMap(([key, value]) => {
        const reference = value;
        const selected = typeof reference?.get === 'function' ? reference.get() : value;
        return selected === undefined ? [] : [[key, selected]];
    })));
}
export function configurationOf(ctx, agent) {
    const source = ctx.get('superCodeConfiguration');
    return source ? agent && source.forAgent ? source.forAgent(agent) : source.get() : {};
}
//# sourceMappingURL=budgets.js.map