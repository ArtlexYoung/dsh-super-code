import { z } from 'zod';
export const connectionConfigSchema = z.object({
    enabled: z.boolean(), port: z.number().int().min(1024).max(65535),
    allowedDirectories: z.array(z.string().min(1).max(4096)).max(32),
    knownDirectories: z.array(z.string().min(1).max(4096)).max(128).default([]),
    maxConcurrent: z.number().int().min(1).max(32),
    maxConnections: z.number().int().min(1).max(32).default(3),
    directoriesConfigured: z.boolean().default(false),
}).strict();
export const defaultConnectionConfig = { enabled: false, port: 23457, allowedDirectories: [], knownDirectories: [], maxConcurrent: 3, maxConnections: 3, directoriesConfigured: false };
export class ConnectionError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
export function activeTask(status) {
    return ['starting', 'running', 'waiting_confirmation', 'cancelling', 'unavailable'].includes(status);
}
//# sourceMappingURL=types.js.map