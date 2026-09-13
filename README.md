# dsh-super-agent

`dsh-super-agent` 是 DeepSeek Harness 的场景 preset 和任务协议包。一个 npm 包提供四个可按 session 选择的 preset，以及一套可被宿主调用的 TypeScript 任务域：任务树、负责人、attempt、提交、review、验收、交付、取消确认、证据和实验指标都使用可重放的 JSONL 事件表示。

## 安装和装配

```bash
dsh plugin --profile my-profile add dsh-super-agent
```

包内的 `cordis.patch.yml` 做两件事：把 `presets/` 加入 `dsh-agent-presets` 的 system roots，并注册一个名为 `ctx.superAgent` 的轻量服务。该服务只管理显式创建的 task workspace，不创建 Agent、不启动模型、不授予 shell/web 权限。模型、sandbox、approval、持久化和官方 subagent/jobs provider 仍由 Harness profile 负责。

如果 profile 没有 `agent-presets`，先在宿主 composition 中装配它，再把本包的 `presets` 目录加入 roots。也可以只装配任务服务：

```yaml
- id: super-agent
  name: dsh-super-agent/dsh
  config:
    maxTasks: 256
    maxDepth: 32
    maxConcurrent: 8
    timeoutMs: 0
    stopGraceMs: 100
```

所有配置都在加载时校验。`timeoutMs: 0` 表示由调用方或 executor 自己决定超时；大于零时，Dispatcher 在期限到达后把未确认停止的 attempt 记录为 `stop_unknown`。`stopGraceMs` 是取消信号发出后等待 executor 提交停止证据的上限。

## 四个 preset

| preset | 用途 | 默认提示和工具边界 |
| --- | --- | --- |
| `solo` | 单 Agent 交付 | 目标、文件、命令、验证；不加载多 Agent 调度 |
| `team` | 负责人式协作 | 任务拆分、owner、依赖、并行派发、review/rework/交付；复用 Harness 官方 subagent 和 jobs |
| `research` | 可复核资料研究 | 查询计划、原始来源、URL 去重、反例和不确定性 |
| `optimization` | 可重复实验迭代 | baseline、单变量假设、匹配 workload、指标账本、回滚和停止条件 |

preset 是 session 级组合，同一个进程可以选择不同场景。默认只挂载 `solo`；选择 `team`、`research` 或 `optimization` 不会把其它场景的工具全部暴露给当前 session。

`team` 的多 Agent 创建仍需要宿主装配对应的 in-process subagent provider。`research` 的 web 工具仍需要宿主的 `dsh-web` 和搜索/抓取 backend。缺少宿主能力时，Harness 会报告依赖不可用，不会由本包伪造结果。

## 任务协议

纯领域 API 位于 `dsh-super-agent` 根导出，也可以从 `dsh-super-agent/core/task-graph` 等子路径导入。根入口只加载无宿主依赖的 core，不导入 Cordis 或 Schemastery，因此可在 Node 单元测试、宿主适配器和离线评测中复用。需要挂载到 Harness 时使用 `dsh-super-agent/dsh`；该子路径才会加载可选的 Cordis/Schemastery peer。

```ts
import { TaskGraph } from 'dsh-super-agent'

const graph = new TaskGraph([
  { taskId: 'compile', title: 'Compile', acceptance: ['tests pass'] },
  { taskId: 'package', title: 'Package', dependencies: ['compile'], acceptance: ['archive exists'] },
])

const running = graph.startTask('compile')
graph.completeTask(running.taskId, running.attemptId!, { ok: true }, [
  { artifactId: 'build', uri: 'memory:build', digest: '<sha256>' },
])
graph.submitTaskResult('compile', 'submit-1')
graph.recordReview('compile', {
  reviewId: 'review-1', reviewerId: 'reviewer', independent: true,
  outcome: 'passed', report: { passed: true }, findings: [],
  reviewedAt: new Date().toISOString(),
})
graph.acceptTask('compile', undefined, 'accept-1')

// Only the accepted version satisfies `package`'s dependency.
const next = graph.startTask('package')
```

生命周期有意分开：运行完成不会自动验收，review 通过不会自动交付，失败 attempt 不会隐式回到 ready。要重试必须显式调用 `returnForRework()`，这会保留旧 attempt 并让下一次 `startTask()` 获得新的 attempt id。依赖在启动时绑定上游的 accepted submission 和 artifact digest；上游返工后，旧绑定自动失效。

每次改变都会追加带完整任务快照的版本化事件：

