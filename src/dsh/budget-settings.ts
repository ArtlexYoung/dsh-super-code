/** Persist UI overrides through Harness settings; Agents take creation-time snapshots. */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { settingsConfigurationSchema, configurationValues, validateConfiguration } from './budgets.js'
import type { Configuration } from './budgets.js'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'

const namespace = 'super-code-budgets'

interface SettingsWriter {
  readonly writable: boolean
  describe(options: { redactSecrets: boolean }): { ns: string; revision: number }[]
  replace(namespace: string, config: object, revision: number): Promise<void>
}

export interface BudgetSettingsSnapshot {
  readonly configuration: Configuration
  readonly revision: number
  readonly writable: boolean
  readonly ptcMaxTimeoutMs: number | false
  readonly defaults: Configuration
}
export type BudgetSettingsResult = { readonly ok: true; readonly snapshot: BudgetSettingsSnapshot }
  | { readonly ok: false; readonly error: 'invalid' | 'conflict' | 'read-only' | 'ptc-unavailable' | 'ptc-ceiling' | 'save-failed' }

/** Keep the evaluated budgets independent of changes to the host's defaults. */
function withLegacyBudgets(config: Configuration, ptcCeiling: number | false): Configuration {
  const maxTimeout = ptcCeiling === false ? false : Math.min(ptcCeiling,
    config.budgets?.ptcMaxTimeoutMs ?? Math.max(600000, config.budgets?.ptcTimeoutMs ?? 0))
  return {
    applyToOfficialPresets: false, maxTasks: 32, maxContextBytes: 32768, ...config,
    budgets: { pressureBasis: 'window', thresholdRatio: 0.8, retainRatio: 0.16,
      summaryMaxTokens: 8192, compactionRetries: 1, maxOverflowRetries: 1,
      ...(maxTimeout === false ? {} : { ptcTimeoutMs: Math.min(600000, maxTimeout), ptcMaxTimeoutMs: maxTimeout }),
      ...config.budgets,
    },
  }
}

export class BudgetSettings {
  constructor(private readonly settings: SettingsWriter, private readonly scope: Pick<SettingsScope<Configuration>, 'get'>,
    private readonly ptcCeiling: () => number | false, private readonly key: string = namespace,
    private readonly defaults: () => Configuration = () => ({})) {}

  read(): BudgetSettingsSnapshot {
    const descriptor = this.settings.describe({ redactSecrets: true }).find(row => row.ns === this.key)
    if (!descriptor) throw new Error('Super Code budget settings are unavailable')
    return { configuration: structuredClone(this.scope.get()), revision: descriptor.revision,
      writable: this.settings.writable, ptcMaxTimeoutMs: this.ptcCeiling(), defaults: structuredClone(this.defaults()) }
  }

  async save(content: string, expected: string): Promise<BudgetSettingsResult> {
    if (!this.settings.writable) return { ok: false, error: 'read-only' }
    let config: Configuration
    try {
      if (content.length > 4096) throw new Error('Configuration is too large')
      config = validateConfiguration(JSON.parse(content))
    } catch { return { ok: false, error: 'invalid' } }
    const budgets = config.budgets
    if (budgets?.ptcTimeoutMs !== undefined || budgets?.ptcMaxTimeoutMs !== undefined) {
      const ceiling = this.ptcCeiling()
      if (ceiling === false) return { ok: false, error: 'ptc-unavailable' }
      if ((budgets.ptcTimeoutMs ?? 0) > ceiling || (budgets.ptcMaxTimeoutMs ?? 0) > ceiling) return { ok: false, error: 'ptc-ceiling' }
    }
    return this.replace(config, expected)
  }

  async reset(expected: string): Promise<BudgetSettingsResult> { return this.replace({}, expected) }

  private async replace(config: Configuration, expected: string): Promise<BudgetSettingsResult> {
    if (!this.settings.writable) return { ok: false, error: 'read-only' }
    if (!/^(0|[1-9]\d*)$/.test(expected) || !Number.isSafeInteger(Number(expected))) return { ok: false, error: 'invalid' }
    try {
      await this.settings.replace(this.key, config, Number(expected))
      return { ok: true, snapshot: this.read() }
    } catch (error) {
      return { ok: false, error: (error as { code?: string }).code === 'SETTINGS_CONFLICT' ? 'conflict' : 'save-failed' }
    }
  }
}

export class SuperCodeBudgets extends TypertRemoteService {
  constructor(ctx: Context, private readonly settings: BudgetSettings) { super(ctx, 'superCodeBudgets') }
  @Remote
  readConfig(): BudgetSettingsSnapshot { return this.settings.read() }
  @Remote
  saveConfig(content: string, expected: string): Promise<BudgetSettingsResult> { return this.settings.save(content, expected) }
  @Remote
  resetConfig(expected: string): Promise<BudgetSettingsResult> { return this.settings.reset(expected) }
}

export function applyBudgetSettings(ctx: Context, config: Configuration): void {
  const base = configurationValues(config)
  const hostDefaults = new BasicCompactionEngine(ctx.isolate('compaction'), { auto: false }).config
  const snapshots = new WeakMap<object, Configuration>()
  let timeout: { defaultMs: number; maxMs: number } | false = false
  let read = (): Configuration => configurationValues(config)
  const source = {
    get: (): Configuration => withLegacyBudgets(read(), timeout ? timeout.maxMs : false),
    forAgent(agent: object): Configuration {
      let snapshot = snapshots.get(agent)
      if (!snapshot) { snapshot = structuredClone(source.get()); snapshots.set(agent, snapshot) }
      return structuredClone(snapshot)
    },
  }
  ctx.provide('superCodeConfiguration', source)
  ctx.inject(['ptcRuntime'], ready => {
    const runtime = ready.get('ptcRuntime') as { timeout?: { defaultMs: number; maxMs: number } }
    timeout = runtime.timeout ?? false
    ready.effect(() => () => { timeout = false })
  })
  // Recent hosts retain a preset generation across Agents; plugin apply is not an Agent boundary.
  ctx.on('agent/created', ({ agent }) => { source.forAgent(agent) })
  ctx.inject(['settings'], owner => {
    const settings = owner.settings
    let key = namespace
    if (typeof settings.register === 'function') {
      const scope = settings.register(namespace, settingsConfigurationSchema, { base, validate: validateConfiguration })
      read = () => structuredClone(scope.get())
      owner.effect(() => () => { read = () => structuredClone(base) })
    } else {
      // SettingsForms edits this Loader entry's volatile values without remounting Agents.
      const forms = settings as unknown as { configure(options: { auto: boolean }, owner: typeof ctx.fiber): () => void }
      const entryId = ctx.fiber.entry?.options.id
      if (!entryId) throw new Error('Super Code budgets require a profile plugin entry')
      key = entryId
      owner.effect(() => forms.configure({ auto: false }, ctx.fiber))
    }
    new SuperCodeBudgets(owner, new BudgetSettings(settings, source, () => timeout ? timeout.maxMs : false, key, () => ({
      applyToOfficialPresets: false, maxTasks: 32, maxContextBytes: 32768,
      budgets: { pressureBasis: 'host', thresholdRatio: hostDefaults.thresholdRatio, retainRatio: hostDefaults.retainRatio,
        summaryMaxTokens: hostDefaults.maxTokens, compactionRetries: hostDefaults.compactionRetries,
        maxOverflowRetries: hostDefaults.maxOverflowRetries,
        ...(timeout ? { ptcTimeoutMs: timeout.defaultMs, ptcMaxTimeoutMs: timeout.maxMs } : {}),
      },
    })))
  })
}
