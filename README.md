# dsh-super-code

一个更快、更节省、更聪明的 DeepSeek Harness 编码插件。它会根据任务选择调研、设计、开发、验证和优化方法：简单任务直接完成，复杂任务按需组织工作。

A faster, more efficient, smarter coding plugin for DeepSeek Harness. It selects research, design, development, verification, and optimization methods to fit the task: straightforward work stays simple, while complex work is coordinated as needed.

在选定的 SWE-bench Pro hard-100 评测中，`0.1.2` 相比 DSH minimal 平均回答耗时减少约 38%，每题输入 token 减少约 14%，正确率提高 8 个百分点。[评测方法与完整结果](docs/EvaluationResults.md)

On the selected SWE-bench Pro hard-100 tasks, `0.1.2` reduced average response time by about 38% and input tokens per task by about 14% versus DSH minimal, while accuracy increased by 8 percentage points. [Methods and full results](docs/EvaluationResults.md)

## 0.1.4 更新 · What's New in 0.1.4

适配 Harness 的两种预设机制：0.1.5/0.1.6 沿用目录安装，已验证的 0.1.7 版本通过插件 bundle 声明预设。设置页按宿主能力展示状态；新版不通过插件安装、重命名或重装用户目录副本。

Supports both Harness preset mechanisms: directory installation on 0.1.5/0.1.6 and bundle declarations on the verified 0.1.7 versions. Settings reflect host capabilities; the newer path does not install, rename, or reinstall user-directory copies through this plugin.

七个指定版本的隔离 Web/CLI 冒烟通过，覆盖 `0.1.5-rc.3`、`0.1.6-alpha.1`、`0.1.6-alpha.2`、`0.1.7-alpha.1`、`0.1.7-alpha.2`、`0.1.7-rc.1`、`0.1.7-rc.2`。验证固定宿主依赖并使用本地确定性模型，不代表原生 Desktop、真实模型或所有升级场景都已通过。[兼容矩阵与限制](docs/Compatibility.md) · [版本记录](docs/Changelog.md)

Isolated Web/CLI smoke checks passed on seven specified versions: `0.1.5-rc.3`, `0.1.6-alpha.1`, `0.1.6-alpha.2`, `0.1.7-alpha.1`, `0.1.7-alpha.2`, `0.1.7-rc.1`, and `0.1.7-rc.2`. Checks pin host dependencies and use a local deterministic model; they do not establish native Desktop, live-model, or complete upgrade compatibility. [Matrix and limitations](docs/Compatibility.md) · [Changelog](docs/Changelog.md)

下方性能数据仍属于 `0.1.2`，不是 `0.1.4` 的新一轮模型效果评测。

The performance figures below remain results for `0.1.2`, not a new model-quality evaluation of `0.1.4`.

## 开始使用 · Get Started

需要 Node.js 22 或更高版本，以及上述已验证的 DeepSeek Harness 版本。其他版本不能仅凭依赖范围视为已验证。三步就能开始：

Use Node.js 22 or later with one of the verified DeepSeek Harness versions above. A dependency range alone does not establish that another version has been tested. To get started:

1. **安装插件：** 在 `dsh-market` 搜索 `dsh-super-code`，或运行下面的命令。

   **Install the plugin:** Search for `dsh-super-code` in `dsh-market`, or run:

   ```bash
   dsh plugin --profile web add dsh-super-code@0.1.4
   ```

2. **选中预设：** 打开 Harness“设置”→“Agent 预设”，选择 `super-code`。

   **Select the preset:** In Harness, open “Settings” → “Agent Presets” and select `super-code`.

3. **开始对话：** 新建会话，直接描述你要完成的编码任务。

   **Start a conversation:** Open a new conversation and describe the coding task you want done.

没看到 `super-code`？先确认插件已启用，再在“设置”→“插件”→“插件配置”→ **Super Code** 查看状态。0.1.5/0.1.6 的可写用户目录支持手动安装及更换标识符；0.1.7 使用宿主声明式预设，不提供此目录安装流程，应检查插件加载与预设依赖。[按宿主排查与预设管理](docs/UsageGuide.md)

Can't find `super-code`? Confirm the plugin is enabled, then check **Super Code** under “Settings” → “Plugins” → “Plugin configuration”. On 0.1.5/0.1.6, a writable user directory supports manual installation and a different identifier. On 0.1.7, presets are declared through the host; check plugin loading and preset dependencies rather than using the directory-installation workflow. [Host-specific troubleshooting and preset management](docs/UsageGuide.md)

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
