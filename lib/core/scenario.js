import { ProtocolError } from './protocol.js';
/** One user-facing preset; professional teams are selected inside a session. */
export const SHIPPED_PRESET_NAMES = ['super-code'];
const DEFAULT_PROFILE = {
    executionMode: 'auto',
    workScenario: 'delivery',
    optimizationTarget: 'both',
};
/** Default workflow axes; a task's professional discipline is independent. */
export const PRESET_PROFILES = Object.freeze({
    'super-code': { executionMode: 'auto', workScenario: 'delivery', optimizationTarget: 'both' },
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
/**
 * Choose an adaptive planning default from the two axes. The programming
 * workflow creates a separate analysis record for team execution, while
 * routine solo/research/optimization tasks stay adaptive to control cost.
 */
export function defaultPlanningForProfile(profile) {
    const resolved = resolveScenarioProfile(profile);
    return resolved.executionMode === 'team' ? 'separate' : 'auto';
}
/** Resolve a shipped preset name to its two-axis profile. */
export function profileForPreset(name) {
    if (typeof name !== 'string' || name.trim() === '')
        throw new ProtocolError('preset name must be a non-empty string', 'INVALID_ARGUMENT');
    const key = name.trim();
    if (!SHIPPED_PRESET_NAMES.includes(key))
        throw new ProtocolError(`unknown preset ${name}`, 'INVALID_ARGUMENT');
    const profile = PRESET_PROFILES[key];
    return { ...profile };
}
export default resolveScenarioProfile;
//# sourceMappingURL=scenario.js.map