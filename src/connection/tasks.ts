import { randomUUID, createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { activeTask, ConnectionError } from './types.js'
import type { ConnectionConfig, DelegatedTask, DelegationHost, TaskStatus, TaskView } from './types.js'
import type { ConnectionStore } from './store.js'
import { gitSnapshot, gitWorktreeRoot, workspaceChanges } from './git.js'

export function withinDirectory(root: string, cwd: string): boolean {
  const path = relative(root, cwd)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
export class DelegatedTasks {
  private records: DelegatedTask[] = []
  private tail: Promise<unknown> = Promise.resolve()
  private closed: boolean = false
  constructor(private readonly store: ConnectionStore, private readonly host: DelegationHost,
    private readonly configuration: () => ConnectionConfig) {}
  async initialize(): Promise<void> {
    this.records = await this.store.tasks()
    for (const task of this.records) if (activeTask(task.status)) this.event(task, 'interrupted', 'Service restarted; no request was replayed. Observe or explicitly continue this task.')
    await this.persist()
  }
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(run)
    this.tail = operation.catch(() => {})
    return operation
  }
  private event(task: DelegatedTask, status: TaskStatus, message: string): void {
    task.status = status; task.updatedAt = Date.now()
    task.events.push({ cursor: ++task.sequence, time: task.updatedAt, status, message: message.slice(0, 1000) })
    task.events = task.events.slice(-200)
  }
  private async persist(): Promise<void> { await this.store.saveTasks(this.records) }
  private owned(id: string): DelegatedTask {
    const task = this.records.find(row => row.id === id)
    if (!task) throw new ConnectionError('task-not-found')
    return task
  }
  private enabled(): void {
    if (this.closed || !this.configuration().enabled) throw new ConnectionError('connection-disabled')
  }
  private async directory(cwd: string): Promise<string> {
    if (!isAbsolute(cwd)) throw new ConnectionError('absolute-directory-required')
    let canonical: string
    try { canonical = await realpath(cwd); if (!(await stat(canonical)).isDirectory()) throw new Error() }
    catch { throw new ConnectionError('directory-unavailable') }
    const roots = await Promise.all(this.configuration().allowedDirectories.map(path => realpath(path)))
    if (!roots.some(root => withinDirectory(root, canonical))) throw new ConnectionError('directory-not-allowed')
    return canonical
  }
  private async capacity(cwd: string, except = ''): Promise<void> {
    const pending = this.records.filter(row => row.id !== except && (activeTask(row.status) || row.status === 'interrupted'))
    if (pending.length >= this.configuration().maxConnections) throw new ConnectionError('concurrency-limit')
    const root = await gitWorktreeRoot(cwd)
    const roots = await Promise.all(pending.map(row => gitWorktreeRoot(row.cwd)))
    if (pending.some((row, index) => withinDirectory(row.cwd, cwd) || withinDirectory(cwd, row.cwd)
      || root !== false && root === roots[index])) throw new ConnectionError('workspace-busy')
  }
  async run(input: { requestId: string; cwd: string; prompt: string; client?: string; connectionId?: string }): Promise<TaskView> {
    const task = await this.exclusive(async () => {
      this.enabled()
      const cwd = await this.directory(input.cwd)
      const fingerprint = digest({ cwd, prompt: input.prompt, client: input.client ?? 'mcp' })
      const prior = this.records.find(row => row.requestId === input.requestId)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ConnectionError('request-conflict')
        if (input.connectionId && prior.connectionId !== input.connectionId) { prior.connectionId = input.connectionId; await this.persist() }
        return prior
      }
      if (this.records.length >= 200) throw new ConnectionError('task-history-full')
      await this.capacity(cwd)
      const preset = await this.host.preset(), id = `sc-${randomUUID()}`, now = Date.now()
      const row: DelegatedTask = { id, sessionId: id, requestId: input.requestId, fingerprint, cwd, preset,
        client: input.client ?? 'mcp', status: 'starting', cancellationRequested: false, createdAt: now, updatedAt: now, currentRequest: randomUUID(),
        output: '', sequence: 0, events: [], operations: {}, baseline: await gitSnapshot(cwd), ...(input.connectionId ? { connectionId: input.connectionId } : {}) }
      this.event(row, 'starting', 'Dispatch intent saved. A DSH turn ending does not verify task acceptance.')
      this.records.push(row); await this.persist()
      try { await this.host.create(row.sessionId, cwd, preset) }
      catch { this.event(row, 'failed', 'Session creation failed. No prompt was sent.'); await this.persist(); return row }
      try {
        await this.host.prompt(row.sessionId, row.currentRequest, input.prompt)
        this.event(row, 'running', 'Prompt accepted by DSH.')
      } catch { this.event(row, 'interrupted', 'Prompt admission could not be confirmed. No automatic retry; inspect the DSH session before continuing.') }
      await this.persist()
      return row
    })
    return this.view(task.id, 0)
  }
  async send(input: { taskId: string; requestId: string; prompt: string; connectionId?: string }): Promise<TaskView> {
    await this.exclusive(async () => {
      this.enabled()
      const task = this.owned(input.taskId), fingerprint = digest(input.prompt)
      const prior = Object.hasOwn(task.operations, input.requestId) ? task.operations[input.requestId] : false
      if (prior) {
        if (prior !== fingerprint) throw new ConnectionError('request-conflict')
        if (input.connectionId && task.connectionId !== input.connectionId) { task.connectionId = input.connectionId; await this.persist() }
        return
      }
      if (Object.keys(task.operations).length >= 128) throw new ConnectionError('task-operation-limit')
      await this.directory(task.cwd)
      await this.refresh(task)
      if (task.status === 'cancelling' || task.status === 'waiting_confirmation') throw new ConnectionError('resolve-in-dsh-first')
      await this.capacity(task.cwd, task.id)
      // Persist the operation before admission. A retry observes this intent; it never resends it.
      Object.defineProperty(task.operations, input.requestId, { value: fingerprint, enumerable: true, configurable: true, writable: true })
      task.currentRequest = randomUUID(); task.cancellationRequested = false
      if (input.connectionId) task.connectionId = input.connectionId
      this.event(task, 'starting', 'Explicit continuation intent saved.'); await this.persist()
      try {
        await this.host.prompt(task.sessionId, task.currentRequest, input.prompt)
        this.event(task, 'running', 'Continuation accepted by DSH.')
      } catch { this.event(task, 'interrupted', 'Continuation admission could not be confirmed; no automatic retry.') }
      await this.persist()
    })
    return this.view(input.taskId, 0)
  }
  async cancel(id: string): Promise<TaskView> {
    await this.exclusive(async () => {
      this.enabled()
      const task = this.owned(id)
      await this.refresh(task)
      if (!activeTask(task.status) && task.status !== 'interrupted') return
      task.cancellationRequested = true
      this.event(task, 'cancelling', 'Cancellation requested; waiting for the root and managed descendants to stop.')
      await this.persist()
      try { await this.host.cancel(task.sessionId) }
      catch { this.event(task, 'unavailable', 'Could not confirm cancellation of the complete task tree. Check DSH.'); await this.persist(); return }
      await this.refresh(task); await this.persist()
    })
    return this.view(id, 0)
  }
  private async refresh(task: DelegatedTask): Promise<void> {
    if (!activeTask(task.status) && task.status !== 'interrupted') return
    if (task.cancellationRequested) await this.host.cancel(task.sessionId).catch(() => {})
    const observation = await this.host.observe(task.sessionId, task.currentRequest, task.cancellationRequested)
    const status: TaskStatus = task.cancellationRequested
      ? ['finished', 'interrupted', 'failed'].includes(observation.status) ? 'cancelled' : observation.status === 'unavailable' ? 'unavailable' : 'cancelling'
      : observation.status
    const changed = task.output !== observation.output
    task.output = observation.output.slice(-12000)
    if (task.status !== status || changed) {
      this.event(task, status, observation.detail); await this.persist()
    }
  }
  async tick(): Promise<void> {
    await this.exclusive(async () => {
      if (this.closed) return
      for (const task of this.records) if (activeTask(task.status) || task.status === 'interrupted') {
        try { await this.refresh(task) }
        catch { if (task.status !== 'unavailable') { this.event(task, 'unavailable', 'Task observation is unavailable; no request was replayed.'); await this.persist() } }
      }
    })
  }
  async view(id: string, cursor: number): Promise<TaskView> {
    const task = await this.exclusive(async () => { const row = this.owned(id); await this.refresh(row); return structuredClone(row) })
    return { taskId: task.id, sessionId: task.sessionId, cwd: task.cwd, preset: task.preset, client: task.client,
      status: task.status, createdAt: task.createdAt, updatedAt: task.updatedAt, output: task.output,
      events: task.events.filter(event => event.cursor > cursor), cursor: task.sequence,
      eventsTruncated: cursor < (task.events[0]?.cursor ?? 1) - 1, acceptance: 'not-verified',
      workspace: await workspaceChanges(task.cwd, task.baseline) }
  }
  async list(cursor: number): Promise<{ tasks: { taskId: string; sessionId: string; cwd: string; client: string; status: TaskStatus; updatedAt: number }[]; nextCursor: number | false }> {
    return this.exclusive(async () => {
      const rows = [...this.records].reverse()
      return { tasks: rows.slice(cursor, cursor + 25).map(task => ({ taskId: task.id, sessionId: task.sessionId, cwd: task.cwd, client: task.client, status: task.status, updatedAt: task.updatedAt })),
        nextCursor: cursor + 25 < rows.length ? cursor + 25 : false }
    })
  }
  overview(): { taskId: string; sessionId: string; cwd: string; client: string; connectionId: string; status: TaskStatus; updatedAt: number }[] {
    return [...this.records].reverse().map(task => ({ taskId: task.id, sessionId: task.sessionId, cwd: task.cwd, client: task.client,
      connectionId: task.connectionId ?? '', status: task.status, updatedAt: task.updatedAt }))
  }
  async wait(id: string, cursor: number, waitMs: number, signal?: AbortSignal): Promise<TaskView> {
    const deadline = Date.now() + Math.min(Math.max(waitMs, 0), 30000)
    let view = await this.view(id, cursor)
    while (activeTask(view.status) && view.status !== 'waiting_confirmation' && view.cursor <= cursor && Date.now() < deadline) {
      signal?.throwIfAborted()
      await pause(Math.min(250, Math.max(1, deadline - Date.now())), undefined, { signal })
      view = await this.view(id, cursor)
    }
    return view
  }
  async close(): Promise<void> { await this.exclusive(async () => { this.closed = true; await this.persist() }) }
}
