/** Package-root registration lets Harness discover the browser contribution. */
import type { Context } from '@deepseek-ai/cordis'

const harnessPlugin: { readonly name: string; readonly inject: readonly string[]; readonly apply: (ctx: Context) => Promise<void> } = {
  name: 'super-code',
  inject: [],
  async apply(ctx) {
    const adapter = await import('./dsh/index.js')
    await adapter.apply(ctx)
  },
}

export default harnessPlugin

export * from './core/teams.js'
export * from './core/guidance.js'
export * from './core/task-memory.js'
export * from './core/delegation.js'
export * from './core/tool-evidence.js'
