import type { Context } from '@deepseek-ai/cordis';
import { type AgentPresets } from '@deepseek-ai/dsh-agent-presets';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
interface InstallationSettings {
    checked: boolean;
    installedId: string;
}
export interface PresetInstallationStatus {
    state: 'available' | 'installed' | 'conflict' | 'missing' | 'broken';
    id: string;
    authorable: boolean;
    userConflict: boolean;
}
export interface PresetInstallationResult {
    ok: boolean;
    status: PresetInstallationStatus;
    error?: 'invalid-name' | 'name-taken' | 'no-user-root' | 'install-failed';
}
/** Serialized writes protect double clicks; mkdir claims only an unoccupied name. */
export declare class PresetInstaller {
    private readonly roster;
    private readonly settings;
    private readonly bundledRoot;
    private readonly baseUrl;
    private tail;
    constructor(roster: Pick<AgentPresets, 'list' | 'roots'>, settings: SettingsScope<InstallationSettings>, bundledRoot?: string, baseUrl?: string);
    status(): Promise<PresetInstallationStatus>;
    initialize(): Promise<void>;
    install(id: unknown): Promise<PresetInstallationResult>;
    private occupied;
    private installNow;
    private enqueue;
}
export declare class SuperCodePresets extends TypertRemoteService {
    private readonly installer;
    constructor(ctx: Context, installer: PresetInstaller);
    status(): Promise<PresetInstallationStatus>;
    installPreset(id: unknown): Promise<PresetInstallationResult>;
}
export declare function applyPresetInstallation(ctx: Context): void;
export {};
//# sourceMappingURL=preset-installation.d.ts.map