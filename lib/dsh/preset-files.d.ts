export interface PresetRoot {
    path: string;
    trust: 'user' | 'system';
}
export interface DirectoryPreset {
    id: string;
    name?: string;
    description?: string;
    path: string;
    trust: 'user' | 'system';
    broken?: string;
}
export interface DirectoryPresets {
    roots: readonly PresetRoot[];
    list(): Promise<readonly DirectoryPreset[]>;
}
export declare function writableRoot(roots: readonly PresetRoot[], _id: string): string;
export declare function readPresetMetadata(directory: string): Promise<{
    name?: string;
    description?: string;
}>;
export declare function copyBundledPreset(bundledRoot: string, staging: string, id: string, name: string): Promise<{
    directory: string;
    description?: string;
}>;
//# sourceMappingURL=preset-files.d.ts.map