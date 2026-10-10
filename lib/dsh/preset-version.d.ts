export declare const pluginVersion: string;
export interface PresetVersion {
    presetVersion?: string;
}
export declare function compositionVersion(content: string): PresetVersion;
export declare function directoryVersion(path: string): Promise<PresetVersion>;
//# sourceMappingURL=preset-version.d.ts.map