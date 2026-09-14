import { ProtocolError } from './protocol.js';
const DEFAULT_PROFILE = {
    executionMode: 'auto',
    workScenario: 'delivery',
    optimizationTarget: 'both',
};
/** Stable compatibility mapping for the four shipped preset names. */
export const PRESET_PROFILES = Object.freeze({
    solo: { executionMode: 'solo', workScenario: 'delivery', optimizationTarget: 'both' },
    team: { executionMode: 'team', workScenario: 'delivery', optimizationTarget: 'both' },
    research: { executionMode: 'auto', workScenario: 'research', optimizationTarget: 'both' },
    optimization: { executionMode: 'auto', workScenario: 'optimization', optimizationTarget: 'both' },
});
function oneOf(value, values, field) {
    if (typeof value !== 'string' || !values.includes(value)) {
        throw new ProtocolError(`${field} must be one of ${values.join(', ')}`, 'INVALID_ARGUMENT');
    }
    return value;
}
/** Normalize an explicit profile while preserving the delivery defaults. */
export function resolveScenarioProfile(input = {}) {
    const executionMode = oneOf(input.executionMode ?? DEFAULT_PROFILE.executionMode, ['solo', 'team', 'auto'], 'executionMode');
    const workScenario = oneOf(input.workScenario ?? DEFAULT_PROFILE.workScenario, ['delivery', 'research', 'optimization'], 'workScenario');
    const optimizationTarget = oneOf(input.optimizationTarget ?? DEFAULT_PROFILE.optimizationTarget, ['performance', 'quality', 'both'], 'optimizationTarget');
    return { executionMode, workScenario, optimizationTarget };
}
/** Resolve a shipped preset name to its two-axis profile. */
export function profileForPreset(name) {
    if (typeof name !== 'string' || name.trim() === '')
        throw new ProtocolError('preset name must be a non-empty string', 'INVALID_ARGUMENT');
    const profile = PRESET_PROFILES[name.trim()];
    if (profile === undefined)
        throw new ProtocolError(`unknown preset ${name}`, 'INVALID_ARGUMENT');
    return { ...profile };
}
export default resolveScenarioProfile;
//# sourceMappingURL=scenario.js.map