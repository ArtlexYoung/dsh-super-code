export interface DisplayBaseline {
    name?: string;
    description?: string;
}
export interface DisplayCopy {
    name: string;
    description: string;
}
export declare function displayCopy(language: string): DisplayCopy;
export interface MetadataMigration {
    changed: boolean;
    baseline: DisplayBaseline;
}
export declare function migrateMetadata(path: string, id: string, current: DisplayBaseline, previous: DisplayBaseline | undefined, copy: DisplayCopy, beforeWrite?: (baseline: DisplayBaseline) => Promise<void>): Promise<MetadataMigration>;
//# sourceMappingURL=preset-metadata.d.ts.map