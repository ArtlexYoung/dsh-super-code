/** A one-shot fallback for clients without native MCP tools; always release its own session. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { pluginVersion } from '../dsh/preset-version.js'

export interface ConnectionRequest { url: string; token: string; tool: string; arguments: Record<string, unknown> }
export async function invokeConnectionTool(request: ConnectionRequest, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const url = new URL(request.url)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/mcp' || url.username || url.password || url.search || url.hash || !/^[a-f0-9]{64}$/.test(request.token)) throw new Error('invalid-connection-configuration')
  if (request.tool !== 'tools' && !/^dsh_[a-z_]+$/.test(request.tool)) throw new Error('invalid-tool-name')
  const client = new Client({ name: 'super-code-mcp-cli', version: pluginVersion })
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${request.token}` } },
    fetch: async (input, init) => {
      if (init?.method !== 'DELETE') return fetch(input, init)
      // Node 22.0 can collect a timeout source composed with AbortSignal.any().
      // Own the deadline until fetch settles, while preserving SDK cancellation.
      const controller = new AbortController(), signal = init.signal
      const abort = (): void => controller.abort(signal?.reason)
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(() => controller.abort(new DOMException('MCP session cleanup timed out', 'TimeoutError')), 5000)
      try { return await fetch(input, { ...init, signal: controller.signal }) }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    },
  })
  try {
    signal?.throwIfAborted()
    await client.connect(transport, { ...(signal ? { signal } : {}), timeout: 15000 })
    return request.tool === 'tools' ? await client.listTools({}, { ...(signal ? { signal } : {}), timeout: 15000 })
      : await client.callTool({ name: request.tool, arguments: request.arguments }, undefined, { ...(signal ? { signal } : {}), timeout: 45000 })
  } finally {
    // SDK close() only aborts local connections; it does not DELETE the remote session.
    try { await transport.terminateSession() } finally { await client.close() }
  }
}
