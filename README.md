# dsh-super-agent

`dsh-super-agent` 是 DeepSeek Harness 的场景化 preset 和任务协议插件。
一个包提供四种工作方式：单人交付、团队协作、资料研究和性能优化。

## 为什么

不同任务需要不同的提示词和工具。把这些配置放在同一个插件中，可以统一版本和安装方式，使用时按 session 选择场景，不必为每个场景维护一套插件。

插件还提供一个轻量任务协议，用来记录任务树、负责人、执行尝试、提交、评审、返工、验收、交付和取消。事件以 JSONL 保存，便于重放和审计。

## 安装

在 DSH profile 中安装：

```bash
dsh plugin --profile web add dsh-super-agent
```

插件会自动注册 preset 目录和 `super-agent` 服务。宿主仍负责模型、sandbox、审批、持久化和网络权限。

`team` 需要宿主提供 subagent/jobs；`research` 的联网能力需要宿主提供 web backend。插件不会自行创建模型或绕过权限策略。

编程任务可以使用根入口提供的 `runProgrammingWorkflow`。宿主传入 `generate` 和 `verify` 回调：默认 `planning: 'auto'`，简单任务直接生成可验收草稿，复杂任务先生成一次分析；草稿验收失败后才进入有界修复，并把压缩后的测试反馈传给下一次调用。也可以显式设置 `planning: 'separate'` 或 `planning: 'skip'`。token、工具调用和修复次数都可以设置预算，模型和测试环境仍由宿主决定。

`verify` 可以返回 `repairHint` 提供短的结构化修复契约（例如必需的函数签名）；workflow 会把它和有界诊断一起传给下一轮，避免模型从冗长日志中猜测接口。
如果连续修复收到完全相同的契约和诊断，默认会停止并返回 `failed`，避免在没有新证据时重复消耗模型调用；可通过 `stopOnRepeatedFeedback: false` 关闭。该策略也可在 Cordis profile/page settings 中配置。

非编程的连续对话可使用 `runConversationWorkflow`。它按 turn 调用宿主模型，并在历史超过 `maxHistoryChars` 时保留首轮 user、最近 assistant 和当前 user，避免把完整旧日志重复发送。长会话可设置 `retainGenerations: false`，不在内存中保留每一轮完整输出。

发布判断可使用 `evaluateReleaseGate`，默认要求候选正确率至少提升 10 个百分点、总 token 至少减少 10%，且耗时不增加；任一条件不满足都会返回 `accepted: false`。
多次独立 matched run 可先用 `aggregateEvaluationRuns` 聚合，再交给 release gate，避免一次 max 推理随机结果影响判断。

如果使用 Cordis 服务，也可以调用 `ctx.superAgent.programmingWorkflow(...)`；两种入口共享同一实现。服务配置中的 `maxRepairAttempts`、`maxFeedbackChars`、`maxInputTokens`、`maxOutputTokens`、`maxTotalTokens`、`maxToolCalls` 和 `timeoutMs` 可由 profile/page settings 调整，单次调用可以覆盖这些默认值。

## 选择 preset

| preset | 用途 |
| --- | --- |
| `solo` | 单 Agent 完成交付任务 |
| `team` | 拆分任务、分配 owner、并行执行和评审 |
| `research` | 收集来源、核对事实、记录不确定性 |
| `optimization` | 建立 baseline、做受控实验并记录指标 |

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
presets/{solo,team,research,optimization}/agent.cordis.yml
src/core/                 # 任务协议、任务图、调度和账本
src/dsh/                  # Cordis 适配层
cordis.patch.yml          # DSH bundle patch
```
