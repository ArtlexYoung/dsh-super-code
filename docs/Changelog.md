# 版本记录 · Changelog

- **0.3.7 · 2026-10-24**：新增关闭、宽松、严格三档删除保护，默认宽松：提示优先使用可恢复的 `trash`，脚本中同样建议使用，用户明确要求时可用 `rm`；严格模式识别永久删除命令并逐次请求确认，官方预设另设开关且默认关闭。兼容旧布尔设置与 v4 日志。[删除保护](UsageGuide.md#删除保护--deletion-protection)
  **0.3.7 · 2026-10-24**: Adds Off, Relaxed, and Strict deletion protection, defaulting to Relaxed: prefer recoverable `trash`, including in scripts, while honoring explicit `rm` requests. Strict mode recognizes permanent-deletion commands and requests per-call approval; official presets opt in separately. Supports legacy boolean settings and v4 journals. [Deletion protection](UsageGuide.md#删除保护--deletion-protection)

  Super Code 侧栏新增只读任务状态并默认展开，从现有记录展示目标、步骤进度、动作和成功文件操作；Agent 名字只在任务根显示。任务、步骤、已加载动作全部展开，使用变高虚拟滚动，保留阅读位置、键盘导航和运行指示。保留原圆圈执行树与记忆库，三项互斥切换。任务状态不改提示词、模型请求、工具定义或执行行为；文件记录不等同完整 Git diff，缺失与截断明确提示。[任务状态](UsageGuide.md#任务状态--task-status)
  Adds a read-only Task status section, open by default, showing recorded objectives, step counts, activity, and successful file operations. Agent names appear only at task roots. All loaded tasks, steps, and activity stay expanded in a variable-height virtual list with reading-position retention, keyboard navigation, and running indicators. Preserves the circular Agent graph and memory library with exclusive section switching. Task status changes no prompts, model requests, tool definitions, or execution behavior. File records are not a complete Git diff; missing or bounded data is labeled. [Task status](UsageGuide.md#任务状态--task-status)

README 仅保留最近三个版本，完整记录见本页；[评测说明](EvaluationResults.md) 列出各组 DSH、插件与模型版本，以及 GLM 迁移和新版预算对照。

README shows the three most recent releases; this page retains the full history. The [evaluation report](EvaluationResults.md) identifies DSH, plugin, and model versions, with GLM transfer and newer-host budget comparisons.

- **0.3.6 · 2026-10-20**：排查发现新版 Harness 预算收紧后出现效果退化，因此增加插件内预算配置，并默认使用此前 Pro 测试中效果更好的旧预算，无需用户手动填写：按完整上下文窗口计算、80% 触发压缩、保留最近 16% 原文、摘要上限 8,192 Token，压缩追加尝试与溢出重试各 1 次，支持新版 PTC 的宿主默认执行时限和上限均为 600 秒。保留原有宿主默认值提示、用户自定义覆盖及运行中 Agent 的配置快照；旧宿主按能力禁用时限覆盖，始终遵守宿主时限上限。官方预设仍需手动开启应用。该修复不代表新增或改写历史评测成绩。[预算设置](UsageGuide.md#运行预算--runtime-budgets)
  **0.3.6 · 2026-10-20**: Investigation found regressions after newer Harness versions reduced their budgets. Adds in-plugin budget settings and defaults to the older budgets that performed better in the Pro tests, without manual setup: full-context-window accounting, compression at 80%, 16% recent verbatim retention, an 8,192-token summary cap, one additional compression attempt and one overflow retry, and 600-second default/maximum deadlines on hosts with the newer PTC provider. Preserves host-default hints, user overrides, and running Agents' configuration snapshots. Older hosts disable unsupported deadline overrides, and host ceilings always apply. Official presets remain opt-in. This fix does not add or revise historical evaluation scores. [Budget settings](UsageGuide.md#运行预算--runtime-budgets)

  设置页按“预设状态 / 上下文配置”分组，预算支持保存、恢复默认和并发编辑冲突检查；修复语言偏好尚未保存时提前重载导致语言回退的问题。完成 20 个 Web 版本、5 个官方 macOS arm64 Desktop 版本与 DSH NEXT 的兼容复验；[验证范围与限制](Compatibility.md)。
  Groups settings into Preset status / Context settings, with budget saving, reset, and concurrent-edit conflict checks. Fixes language changes being lost when the page reloads before the host saves the preference. Revalidated 20 Web versions, five official macOS arm64 Desktop versions, and DSH NEXT; [coverage and limits](Compatibility.md).

- **0.3.5 · 2026-10-18**：适配 Harness `0.2.1-rc.2`，修复 v4 日志迁移后旧任务记录不可见的问题，保留 `0.1.5-alpha.1` 起的兼容性，并补齐官方桌面安装说明。[验证范围](Compatibility.md)
  **0.3.5 · 2026-10-18**: Supports Harness `0.2.1-rc.2`, restores legacy task records after v4 log migration, retains support from `0.1.5-alpha.1`, and clarifies official Desktop installation. [Validation coverage](Compatibility.md)

- **0.3.4 · 2026-10-15**：补充官方预设在同一批 100 题上的成绩、用量与耗时核算说明；新增 README 致谢表格和[详细致谢文档](Acknowledgements.md)，说明宿主、界面设计、Skill、无障碍资料、评测项目与运行依赖的贡献和借鉴范围，并将文档纳入 npm 包。
  **0.3.4 · 2026-10-15**: Adds official preset results on the same 100 tasks, with usage and timing methodology. Adds a README acknowledgements table and [detailed acknowledgements](Acknowledgements.md) covering the host, UI design, Skills, accessibility resources, evaluation projects, and runtime dependencies; includes the document in the npm package.

- **0.3.3 · 2026-10-14**：执行树与记忆库合并为单个 Super Code 侧栏，默认展开执行区，两区互斥且始终保留一个展开；切换后保留树状态、筛选、搜索、阅读位置与草稿，记忆记录同页定位。记忆支持新增、编辑、取消、保存和确认删除，手动条目标明来源，只保留当前内容，失败保留输入并防止并发覆盖。保留圆形节点，增强运行环动画，修复节点光环、文字与连线重叠。内嵌按需加载的前端 Skill，覆盖布局对齐、操作舒适度、响应式、交互状态和浏览器验证；旧预设需要确认重装。整理双语安装、评测用途、版本规则及简短更新说明；[验证范围](Compatibility.md)。
  **0.3.3 · 2026-10-14**: Combines the Agent tree and memory library in one Super Code sidebar, with the tree open by default and exactly one section expanded. Switching preserves tree state, filters, search, reading position, and drafts; memory activity links open in the same page. Adds memory creation, editing, cancellation, saving, and confirmed deletion. Manual entries are labeled; only current content is stored, failed writes preserve input, and concurrent changes are protected. Retains circular nodes, makes running animation clearer, and fixes halo, label, and connector overlap. Bundles an on-demand frontend Skill for alignment, comfortable controls, responsive layout, interaction states, and browser validation; existing presets require confirmed reinstallation. Clarifies bilingual installation, evaluation methodology, version rules, and concise update notes; [validation scope](Compatibility.md).

- **0.3.2 · 2026-10-11**：统一预设设置、执行树和记忆库的视觉样式，保留圆形节点，紧凑工具栏显示“已收起”/“自动整理”名称；所有插件按钮使用上方名称气泡，历史时间/排序改为支持键盘操作的自定义下拉。Agent 详情按对话呈现用户消息、回复和可展开的真实工具调用/结果，兼容旧版与新版 journal，顶部额外信息按需展开。记忆库新增主题导航、筛选和同主题条目，精简中英文冗余文案。保留预设安装、版本提示、归属保护及重装备份；[验证范围](Compatibility.md)。
  **0.3.2 · 2026-10-11**: Refreshes preset settings, the Agent tree, and memory library while retaining circular nodes. Compact actions have visible Collapsed/Organize labels; plugin buttons show name bubbles above, and history filters use keyboard-accessible custom dropdowns. Agent details show user/reply roles and expandable real tool calls/results from old and new journals, with additional header information folded. Adds memory topic navigation, filtering, and related entries, and trims redundant bilingual copy. Preserves installation, version notices, ownership protection, and reinstall backups; [validation scope](Compatibility.md).
  修复新版侧栏聚焦导致下拉选项无法点击的问题；启动时等待宿主语言偏好加载，避免暂定浏览器语言触发预设重复同步与刷新。
  Fixes dropdown options closing before selection when newer sidebars take focus. Startup waits for the host language preference, preventing provisional browser locales from repeatedly synchronizing presets and reloading the page.

- **0.3.1 · 2026-10-10**：设置页始终展开，展示插件与当前预设的独立版本，提示不一致或未记录版本；声明式宿主新增安装、确认重装、改名、恢复备份及默认名称/描述语言同步。保留目录式安装、归属校验和自定义内容保护，允许新版宿主使用的 Cordis/Schemastery alpha 依赖。
  **0.3.1 · 2026-10-10**: Keeps settings expanded and shows independent plugin/preset versions with mismatch or unrecorded-version notices. Adds installation, confirmed reinstallation, renaming, recovery backups and default display-language synchronization on declarative hosts. Retains directory installation, ownership checks and custom display-field protection, and accepts the Cordis/Schemastery alpha dependencies used by newer hosts.
  修复原生桌面宿主管理 API 的解析位置，以及移除确认列表条目后 Escape 误关设置页的问题。逐版验证 15 个官方 Harness 版本（`0.1.5-alpha.1`～`0.2.1-alpha.2`）及可获取的四个 macOS arm64 Desktop 发行包；[验证范围与限制](Compatibility.md)。
  Fixes native Desktop management API resolution and Escape closing Settings after removing a confirmation row. Verifies 15 official Harness versions (`0.1.5-alpha.1`–`0.2.1-alpha.2`) and four available macOS arm64 Desktop releases; [verification scope and limits](Compatibility.md).

- **0.3.0 · 2026-10-09**：合入 Batch.3，用 Harness 原生 PTC 合并工具调用、并行独立读取，补齐批量调用中的 Agent 记忆使用记录，保留分层记忆及 0.2.1 的兼容适配，更新完整 100 题成绩和使用说明。
  **0.3.0 · 2026-10-09**: Integrates Batch.3 with Harness-native PTC for composed tool calls and parallel independent reads, adds per-Agent memory activity for nested calls, retains layered memory and 0.2.1 compatibility updates, and refreshes the complete 100-task results and usage guide.

- **0.2.1 · 2026-10-08**：逐版验证 Harness `0.2.0-rc.2` 与 `0.2.1-alpha.1`，扩展 peer 依赖范围，补齐根路径及 `/dsh`、`/super-code` 子路径的中英文展示资源，以适配新版插件元数据读取机制。安装、主/子 Agent、记忆、重启及 Safari 界面验收通过；alpha.1 原生 Desktop 尚未验收。[兼容范围与限制](Compatibility.md)
  **0.2.1 · 2026-10-08**: Verifies Harness `0.2.0-rc.2` and `0.2.1-alpha.1` individually, extends peer ranges, and exports Chinese/English display resources for the root, `/dsh`, and `/super-code` entries to support the new plugin metadata reader. Installation, main/child Agents, memory, restart, and Safari checks passed; native Desktop alpha.1 remains unverified. [Compatibility scope and limitations](Compatibility.md)

- **0.2.0 · 2026-09-30**：合入分层任务记忆，新增记忆库和每个 Agent 的记忆使用记录，tab 标题和界面文案跟随中英文切换，补齐 Harness 0.1.5-alpha.1 至 0.2.0-rc.2 的宿主兼容适配并完成官方 Desktop 原生窗口验收。
  **0.2.0 · 2026-09-30**: Integrates hierarchical task memory, adds the memory library and per-Agent memory activity, keeps tab titles and interface labels in sync with the Chinese/English language setting, and adapts the host boundary from Harness 0.1.5-alpha.1 through 0.2.0-rc.2, including checks in the official Desktop native window.

- **0.1.4**：适配 Harness 的目录与声明式预设机制：旧宿主保留目录安装，新宿主通过 bundle 声明 Super Code，设置页按宿主能力显示状态；声明式路径不提供目录副本安装、重命名、重装或名称语言同步。扩展 Harness peer 依赖范围，补齐中英文发布说明、使用指南及 npm 包内公开文档。`zod` 保留为运行时依赖，不内嵌其文件。
  Adapts directory and declarative Harness presets: older hosts retain directory installation, while newer hosts use a Super Code bundle declaration and capability-specific status. The declarative path does not install, rename, reinstall, or synchronize localized names for directory copies. Expands Harness peer dependency ranges and includes bilingual release notes, usage guidance, and public documentation in the npm package. `zod` remains a runtime dependency without bundling its files.
  已验证 `0.1.5-rc.3`、`0.1.6-alpha.1`、`0.1.6-alpha.2`、`0.1.7-alpha.1`、`0.1.7-alpha.2`、`0.1.7-rc.1`、`0.1.7-rc.2`；仅代表固定依赖的隔离 Web/CLI 与确定性模型冒烟，不代表原生 Desktop、外部模型、完整升级回归或新的 SWE-bench 成绩。[兼容范围与安装限制](Compatibility.md)
  Verified `0.1.5-rc.3`, `0.1.6-alpha.1`, `0.1.6-alpha.2`, `0.1.7-alpha.1`, `0.1.7-alpha.2`, `0.1.7-rc.1`, and `0.1.7-rc.2` in pinned, isolated Web/CLI smoke checks using a deterministic model—not native Desktop, external models, complete upgrade regression, or new SWE-bench results. [Compatibility scope and installation limitations](Compatibility.md)
- **0.1.3**：插件配置和预设的默认名称、描述跟随中英文语言设置；升级仅更新未被用户修改的字段。安装名称支持中文和空格。已安装副本可在确认清单后按新名称与标识符重装，旧目录保留恢复备份，并严格校验副本归属。[使用说明](UsageGuide.md)
  Plugin settings and default preset names and descriptions follow the Chinese/English interface language; upgrades update only untouched fields. Installation names support Chinese characters and spaces. Owned copies can be reinstalled with a new name and identifier after confirmation, while the old directory is retained as a recovery backup. [Usage guide](UsageGuide.md)
- **0.1.2**：优化按需专业指导、故障诊断与状态恢复验证，保留预设安装修复，最低支持 Harness 0.1.5-alpha.1。
  Improves on-demand guidance, failure diagnosis, and state recovery checks; retains the preset installation fix and supports Harness 0.1.5-alpha.1 or later.
- **0.1.1**：修复部分宿主安装后预设不可见的问题，新增可折叠的安装状态与自定义名称安装入口，兼容 Harness 0.1.5-rc.1。
  Fixes presets missing on some hosts after installation and adds a collapsible status panel with custom-name installation; supports Harness 0.1.5-rc.1.
- **0.1.0**：发布统一 Super Code 编码预设，提供多 Agent 执行树、任务记忆与用量展示。
  Introduces the unified Super Code coding preset, with an Agent tree, task memory, and usage display.
- **0.0.9**：包名改为 `dsh-super-code`，使用 Harness 原生任务记忆和按需专业指导，简化旧工作流并完善执行树状态。
  Renames the package to `dsh-super-code`, adopts Harness-native task memory and on-demand specialist guidance, simplifies earlier workflows, and improves Agent tree state.

更早版本以 `dsh-super-agent` 包名开发和发布；以下条目记录该项目的前身，不代表 `dsh-super-code` 曾以这些版本号发布。历史中没有 0.0.8 发布提交。

Earlier versions were developed and released as `dsh-super-agent`. The entries below describe that predecessor, not releases of the `dsh-super-code` package. The repository history has no 0.0.8 release commit.

- **0.0.7**：引入统一 Super Code 预设、Agent 执行图和精简任务上下文。
  Introduces the unified Super Code preset, Agent graph, and compact task context.
- **0.0.6**：完成统一预设的初版集成，改进编程任务规划与模型选择；Harness 包改为 peer dependencies。
  Integrates the first unified preset, improves programming planning and model selection, and declares Harness packages as peer dependencies.
- **0.0.5**：完成 Harness Web 适配、宿主界面集成和模型池路由，并让简单任务按需规划。
  Completes Harness Web adaptation, host UI integration, and model-pool routing, with adaptive planning for straightforward tasks.
- **0.0.4**：加入有界多轮任务上下文、验证失败修复提示与评测聚合，限制停滞修复和历史内存增长。
  Adds bounded multi-turn task context, verifier repair hints, and evaluation aggregation, while limiting stalled repairs and history growth.
- **0.0.3**：整理插件文档并采用 Apache-2.0 许可。
  Refines plugin documentation and adopts the Apache-2.0 license.
- **0.0.2**：补齐类型化任务和指标协议，建立初版评测工具。
  Adds typed task and metric protocols and an initial evaluation tool.
- **0.0.1**：提供场景预设及可安装的 DSH 插件包。
  Provides scenario presets and an installable DSH plugin package.
