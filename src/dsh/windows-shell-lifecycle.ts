import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

class ShellOwnershipPending extends Error {}

interface RuntimeOwnership {
  rootOf(agent: Agent): Agent
  namesOf(agent: Agent): { self: string; parent?: string }
}

function ownershipUnavailable(error: unknown): error is Error & { code: 'UNAUTHORIZED' } {
  return error instanceof Error && 'code' in error && error.code === 'UNAUTHORIZED'
}

function runtimeCreatorOf(subagents: RuntimeOwnership, agents: readonly Agent[], agent: Agent): Agent | false {
  const root = subagents.rootOf(agent)
  if (root === agent) return false
  const parent = subagents.namesOf(agent).parent
  for (const candidate of agents) {
    try {
      if (subagents.rootOf(candidate) === root && subagents.namesOf(candidate).self === parent) return candidate
    } catch (error) {
      // 其他尚未登记归属的 Agent 不参与直属创建者查找。
      if (!ownershipUnavailable(error)) throw error
    }
  }
  return false
}

/** 运行时归属与持久化会话来源、共享预设作用域不同。 */
export function creatorOf(ctx: Context, agent: Agent): Agent | false {
  const agents = ctx.get('agents')
  if (typeof agents?.isOwnedBy === 'function') {
    return agents.list().find(candidate => agents.isOwnedBy(agent.id, candidate)) ?? false
  }
  const subagents = ctx.get('subagents') as RuntimeOwnership | undefined
  if (typeof subagents?.rootOf !== 'function') return false
  try {
    return runtimeCreatorOf(subagents, agents?.list() ?? [], agent)
  } catch (error) {
    // rc.2 先发布子 Agent，再登记运行时归属；此时不能把它当作根节点。
    if (ownershipUnavailable(error)) {
      throw new ShellOwnershipPending(error.message, { cause: error })
    }
    throw error
  }
}

/** 创建阶段只暂缓尚未登记的归属，首次执行前必须完成初始化。 */
export function applyShellLifecycle(ctx: Context, install: (agent: Agent) => void | Promise<void>, prepend = false): void {
  ctx.on('agent/created', async ({ agent }) => {
    try { await install(agent) }
    catch (error) { if (!(error instanceof ShellOwnershipPending)) throw error }
  })
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    await install(agent)
    return next()
  }, prepend)
}
