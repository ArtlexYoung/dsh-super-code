/** One global writer; preset scopes reuse the installed library. */
import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { configurationOf } from './budgets.js'
import type { Configuration } from './budgets.js'
import { registerBundledSkills } from './bundled-skills.js'
import { prepareSkillDirectory, synchronizeSkillCopy } from './skill-installation.js'
import type { SkillCopyError } from './skill-installation.js'

export interface SkillDirectoryStatus {
  readonly state: 'syncing' | 'ready' | 'error'
  readonly canOpen: boolean
  readonly issues: readonly { id: string; error: SkillCopyError }[]
}
const packages = ['oil-ui', 'openspec', 'mattpocock', 'pstack'] as const
export function skillDirectoryCommand(directory: string, platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [directory] }
  if (platform === 'win32') return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', `Invoke-Item -LiteralPath '${directory.replaceAll("'", "''")}'`] }
  if (platform === 'linux') return { command: 'xdg-open', args: [directory] }
  throw new Error('Skill directory opener unavailable')
}
function enabledPackages(config: Configuration): boolean[] {
  return [config.oilUiSkill === true, config.openspecSkills === true,
    config.mattpocockSkills === true || config.grillMeSkill === true, config.pstackSkills === true]
}

export class SkillDirectory {
  private tail: Promise<void> = Promise.resolve()
  private signature = ''
  private closed = false
  private readonly installed = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private current: SkillDirectoryStatus = { state: 'syncing', canOpen: this.canOpen(), issues: [] }
  constructor(readonly directory: string, private readonly source: string, private readonly configuration: () => Configuration) {}
  status(): SkillDirectoryStatus { return structuredClone(this.current) }
  ready(): Promise<void> { return this.tail }
  available(id: string): boolean { return !this.closed && this.installed.has(id) }
  subscribe(refresh: () => void): () => void { this.listeners.add(refresh); return () => { this.listeners.delete(refresh) } }
  close(): Promise<void> { this.closed = true; return this.tail }
  private canOpen(): boolean { return ['darwin', 'win32'].includes(process.platform) || process.platform === 'linux' && !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY) }

  synchronize(): Promise<void> {
    if (this.closed) return this.tail
    const enabled = enabledPackages(this.configuration()), signature = JSON.stringify(enabled)
    if (signature === this.signature) return this.tail
    this.signature = signature
    this.current = { ...this.current, state: 'syncing' }
    this.tail = this.tail.then(async () => {
      if (this.closed) return
      const issues: { id: string; error: SkillCopyError }[] = []
      try { await prepareSkillDirectory(this.directory) }
      catch {
        this.signature = ''; this.installed.clear()
        this.current = { ...this.current, state: 'error', issues: [{ id: 'dsh-super-code', error: 'conflict' }] }
        for (const refresh of this.listeners) refresh()
        return
      }
      for (const [index, id] of packages.entries()) {
        if (this.closed) return
        const result = await synchronizeSkillCopy(this.directory, id, join(this.source, id), enabled[index]!)
        if (result.available) this.installed.add(id); else this.installed.delete(id)
        if (result.error) issues.push({ id, error: result.error })
      }
      if (issues.length) this.signature = ''
      this.current = { ...this.current, state: issues.length ? 'error' : 'ready', issues }
      for (const refresh of this.listeners) refresh()
    })
    return this.tail
  }

  async open(): Promise<{ opened: true }> {
    if (this.closed || !this.canOpen()) throw new Error('Skill directory opener unavailable')
    await this.synchronize()
    // Open the standard parent folder, including the user's independently installed Skills.
    const { command, args } = skillDirectoryCommand(join(this.directory, '..'), process.platform)
    await new Promise<void>((resolveOpen, reject) => {
      execFile(command, args, { timeout: 10000 }, error => error ? reject(new Error('Cannot open Skill directory')) : resolveOpen())
    })
    return { opened: true }
  }
}
declare module '@deepseek-ai/cordis' { interface Context { superCodeSkills: SkillDirectory } }

export function applySkillDirectory(ctx: Context): void {
  const configured = process.env.DSH_HOME?.trim() ? process.env.DSH_HOME : join(homedir(), '.dsh')
  const home = configured === '~' ? homedir() : /^~[/\\]/.test(configured) ? join(homedir(), configured.slice(2)) : configured
  const service = new SkillDirectory(join(resolve(home), 'skills/dsh-super-code'),
    fileURLToPath(new URL('../../builtin/skills/', import.meta.url)), () => configurationOf(ctx))
  ctx.provide('superCodeSkills', service)
  ctx.effect(() => () => service.close())
  // The settings provider can become ready before our namespace is registered.
  // Its Remote is published only after the persisted switches are resolved.
  ctx.inject(['superCodeBudgets'], owner => {
    const refresh = (): void => { void service.synchronize() }
    owner.on('settings/updated', refresh)
    owner.on('settings/document-updated', refresh)
    refresh()
  })
  ctx.inject(['skills'], owner => registerBundledSkills(owner,
    { bundledSkillDir: service.directory, layout: 'builtin' }, service))
}
