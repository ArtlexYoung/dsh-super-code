import type { GitSnapshot, WorkspaceChanges } from './types.js';
export declare function gitWorktreeRoot(cwd: string): Promise<string | false>;
export declare function gitSnapshot(cwd: string): Promise<GitSnapshot>;
export declare function workspaceChanges(cwd: string, baseline: GitSnapshot): Promise<WorkspaceChanges>;
//# sourceMappingURL=git.d.ts.map