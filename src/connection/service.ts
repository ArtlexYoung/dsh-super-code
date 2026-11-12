import { randomBytes } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { ConnectionError, connectionConfigSchema } from './types.js'
import type { CallerApproval, ConnectionConfig, DelegationHost } from './types.js'
import type { ApprovalAnswer, ApprovalRoot } from './approvals.js'
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

async function canonicalKnownDirectories(paths: readonly string[]): Promise<string[]> {
  // Known entries are not grants: keep missing/inaccessible paths visible for removal.
  return [...new Set(await Promise.all(paths.map(path => realpath(path).catch(() => path))))]
}

export class ConnectionService {
  private settings!: ConnectionSettings
  private tasks!: DelegatedTasks
  private http!: ConnectionHttp
  private directoryRequests!: DirectoryRequests
  private timer: ReturnType<typeof setInterval> | false = false
  private tail: Promise<unknown> = Promise.resolve()
  private closing: Promise<void> | false = false
  private cleanupFailed: boolean = false
  private state: ConnectionSnapshot['state'] = 'disabled'
  private error: string = ''
  private observationError: boolean = false
  private observing: boolean = false
  constructor(private readonly store: ConnectionStore, private readonly host: DelegationHost) {}
  async initialize(): Promise<void> {
    await this.store.initialize()
    try {
      this.settings = await this.store.settings()
      this.settings.config.knownDirectories = await canonicalKnownDirectories(this.settings.config.knownDirectories)
      this.tasks = new DelegatedTasks(this.store, this.host, () => this.closing ? { ...this.settings.config, enabled: false } : this.settings.config)
      await this.tasks.initialize()
      this.directoryRequests = new DirectoryRequests(() => this.settings.config.allowedDirectories)
      this.http = new ConnectionHttp(this.tasks, (input, client) => this.exclusive(async () => {
        if (this.closing || !this.settings.config.enabled) throw new ConnectionError('connection-disabled')
        return this.directoryRequests.request(input, client)
      }))
      await this.listen()
      this.timer = setInterval(() => {
        if (this.closing || this.observing) return
        this.observing = true
        void this.tasks.tick().then(
          () => { if (!this.closing) this.observationError = false },
          () => { if (!this.closing) this.observationError = true },
        ).finally(() => { this.observing = false })
      }, 1000)
      this.timer.unref()
    } catch (error) { await this.store.close(); throw error }
  }
  read(): ConnectionSnapshot {
    return { configuration: structuredClone(this.settings.config), revision: this.settings.revision, writable: !this.closing,
      state: this.closing ? 'disabled' : this.state, error: this.error || (this.observationError ? 'storage-unavailable' : ''), url: `http://127.0.0.1:${this.settings.config.port}/mcp` }
  }
  overview(): ConnectionOverview { return { connections: this.http.connections(), sessions: this.tasks.overview() } }
  requestApproval(input: Omit<CallerApproval, 'id' | 'createdAt' | 'expiresAt' | 'taskId' | 'cwd'>, roots: readonly ApprovalRoot[], signal?: AbortSignal): Promise<ApprovalAnswer> {
    if (this.closing || this.state !== 'listening') return Promise.resolve('host')
    return this.tasks.requestApproval(input, roots, signal)
  }
  async disconnect(id: string): Promise<{ disconnected: true }> { await this.http.disconnect(id); return { disconnected: true } }
  pendingDirectories(): DirectoryRequest[] { return this.directoryRequests.pending() }
  async resolveDirectory(id: string, decision: string): Promise<{ status: DirectoryRequest['status'] }> {
    if (decision !== 'approved' && decision !== 'rejected') throw new ConnectionError('invalid-decision')
    return this.exclusive(() => {
      if (this.closing) throw new ConnectionError('unavailable')
      return this.directoryRequests.resolve(id, decision, async path => {
        if (this.closing || !this.settings.config.enabled) throw new ConnectionError('connection-disabled')
        const allowedDirectories = [...new Set([...this.settings.config.allowedDirectories, path])]
        if (allowedDirectories.length > 32) throw new ConnectionError('directory-limit')
        const next = { ...this.settings, revision: this.settings.revision + 1,
          config: { ...this.settings.config, directoriesConfigured: true, allowedDirectories,
            knownDirectories: [...new Set([...this.settings.config.knownDirectories, path])].slice(-128) } }
        await this.store.saveSettings(next)
        this.settings = next
      })
    })
  }
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(run); this.tail = operation.catch(() => {}); return operation
  }
  async save(content: string, revision: string): Promise<ConnectionSaveResult> {
    return this.exclusive(async () => {
      if (this.closing) return { ok: false, error: 'unavailable' }
      if (revision !== String(this.settings.revision)) return { ok: false, error: 'conflict' }
      let config: ConnectionConfig
      try {
        if (content.length > 131072) throw new Error()
        config = connectionConfigSchema.parse(JSON.parse(content))
        config.maxConcurrent = config.maxConnections
        if (config.knownDirectories.some(path => !isAbsolute(path))) throw new Error()
        config.knownDirectories = await canonicalKnownDirectories(config.knownDirectories)
        config.allowedDirectories = [...new Set(await Promise.all(config.allowedDirectories.map(async path => {
          if (!isAbsolute(path)) throw new Error()
          // Stopping admission must not require saved grants to remain accessible.
          if (!config.enabled && this.settings.config.allowedDirectories.includes(path)) return path
          const canonical = await realpath(path)
          if (!(await stat(canonical)).isDirectory()) throw new Error()
          return canonical
        })))].sort()
        if (config.enabled && !config.allowedDirectories.length) throw new Error()
      } catch { return { ok: false, error: 'invalid' } }
      if (this.closing) return { ok: false, error: 'unavailable' }
      const previous = this.settings.config
      const next = { ...this.settings, revision: this.settings.revision + 1, config }
      try { await this.store.saveSettings(next) } catch { return { ok: false, error: 'save-failed' } }
      this.settings = next
      if (!config.enabled || !config.allowCallerApproval || JSON.stringify(config.allowedDirectories) !== JSON.stringify(previous.allowedDirectories)) this.tasks.approvalsChanged()
      if (!config.enabled) this.directoryRequests.rejectPending()
      const transportChanged = this.state === 'error' || config.enabled !== previous.enabled || config.port !== previous.port || config.maxConnections !== previous.maxConnections
      if (transportChanged) await this.restart()
      return { ok: true, snapshot: this.read() }
    })
  }
  reveal(): { token: string } { return { token: this.settings.token } }
  async rotate(revision: string): Promise<ConnectionSaveResult> {
    return this.exclusive(async () => {
      if (this.closing) return { ok: false, error: 'unavailable' }
      if (revision !== String(this.settings.revision)) return { ok: false, error: 'conflict' }
      const next = { ...this.settings, revision: this.settings.revision + 1, token: randomBytes(32).toString('hex') }
      try { await this.store.saveSettings(next) } catch { return { ok: false, error: 'save-failed' } }
      this.settings = next
      this.tasks.approvalsChanged()
      await this.restart()
      return { ok: true, snapshot: this.read() }
    })
  }
  private async restart(): Promise<void> {
    if (this.closing) return
    this.state = 'disabled'; this.error = ''
    try { await this.http.close() }
    catch { this.state = 'error'; this.error = 'cleanup-failed'; return }
    if (!this.closing) await this.listen()
  }
  private async listen(): Promise<void> {
    this.error = ''; this.state = 'disabled'
    if (!this.settings.config.enabled) return
    try { await this.http.start(this.settings.config.port, this.settings.token, this.settings.config.maxConnections); this.state = 'listening' }
    catch (error) { this.state = 'error'; this.error = error instanceof ConnectionError ? error.code : 'unavailable' }
  }
  close(): Promise<void> {
    if (this.closing && !this.cleanupFailed) return this.closing
    this.cleanupFailed = false
    this.closing = this.exclusive(async () => {
      if (this.timer) { clearInterval(this.timer); this.timer = false }
      this.state = 'disabled'
      this.directoryRequests.rejectPending()
      const failures: unknown[] = []
      // A transport or persistence error must not strand the profile lock.
      for (const release of [() => this.http.close(), () => this.tasks.close(), () => this.store.close()]) {
        try { await release() } catch (error) { failures.push(error) }
      }
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, 'MCP resource cleanup failed')
    }).catch(error => { this.cleanupFailed = true; throw error })
    return this.closing
  }
}
