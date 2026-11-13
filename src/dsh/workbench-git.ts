import { realpath } from 'node:fs/promises'
import { relative, isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { GitRepository } from '../workbench/git/repository.js'
import type { GitResult } from '../workbench/git/request.js'

export interface GitSource { id: string; parent: string | null; name: string; files: string[]; partial: boolean }
export type WorkbenchGitResult = GitResult & { sources?: GitSource[] }

export class WorkbenchGit {
  private readonly repositories = new Map<string, GitRepository>()
  constructor(private readonly ctx: Context) {}

  async execute(session: Session, input: unknown, policy: SandboxExecutionPolicy | undefined, signal: AbortSignal): Promise<WorkbenchGitResult> {
    if (!session.header.cwd) throw new Error('WORKBENCH_WORKSPACE')
    const target = await this.ctx.fs.resolve(session.header.cwd, { signal })
    const directory = this.ctx.fs.processPath(target), canonical = await realpath(directory)
    if (this.ctx.fs.processPathFromHostPath && this.ctx.fs.processPathFromHostPath(canonical) !== canonical) throw new Error('WORKBENCH_GIT_LOCAL')
    let repository = this.repositories.get(canonical)
    if (!repository) {
      repository = new GitRepository(canonical, 'git', async (argv, policy, signal) => {
        const sandbox = this.ctx.get('sandbox')
        if (!sandbox || typeof sandbox.confine !== 'function' || policy.mode === 'danger-full-access') throw new Error('WORKBENCH_GIT_SANDBOX')
        // 旧宿主同步返回，新宿主异步准备沙箱；两者使用同一调用入口。
        const method = sandbox.confine.bind(sandbox)
        const confine: (argv: readonly string[], policy: Parameters<typeof method>[1], signal?: AbortSignal) => ReturnType<typeof method> = method
        return (await confine(argv, { ...policy, mode: policy.mode }, signal)).argv
      })
      this.repositories.set(canonical, repository)
    }
    const result = await repository.execute(input, policy, signal)
    if (result.kind !== 'state') return result
    return { ...result, sources: this.sources(canonical) }
  }

  private sources(root: string): GitSource[] {
    const result: GitSource[] = []
    for (const session of this.ctx.sessions.list()) {
      if (!session.header.cwd) continue
      const facts = this.ctx.sessionProjections.stateOf(session, 'superCodeFeedback')
      if (!facts) continue
      const files = facts.files.map(file => relative(root, file.path).replaceAll('\\', '/'))
        .filter(file => file !== '..' && !file.startsWith('../') && !isAbsolute(file))
      if (files.length) result.push({ id: session.id, parent: session.header.parentSession || null,
        name: session.header.agentPreset || session.id.slice(0, 8), files, partial: facts.omittedFiles > 0 })
    }
    return result
  }
}
