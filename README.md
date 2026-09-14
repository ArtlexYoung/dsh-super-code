# dsh-super-agent

`dsh-super-agent` 是 DeepSeek Harness 的场景化 preset 和任务协议插件。
一个包提供“执行方式 × 工作场景”的组合：执行方式决定由一个 Agent 还是任务团队完成，工作场景决定交付、研究或优化时使用的验收纪律。

## 为什么

不同任务需要不同的执行方式、提示词和验收规则。把这些配置放在同一个插件中，可以统一版本和安装方式，使用时按 session 选择组合，不必为每个组合维护一套插件。

插件还提供一个轻量任务协议，用来记录任务树、负责人、执行尝试、提交、评审、返工、验收、交付和取消。事件以 JSONL 保存，便于重放和审计。

## 安装

在 DSH profile 中安装：

```bash
dsh plugin --profile web add dsh-super-agent
```

插件会自动注册 preset 目录和 `super-agent` 服务。宿主仍负责模型、sandbox、审批、持久化和网络权限。

## Harness 页面适配

Web client 通过 Harness 的公开 slots、Remote 和 session projection 接入四个页面能力：

- 对话输入栏模型控件左侧的 `Agent 预设` 选择器从 `agentPresets.list()` 动态读取 roster，并用 `agentPresets.select()` 切换当前仍为空白的会话；已开始首轮的会话遵循 Harness 组合不可变规则并显示拒绝原因。
- 设置 → 插件配置中的 `super-agent` 卡片读取 `session/modelCatalog`，按高/常规/低三个模型池勾选真实可路由模型，并为每个模型选择可用 reasoning strength。保存后写入 `super-agent` settings namespace，不依赖硬编码模型名称。
- 对话底部的 token 摘要读取 `superAgentUsage` projection，显示总量、平均缓存命中率、未缓存输入、缓存读取、输出以及按 provider/model 的明细；没有该投影时回退到 Harness 原生 `tokenUsage`。
- 右侧 Sidebar 的 `Agent 执行树` 使用 Session Controller 的 subagent catalog 和 `openSubagent` 地址导航，点击节点直接打开对应 Agent 的执行对话，不复制宿主的会话持久化。

模型池设置会真实影响 `ctx.superAgent.programmingWorkflow()` 和 `conversationWorkflow()`：分析/计划优先高智能池，常规草稿按任务复杂度选择低或常规池，修复和研究回到常规池；空池或不可用模型只向更高等级回退，绝不降级。选中的 strength 通过 workflow context 传给宿主模型适配器。模型调用返回的 usage 会同时进入服务汇总和 `superAgentUsage` 持久投影。

`team` 需要宿主提供 subagent/jobs；`research` 的联网能力需要宿主提供 web backend。插件不会自行创建模型或绕过权限策略。核心配置可通过 `executionMode`（`solo`、`team`、`auto`）和 `workScenario`（`delivery`、`research`、`optimization`）表达二维组合。

`optimization` 同时支持三种目标：`quality`（输出质量或正确率）、`performance`（延迟、token 或工具调用成本）和 `both`。默认是 `both`，保持质量不下降并要求成本下降；质量优化允许成本上升但必须达到质量门槛；性能优化要求质量不下降且至少改善一种成本指标。模型、基准和验收器由宿主传入。

编程任务可以使用根入口提供的 `runProgrammingWorkflow`。宿主传入 `generate` 和 `verify` 回调：默认 `planning: 'auto'`，简单任务直接生成可验收草稿，复杂任务先生成一次分析；草稿验收失败后才进入有界修复，并把压缩后的测试反馈传给下一次调用。也可以显式设置 `planning: 'separate'` 或 `planning: 'skip'`。token、工具调用和修复次数都可以设置预算，模型和测试环境仍由宿主决定。

未显式设置 `planning` 时，工作流会根据 profile 选择默认值：`solo × delivery`、`research` 和 `optimization` 使用复杂度自适应路径，简单任务直接生成草稿；`team × delivery` 默认先生成结构化分析，以便记录任务拆分和依赖。显式的 `planning` 选项始终优先。

`verify` 可以返回 `repairHint` 提供短的结构化修复契约（例如必需的函数签名）；workflow 会把它和有界诊断一起传给下一轮，避免模型从冗长日志中猜测接口。
如果连续修复收到完全相同的契约和诊断，默认会停止并返回 `failed`，避免在没有新证据时重复消耗模型调用；可通过 `stopOnRepeatedFeedback: false` 关闭。该策略也可在 Cordis profile/page settings 中配置。

