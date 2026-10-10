# dsh-super-code

一个更快、更节省、更聪明的 DeepSeek Harness 编码插件。简单任务直接做，复杂任务按需组织专业 Agent；任务状态和有来源的经验可以留到后续对话，不必反复交代。

A faster, more efficient coding plugin for DeepSeek Harness. It handles straightforward tasks directly, brings in specialist Agents when useful, and keeps sourced knowledge available for later conversations.

在同一组 SWE-bench Pro hard-100 中，0.3.0 采用的 Batch.3 候选相比官方 minimal，平均回答耗时减少 **48%**、每题总 token 减少 **45%**、模型调用次数减少 **44.5%**，通过率从 **44% 提高到 54%**。[完整结果与限制](docs/EvaluationResults.md)

On the same SWE-bench Pro hard-100 set, the Batch.3 candidate adopted for 0.3.0 uses **48% less response time**, **45% fewer total tokens**, and **44.5% fewer model calls**, with **54% passing versus 44%** for official minimal. [Full results and limitations](docs/EvaluationResults.md)

## 0.3.1 · What's New

设置页始终展开，显示插件与当前预设的独立版本，并提示版本不一致或旧预设未记录版本。目录式和 DSH NEXT 等声明式宿主均提供安装、确认重装、改名及恢复备份，默认名称和描述跟随中英文切换。[版本检查与更新](docs/UsageGuide.md#查看预设版本--checking-the-preset-version)

The settings page stays expanded, shows independent plugin and preset versions, and flags mismatched or unrecorded versions. Directory and declarative hosts such as DSH NEXT support installation, confirmed reinstallation, renaming and recovery backups. Default names and descriptions follow Chinese/English language changes. [Version checks and updates](docs/UsageGuide.md#查看预设版本--checking-the-preset-version)

本版本已逐版验证 Harness `0.1.5-alpha.1`～`0.2.1-alpha.2` 的 15 个官方 Web/CLI 版本；原生桌面范围和限制见[兼容矩阵](docs/Compatibility.md)。

This version verifies 15 official Web/CLI versions from Harness `0.1.5-alpha.1` through `0.2.1-alpha.2`; see the [matrix](docs/Compatibility.md) for native Desktop coverage and limits.

## 0.3.0 · What's New

- **批量工具调用：** 用 Harness 原生 PTC 在一次模型调用中组合多个操作，减少来回；独立读取可以并行，写入、测试和有依赖的操作依次执行，不用额外配置。
  **Batched tool calls:** Uses Harness-native PTC to compose several operations in one model call. Independent reads can overlap; writes, tests, and dependent operations run in order. No extra setup is needed.
- **保留记忆与界面：** 延续任务、项目和全局三层记忆、右侧执行树及记忆库；已适配 Harness `0.1.5-alpha.1`～`0.2.1-alpha.1`。具体版本和验收范围见[兼容矩阵](docs/Compatibility.md)。
  **Memory and interface:** Retains task, project, and global memory, the Agent tree, and the memory library, with adaptations for Harness `0.1.5-alpha.1`–`0.2.1-alpha.1`. See the [verified versions and scope](docs/Compatibility.md).

效果数据来自已完成 100 题评分的冻结 Batch.3 候选；整合后的 0.3.0 发布包另做功能回归，没有重新跑这 100 次模型任务。

Quality results come from the frozen Batch.3 candidate, which has scores for all 100 tasks. The integrated 0.3.0 package receives separate functional regression checks, not a fresh 100-task model run.

## 开始使用 · Get Started

需要 Node.js 22 或更高版本，以及[已验证的 Harness 版本](docs/Compatibility.md)。

Use Node.js 22 or later and a [verified Harness version](docs/Compatibility.md).

1. **安装：** 在插件市场搜索 `dsh-super-code`，或运行以下命令安装 npm 已发布版。

   **Install:** Search for `dsh-super-code` in the plugin marketplace, or install the published npm version:

   ```bash
   dsh plugin --profile web add dsh-super-code
   ```

   GitHub Release 中的 0.3.1 安装包可用 `dsh plugin --profile web add ./dsh-super-code-0.3.1.tgz` 安装。
   To install the 0.3.1 package from GitHub Releases, use `dsh plugin --profile web add ./dsh-super-code-0.3.1.tgz`.

2. **选中预设：** 打开“设置”→“Agent 预设”，选择 `super-code`。

   **Select the preset:** Open “Settings” → “Agent Presets” and choose `super-code`.

3. **开始对话：** 新建会话，描述你要完成的编码任务。模型、推理等级、权限和工具沿用 Harness 的设置；子 Agent 默认继承父 Agent 的模型，不用另配模型池。

   **Start a conversation:** Open a new session and describe the task. Models, reasoning effort, permissions, and tools come from Harness; child Agents inherit the parent's model by default.

没看到预设？在“设置”→ **Super Code** 查看状态；旧插件版本的入口在“插件配置”中。[安装与排查](docs/UsageGuide.md)

Can't find the preset? Open “Settings” → **Super Code**. Older plugin versions place this under “Plugin configuration”. [Setup and troubleshooting](docs/UsageGuide.md)

[![Super Code 配置入口 · Super Code settings](docs/images/preset-settings-preview.png)](docs/images/preset-settings.png)

右侧执行树显示各 Agent 的状态、用量和缓存率。拖动平移、滚轮缩放；点节点查看详情，不切换主对话。右侧新标签页中的“记忆库”可以查看当前项目和全局偏好。[界面与记忆说明](docs/UsageGuide.md)

The Agent tree shows status, usage, and cache hit rate. Drag to pan, scroll to zoom, and click a node for details without leaving the main conversation. Open “Memory library” from the sidebar's new-tab page to view project knowledge and global preferences. [Interface and memory guide](docs/UsageGuide.md)

[![Agent 执行树 · Agent execution tree](docs/images/agent-tree-preview.png)](docs/images/agent-tree.png)

## 效果 · Results

同一组 100 题，均完成官方评分；评分环境异常已使用原补丁复核。时间不含官方评分，token 包含缓存输入，并不等于费用。

All five runs received official scores for the same 100 tasks. Grading anomalies were rechecked with the original patches. Time excludes grading; tokens include cache reads and are not a monetary cost estimate.

| 指标 / Metric | 官方 minimal | 0.0.9 | 0.1.2 | 0.2.0 分层记忆 | 0.3.0 Batch.3 |
|---|---:|---:|---:|---:|---:|
| 通过 / Passed | 44/100 | 48/100 | 52/100 | 52/100 | **54/100** |
| 平均耗时 / Minutes per task | 25.69 | 16.46 | 16.01 | 15.15 | **13.46** |
| 平均总 token / Tokens per task | 11,578,047 | 9,623,217 | 9,938,176 | 9,299,094 | **6,381,969** |
| 模型调用/题 / Model calls | 124.85 | 92.78 | 99.78 | 93.83 | **69.29** |

Batch.3 相比 0.2.0 新通过 8 题、回退 6 题，净增 2 题。这是已用于诊断的历史题集，各轮宿主版本也有差异，结果不能单独证明某一项改动的效果。[多维指标、逐题证据与统计口径](docs/EvaluationResults.md)

Batch.3 gains eight tasks and regresses on six against 0.2.0, for a net gain of two. This is a historically exposed diagnostic set, and host revisions differ between some runs; the results do not isolate any single change. [Detailed metrics, per-task evidence, and methodology](docs/EvaluationResults.md)

[使用说明 · Usage](docs/UsageGuide.md) · [兼容性 · Compatibility](docs/Compatibility.md) · [版本记录 · Changelog](docs/Changelog.md)
