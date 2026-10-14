# dsh-super-code

一个更快、更节省、更聪明的 DeepSeek Harness 编码插件。简单任务直接做，复杂任务按需组织专业 Agent；任务状态和有来源的经验可以留到后续对话，不必反复交代。

A faster, more efficient coding plugin for DeepSeek Harness. It handles straightforward tasks directly, brings in specialist Agents when useful, and keeps sourced knowledge available for later conversations.

在同一组 SWE-bench Pro hard-100 中，0.3.0 的评测候选相比官方 minimal，平均回答耗时减少 **48%**、每题总 token 减少 **45%**、模型调用次数减少 **44.5%**，通过率从 **44% 提高到 54%**。[完整结果与限制](docs/EvaluationResults.md)

On the same SWE-bench Pro hard-100 set, the evaluation candidate for 0.3.0 uses **48% less response time**, **45% fewer total tokens**, and **44.5% fewer model calls**, with **54% passing versus 44%** for official minimal. [Full results and limitations](docs/EvaluationResults.md)

# 1 版本与更新 · Versions and Updates

为保证版本效果，发布前需要进行大量测试和回归验证，耗时较久，因此更新周期可能较长。

Extensive testing and regression checks are needed to verify each release's effectiveness. This takes time, so release cycles may be longer.

版本号采用 **主版本.效果优化版本.维护版本**，例如 `0.3.3`：

Version numbers follow **major.performance-improvement.maintenance**, for example `0.3.3`:

| 位置 / Position | 含义 / Meaning |
|---|---|
| 第一位 / First (`0`) | 主版本，仅在大范围重构时调整。 / Major version; changes only for extensive refactoring. |
| 第二位 / Second (`3`) | 效果优化版本，记录编码效果、效率等方面的优化。 / Performance-improvement version; tracks improvements to coding results, efficiency, and related capabilities. |
| 第三位 / Third (`3`) | 维护版本，记录问题修复、UI 优化、兼容性适配等更新。 / Maintenance version; tracks bug fixes, UI improvements, compatibility updates, and similar changes. |

## 0.3.3 · What's New

统一执行树与记忆库侧栏，支持直接管理记忆，并改善执行树动画与布局。[更新详情](docs/Changelog.md)

Unifies the Agent tree and memory library in one sidebar, adds direct memory management, and improves tree animation and spacing. [Changelog](docs/Changelog.md)

## 0.3.2 · What's New

美化插件界面，提供更紧凑的执行树、对话式 Agent 详情和按主题组织的记忆库。[更新详情](docs/Changelog.md)

Refreshes the plugin UI with a compact Agent tree, chat-style Agent details, and a topic-based memory library. [Changelog](docs/Changelog.md)

## 0.3.1 · What's New

完善预设安装与重装，新增版本提示，并让默认名称和描述跟随中英文切换。[更新详情](docs/Changelog.md)

Improves preset installation and reinstallation, adds version notices, and keeps default names and descriptions in sync with Chinese/English settings. [Changelog](docs/Changelog.md)

## 0.3.0 · What's New

支持批量工具调用和并行读取，减少模型往返。[更新详情](docs/Changelog.md)

Adds batched tool calls and parallel reads to reduce model round trips. [Changelog](docs/Changelog.md)

# 2 开始使用 · Get Started

请使用[已验证的 Harness 版本](docs/Compatibility.md)，按所用客户端选择安装方式。

Use a [verified Harness version](docs/Compatibility.md) and choose the installation method for your client.

## 2.1 安装 · Install

### 官方桌面版 · Official Desktop

打开左侧 **插件 → 添加插件**，在“包名或地址”中输入 `dsh-super-code`，点击 **安装**，完成后按提示重新加载或重启。桌面版自带运行环境，无需另外安装 Node.js。

Open **Plugins → Add plugin**, enter `dsh-super-code` in “Package name or address”, and click **Install**. Reload or restart if prompted. The desktop app includes its runtime; no separate Node.js installation is needed.

### Web / 命令行版 · Web / CLI

需要 Node.js 22 或更高版本。通过 npm 安装 Harness，再添加插件；已有 `dsh` 命令时跳过第一行。

Requires Node.js 22 or later. Install Harness via npm, then add the plugin. Skip the first line if `dsh` is already installed.

```bash
npm install -g @deepseek-ai/dsh
dsh plugin --profile web add dsh-super-code
```

