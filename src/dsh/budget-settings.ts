/** Persist UI overrides through Harness settings; Agents take creation-time snapshots. */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { validateConfiguration } from './budgets.js'
import { applyConfiguration } from './configuration.js'
import type { Configuration } from './budgets.js'
import type { ShellStatus } from './windows-shell.js'
import { randomUUID } from 'node:crypto'
import { skillPackages } from './skill-packages.js'
import type { SkillPackageVersion } from './skill-packages.js'
import type { SkillDirectoryStatus } from './skill-directory.js'

const namespace = 'super-code-budgets'

interface SettingsWriter {
  readonly writable: boolean
  describe(options: { redactSecrets: boolean }): { ns: string; revision: number }[]
  replace(namespace: string, config: object, revision: number): Promise<void>
}

export interface BudgetSettingsSnapshot {
  readonly namespace?: string
  readonly generation?: string
  readonly shell?: ShellStatus
  readonly skillPackages?: Readonly<Record<string, SkillPackageVersion>>
  readonly skills?: SkillDirectoryStatus
  readonly configuration: Configuration
  readonly revision: number
  readonly writable: boolean
  readonly ptcMaxTimeoutMs: number | false
  readonly defaults: Configuration
}
export type BudgetSettingsResult = { readonly ok: true; readonly snapshot: BudgetSettingsSnapshot }
  | { readonly ok: false; readonly error: 'invalid' | 'conflict' | 'read-only' | 'ptc-unavailable' | 'ptc-ceiling' | 'save-failed' }

export class BudgetSettings {
  private readonly generation = randomUUID()
  constructor(private readonly settings: SettingsWriter, private readonly scope: Pick<SettingsScope<Configuration>, 'get'>,
    private readonly ptcCeiling: () => number | false, private readonly key: string = namespace,
    private readonly defaults: () => Configuration = () => ({})) {}

  read(): BudgetSettingsSnapshot {
    const descriptor = this.settings.describe({ redactSecrets: true }).find(row => row.ns === this.key)
    if (!descriptor) throw new Error('Super Code budget settings are unavailable')
    return { namespace: this.key, configuration: structuredClone(this.scope.get()), revision: descriptor.revision, generation: this.generation,
      writable: this.settings.writable, ptcMaxTimeoutMs: this.ptcCeiling(), defaults: structuredClone(this.defaults()) }
  }

  async save(content: string, expected: string): Promise<BudgetSettingsResult> {
    if (!this.settings.writable) return { ok: false, error: 'read-only' }
    let config: Configuration
    try {
      if (content.length > 4096) throw new Error('Configuration is too large')
      config = validateConfiguration(JSON.parse(content))
    } catch { return { ok: false, error: 'invalid' } }
    const previous = this.scope.get().budgets
    // Stored values may outlive a provider or its limits. Preserve them when
    // editing other settings; only newly selected execution budgets need validation.
    const changed = (['ptcTimeoutMs', 'ptcMaxTimeoutMs'] as const).flatMap(key => {
      const value = config.budgets?.[key]
      return value !== undefined && value !== previous?.[key] ? [value] : []
    })
    if (changed.length) {
      const ceiling = this.ptcCeiling()
      if (ceiling === false) return { ok: false, error: 'ptc-unavailable' }
      if (changed.some(value => value > ceiling)) return { ok: false, error: 'ptc-ceiling' }
    }
    return this.replace(config, expected)
  }

  async reset(expected: string): Promise<BudgetSettingsResult> { return this.replace({}, expected) }

  private async replace(config: Configuration, expected: string): Promise<BudgetSettingsResult> {
    if (!this.settings.writable) return { ok: false, error: 'read-only' }
    const [revision, generation, extra] = expected.split(':')
    if (extra !== undefined || generation === '' || !/^(0|[1-9]\d*)$/.test(revision!) || !Number.isSafeInteger(Number(revision))) return { ok: false, error: 'invalid' }
    // Numeric revisions can repeat after a service restart. Older clients may
    // still send only the number; current clients also identify the instance.
    if (generation !== undefined && generation !== this.generation) return { ok: false, error: 'conflict' }
    try {
      await this.settings.replace(this.key, config, Number(revision))
      return { ok: true, snapshot: this.read() }
    } catch (error) {
      return { ok: false, error: (error as { code?: string }).code === 'SETTINGS_CONFLICT' ? 'conflict' : 'save-failed' }
    }
  }
}

