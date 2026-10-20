/** Fail-closed tool boundary for isolated SWE-bench Pro Agent runs. */

import { existsSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const FILE_TOOLS = new Set(['read', 'read_image', 'write', 'edit', 'glob', 'grep'])
const HOST_NETWORK_TOOLS = new Set(['web_fetch', 'web_search'])

function inside(root, target) {
  return target === root || target.startsWith(root + '/')
}

function nearestExisting(path) {
  let candidate = path
  while (!existsSync(candidate)) {
    const parent = dirname(candidate)
    if (parent === candidate) return candidate
    candidate = parent
  }
  return realpathSync.native(candidate)
}

export function guardToolCall(name, rawArguments, workspace, container) {
  const args = rawArguments !== null && typeof rawArguments === 'object' ? rawArguments : {}
  const root = realpathSync.native(resolve(workspace))
  if (!/^[a-z0-9_.-]+$/u.test(container)) {
    throw new Error('invalid SWE-bench evaluation container name')
  }
  if (HOST_NETWORK_TOOLS.has(name) || (typeof args.url === 'string' && /^https?:\/\//iu.test(args.url))) {
    return 'SWE-bench evaluation policy denied host network access outside the model provider path'
  }
  if (name === 'bash') {
    if (args.sandbox_permissions !== undefined || args.justification !== undefined
      || args.run_in_background === true) {
      return 'SWE-bench evaluation policy denied bash escalation or background execution'
    }
    if (typeof args.workdir === 'string') {
      const workdir = resolve(root, args.workdir)
      if (!inside(root, workdir) || !inside(root, nearestExisting(workdir))) {
        return 'SWE-bench evaluation policy denied a bash workdir outside the task workspace'
      }
    }
    const command = typeof args.command === 'string' ? args.command : ''
    const allowed = new RegExp(
      "^docker exec " + container + " bash -lc 'cd /app && [^'\\r\\n]+'$",
      'u',
    )
    return allowed.test(command)
      ? undefined
      : 'SWE-bench evaluation policy requires shell commands to run in the assigned offline task container'
  }
  if (!FILE_TOOLS.has(name)) return undefined
  const path = args.file_path ?? args.path ?? args.directory ?? '.'
  if (typeof path !== 'string') {
    return 'SWE-bench evaluation policy requires a string workspace path'
  }
  const target = resolve(root, path)
  if (!inside(root, target) || !inside(root, nearestExisting(target))) {
    return 'SWE-bench evaluation policy denied filesystem access outside the task workspace'
  }
  return undefined
}

export const name = 'swebench-evaluation-tool-guard'
export const inject = ['tools', 'agents']

export function apply(ctx) {
  const workspace = process.env.DSH_EVAL_WORKSPACE
  const container = process.env.DSH_EVAL_CONTAINER_NAME
  if (!workspace || !container) throw new Error('SWE-bench evaluation guard environment is incomplete')
  const guard = exec => guardToolCall(exec.name, exec.arguments, workspace, container)

  // The plain-context guard protects host-level calls. Agent scopes have their
  // own guard layer, so install the same fail-closed policy there as well.
  ctx.tools.guard(guard)
  const installed = new WeakSet()
  const install = agent => {
    if (installed.has(agent)) return
    installed.add(agent)
    agent.ctx.tools.guard(guard)
  }
  for (const agent of ctx.agents.list()) install(agent)
  ctx.on('agent/created', ({ agent }) => { install(agent) })
}