连续对话可使用 `runConversationWorkflow`。它按 turn 调用宿主模型，并在历史超过 `maxHistoryChars` 时保留首轮 user、最近 assistant 和当前 user，避免把完整旧日志重复发送。工作流还会从 user turns 提取一个有界的 `contract` ledger，记录语言、接口、下标、复杂度和输出约束等原文片段；宿主可将 `context.contract.text` 放入请求上下文，帮助后续 turn 保持前轮约束，不需要额外模型调用。长会话可设置 `retainGenerations: false`，不在内存中保留每一轮完整输出。

发布判断可使用 `evaluateReleaseGate`，默认要求候选正确率至少提升 10 个百分点、总 token 至少减少 10%，且耗时不增加；任一条件不满足都会返回 `accepted: false`。
多次独立 matched run 可先用 `aggregateEvaluationRuns` 聚合，再交给 release gate，避免一次 max 推理随机结果影响判断。
如果要判断整个插件版本，使用 `evaluateScenarioBatchRelease`。它要求同一批结果同时包含 `solo`、`team`、`research` 和 `optimization`，并分别计算四个场景的门槛；任一场景缺失或未通过，整体结果都会是 `accepted: false`。

如果使用 Cordis 服务，也可以调用 `ctx.superAgent.programmingWorkflow(...)`；两种入口共享同一实现。服务配置中的 `maxRepairAttempts`、`maxFeedbackChars`、`maxInputTokens`、`maxOutputTokens`、`maxTotalTokens`、`maxToolCalls` 和 `timeoutMs` 可由 profile/page settings 调整，单次调用可以覆盖这些默认值。

## 选择 preset

| preset | 执行方式 × 工作场景 | 用途 |
| --- | --- | --- |
| `solo` | `solo × delivery` | 单 Agent 完成交付任务 |
| `team` | `team × delivery` | 拆分任务、分配 owner、并行执行和评审 |
| `research` | `auto × research` | 收集来源、核对事实、记录不确定性 |
| `optimization` | `auto × optimization` | 建立 baseline、按质量/性能/综合目标做受控实验 |

四个名称是兼容入口，不限制组合。需要陌生 API 资料时可以使用 `research` 场景并采用 team 执行；需要并行 benchmark 时可以使用 `optimization` 场景并采用 team 执行。宿主可以直接传入二维 profile：

编码任务如果只是实现或修复明确接口，四个场景都会优先返回可运行 artifact，避免把任务树、研究报告或未测量 benchmark 写进上下文；只有任务本身要求拆分、外部证据或性能/质量实验时，才展开对应纪律。

```ts
{ executionMode: 'team', workScenario: 'optimization', optimizationTarget: 'performance' }
```

创建 session 时传入 `agentPreset`：

```json
{
  "request": {
    "agentPreset": "team"
  }
}
```

## 使用任务协议

```ts
import { TaskGraph, runProgrammingWorkflow } from 'dsh-super-agent'

const graph = new TaskGraph([
  { taskId: 'build', title: 'Build', acceptance: ['tests pass'] },
  { taskId: 'release', title: 'Release', dependencies: ['build'] },
])

const attempt = graph.startTask('build')
graph.completeTask(attempt.taskId, attempt.attemptId!, { ok: true }, [])
graph.submitTaskResult('build', 'submit-1')
// 评审通过并验收后，release 才能启动。
```

根入口只依赖 TypeScript/Node，可用于测试和离线任务处理。需要挂载 Cordis 服务时使用 `dsh-super-agent/dsh`：

```ts
const workspace = ctx.superAgent.workspace('release')
```

任务状态不会自动跳过评审或验收；失败尝试也不会自动重跑。调用方可以通过 `eventsSince()` 导出事件，并用 `TaskGraph.fromEvents()` 恢复。

## 开发

```bash
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

测试覆盖状态迁移、并发、依赖、幂等、取消、超时、评审、研究来源和优化指标。

## 许可证

Apache License 2.0，见 [LICENSE](LICENSE)。

## 目录

```text
presets/{solo,team,research,optimization}/agent.cordis.yml  # 兼容组合入口
src/core/                 # 任务协议、任务图、调度和账本
src/core/scenario.ts      # 执行方式 × 工作场景和优化目标
src/dsh/                  # Cordis 适配层
cordis.patch.yml          # DSH bundle patch
```
