/** Advice for the calling client; never injected into DSH model context. */
export const connectionInstructions = 'DSH Super Code is a delegation executor. The serving Web/Desktop/NEXT app is not the project or candidate under test. Use MCP tools to delegate work in the chosen cwd and verify candidate artifacts there; do not inspect, click, reinstall, restart or reconfigure the serving DSH app to diagnose a delegated project. Call dsh_status for allowed directories and capacity, dsh_models for model/effort IDs, and dsh_sessions to explicitly choose history or a new conversation. Read progress/results with dsh_wait and public history with dsh_read. A tool return or finished turn is not task acceptance. Busy/limit errors are admission refusals: retain the same requestId and input, inspect blocking tasks and wait; do not cancel or disconnect other clients. Never approve permissions through UI automation. Check dsh_status.allowCallerApproval (off by default): when disabled, waiting_confirmation requires the user in DSH. When enabled, dsh_wait exposes exact one-time callerApproval.pending requests or an interactive form; inspect the tool, arguments and reason and use dsh_approve with taskId/approvalId/decision under the calling client authorization. Directory consent always stays in DSH. Reuse one MCP session, long-poll dsh_wait up to 30 seconds instead of tight polling, and terminate your own HTTP session with DELETE when done (SDK transport.terminateSession before client.close). Closing a local SDK client alone does not release the server session. If native tools are unavailable, use the packaged super-code-mcp CLI with credentials supplied privately through environment variables; do not search DSH profile files for credentials.';
export function connectionRecovery(code) {
    switch (code) {
        case 'workspace-busy':
        case 'concurrency-limit':
            return { action: 'inspect-capacity', message: 'No prompt was admitted. Call dsh_status, wait for blocking tasks with dsh_wait, then retry the same requestId and input. Do not change cwd to evade a shared Git worktree lock or cancel another task.', retryable: true, retryAfterMs: 30000 };
        case 'new-conversation-disabled':
            return { action: 'choose-history', message: 'No new conversation was created. Call dsh_sessions and choose an existing taskId, or ask the user to enable creation.', retryable: false };
        case 'directory-not-allowed':
            return { action: 'request-directory', message: 'Use dsh_status to inspect grants or dsh_request_directory to request user consent. Do not edit DSH settings or bypass this boundary.', retryable: false };
        case 'caller-approval-disabled':
            return { action: 'user-confirmation', message: 'Caller approval is disabled. Ask the user to handle this in DSH or enable the setting; do not automate the UI.', retryable: false };
        case 'approval-not-found':
        case 'approval-conflict':
            return { action: 'inspect-approval', message: 'Read dsh_wait for current pending requests. Do not reuse an expired, withdrawn or already-decided approval for another operation.', retryable: false };
        case 'resolve-in-dsh-first':
            return { action: 'user-confirmation', message: 'Read dsh_wait: if callerApproval.pending is present, inspect the exact operation and decide through dsh_approve; otherwise ask the user to resolve it in DSH. Do not automate the UI.', retryable: false };
        case 'task-not-found':
            return { action: 'recover-task-id', message: 'Call dsh_sessions for the same cwd or dsh_wait without taskId to recover service-owned IDs. Do not recreate or resend an uncertain request.', retryable: false };
        case 'request-conflict':
            return { action: 'check-request', message: 'This requestId already identifies different input. Inspect the prior task; use a new requestId only for a genuinely new operation.', retryable: false };
        default:
            return { action: 'report-error', message: 'Report the failure and inspect service/task state through MCP. Do not fall back to controlling the serving DSH application or editing its profile.', retryable: false };
    }
}
//# sourceMappingURL=guidance.js.map