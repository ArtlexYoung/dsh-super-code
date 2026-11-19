import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { ChildProcess } from 'node:child_process'
import { launchWindow } from './window-launcher.js'

const MAX_MESSAGE_BYTES = 32 * 1024 * 1024
const MAX_QUEUE_BYTES = 64 * 1024 * 1024
const CONNECTION_TIMEOUT_MS = 20000
const HEARTBEAT_MS = 3000
export type WindowEvent = { kind: 'message'; content: string } | { kind: 'closed'; reason: string } | { kind: 'ping' }
export type WindowAddress = { id: string; url: string }

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Super Code</title></head><body><main id="root"><p role="status">Super Code…</p></main><script src="/window.js" defer></script></body></html>`

/** 独立窗口只与原前端通信；此服务没有文件、Shell 或模型接口。 */
class WindowConnection {
  readonly id: string = randomBytes(16).toString('hex')
  readonly token: string = randomBytes(32).toString('base64url')
  private readonly server: Server
  private response?: ServerResponse
  private child?: ChildProcess
  private events: WindowEvent[] = []
  private outgoing: string[] = []
  private queuedBytes = 0
  private wake?: () => void
  private closed = false
  private claimed = false
  private ready = false
  private ownerSeen = Date.now()
  private childSeen = Date.now()
  private timer?: ReturnType<typeof setInterval>
  private origin = ''

  constructor(private readonly script: Buffer, private readonly launch: typeof launchWindow, private readonly ended: () => void) {
    this.server = createServer((req, res) => { void this.handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(400); res.end() }) })
  }

  async open(native: boolean): Promise<WindowAddress> {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error): void => {
        this.server.off('error', finish); this.server.off('close', closed)
        if (error) reject(error); else resolve()
      }
      const closed = (): void => finish(new Error('WORKBENCH_WINDOW_CLOSED'))
      this.server.once('error', finish); this.server.once('close', closed)
      this.server.listen(0, '127.0.0.1', () => finish())
    })
    if (this.closed) throw new Error('WORKBENCH_WINDOW_CLOSED')
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('WORKBENCH_WINDOW_START')
    this.origin = `http://127.0.0.1:${address.port}`
    this.timer = setInterval(() => {
      // 系统 WebView 会暂停闲置脚本；就绪后依靠连接关闭和进程退出判断，避免误断连。
      if (Date.now() - this.ownerSeen > CONNECTION_TIMEOUT_MS || !this.ready && Date.now() - this.childSeen > CONNECTION_TIMEOUT_MS) this.close('WORKBENCH_WINDOW_DISCONNECTED')
      else { this.push({ kind: 'ping' }); this.response?.write('{"kind":"ping"}\n') }
    }, HEARTBEAT_MS)
    this.timer.unref()
    const result = { id: this.id, url: `${this.origin}/#${this.token}` }
    try { if (native) await this.start(result.url) } catch (error) { this.close('WORKBENCH_WINDOW_START'); throw error }
    return result
  }

  private async start(url: string): Promise<void> {
    this.child = await this.launch(url)
    if (this.closed) { this.child.kill(); throw new Error('WORKBENCH_WINDOW_CLOSED') }
    this.child.once('exit', () => this.close('WORKBENCH_WINDOW_CLOSED'))
  }

  private push(event: WindowEvent): void {
    if (this.closed) return
    const bytes = event.kind === 'message' ? Buffer.byteLength(event.content) : 64
    this.queuedBytes += bytes
    if (this.queuedBytes > MAX_QUEUE_BYTES) { this.close('WORKBENCH_WINDOW_OVERFLOW'); return }
    this.events.push(event); this.wake?.()
  }

  private authenticated(req: IncomingMessage): boolean {
    const actual = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${this.token}`)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; worker-src blob:; font-src data:; frame-ancestors 'none'; base-uri 'none'")
    if (this.closed || req.headers.host !== new URL(this.origin).host || req.headers.origin && req.headers.origin !== this.origin) { res.writeHead(403).end(); return }
    if (req.method === 'GET' && req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page); return }
    if (req.method === 'GET' && req.url === '/window.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(this.script); return }
    if (!this.authenticated(req)) { res.writeHead(403).end(); return }
    if (req.method === 'GET' && req.url === '/events' && !this.claimed) {
      this.claimed = true; this.response = res; this.childSeen = Date.now()
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' }); res.flushHeaders()
      for (const line of this.outgoing.splice(0)) res.write(line)
      res.once('close', () => this.close('WORKBENCH_WINDOW_DISCONNECTED'))
      return
    }
    if (req.method !== 'POST' || req.url !== '/message' || req.headers['content-type'] !== 'application/json') { res.writeHead(404).end(); return }
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of req) { size += chunk.length; if (size > MAX_MESSAGE_BYTES) { res.writeHead(413).end(); req.resume(); return }; chunks.push(chunk) }
    const content = Buffer.concat(chunks).toString('utf8')
    const value: unknown = JSON.parse(content)
    if (!value || typeof value !== 'object' || !('kind' in value) || typeof value.kind !== 'string') { res.writeHead(400).end(); return }
    this.childSeen = Date.now()
    if (value.kind === 'ready') this.ready = true
    if (value.kind !== 'ping') this.push({ kind: 'message', content })
    res.writeHead(204).end()
  }

  send(content: string): void {
    this.ownerSeen = Date.now()
    if (this.closed) throw new Error('WORKBENCH_WINDOW_CLOSED')
    if (!content) return
    if (Buffer.byteLength(content) > MAX_MESSAGE_BYTES) throw new Error('WORKBENCH_WINDOW_MESSAGE_SIZE')
    JSON.parse(content)
    const line = `${content}\n`
    if (this.response) { if (this.response.writableLength > MAX_QUEUE_BYTES) this.close('WORKBENCH_WINDOW_OVERFLOW'); else this.response.write(line) }
    else {
      if (this.outgoing.reduce((size, item) => size + Buffer.byteLength(item), 0) + Buffer.byteLength(line) > MAX_QUEUE_BYTES) throw new Error('WORKBENCH_WINDOW_OVERFLOW')
      this.outgoing.push(line)
    }
  }

  async *listen(signal: AbortSignal): AsyncGenerator<WindowEvent> {
    const stop = (): void => this.close('WORKBENCH_WINDOW_DISCONNECTED')
    signal.addEventListener('abort', stop, { once: true })
    try {
      while (!signal.aborted) {
        if (this.events.length) { const event = this.events.shift()!; this.queuedBytes -= event.kind === 'message' ? Buffer.byteLength(event.content) : 64; yield event; continue }
        if (this.closed) { yield { kind: 'closed', reason: this.reason }; return }
        await new Promise<void>(resolve => { this.wake = resolve })
      }
    } finally { signal.removeEventListener('abort', stop); this.close('WORKBENCH_WINDOW_DISCONNECTED') }
  }

  private reason = 'WORKBENCH_WINDOW_CLOSED'
  close(reason = 'WORKBENCH_WINDOW_CLOSED'): void {
    if (this.closed) return
    this.closed = true; this.reason = reason; clearInterval(this.timer)
    this.outgoing.length = 0; this.events.length = 0; this.queuedBytes = 0
    this.response?.end(); this.server.close(); this.server.closeAllConnections()
    // 断连后的窗口降为只读，留给用户复制尚未确认的文本；主动关窗或卸载仍结束进程。
    if (!(reason === 'WORKBENCH_WINDOW_DISCONNECTED' && this.ready) && this.child && this.child.exitCode === null && this.child.signalCode === null) this.child.kill()
    this.wake?.(); this.ended()
  }
}

export class WorkbenchWindows {
  private readonly windows = new Map<string, { session: string; window: WindowConnection }>()
  private disposed = false
  constructor(private readonly launch: typeof launchWindow = launchWindow, private readonly script: () => Promise<Buffer> = () => readFile(new URL('../../dist/window.js', import.meta.url))) {}

  async open(session: string, native: boolean): Promise<WindowAddress> {
    if (this.disposed) throw new Error('WORKBENCH_WINDOW_CLOSED')
    const script = await this.script()
    if (this.disposed) throw new Error('WORKBENCH_WINDOW_CLOSED')
    const window = new WindowConnection(script, this.launch, () => this.windows.delete(window.id))
    this.windows.set(window.id, { session, window })
    try { return await window.open(native) } catch (error) { window.close(); throw error }
  }
  private of(session: string, id: string): WindowConnection {
    const entry = this.windows.get(id)
    if (!entry || entry.session !== session) throw new Error('WORKBENCH_WINDOW_CLOSED')
    return entry.window
  }
  events(session: string, id: string, signal: AbortSignal): AsyncGenerator<WindowEvent> { return this.of(session, id).listen(signal) }
  send(session: string, id: string, content: string): void { this.of(session, id).send(content) }
  close(session: string, id: string): void { this.of(session, id).close() }
  dispose(): void { this.disposed = true; for (const { window } of [...this.windows.values()]) window.close() }
}
