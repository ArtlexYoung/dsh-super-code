import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { fileURLToPath } from 'node:url'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ConnectionService } from '../connection/service.js'
import type { ConnectionSaveResult, ConnectionSnapshot } from '../connection/service.js'
import { ConnectionError, defaultConnectionConfig } from '../connection/types.js'
import { ConnectionStore } from '../connection/store.js'
import { ConnectionHost } from './connection-host.js'
import type { ConnectionHostServices } from './connection-host.js'

interface DirectoryListing { path: string; home: string; crumbs: { name: string; path: string; hidden: boolean }[]; entries: { name: string; path: string; hidden: boolean }[]; truncated: boolean }
interface SettingsEnvironment {
  workspaces: false | { list(): { path: string; title: string }[] }
  picker: false | { capability(): { kind: string; pick?(signal: AbortSignal): Promise<string | null>; list?(path?: string, signal?: AbortSignal): Promise<DirectoryListing> } }
}

export class SuperCodeConnection extends TypertRemoteService {
  constructor(ctx: Context, private readonly current: () => ConnectionService | false,
    private readonly environment: SettingsEnvironment = { workspaces: false, picker: false }) { super(ctx, 'superCodeConnection') }
  private service(): ConnectionService { const service = this.current(); if (!service) throw new ConnectionError('unavailable'); return service }
  @Remote
  readConfig(): ConnectionSnapshot { return this.current() ? this.service().read() : { configuration: structuredClone(defaultConnectionConfig), revision: 0, writable: false, state: 'error', error: 'unavailable', url: '' } }
  @Remote
  saveConfig(content: string, expected: string): Promise<ConnectionSaveResult> { return this.service().save(content, expected) }
  @Remote
  revealToken(): { token: string } { return this.service().reveal() }
  @Remote
  rotateToken(expected: string): Promise<ConnectionSaveResult> { return this.service().rotate(expected) }
  @Remote
  overview(): ReturnType<ConnectionService['overview']> { return this.current() ? this.service().overview() : { connections: [], sessions: [] } }
  @Remote
  disconnectClient(id: string): Promise<{ disconnected: true }> { return this.service().disconnect(id) }
  @Remote
  pendingDirectories(): ReturnType<ConnectionService['pendingDirectories']> { return this.current() ? this.service().pendingDirectories() : [] }
  @Remote
  resolveDirectory(id: string, decision: string): ReturnType<ConnectionService['resolveDirectory']> { return this.service().resolveDirectory(id, decision) }
  @Remote
  async directories(): Promise<{ items: { path: string; title: string; available: boolean; workspace: boolean }[]; picker: string; available: boolean }> {
    const workspaces = this.environment.workspaces ? this.environment.workspaces.list() : []
    const config = this.current() ? this.service().read().configuration : defaultConnectionConfig
    // Registry entities expose these fields through prototype getters.
    const rows = [...workspaces.map(row => ({ path: row.path, title: row.title, workspace: true })),
      ...[...config.knownDirectories, ...config.allowedDirectories].map(path => ({ path, title: '', workspace: false }))]
    const items = await Promise.all(rows.slice(0, 500).map(async row => {
      try { const path = await realpath(row.path); return { path, title: row.title, workspace: row.workspace, available: (await stat(path)).isDirectory() } }
      catch { return { path: row.path, title: row.title, workspace: row.workspace, available: false } }
    }))
    return { items: items.filter((row, index) => items.findIndex(other => other.path === row.path) === index),
      picker: this.environment.picker ? this.environment.picker.capability().kind : 'unavailable', available: !!this.environment.workspaces }
  }
  @Remote
  async pickDirectory(signal: AbortSignal): Promise<{ kind: 'selected'; path: string } | { kind: 'cancelled' }> {
    const picker = this.environment.picker && this.environment.picker.capability()
    if (!picker || picker.kind !== 'native' || !picker.pick) throw new ConnectionError('picker-unavailable')
    const path = await picker.pick(signal)
    return path === null ? { kind: 'cancelled' } : { kind: 'selected', path }
  }
  @Remote
  async browseDirectory(path: string, signal: AbortSignal): Promise<DirectoryListing> {
    const picker = this.environment.picker && this.environment.picker.capability()
    if (!picker || picker.kind !== 'browse' || !picker.list) throw new ConnectionError('picker-unavailable')
    return picker.list(path || undefined, signal)
  }
}
export function applyConnection(ctx: Context): void {
  let service: ConnectionService | false = false
  const environment: SettingsEnvironment = { workspaces: false, picker: false }
  new SuperCodeConnection(ctx, () => service, environment)
  ctx.inject(['workspaceRegistry'], owner => {
    environment.workspaces = owner.get('workspaceRegistry')
    owner.effect(() => () => { environment.workspaces = false })
  })
  ctx.inject(['directoryPicker'], owner => {
    environment.picker = owner.get('directoryPicker')
    owner.effect(() => () => { environment.picker = false })
  })
  const profileServices = 'profileContext' in ctx ? ['profileContext'] : []
  ctx.inject([...profileServices, 'sessionController', 'agents', 'sessionQuery', 'subagents', 'superCodePresets'], async owner => {
    let directory: string
    try {
      if (profileServices.length) {
        const profile = owner.get('profileContext') as { patchPath: string }
        directory = dirname(profile.patchPath)
      } else {
        // Early hosts expose the profile only as the boot context base URL. Verify its manifest.
        const baseUrl = owner.root.baseUrl
        if (!baseUrl) throw new Error('Profile base URL unavailable')
        directory = fileURLToPath(baseUrl)
        const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
        if (!Array.isArray(manifest.dsh?.profile?.bundles)) throw new Error('Not a profile')
      }
    } catch { owner.logger.warn('Super Code connection requires a persistent host profile.'); return }
    const host = new ConnectionHost({ presets: owner.get('superCodePresets'), controller: owner.get('sessionController'),
      agents: owner.get('agents'), query: owner.get('sessionQuery'), subagents: owner.get('subagents') } as ConnectionHostServices)
    const connection = new ConnectionService(new ConnectionStore(join(directory, 'super-code-connection')), host)
    try {
      await connection.initialize()
      service = connection
      owner.effect(() => () => { service = false; return connection.close() })
    } catch { owner.logger.warn('Super Code connection storage is unavailable or already owned by another host. No endpoint was started.') }
  })
}