```ts
const jsonl = graph.toJSONL()
const restored = TaskGraph.fromEvents(graph.eventsSince())
```

同一个 request id 重放会返回同一结果；使用不同内容重用 request id 会得到结构化 `ProtocolError`。事件序号、任务 revision、状态迁移和依赖环在写入与重放时都会检查。正在运行的任务收到取消请求后处于 `stopping`，只有 executor 或宿主提交停止证据后才变为 `cancelled/stopped`；无法确认时记录 `failed/stop_unknown`，不会把迟到结果交付。

### Cordis 服务

适配层从 `dsh-super-agent/dsh` 导出 `SuperAgentService`，并通过 `ctx.superAgent.workspace(scope)` 创建一个显式 workspace：

```ts
const workspace = ctx.superAgent.workspace('release')
const task = workspace.graph.add({ taskId: 'verify', title: 'Verify' })
await workspace.dispatcher.runReady(
  () => 'worker-name',
  async (_task, signal) => {
    signal.throwIfAborted()
    return { result: { passed: true } }
  },
)
```

适配层不猜测 `ctx.agents` 的身份、不复制 Harness Agent Teams 的 roster/mailbox，也不自行写 session 数据库。宿主如果需要跨 session 持久化，可保存 `eventsSince()` 的 JSONL，并在恢复时显式调用 `TaskGraph.fromEvents()`；恢复中的 active attempt 会被标为 `stop_unknown`，不会自动重跑。

## Review、Research 和 Optimization

- `summarizeReviews()` 会按 artifact/location/结论规范化发现并去重。独立 reviewer 不足或结论冲突时返回 `inconclusive`，不会把执行者自检当独立审查。
- `ResearchLedger` 只记录调用方已经取得的来源；URL 会去掉追踪参数并规范化，缺少来源的 claim 不能标为已验证。它不执行网络请求。
- `OptimizationLedger` 要求匹配 workload、单一 changed factor 和 rollback ref。只有相同模型/上下文/工作负载下的真实 baseline/candidate 同时满足得分不下降且 total tokens 严格下降，决策才是 `stop`；mock/replay 结果只能是 `inconclusive`。

这些账本是纯内存对象。它们提供证据和摘要出口，但不宣称已经跑过 HumanEval、SWE-bench、真实硬件或真实模型评测。

## 兼容性和权限

- 当前包版本：`0.0.2`。
- 目标 Harness：`0.1.2-alpha.2` 或更新的 0.1.2 发行线；当前包对 `@deepseek-ai/dsh-agent-presets` 的依赖从 `0.1.2-alpha.2` 开始，npm lock 当前解析为 `0.1.2-rc.1`。pinned `cd5ef814`（runtime `0.1.2-alpha.1`）上的四个 preset 解析和 `deepseek-v4.1-flash` smoke 属于 0.0.1 历史基线，不作为当前包的完整兼容证明。
- 本包的 Cordis 适配器（`dsh-super-agent/dsh`）依赖宿主提供的 `@deepseek-ai/cordis ^4.0.2` 和 `@deepseek-ai/schemastery ^3.18.2`；两个 peer 对只使用根 core 的消费者保持 optional。
- 包不执行安装脚本，不写 API key、profile 路径或用户内容，不改变宿主的 sandbox、approval、网络和模型路由。
- `lib/` 是发布时的 JavaScript 和 declaration 产物；`src/`、测试、`eval/` 和 `.development/` 不进入 npm tarball。

## 开发和验证

```bash
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

`test/` 覆盖状态迁移、CAS、依赖验收版本、幂等事件、JSONL 重放、取消/超时、review 多样性、来源规范化和指标门禁。`eval/` 是被 `.gitignore` 忽略的本地评测工作区，数据集清单只保存公开来源和固定 revision。

发布前还应在目标 profile 中执行四个 preset 的 roster discovery、挂载和真实模型 smoke，并用相同模型、上下文上限、任务集和工具策略做 baseline/candidate 对照。没有真实结果时，报告必须标记为 `mock` 或 `replay`，不能据此声称 token 或质量提升。

## 目录

```text
presets/
├── solo/agent.cordis.yml
├── team/agent.cordis.yml
├── research/agent.cordis.yml
└── optimization/agent.cordis.yml
src/
├── core/                 # 无宿主依赖的协议、任务图、调度和账本
├── dsh/                  # 薄 Cordis service adapter
└── index.ts              # 稳定导出面
cordis.patch.yml         # preset root 和 ctx.superAgent 的统一入口
```

