/** Structural adapter over public host services, shared by supported v3/v4 journals. */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { DelegationHost, HostObservation } from '../connection/types.js';
import type { PresetInstallationStatus } from './preset-installation.js';
interface HostAgent {
    status: string;
    cancel(cause: {
        kind: 'user';
    }, options: {
        keepInbox: boolean;
    }): void;
}
interface SessionCut extends Disposable {
    events: readonly SessionEvent[];
    inheritedEventCount: number;
}
interface Descendant {
    id: string;
    parentId: string;
    kind: string;
    mode?: string;
    activity?: string;
}
export interface ConnectionHostServices {
    presets: {
        status(): Promise<PresetInstallationStatus>;
    };
    controller: {
        create(request: {
            sessionId: string;
            cwd: string;
            agentPreset: string;
        }): Promise<{
            sessionId: string;
            agentPreset?: string;
        }>;
        prompt(request: {
            sessionId: string;
            requestId: string;
            mode: 'queue';
            content: {
                type: 'text';
                text: string;
            }[];
        }, signal: AbortSignal): Promise<unknown>;
    };
    agents: {
        get(id: string): HostAgent | undefined;
    };
    query: {
        observeSession(id: string, options: {
            projectionMode: 'none';
            signal: AbortSignal;
        }): Promise<SessionCut>;
    };
    subagents: {
        listDescendants(id: string, signal?: AbortSignal): Promise<Descendant[]>;
        interrupt(id: string, authority: {
            kind: 'user';
            parentSessionId: string;
        }): Promise<unknown>;
    };
}
interface SessionFacts {
    status: HostObservation['status'];
    output: string;
}
/** Own events only; idle without a settled, admitted request is not a completed task. */
export declare function connectionSessionFacts(events: readonly SessionEvent[], agentStatus: string, requestId: string, cancelling?: boolean): SessionFacts;
export declare class ConnectionHost implements DelegationHost {
    private readonly services;
    constructor(services: ConnectionHostServices);
    preset(): Promise<string>;
    create(sessionId: string, cwd: string, preset: string): Promise<void>;
    prompt(sessionId: string, requestId: string, prompt: string): Promise<void>;
    private facts;
    observe(sessionId: string, requestId: string, cancelling?: boolean): Promise<HostObservation>;
    cancel(sessionId: string): Promise<void>;
}
export {};
//# sourceMappingURL=connection-host.d.ts.map