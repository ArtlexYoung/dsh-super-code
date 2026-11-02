import type { Context } from '@deepseek-ai/cordis';
import type { WindowsRuntime } from '../core/windows-runtime.js';
interface ShellSpec {
    command: string;
    env?: NodeJS.ProcessEnv;
    sandboxPolicy?: {
        mode: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
interface HostShell {
    readonly config: Record<string, unknown>;
    readonly sandboxMode?: string;
    resolve(request: ShellSpec): ShellSpec;
    argv(spec: ShellSpec): string[];
}
interface ShellConstructor {
    new (ctx: Context, config: Record<string, unknown>): HostShell;
    readonly inject?: readonly string[];
}
/** Use the host provider's argv extension point, including its sandboxed implementation. */
export declare function bundledBashProvider(Base: ShellConstructor, runtime: WindowsRuntime | (() => WindowsRuntime)): ShellConstructor;
export interface ShellStatus {
    readonly platform: string;
    readonly state: 'host' | 'pending' | 'ready' | 'error';
    readonly version?: string;
    readonly error?: string;
}
interface RuntimeService {
    status(): ShellStatus;
    prepare(): Promise<WindowsRuntime>;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        superCodeShell: RuntimeService;
    }
}
/** One shared preparation result; no installation subprocess or global environment mutation. */
export declare function applyWindowsShell(ctx: Context): void;
export declare const name = "super-code-shell";
export declare const inject: string[];
/** Keep tools inherited so both root and child capability restrictions still apply. */
export declare function apply(ctx: Context): Promise<void>;
export {};
//# sourceMappingURL=windows-shell.d.ts.map