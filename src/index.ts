/** Package-root registration lets Harness discover the browser contribution. */
import type { Context } from '@deepseek-ai/cordis'
import { configurationSchema } from './dsh/budgets.js'
import type { Configuration } from './dsh/budgets.js'

export const Config: typeof configurationSchema = configurationSchema

const harnessPlugin: { readonly name: string; readonly inject: readonly string[]; readonly Config: typeof Config; readonly apply: (ctx: Context, config?: Configuration) => Promise<void> } = {
  name: 'super-code',
  inject: [],
  Config,
  async apply(ctx, config = {}) {
    const adapter = await import('./dsh/index.js')
    await adapter.apply(ctx, config)
  },
}

export default harnessPlugin

export * from './core/teams.js'
export * from './core/guidance.js'
export * from './core/task-memory.js'
export * from './core/delegation.js'
export * from './core/tool-evidence.js'
