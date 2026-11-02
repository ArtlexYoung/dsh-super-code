export interface WindowsRuntime {
    readonly root: string;
    readonly bin: string;
    readonly bash: string;
    readonly version: string;
    readonly arch: string;
}
/** Decode only the manifest's fixed files, then publish the complete private runtime. */
export declare function prepareWindowsRuntime(options?: {
    cacheRoot?: string;
    arch?: string;
    source?: string;
}): Promise<WindowsRuntime>;
/** Supply only shell-specific overrides; the host still scrubs its ambient credentials. */
export declare function windowsRuntimeEnvironment(runtime: WindowsRuntime, supplied?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
//# sourceMappingURL=windows-runtime.d.ts.map