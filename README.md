# dsh-super-code

一个更快、更节省、更聪明的 DeepSeek Harness 编码插件。简单任务直接做，复杂任务按需组织专业 Agent；任务状态和有来源的经验可以留到后续对话，不必反复交代。

A faster, more efficient coding plugin for DeepSeek Harness. It handles straightforward tasks directly, brings in specialist Agents when useful, and keeps sourced knowledge available for later conversations.

在同一组 SWE-bench Pro hard-100 中，0.3.0 的评测候选相比官方 minimal，平均回答耗时减少 **48%**、每题总 token 减少 **45%**、模型调用次数减少 **44.4%**，通过率从 **44% 提高到 54%**。[完整结果与限制](docs/EvaluationResults.md)

On the same SWE-bench Pro hard-100 set, the evaluation candidate for 0.3.0 uses **48% less response time**, **45% fewer total tokens**, and **44.4% fewer model calls**, with **54% passing versus 44%** for official minimal. [Full results and limitations](docs/EvaluationResults.md)

# 1 版本与更新 · Versions and Updates

为保证版本效果，发布前需要进行大量测试和回归验证，耗时较久，因此更新周期可能较长。

Extensive testing and regression checks are needed to verify each release's effectiveness. This takes time, so release cycles may be longer.

版本号采用 **主版本.效果优化版本.维护版本**，例如 `0.3.4`：

Version numbers follow **major.performance-improvement.maintenance**, for example `0.3.4`:

| 位置 / Position | 含义 / Meaning |
|---|---|
| 第一位 / First (`0`) | 主版本，仅在大范围重构时调整。 / Major version; changes only for extensive refactoring. |
| 第二位 / Second (`3`) | 效果优化版本，记录编码效果、效率等方面的优化。 / Performance-improvement version; tracks improvements to coding results, efficiency, and related capabilities. |
| 第三位 / Third (`4`) | 维护版本，记录问题修复、UI 优化、兼容性适配等更新。 / Maintenance version; tracks bug fixes, UI improvements, compatibility updates, and similar changes. |

## 0.3.4 · What's New

补充官方预设评测结果，新增致谢表格与详细来源说明。[更新详情](docs/Changelog.md)

Adds official preset evaluation results, an acknowledgements table, and detailed source attribution. [Changelog](docs/Changelog.md)

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
dsh plugin --profile web add ./dsh-super-code-0.3.4.tgz
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

五组均完成同一批 100 题，使用 `high` 思考等级；评分环境异常已用原补丁复核。0.2.0 和 0.3.0 对应已评测的候选，耗时保留历史原始作答口径。

All five runs completed the same 100 tasks with `high` reasoning. Grading anomalies were rechecked with the original patches. Versions 0.2.0 and 0.3.0 refer to evaluated candidates; times retain the historical response-time convention.

| 指标 / Metric | 官方 minimal + high | 0.0.9 | 0.1.2 | 0.2.0 | 0.3.0 |
|---|---:|---:|---:|---:|---:|
| 通过 / Passed | 44/100 | 48/100 | 52/100 | 52/100 | **54/100** |
| 平均耗时（历史）/ Original minutes per task | 25.685 | 16.458 | 16.011 | 15.148 | **13.461** |
| 平均总 token / Total tokens per task | 11,578,046.900 | 9,623,216.520 | 9,938,176.210 | 9,299,093.840 | **6,381,968.850** |
| 缓存输入 token/题 / Cached input | 11,404,101.120 | 9,461,981.440 | 9,775,799.040 | 9,142,005.760 | 6,231,823.360 |
| 模型调用/题 / Model calls | 124.660 | 92.780 | 99.780 | 93.830 | **69.290** |

## 3.2 官方预设成绩 · Official Preset Results

截至 **2026-10-15 08:38（UTC+8）**，下表五组均已完成同一批 100 题。极简 + high 的净耗时和调用次数已按原始会话核算。

As of **October 15, 2026, 08:38 (UTC+8)**, all five runs below have completed the same 100 tasks. Minimal + high's net time and call counts have been audited against the original sessions.

