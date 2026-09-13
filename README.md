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
import { TaskGraph } from 'dsh-super-agent'

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
