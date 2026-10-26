import { randomBytes } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { ConnectionError, connectionConfigSchema } from './types.js'
import type { ConnectionConfig, DelegationHost } from './types.js'
import { ConnectionStore } from './store.js'
import type { ConnectionSettings } from './store.js'
import { DelegatedTasks } from './tasks.js'
import { ConnectionHttp } from './http.js'
import type { ConnectedClient } from './http.js'
import { DirectoryRequests } from './directories.js'
import type { DirectoryRequest } from './directories.js'

export interface ConnectionSnapshot { configuration: ConnectionConfig; revision: number; writable: boolean;
  state: 'disabled' | 'listening' | 'error'; error: string; url: string }
export interface ConnectionOverview { connections: ConnectedClient[]; sessions: ReturnType<DelegatedTasks['overview']> }
export type ConnectionSaveResult = { ok: true; snapshot: ConnectionSnapshot } | { ok: false; error: string }
export class ConnectionService {
  private settings!: ConnectionSettings
  private tasks!: DelegatedTasks
  private http!: ConnectionHttp
  private directoryRequests!: DirectoryRequests
  private timer: ReturnType<typeof setInterval> | false = false
  private tail: Promise<unknown> = Promise.resolve()
  private state: ConnectionSnapshot['state'] = 'disabled'
  private error: string = ''
  private observing: boolean = false
  constructor(private readonly store: ConnectionStore, private readonly host: DelegationHost) {}
  async initialize(): Promise<void> {
    await this.store.initialize()
    try {
      this.settings = await this.store.settings()
      this.tasks = new DelegatedTasks(this.store, this.host, () => this.settings.config)
      await this.tasks.initialize()
      this.directoryRequests = new DirectoryRequests(() => this.settings.config.allowedDirectories)
      this.http = new ConnectionHttp(this.tasks, (input, client) => this.exclusive(async () => {
        if (!this.settings.config.enabled) throw new ConnectionError('connection-disabled')
        return this.directoryRequests.request(input, client)
      }))
      await this.listen()
      this.timer = setInterval(() => {
        if (this.observing) return
        this.observing = true
        void this.tasks.tick().catch(() => { this.error = 'storage-unavailable' }).finally(() => { this.observing = false })
      }, 1000)
      this.timer.unref()
    } catch (error) { await this.store.close(); throw error }
  }
  read(): ConnectionSnapshot {
    return { configuration: structuredClone(this.settings.config), revision: this.settings.revision, writable: true,
      state: this.state, error: this.error, url: `http://127.0.0.1:${this.settings.config.port}/mcp` }
  }
  overview(): ConnectionOverview { return { connections: this.http.connections(), sessions: this.tasks.overview() } }
  async disconnect(id: string): Promise<{ disconnected: true }> { await this.http.disconnect(id); return { disconnected: true } }
  pendingDirectories(): DirectoryRequest[] { return this.directoryRequests.pending() }
  async resolveDirectory(id: string, decision: string): Promise<{ status: DirectoryRequest['status'] }> {
    if (decision !== 'approved' && decision !== 'rejected') throw new ConnectionError('invalid-decision')
    return this.exclusive(() => this.directoryRequests.resolve(id, decision, async path => {
      if (!this.settings.config.enabled) throw new ConnectionError('connection-disabled')
      const allowedDirectories = [...new Set([...this.settings.config.allowedDirectories, path])]
      if (allowedDirectories.length > 32) throw new ConnectionError('directory-limit')
      const next = { ...this.settings, revision: this.settings.revision + 1,
        config: { ...this.settings.config, directoriesConfigured: true, allowedDirectories,
          knownDirectories: [...new Set([...this.settings.config.knownDirectories, path])].slice(-128) } }
      await this.store.saveSettings(next)
      this.settings = next
    }))
  }
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(run); this.tail = operation.catch(() => {}); return operation
  }
  async save(content: string, revision: string): Promise<ConnectionSaveResult> {
    return this.exclusive(async () => {
      if (revision !== String(this.settings.revision)) return { ok: false, error: 'conflict' }
      let config: ConnectionConfig
      try {
        if (content.length > 131072) throw new Error()
        config = connectionConfigSchema.parse(JSON.parse(content))
        config.maxConcurrent = config.maxConnections
        if (config.knownDirectories.some(path => !isAbsolute(path))) throw new Error()
        config.knownDirectories = [...new Set(config.knownDirectories)]
        config.allowedDirectories = [...new Set(await Promise.all(config.allowedDirectories.map(async path => {
          if (!isAbsolute(path)) throw new Error()
          const canonical = await realpath(path)
          if (!(await stat(canonical)).isDirectory()) throw new Error()
          return canonical
        })))].sort()
        if (config.enabled && !config.allowedDirectories.length) throw new Error()
      } catch { return { ok: false, error: 'invalid' } }
      const previous = this.settings.config
      const next = { ...this.settings, revision: this.settings.revision + 1, config }
      try { await this.store.saveSettings(next) } catch { return { ok: false, error: 'save-failed' } }
      this.settings = next
      if (!config.enabled) this.directoryRequests.rejectPending()
      const transportChanged = this.state === 'error' || config.enabled !== previous.enabled || config.port !== previous.port || config.maxConnections !== previous.maxConnections
      if (transportChanged) { await this.http.close(); await this.listen() }
      return { ok: true, snapshot: this.read() }
    })
  }
  reveal(): { token: string } { return { token: this.settings.token } }
  async rotate(revision: string): Promise<ConnectionSaveResult> {
    return this.exclusive(async () => {
      if (revision !== String(this.settings.revision)) return { ok: false, error: 'conflict' }
      const next = { ...this.settings, revision: this.settings.revision + 1, token: randomBytes(32).toString('hex') }
      try { await this.store.saveSettings(next) } catch { return { ok: false, error: 'save-failed' } }
      this.settings = next
      await this.http.close(); await this.listen()
      return { ok: true, snapshot: this.read() }
    })
  }
  private async listen(): Promise<void> {
    this.error = ''; this.state = 'disabled'
    if (!this.settings.config.enabled) return
    try { await this.http.start(this.settings.config.port, this.settings.token, this.settings.config.maxConnections); this.state = 'listening' }
    catch (error) { this.state = 'error'; this.error = error instanceof ConnectionError ? error.code : 'unavailable' }
  }
  async close(): Promise<void> {
    await this.exclusive(async () => {
      if (this.timer) clearInterval(this.timer)
      this.directoryRequests.rejectPending()
      await this.http.close(); await this.tasks.close(); await this.store.close()
    })
  }
}