<details>
<summary>使用 Release 安装包（可选） · Install a Release package (optional)</summary>

从 [GitHub Releases](https://github.com/ArtlexYoung/dsh-super-code/releases) 下载 `.tgz` 包。桌面版在“包名或地址”中填入文件的完整路径；Web 版运行以下命令，将文件名替换为实际下载的版本。

Download a `.tgz` package from [GitHub Releases](https://github.com/ArtlexYoung/dsh-super-code/releases). On desktop, enter its full path in “Package name or address”. For Web, run the command below with the filename you downloaded.

```bash
dsh plugin --profile web add ./dsh-super-code-0.3.3.tgz
```

</details>

## 2.2 选中预设 · Select the Preset

打开 **设置 → Agent 预设**，选择 **Super Code 模式**（默认标识符 `super-code`）。

Open **Settings → Agent Presets** and choose **Super Code** (default identifier: `super-code`).

## 2.3 开始对话 · Start a Conversation

新建会话，描述你要完成的编码任务。模型、推理等级、权限和工具沿用 Harness 的设置；子 Agent 默认继承父 Agent 的模型，不用另配模型池。

Open a new session and describe the task. Models, reasoning effort, permissions, and tools come from Harness; child Agents inherit the parent's model by default.

没看到预设？在“设置”→ **Super Code** 查看状态；旧插件版本的入口在“插件配置”中。[安装与排查](docs/UsageGuide.md)

Can't find the preset? Open “Settings” → **Super Code**. Older plugin versions place this under “Plugin configuration”. [Setup and troubleshooting](docs/UsageGuide.md)

[![Super Code 配置入口 · Super Code settings](docs/images/preset-settings-preview.png)](docs/images/preset-settings.png)

右侧 **Super Code** 页面统一展示执行树与记忆库，默认展开执行区，点击标题切换。执行树显示各 Agent 的状态、用量和缓存率，支持平移、缩放和节点详情；记忆库可查看、新增、编辑和删除当前项目记忆及全局偏好。[界面与记忆说明](docs/UsageGuide.md)

The **Super Code** sidebar combines the Agent tree and memory library. The tree opens by default; click a section heading to switch. View Agent status, usage, and cache hit rate, pan and zoom, or open node details. Browse, add, edit, and delete project memories and global preferences in the library. [Interface and memory guide](docs/UsageGuide.md)

[![Agent 执行树 · Agent execution tree](docs/images/agent-tree-preview.png)](docs/images/agent-tree.png)

# 3 效果 · Results

当前版本迭代的效果优化均使用从 SWE-bench 官方 dev 集中筛选出的 **33 道有效困难题**；SWE-bench Pro hard-100 的 100 题用于候选冻结后的效果评测及 bug 排查，不参与效果调优。详见[评测口径与限制](docs/EvaluationResults.md)。

Current iterations are optimized on **33 valid difficult tasks selected from the official SWE-bench dev split**. The 100 SWE-bench Pro hard-100 tasks are used to evaluate frozen candidates and investigate bugs, not for performance tuning. See the [methodology and limitations](docs/EvaluationResults.md).

## 3.1 各版本成绩 · Version Results

同一组 100 题，均完成官方评分；评分环境异常已使用原补丁复核。时间不含官方评分，token 包含缓存输入，并不等于费用。

All five runs received official scores for the same 100 tasks. Grading anomalies were rechecked with the original patches. Time excludes grading; tokens include cache reads and are not a monetary cost estimate.

| 指标 / Metric | 官方 minimal | 0.0.9 | 0.1.2 | 0.2.0 | 0.3.0 |
|---|---:|---:|---:|---:|---:|
| 通过 / Passed | 44/100 | 48/100 | 52/100 | 52/100 | **54/100** |
| 平均耗时 / Minutes per task | 25.69 | 16.46 | 16.01 | 15.15 | **13.46** |
| 平均总 token / Tokens per task | 11,578,047 | 9,623,217 | 9,938,176 | 9,299,094 | **6,381,969** |
| 模型调用/题 / Model calls | 124.85 | 92.78 | 99.78 | 93.83 | **69.29** |

[多维指标、逐题证据与统计口径](docs/EvaluationResults.md)

[Detailed metrics, per-task evidence, and methodology](docs/EvaluationResults.md)

[使用说明 · Usage](docs/UsageGuide.md) · [兼容性 · Compatibility](docs/Compatibility.md) · [版本记录 · Changelog](docs/Changelog.md)
