/** Profile-local storage. Claim before reading/writing; never replay dispatch intents on boot. */
import { chmod, mkdir, open, readFile, rename, unlink, lstat } from 'node:fs/promises'
import { join, isAbsolute, relative } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { connectionConfigSchema, defaultConnectionConfig, ConnectionError } from './types.js'
import type { ConnectionConfig, DelegatedTask } from './types.js'

const taskStorageLimit = 64 * 1024 * 1024
const taskSchema = z.object({
  id: z.string().regex(/^sc-[a-f0-9-]{36}$/), sessionId: z.string(), requestId: z.string().min(1).max(128), fingerprint: z.string().length(64),
  cwd: z.string().max(4096), preset: z.string().min(1).max(128), client: z.string().max(80),
  status: z.enum(['starting', 'running', 'waiting_confirmation', 'cancelling', 'finished', 'failed', 'cancelled', 'interrupted', 'unavailable']),
  cancellationRequested: z.boolean(), createdAt: z.number(), updatedAt: z.number(), currentRequest: z.string(), output: z.string().max(12000),
  sequence: z.number().int().nonnegative(), events: z.array(z.object({ cursor: z.number().int().positive(), time: z.number(), status: z.string(), message: z.string().max(1000) }).strict()).max(200),
  operations: z.record(z.string(), z.string().length(64)).refine(value => Object.keys(value).length <= 128),
  connectionId: z.string().max(128).optional(),
  previousRequest: z.string().min(1).max(128).optional(),
  modelSelection: z.object({ provider: z.string().min(1).max(256), model: z.string().min(1).max(256), reasoningEffort: z.string().min(1).max(128).optional() }).strict().optional(),
  observation: z.object({ lastEventSeq: z.number().int().min(-1), lastEventType: z.string().max(128), outputTruncated: z.boolean(), errorCode: z.string().max(128).optional() }).strict().optional(),
  baseline: z.object({ available: z.boolean(), root: z.string(), head: z.string(), fingerprint: z.string(), dirty: z.array(z.string()).max(160) }).strict(),
}).strict().refine(value => value.sessionId === value.id && isAbsolute(value.cwd))

const settingsSchema = z.object({ revision: z.number().int().nonnegative(), config: connectionConfigSchema,
  token: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export interface ConnectionSettings { revision: number; config: ConnectionConfig; token: string }
export class ConnectionStore {
  private lock: string = ''
  private owned: boolean = false
  private writable: boolean = false
  constructor(readonly directory: string) {}
  async initialize(): Promise<void> {
    if (this.owned) throw new ConnectionError('profile-busy')
    if (!isAbsolute(this.directory)) throw new ConnectionError('storage-unavailable')
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const info = await lstat(this.directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new ConnectionError('storage-unavailable')
    await chmod(this.directory, 0o700)
    const path = join(this.directory, 'owner.lock')
    const token = `${process.pid}:${randomUUID()}`
    try { await this.claim(path, token) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      // A separate exclusive claim serializes stale-lock recovery by competing hosts.
      const recovery = await open(join(this.directory, 'recovery.lock'), 'wx', 0o600).catch(() => { throw new ConnectionError('profile-busy') })
      const failures: unknown[] = []
      try {
        const previous = await readFile(path, 'utf8').catch(failure => {
          if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') throw failure
          return false as const
        })
        // A live owner can finish closing after the exclusive claim saw EEXIST.
        if (previous !== false) {
          const pid = Number(previous.split(':')[0])
          if (!Number.isSafeInteger(pid) || pid <= 0) throw new ConnectionError('profile-busy')
          try { process.kill(pid, 0); throw new ConnectionError('profile-busy') }
          catch (failure) { if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') throw failure }
          await unlink(path)
        }
        await this.claim(path, token)
      } catch (failure) { failures.push(failure) }
      for (const release of [() => recovery.close(), () => unlink(join(this.directory, 'recovery.lock'))]) {
        try { await release() } catch (failure) { failures.push(failure) }
      }
      if (failures.length) {
        // Initialization did not complete: never strand a token for this live PID.
        try { await this.release(token) } catch (failure) { failures.push(failure) }
        if (failures.length === 1) throw failures[0]
        throw new AggregateError(failures, 'MCP lock recovery failed')
      }
    }
    this.lock = token
    this.owned = true; this.writable = true
  }
  private async claim(path: string, token: string): Promise<void> {
    const file = await open(path, 'wx', 0o600)
    let identity: { dev: number; ino: number } | false = false
    try {
      identity = await file.stat()
      await file.writeFile(token); await file.sync(); await file.close()
    } catch (error) {
      await file.close().catch(() => {})
      try {
        const current = await lstat(path)
        if (identity && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) await unlink(path)
      } catch (cleanup) {
        if ((cleanup as NodeJS.ErrnoException).code !== 'ENOENT') throw new AggregateError([error, cleanup], 'Failed to clean up an incomplete MCP owner lock')
      }
      throw error
    }
  }
  async close(): Promise<void> {
    this.writable = false
    if (!this.owned) return
    const token = this.lock
    await this.release(token)
    // Keep failed releases retryable without permitting further profile writes.
    if (this.lock === token) this.owned = false
  }
  private async release(token: string): Promise<void> {
    const path = join(this.directory, 'owner.lock')
    try { if (await readFile(path, 'utf8') === token) await unlink(path) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  async settings(): Promise<ConnectionSettings> {
    try {
      const stored = settingsSchema.parse(JSON.parse(await readFile(join(this.directory, 'settings.json'), 'utf8')))
      if (stored.config.maxConcurrent !== stored.config.maxConnections) {
        stored.config.maxConcurrent = stored.config.maxConnections
        await this.write('settings.json', JSON.stringify(stored))
      }
      return stored
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ConnectionError('storage-unavailable')
      const value = { revision: 0, config: structuredClone(defaultConnectionConfig), token: randomBytes(32).toString('hex') }
      await this.write('settings.json', JSON.stringify(value))
      return value
    }
  }
  async saveSettings(value: ConnectionSettings): Promise<void> {
    const normalized = settingsSchema.parse(value)
    normalized.config.maxConcurrent = normalized.config.maxConnections
    await this.write('settings.json', JSON.stringify(normalized))
  }
  async tasks(): Promise<DelegatedTask[]> {
    try {
      const path = join(this.directory, 'tasks.json')
      if ((await lstat(path)).size > taskStorageLimit) throw new ConnectionError('storage-unavailable')
      return z.array(taskSchema).max(200).parse(JSON.parse(await readFile(path, 'utf8'))) as DelegatedTask[]
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new ConnectionError('storage-unavailable')
    }
  }
  async saveTasks(tasks: DelegatedTask[]): Promise<void> {
    const content = JSON.stringify(tasks)
    if (Buffer.byteLength(content) > taskStorageLimit) throw new ConnectionError('task-storage-full')
    await this.write('tasks.json', content)
  }
  private async write(name: string, content: string): Promise<void> {
    if (!this.owned || !this.writable || relative(this.directory, join(this.directory, name)).startsWith('..')) throw new ConnectionError('storage-unavailable')
    const target = join(this.directory, name), temporary = `${target}.${randomUUID()}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(content); await file.sync(); await file.close()
      await rename(temporary, target)
    } catch (error) {
      await file.close().catch(() => {})
      await unlink(temporary).catch(() => {})
      throw error
    }
  }
}
