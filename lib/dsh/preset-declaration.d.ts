import yaml from 'js-yaml';
import { type DisplayBaseline } from './preset-metadata.js';
import type { DeclaredPresetRegistry, PresetInstallationResult, PresetInstallationStatus } from './preset-installation.js';
export declare const declarationSchema: yaml.Schema;
export interface DeclarationConfig {
    id: string;
    name?: string;
    description?: string;
    order?: number;
    plugins: Array<{
        name?: string;
        config?: Record<string, unknown>;
        [key: string]: unknown;
    }>;
}
export interface DeclarationEntry {
    id: string;
    disabled?: boolean;
    options: {
        name: string;
        config?: DeclarationConfig;
    };
}
export interface DeclarationHost {
    patchPath: string;
    entries(): readonly DeclarationEntry[];
    reload(): Promise<void>;
    exclusive<T>(run: () => Promise<T>): Promise<T>;
}
export interface DeclarationSettings {
    declaration?: {
        entryId: string;
        id: string;
        token: string;
    };
    declarationDisplay?: DisplayBaseline;
}
export interface DeclarationState {
    get(): DeclarationSettings;
    update(patch: Partial<DeclarationSettings>): Promise<void>;
}
/** Newer settings providers edit Loader forms; installation records stay local. */
export declare class DeclarationStateFile implements DeclarationState {
    private readonly path;
    private value;
    private constructor();
    static open(path: string): Promise<DeclarationStateFile>;
    get(): DeclarationSettings;
    update(patch: Partial<DeclarationSettings>): Promise<void>;
}
/** Only marked bundle rows or UUID-matched manual installations may be replaced. */
export declare class DeclaredPresetInstaller {
    private readonly registry;
    private readonly settings;
    private readonly host;
    private readonly bundlePath;
    private tail;
    constructor(registry: DeclaredPresetRegistry, settings: DeclarationState, host: DeclarationHost, bundlePath: string);
    private entry;
    private document;
    status(): Promise<PresetInstallationStatus>;
    install(id: unknown, name?: string): Promise<PresetInstallationResult>;
    reinstall(previousId: string, id: unknown, name?: string): Promise<PresetInstallationResult>;
    private reject;
    private replace;
    synchronize(language: string): Promise<{
        changed: boolean;
    }>;
    /** Back up first, refuse a stale file, and restore only our own failed write. */
    private save;
    private readPatch;
    private atomicWrite;
    private enqueue;
}
//# sourceMappingURL=preset-declaration.d.ts.map