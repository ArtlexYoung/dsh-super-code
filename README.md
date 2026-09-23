# dsh-super-code

一个更快、更节省、更聪明的 DeepSeek Harness 编码插件。它会根据任务选择调研、设计、开发、验证和优化方法：简单任务直接完成，复杂任务按需组织工作。

A faster, more efficient, smarter coding plugin for DeepSeek Harness. It selects research, design, development, verification, and optimization methods to fit the task: straightforward work stays simple, while complex work is coordinated as needed.

在选定的 SWE-bench Pro hard-100 评测中，`0.1.2` 相比 DSH minimal 平均回答耗时减少约 38%，每题输入 token 减少约 14%，正确率提高 8 个百分点。[评测方法与完整结果](docs/EvaluationResults.md)

On the selected SWE-bench Pro hard-100 tasks, `0.1.2` reduced average response time by about 38% and input tokens per task by about 14% versus DSH minimal, while accuracy increased by 8 percentage points. [Methods and full results](docs/EvaluationResults.md)

## 开始使用 · Get Started

需要 DeepSeek Harness 0.1.5-alpha.1 或更高版本。三步就能开始：

You'll need DeepSeek Harness 0.1.5-alpha.1 or later. To get started:

1. **安装插件：** 在 `dsh-market` 搜索 `dsh-super-code`，或运行下面的命令。

   **Install the plugin:** Search for `dsh-super-code` in `dsh-market`, or run:

   ```bash
   dsh plugin --profile web add dsh-super-code
   ```

2. **选中预设：** 打开 Harness“设置”→“Agent 预设”，选择 `super-code`。

   **Select the preset:** In Harness, open “Settings” → “Agent Presets” and select `super-code`.

3. **开始对话：** 新建会话，直接描述你要完成的编码任务。

   **Start a conversation:** Open a new conversation and describe the coding task you want done.

没看到 `super-code`？打开“设置”→“插件”→“插件配置”→ **Super Code** 查看状态并手动安装。标识符已被占用时可换一个，不会覆盖已有预设。[排查与预设管理](docs/UsageGuide.md)

Can't find `super-code`? Open “Settings” → “Plugins” → “Plugin configuration” → **Super Code** to check its status and install it manually. If the identifier is taken, choose another; existing presets are left untouched. [Troubleshooting and preset management](docs/UsageGuide.md)

[![Super Code 配置入口 · Super Code settings](docs/images/preset-settings-preview.png)](docs/images/preset-settings.png)

模型、推理等级、权限和工具沿用 Harness 的设置；子 Agent 默认继承父 Agent 的模型选择，不用再配置一套。

Models, reasoning effort, permissions, and tools come from Harness. Child Agents inherit the parent Agent's model choice by default, so there's no second set of settings to manage.

任务开始后，可以在右侧 Agent 执行树查看每个 Agent 的状态与用量。拖动空白处平移，滚轮或按钮缩放；点一个节点，就能在侧栏标签中查看详情。[界面说明](docs/UsageGuide.md)

Once a task is running, the Agent tree on the right shows each Agent's status and usage. Drag empty space to pan, zoom with the wheel or buttons, and click a node to see its details in a sidebar tab. [Interface guide](docs/UsageGuide.md)

[![Agent 执行树 · Agent execution tree](docs/images/agent-tree-preview.png)](docs/images/agent-tree.png)

## 效果 · Results

这组成绩来自选定的 SWE-bench Pro hard-100，使用 `deepseek-v4.1-flash`、`high` 推理等级、原生 DSH Web RPC 和官方评分器。两组都完成了 100/100 题评分。

These results come from the selected SWE-bench Pro hard-100 tasks, using `deepseek-v4.1-flash`, `high` reasoning, native DSH Web RPC, and the official grader. Both runs received scores for all 100 tasks.

| 指标 / Metric | DSH minimal | super-code 0.1.2 | 变化 / Change |
|---|---:|---:|---:|
| 正确率 / Accuracy | 41% | **49%** | **+8 个百分点 / +8 pp** |
| 平均模型调用/题 / Model calls per task | 124.85 | 99.78 | -20.1% |
| 平均输入 token/题 / Input tokens per task | 11,477,170 | 9,840,383 | -14.3% |
| 平均回答耗时 / Response time | 25.69 分钟 / min | 16.01 分钟 / min | -37.7% |

两次运行使用不同的 Harness 提交，不能将全部差异归因于插件。完整指标、回退题目、统计口径和逐题证据见[评测文档](docs/EvaluationResults.md)。

The runs used different Harness commits, so not every difference can be attributed to the plugin. See the [evaluation details](docs/EvaluationResults.md) for all metrics, regressions, calculation methods, and per-task evidence.

[使用说明 · Usage guide](docs/UsageGuide.md) · [评测详情 · Evaluation details](docs/EvaluationResults.md) · [版本记录 · Changelog](docs/Changelog.md)