| 指标 / Metric | 极简 minimal + high | 极简 minimal + max | 标准 standard + high | PTC + high | 创造 creative + high |
|---|---:|---:|---:|---:| ---: |
| 有效进度 / Valid scores | 100/100 | 100/100 | 100/100 | 100/100 | 100/100 |
| 通过/有效 / Passed / valid | 44/100 | 48/100 | 49/100 | 44/100 | 46/100 |
| 原始分钟/题 / Original minutes | 25.685 | 32.529 | 20.683 | 17.302 | 19.856 |
| 净分钟/题 / Net minutes | 25.122 | 32.009 | 18.826 | 15.122 | 18.714 |
| 模型调用/题 / Model calls | 124.660 | 138.920 | 92.370 | 71.160 | 93.600 |
| 总 token/题 / Total tokens | 11,578,046.900 | 14,966,097.260 | 8,854,513.910 | 6,238,434.510 | 9,292,949.400 |
| 缓存输入 token/题 / Cached input | 11,404,101.120 | 14,770,140.160 | 8,713,578.230 | 6,099,266.510 | 9,145,025.240 |
| 非缓存输入 token/题 / Uncached input | 73,068.830 | 79,357.380 | 58,114.810 | 61,668.140 | 60,262.050 |
| 输出 token/题 / Output | 100,876.950 | 116,599.720 | 82,820.870 | 77,499.860 | 87,662.110 |
| 缺少用量的请求 / Requests without usage | 3 | 11 | 4 | 5 | 2 |

标准 + max 已暂停（2 个有效结果，0 题通过），暂不纳入完整 100 题比较。

Standard + max is paused, with 2 valid results and 0 passes, and is excluded from the completed 100-task comparison.

创造保留官方预设与工具定义；评测隔离禁止 `cordis_run` 在宿主上执行动态代码，只读检查仍可使用。

Creative retains the official preset and tool definitions. Evaluation isolation blocks host-side dynamic execution through `cordis_run`; read-only inspection remains available.

净耗时扣除最终有效作答中的失败请求和重试等待；两种耗时均不含官方评分。调用次数排除已记录的失败请求。总 token = 缓存输入 + 非缓存输入 + 输出，输出含思考 token。未返回的用量不估算，表中数字不等于完整账单。历史宿主版本也有差异。

Net time excludes failed requests and retry waits within the final valid answer; neither time measure includes grading. Call counts exclude logged failed requests. Total tokens = cached input + uncached input + output, including reasoning. Missing usage is not estimated, so these figures are not a complete bill. Historical Harness revisions also differ.

[多维指标、逐题证据与统计口径](docs/EvaluationResults.md)

[Detailed metrics, per-task evidence, and methodology](docs/EvaluationResults.md)

[使用说明 · Usage](docs/UsageGuide.md) · [兼容性 · Compatibility](docs/Compatibility.md) · [版本记录 · Changelog](docs/Changelog.md)

# 4 致谢 · Acknowledgements

本项目认可 [LINUX DO](https://linux.do) 社区。

This project recognizes the [LINUX DO](https://linux.do) community.

感谢以下项目与资料。具体贡献、借鉴范围和许可证说明见[详细致谢文档](docs/Acknowledgements.md)。

Thanks to the projects and resources below. See the [detailed acknowledgements](docs/Acknowledgements.md) for contributions, design references, and license notes.

| 项目 / Reference | 类型与许可证 / Type and license | 贡献与借鉴 / Contribution and influence |
| --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 宿主 / Harness，MIT | Agent、会话、工具、PTC、Skill 与 Web / 桌面扩展接口 / Agents, sessions, tools, PTC, Skills, Web and desktop APIs |
| [ZCode](https://github.com/zai-org/ZCode) | UI 设计参考 / UI reference，Apache-2.0 | 紧凑布局、视觉层级、设置分组与交互状态 / Compact layouts, hierarchy, settings groups, interaction states |
| [Agent Skills](https://agentskills.io/specification) | 开放规范 / Open specification，Apache-2.0 | SKILL.md、元数据、参考目录与按需加载 / SKILL.md, metadata, resource directories, progressive disclosure |
| [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines) | 设计指南，官方文档条款 / Design guidance, documentation terms | 前端 Skill 的布局、操作负担与反馈原则 / Layout, ergonomic controls, feedback guidance for the frontend Skill |
| [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Web 无障碍标准，W3C 文档条款 / Accessibility standard, W3C document terms | 操作目标尺寸、间距与浏览器验证 / Target size, spacing, browser validation |
| [SWE-bench](https://github.com/SWE-bench/SWE-bench) | 评测代码 MIT；数据另见条款 / MIT code; separate data terms | dev 集有效困难 33 题的来源与评分基础 / Source and grading foundation for the 33 valid difficult dev tasks |
| [SWE-bench Pro](https://github.com/scaleapi/SWE-bench_Pro-os) | 评测代码 MIT；数据另见条款 / MIT code; separate data terms | 冻结候选的 hard-100 评测与 bug 排查 / Frozen-candidate hard-100 evaluation and bug investigation |
| [js-yaml](https://github.com/nodeca/js-yaml) / [Zod](https://github.com/colinhacks/zod) | 运行依赖 / Runtime dependencies，MIT | YAML 解析与数据校验 / YAML parsing and data validation |
