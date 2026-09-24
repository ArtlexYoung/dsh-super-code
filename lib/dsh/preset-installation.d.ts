import type { Context } from '@deepseek-ai/cordis';
import { type AgentPresets } from '@deepseek-ai/dsh-agent-presets';
import { type DisplayBaseline } from './preset-metadata.js';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
interface InstallationSettings {
    checked: boolean;
    installedId: string;
    installation?: {
        id: string;
        path: string;
        token: string;
        dev: number;
        ino: number;
    };
    display?: Record<string, DisplayBaseline>;
    pendingDisplay?: Record<string, DisplayBaseline>;
}
export interface PresetInstallationStatus {
    state: 'available' | 'installed' | 'conflict' | 'missing' | 'broken';
    id: string;
    name?: string;
    authorable: boolean;
    userConflict: boolean;
}
export interface PresetInstallationResult {
    ok: boolean;
    status: PresetInstallationStatus;
    error?: 'ownership-unverified' | 'invalid-name' | 'invalid-display-name' | 'name-taken' | 'no-user-root' | 'install-failed';
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
    synchronize(language: string): Promise<{
        changed: boolean;
    }>;
    install(id: unknown, name?: string): Promise<PresetInstallationResult>;
    reinstall(previousId: string, id: unknown, name?: string): Promise<PresetInstallationResult>;
    private occupied;
    private installNow;
    private enqueue;
}
interface InstallationController {
    status(): Promise<PresetInstallationStatus>;
    install(id: unknown, name?: string): Promise<PresetInstallationResult>;
    reinstall(previousId: string, id: unknown, name?: string): Promise<PresetInstallationResult>;
    synchronize(language: string): Promise<{
        changed: boolean;
    }>;
}
/** The 0.1.7 registry owns declarations; this package never writes its profile. */
export declare class DeclaredPresetStatus implements InstallationController {
    private readonly registry;
    constructor(registry: {
        list(): Promise<readonly {
            id: string;
            name?: string;
            broken?: string;
        }[]>;
    });
    status(): Promise<PresetInstallationStatus>;
    install(_id: unknown, _name?: string): Promise<PresetInstallationResult>;
    reinstall(_previousId: string, _id: unknown, _name?: string): Promise<PresetInstallationResult>;
    synchronize(_language: string): Promise<{
        changed: boolean;
    }>;
}
export declare class SuperCodePresets extends TypertRemoteService {
    private readonly installer;
    constructor(ctx: Context, installer: InstallationController);
    status(): Promise<PresetInstallationStatus>;
    installPreset(id: unknown, name?: string): Promise<PresetInstallationResult>;
    reinstallPreset(previousId: string, id: unknown, name?: string): Promise<PresetInstallationResult>;
    synchronize(language: string): Promise<{
        changed: boolean;
    }>;
}
export declare function applyPresetInstallation(ctx: Context): void;
export {};
//# sourceMappingURL=preset-installation.d.ts.map