/** A one-shot fallback for clients without native MCP tools; always release its own session. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { pluginVersion } from '../dsh/preset-version.js';
export async function invokeConnectionTool(request, signal) {
    const url = new URL(request.url);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/mcp' || url.username || url.password || url.search || url.hash || !/^[a-f0-9]{64}$/.test(request.token))
        throw new Error('invalid-connection-configuration');
    if (request.tool !== 'tools' && !/^dsh_[a-z_]+$/.test(request.tool))
        throw new Error('invalid-tool-name');
    const client = new Client({ name: 'super-code-mcp-cli', version: pluginVersion });
    const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { authorization: `Bearer ${request.token}` } },
        fetch: (input, init) => fetch(input, init?.method === 'DELETE'
            ? { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) }
            : init),
    });
    try {
        signal?.throwIfAborted();
        await client.connect(transport, { ...(signal ? { signal } : {}), timeout: 15000 });
        return request.tool === 'tools' ? await client.listTools({}, { ...(signal ? { signal } : {}), timeout: 15000 })
            : await client.callTool({ name: request.tool, arguments: request.arguments }, undefined, { ...(signal ? { signal } : {}), timeout: 45000 });
    }
    finally {
        // SDK close() only aborts local connections; it does not DELETE the remote session.
        try {
            await transport.terminateSession();
        }
        finally {
            await client.close();
        }
    }
}
//# sourceMappingURL=client.js.map