export class SuperCodeBudgets extends TypertRemoteService {
  constructor(ctx: Context, private readonly settings: BudgetSettings) { super(ctx, 'superCodeBudgets') }
  @Remote
  readConfig(): BudgetSettingsSnapshot { return { ...this.settings.read(), ...this.featureStatus() } }
  @Remote
  async openSkillsDirectory(): Promise<{ opened: true }> {
    const skills = this.ctx.get('superCodeSkills')
    if (!skills) throw new Error('Skill directory unavailable')
    return skills.open()
  }
  @Remote
  async syncSkills(): Promise<BudgetSettingsSnapshot> {
    await this.ctx.get('superCodeSkills')?.synchronize()
    return this.readConfig()
  }
  @Remote
  async saveConfig(content: string, expected: string): Promise<BudgetSettingsResult> {
    const result = await this.settings.save(content, expected)
    if (result.ok) void this.synchronizeSkills()
    return result.ok ? { ...result, snapshot: { ...result.snapshot, ...this.featureStatus() } } : result
  }
  @Remote
  async resetConfig(expected: string): Promise<BudgetSettingsResult> {
    const result = await this.settings.reset(expected)
    if (result.ok) void this.synchronizeSkills()
    return result.ok ? { ...result, snapshot: { ...result.snapshot, ...this.featureStatus() } } : result
  }

  private featureStatus(): Pick<BudgetSettingsSnapshot, 'skillPackages' | 'skills' | 'shell'> {
    let skills: SkillDirectoryStatus | undefined, shell: ShellStatus | undefined
    try { skills = this.ctx.get('superCodeSkills')?.status() }
    catch (error) { this.ctx.logger.warn('Skill status is unavailable.', error) }
    try { shell = this.ctx.get('superCodeShell')?.status() }
    catch (error) { this.ctx.logger.warn('Shell status is unavailable.', error) }
    return { skillPackages, skills, shell }
  }

  private async synchronizeSkills(): Promise<void> {
    try { await this.ctx.get('superCodeSkills')?.synchronize() }
    catch (error) { this.ctx.logger.warn('Settings were saved, but Skill synchronization failed.', error) }
  }
}

export async function applyBudgetSettings(ctx: Context, config: Configuration): Promise<void> {
  applyConfiguration(ctx, config)
  await applyBudgetRemote(ctx)
}

export async function applyBudgetRemote(ctx: Context): Promise<void> {
  await ctx.inject(['settings', 'superCodeConfiguration'], async owner => {
    let disposed = false
    owner.effect(() => () => { disposed = true })
    const source = owner.superCodeConfiguration
    let hostDefaults: Configuration['budgets'] = {}
    try {
      const { BasicCompactionEngine } = await import('@deepseek-ai/dsh-compaction-basic')
      if (disposed) return
      const defaults = new BasicCompactionEngine(owner.isolate('compaction'), { auto: false }).config
      hostDefaults = { thresholdRatio: defaults.thresholdRatio, retainRatio: defaults.retainRatio,
        summaryMaxTokens: defaults.maxTokens, compactionRetries: defaults.compactionRetries,
        maxOverflowRetries: defaults.maxOverflowRetries }
    } catch (error) { owner.logger.warn('Host compression defaults are unavailable; saved overrides remain available.', error) }
    if (disposed) return
    let descriptors: ReturnType<SettingsWriter['describe']> | undefined
    const invalidate = (): void => { descriptors = undefined }
    owner.on('settings/updated', invalidate)
    owner.on('settings/document-updated', invalidate)
    // 宿主 describe 会重建全部设置表单；只复用版本信息，配置仍逐次读取。
    const settings: SettingsWriter = {
      get writable() { return owner.settings.writable },
      describe: options => descriptors ??= owner.settings.describe(options)
        .filter(row => row.ns === source.namespace()).map(({ ns, revision }) => ({ ns, revision })),
      async replace(namespace, config, revision) {
        try { await owner.settings.replace(namespace, config, revision) }
        finally { invalidate() }
      },
    }
    new SuperCodeBudgets(owner, new BudgetSettings(settings, source,
      () => { const timeout = source.timeout(); return timeout ? timeout.maxMs : false }, source.namespace(), () => {
        const timeout = source.timeout()
        return { applyToOfficialPresets: false, maxTasks: 32, maxContextBytes: 32768,
          budgets: { pressureBasis: 'host', ...hostDefaults,
            ...(timeout ? { ptcTimeoutMs: timeout.defaultMs, ptcMaxTimeoutMs: timeout.maxMs } : {}) } }
      }))
  })
}
