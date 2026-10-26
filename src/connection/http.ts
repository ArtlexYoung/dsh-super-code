/** Local Streamable HTTP boundary. Authentication precedes body parsing and MCP dispatch. */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { timingSafeEqual, randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { DelegatedTasks } from './tasks.js'
import { pluginVersion } from '../dsh/preset-version.js'
import { ConnectionError } from './types.js'
import type { DirectoryApplication, DirectoryRequest } from './directories.js'

const identity = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.:-]+$/)
const prompt = z.string().trim().min(1).max(32000)
const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0)
const waitMs = z.number().int().min(0).max(30000).default(0)
type RequestDirectory = (input: DirectoryApplication, client: string) => Promise<DirectoryRequest>
export function delegationMcpServer(tasks: DelegatedTasks, signal: (id: string | number) => AbortSignal, connectionId = '', requestDirectory?: (input: DirectoryApplication) => Promise<DirectoryRequest>): McpServer {
  const server = new McpServer({ name: 'dsh-super-code', version: pluginVersion }, { maxToolInputElements: 64 })
  const result = async (run: () => Promise<unknown>): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await run()) }] } }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof ConnectionError ? error.code : 'operation-unavailable' }] } }
  }
  server.registerTool('dsh_run', { description: 'Delegate a task to a new DSH Super Code root session. Use a stable requestId for retries; conflicts do not dispatch. DSH permissions apply, independently of the caller sandbox. A finished turn is not verified acceptance.',
    inputSchema: z.object({ requestId: identity, cwd: z.string().min(1).max(4096), prompt, client: z.string().min(1).max(80).optional() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, input => result(() => tasks.run({ ...input, connectionId })))
  server.registerTool('dsh_wait', { description: 'Omit taskId to list service-owned tasks (cursor is a list offset). With taskId, read bounded output, workspace observations and events after cursor. Long-poll up to 30 seconds; timeout/disconnect never cancels execution. waiting_confirmation must be resolved in DSH. finished means execution ended, not acceptance verified.',
    inputSchema: z.object({ taskId: identity.optional(), cursor, waitMs }).strict(),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, (input, extra) => result(() => input.taskId ? tasks.wait(input.taskId, input.cursor, input.waitMs, signal(extra.requestId)) : tasks.list(input.cursor)))
  server.registerTool('dsh_send', { description: 'Explicitly queue a follow-up in a service-owned root session, including after an interruption. Use a new stable requestId for each follow-up. An ambiguous admission is never automatically resent. Does not approve host permissions.',
    inputSchema: z.object({ taskId: identity, requestId: identity, prompt }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, input => result(() => tasks.send({ ...input, connectionId })))
  server.registerTool('dsh_cancel', { description: 'Request cancellation of a service-owned root and its managed descendants. Check the returned status; cancelling/unavailable do not confirm that all execution stopped. Already accepted external side effects cannot be undone.',
    inputSchema: z.object({ taskId: identity }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, input => result(() => tasks.cancel(input.taskId)))
  server.registerTool('dsh_request_directory', { description: 'Request access to an existing absolute directory (including its descendants). DSH displays a consent dialog; only the user can approve. Repeat the same requestId, path and reason to poll. Pending requests expire after 5 minutes and are discarded on host restart. Rejection is final for that requestId. Never assume access before approved.',
    inputSchema: z.object({ requestId: identity, path: z.string().min(1).max(4096), reason: z.string().trim().min(1).max(1000) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, input => result(() => { if (!requestDirectory) throw new ConnectionError('unavailable'); return requestDirectory(input) }))
  return server
}
function reply(res: ServerResponse, code: number, message: string): void {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(message)
}
function authorized(req: IncomingMessage, token: string): boolean {
  const actual = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${token}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
export interface ConnectedClient { id: string; name: string; version: string; connectedAt: number; lastSeen: number }
interface ClientConnection extends ConnectedClient {
  mcp: McpServer; transport: StreamableHTTPServerTransport; lifetime: AbortController;
  calls: Map<string | number, AbortController>; active: number;
}
/** MCP sessions, rather than TCP sockets or individual HTTP requests, define a connection. */
export class ConnectionHttp {
  private server: Server | false = false
  private requests = 0
  private readonly clients = new Map<string, ClientConnection>()
  private readonly pending = new Set<AbortController>()
  private timer: ReturnType<typeof setInterval> | false = false
  constructor(private readonly tasks: DelegatedTasks, private readonly requestDirectory: RequestDirectory | undefined = undefined) {}
  connections(): ConnectedClient[] {
    return [...this.clients.values()].filter(client => client.transport.sessionId).map(({ id, name, version, connectedAt, lastSeen }) => ({ id, name, version, connectedAt, lastSeen }))
  }
  async disconnect(id: string): Promise<void> {
    const client = this.clients.get(id)
    if (!client) return
    this.clients.delete(id); client.lifetime.abort()
    for (const call of client.calls.values()) call.abort()
    await client.mcp.close()
  }
  private async prune(): Promise<void> {
    const expired = [...this.clients.values()].filter(client => !client.active && Date.now() - client.lastSeen > 10 * 60 * 1000)
    await Promise.all(expired.map(client => this.disconnect(client.id)))
  }
  async start(port: number, token: string, maxConnections = 3): Promise<void> {
    if (this.server) throw new ConnectionError('already-listening')
    const server = createServer((req, res) => { void this.handle(req, res, port, token, maxConnections).catch(() => { if (!res.headersSent) reply(res, 500, 'Request failed'); else res.end() }) })
    server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 1000
    server.maxHeadersCount = 40
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
    }).catch(() => { server.close(); throw new ConnectionError('port-unavailable') })
    this.server = server
    this.timer = setInterval(() => { void this.prune().catch(() => {}) }, 5000); this.timer.unref()
  }
  private async admit(body: unknown, maxConnections: number): Promise<ClientConnection | false> {
    if (!body || typeof body !== 'object' || (body as { method?: string }).method !== 'initialize') return false
    await this.prune()
    if (this.clients.size >= maxConnections) throw new ConnectionError('connection-limit')
    const id = randomUUID(), now = Date.now(), lifetime = new AbortController(), calls = new Map<string | number, AbortController>()
    const mcp = delegationMcpServer(this.tasks, requestId => calls.get(requestId)?.signal ?? lifetime.signal, id,
      input => { if (!this.requestDirectory) throw new ConnectionError('unavailable'); return this.requestDirectory(input, this.clients.get(id)?.name ?? 'MCP client') })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => id, enableJsonResponse: true,
      onsessionclosed: () => { void this.disconnect(id) } })
    const client: ClientConnection = { id, name: 'MCP client', version: '', connectedAt: now, lastSeen: now, mcp, transport, lifetime, calls, active: 0 }
    this.clients.set(id, client)
    mcp.server.oninitialized = () => {
      const info = mcp.server.getClientVersion()
      client.name = (info?.name ?? 'MCP client').slice(0, 80); client.version = (info?.version ?? '').slice(0, 80)
    }
    try { await mcp.connect(transport) } catch (error) { await this.disconnect(id); throw error }
    return client
  }
  private async handle(req: IncomingMessage, res: ServerResponse, port: number, token: string, maxConnections: number): Promise<void> {
    const address = '127.0.0.1:' + port
    if (req.headers.host !== address && req.headers.host !== 'localhost:' + port) { reply(res, 403, 'Invalid Host'); return }
    if (req.headers.origin !== undefined) { reply(res, 403, 'Origin not allowed'); return }
    if (req.url !== '/mcp') { reply(res, 404, 'Not found'); return }
    if (!authorized(req, token)) { res.setHeader('WWW-Authenticate', 'Bearer'); reply(res, 401, 'Bearer token required'); return }
    if (!['POST', 'DELETE'].includes(req.method ?? '')) { res.setHeader('Allow', 'POST, DELETE'); reply(res, 405, 'Use POST or DELETE'); return }
    if (req.method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) { reply(res, 415, 'JSON required'); return }
    if (this.requests >= 12) { reply(res, 429, 'Too many requests'); return }
    if (Number(req.headers['content-length'] ?? 0) > 131072) { reply(res, 413, 'Request too large'); return }
    this.requests++
    const abort = new AbortController(); this.pending.add(abort)
    res.once('close', () => abort.abort())
    let client: ClientConnection | false = false, requestId: string | number | false = false, admitted = false
    try {
      let body: unknown
      if (req.method === 'POST') {
        const chunks: Buffer[] = []; let length = 0
        for await (const chunk of req) {
          length += chunk.length
          if (length > 131072) { reply(res, 413, 'Request too large'); return }
          chunks.push(Buffer.from(chunk))
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { reply(res, 400, 'Invalid JSON'); return }
        if (Array.isArray(body)) { reply(res, 400, 'Batch requests are not supported'); return }
      }
      const session = req.headers['mcp-session-id']
      if (session !== undefined) {
        client = typeof session === 'string' ? this.clients.get(session) ?? false : false
        if (!client) { reply(res, 404, 'MCP session not found; initialize again'); return }
      } else {
        try { client = await this.admit(body, maxConnections); admitted = !!client }
        catch (error) { if (error instanceof ConnectionError && error.code === 'connection-limit') { reply(res, 429, 'Maximum MCP connections reached'); return }; throw error }
        if (!client) { reply(res, 400, 'Initialize an MCP session first'); return }
      }
      client.active++; client.lastSeen = Date.now()
      const id = body && typeof body === 'object' ? (body as { id?: unknown }).id : false
      if (typeof id === 'string' || typeof id === 'number') {
        requestId = id
        if (client.calls.has(id)) { reply(res, 409, 'Duplicate in-flight request ID'); return }
        client.calls.set(id, abort)
      }
      await client.transport.handleRequest(req, res, body)
    } finally {
      if (client) {
        client.active--; client.lastSeen = Date.now()
        if (requestId !== false && client.calls.get(requestId) === abort) client.calls.delete(requestId)
        if (admitted && (!client.transport.sessionId || res.statusCode >= 400)) await this.disconnect(client.id)
      }
      this.pending.delete(abort); this.requests--
    }
  }
  async close(): Promise<void> {
    const server = this.server; this.server = false
    if (this.timer) { clearInterval(this.timer); this.timer = false }
    for (const pending of this.pending) pending.abort()
    await Promise.all([...this.clients.keys()].map(id => this.disconnect(id)))
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
