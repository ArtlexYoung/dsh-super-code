import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
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
/** Resolve the running host's modules, including installed directory presets and Desktop profiles. */
export declare function hostModule(ctx: Context, name: string): Promise<Record<string, unknown>>;
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
/** Runtime ownership is distinct from durable session lineage or shared preset scope. */
export declare function creatorOf(ctx: Context, agent: Agent): Agent | false;
/** Contribute an inherited tool without changing the host provider or session policy. */
export declare function mountBundledBash(ctx: Context): Promise<false | (() => Promise<void>)>;
/** Keep tools inherited so both root and child capability restrictions still apply. */
export declare function apply(ctx: Context): Promise<void>;
export {};
//# sourceMappingURL=windows-shell.d.ts.map