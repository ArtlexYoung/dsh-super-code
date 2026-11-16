import type { Context } from '@deepseek-ai/cordis'
import { configurationValues, settingsConfigurationSchema, validateConfiguration } from './budgets.js'
import type { Configuration } from './budgets.js'

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


export interface ConfigurationSource {
  get(): Configuration
  forAgent(agent: object): Configuration
  timeout(): { defaultMs: number; maxMs: number } | false
  namespace(): string
}

declare module '@deepseek-ai/cordis' { interface Context { superCodeConfiguration: ConfigurationSource } }

export function applyConfiguration(ctx: Context, config: Configuration): void {
  const base = configurationValues(config), snapshots = new WeakMap<object, Configuration>()
  let timeout: { defaultMs: number; maxMs: number } | false = false
  let read = (): Configuration => configurationValues(config)
  let key = 'super-code-budgets'
  const source: ConfigurationSource = {
    get: () => withLegacyBudgets(read(), timeout ? timeout.maxMs : false),
    forAgent(agent) {
      let snapshot = snapshots.get(agent)
      if (!snapshot) { snapshot = source.get(); snapshots.set(agent, snapshot) }
      return structuredClone(snapshot)
    },
    timeout: () => timeout,
    namespace: () => key,
  }
  ctx.provide('superCodeConfiguration', source)
  ctx.inject(['ptcRuntime'], ready => {
    const runtime = ready.get('ptcRuntime') as { timeout?: { defaultMs: number; maxMs: number } }
    timeout = runtime.timeout ?? false
    ready.effect(() => () => { timeout = false })
  })
  ctx.on('agent/created', ({ agent }) => { source.forAgent(agent) })
  ctx.inject(['settings'], owner => {
    const settings = owner.settings
    if (typeof settings.register === 'function') {
      const scope = settings.register(key, settingsConfigurationSchema, { base, validate: validateConfiguration })
      read = () => structuredClone(scope.get())
      owner.effect(() => () => { read = () => structuredClone(base) })
    } else {
      const forms = settings as unknown as { configure(options: { auto: boolean }, owner: typeof ctx.fiber): () => void }
      const entryId = ctx.fiber.entry?.options.id
      if (!entryId) throw new Error('Super Code budgets require a profile plugin entry')
      key = entryId
      owner.effect(() => forms.configure({ auto: false }, ctx.fiber))
    }
  })
}
