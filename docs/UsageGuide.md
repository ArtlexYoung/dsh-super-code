# 使用 Super Code · Using Super Code

[README 的三步说明](../README.md)适合第一次上手。这里补充模型设置、找不到预设时的处理方法，以及执行树和预设管理的细节。

The [three steps in the README](../README.md) will get you started. This page covers model settings, missing presets, the Agent tree, and preset management in more detail.

## 模型怎么选 · Choosing a Model

已有可用模型时，不用为插件再配一遍。如果还没设置，在 Harness“设置”→“模型”添加提供方，再从对话输入框下方选择模型和推理等级。Super Code 跟随当前会话的选择，不另设模型池；子 Agent 默认继承父 Agent 的模型，权限和工具也由 Harness 管理。

If you already have a working model, there is nothing extra to configure for the plugin. Otherwise, add a provider under Harness “Settings” → “Models”, then choose a model and reasoning effort below the message input. Super Code uses the current session's choice rather than a separate model pool. Child Agents inherit the parent Agent's model by default, while Harness manages permissions and tools.

## 批量工具调用 · Batched Tool Calls

0.3.0 的 Super Code 预设使用 Harness 原生 PTC。Agent 可以在一次模型调用里组合几个工具操作，例如同时读取互不依赖的文件，拿到结果后再决定下一步。它不需要额外的 Agent，也不用另选模式。

The Super Code preset in 0.3.0 uses Harness-native PTC. An Agent can compose several tool operations in one model call—for example, read independent files together before deciding what to do next. It needs neither an extra Agent nor a separate mode selection.

默认指导要求独立读取按需并行，写入、测试、状态变更和依赖步骤依次执行；失败时保留已成功的结果，只重试失败或过期的读取。插件向宿主声明任务和记忆工具中哪些动作可以并行，未知动作默认独占。其他工具是否允许并行，由它们在 Harness 中的声明决定。权限确认、取消、结果保存和部分失败都由宿主管理。

The default guidance calls for parallel reads when useful, ordered writes, tests, state changes, and dependent steps, and retries limited to failed or stale reads while retaining successful results. The plugin declares which task and memory actions are safe to overlap; unknown actions remain exclusive. Other tools use their own Harness concurrency declarations. Harness handles permissions, cancellation, result persistence, and partial failures.

批量调用减少的是模型与工具之间的来回，不保证每项操作都会更快，也不改变模型、权限或记忆的设置。

Batching reduces round trips between the model and tools. It does not guarantee that every operation runs faster or change model, permission, or memory settings.

## 运行预算 · Runtime Budgets

打开设置中的“Super Code 模式”（部分版本位于“插件”→“插件配置”）。顶部“预设状态”用于查看和安装预设；“上下文配置”用于调整预算。插件默认已使用此前 Pro 测试中的旧预算，无需手动填写。界面使用百分数和秒；括号内仍显示当前宿主的默认值，便于与输入框中的实际配置比较。

Open “Super Code” in Settings (under “Plugins” → “Plugin configuration” in some versions). “Preset status” shows and installs the preset; “Context settings” contains the budgets. The plugin already uses the older Pro-test budgets without manual setup. The form uses percentages and seconds; parentheses still show the current host defaults for comparison with the effective values in the inputs.

| 类型 / Type | 配置 / Settings | 生效范围 / Applies to |
|---|---|---|
| 通用预算 / Common budgets | 压缩比例、摘要上限、PTC 时限及重试次数 / Compression ratios, summary limit, PTC deadlines, and retries | 默认仅 Super Code；打开“同时应用到官方预设”后，也用于标准、PTC、极简、创造模式 / Super Code by default; also Standard, PTC, Minimal, and Create when “Also apply to official presets” is enabled |
| Super Code 专属预算 / Super Code budgets | 活跃任务记录上限、任务记忆上下文容量 / Active task record limit and task-memory context capacity | 始终仅 Super Code / Always Super Code only |

官方预设开关默认关闭，不影响自定义预设；开启后也只修改通用预算，不改变官方预设的工具和提示词。修改保存后对新建 Agent 生效，运行中的 Agent 保留原配置。切换顶部标签不会丢失尚未保存的输入。

The official-preset switch is off by default and leaves custom presets untouched. When enabled, it changes only common budgets, preserving official tools and prompts. Saved changes apply to new Agents; running Agents keep their configuration. Switching tabs retains unsaved input.

留空沿用插件默认预算；“恢复默认”会清除界面的覆盖，回到插件加载配置，未配置的字段使用旧预算。用户已保存的配置优先生效。保存失败时保留输入，若提示预算已在别处修改，先重新读取再调整。

Leave fields blank to inherit plugin defaults. “Reset to defaults” clears UI overrides and restores the plugin configuration, using the older budgets for unconfigured fields. Saved user values take precedence. Failed saves retain your input. If budgets changed elsewhere, reload before editing again.

也可以通过插件的 `budgets` 配置调整通用预算；将 `applyToOfficialPresets` 设为 `true` 可同时应用到上述四种官方预设。保存预算不会重启 Agent。

You can also set common budgets in the plugin's `budgets` configuration. Set `applyToOfficialPresets: true` to include the four official presets above. Saving budgets does not restart Agents.

旧宿主未提供 `ptcRuntime` 时，“批量工具执行”的时限输入框会禁用；压缩预算和任务记忆容量仍可设置。

On older hosts without `ptcRuntime`, batch-tool deadline inputs are disabled; compression and task-memory budgets remain configurable.

下面是插件已默认使用的旧预算，无需再将它手动添加到 `name: dsh-super-code` 的加载配置中。需要自定义时，可以在界面或加载项的 `config.budgets` 中修改对应字段。

The plugin already uses these older budgets by default; there is no need to add them manually to the `dsh-super-code` entry. Customize individual fields in the UI or the entry's `config.budgets` when needed.

```yaml
budgets:
  pressureBasis: window
  thresholdRatio: 0.8
  retainRatio: 0.16
  summaryMaxTokens: 8192
  compactionRetries: 1
  maxOverflowRetries: 1
  ptcTimeoutMs: 600000
  ptcMaxTimeoutMs: 600000
```

`pressureBasis: window` 为插件默认，按完整上下文窗口计算；选择 `host` 则按当前宿主策略计算。`retainRatio` 必须小于 `thresholdRatio`。PTC 两项的单位是毫秒，包含工具等待时间；显式更短的调用期限仍然生效，上限不会超过宿主允许值。PTC 时间覆盖需要提供 `ptcRuntime` 的新版宿主；旧版的 CPU 忙碌计时与新版总耗时计时不能等同。这些配置不改变执行后端、权限或取消行为。

`pressureBasis: window` is the plugin default and uses the full context window; choose `host` to follow the current host budget policy. `retainRatio` must be lower than `thresholdRatio`. PTC values are milliseconds, including tool waits; explicit shorter call deadlines still apply, and the host ceiling remains authoritative. PTC overrides require a newer host with `ptcRuntime`. The old busy-CPU timer and the new elapsed timer are different. These settings preserve the host execution backend, permissions, and cancellation.

Super Code 专属的 `maxTasks`（默认 32）和 `maxContextBytes`（默认 32,768），分别控制会话中活跃任务记录数量和任务记忆上下文的字节预算。增加预算会占用更多上下文；通常保持默认即可。

Super Code also has `maxTasks` (default 32) and `maxContextBytes` (default 32,768), which bound the active task records and task-memory context bytes per conversation. Larger budgets use more context; the defaults are usually sufficient.

## 找不到预设 · Can't Find the Preset?

先确认插件已启用，并按[兼容矩阵](Compatibility.md)核对宿主版本与实际依赖。插件按宿主提供的预设机制选择以下两条路径。

First confirm the plugin is enabled and check the host version and installed dependencies against the [compatibility matrix](Compatibility.md). The plugin uses the preset mechanism provided by the host.

### Harness 0.1.7 / 0.2.0 / 0.2.1：声明式预设 · Declarative Presets

Super Code 由插件 bundle 声明，宿主负责加载。从 0.3.1 起，未安装时可以在“设置”→ **Super Code** 安装预设；已安装时提供“重新安装预设”，确认后按所填名称和标识符替换。声明保存在当前 profile 的补丁层，通过宿主公开接口加载，不需要用户预设目录。宿主未开放管理接口时，页面会明确提示。

The plugin bundle declares Super Code and the host loads it. From 0.3.1, use “Settings” → **Super Code** to install a missing preset or confirm reinstallation of an installed preset with the entered name and identifier. Declarations persist in the current profile's patch layer and load through public host APIs; no user preset directory is needed. Hosts without management APIs show an explicit notice.

声明式预设的默认名称和描述从 0.3.1 起跟随中英文设置，已自定义的字段保留。语言变化只调整展示字段，不更新旧预设的内容或版本；确认重装才使用当前插件随包的组合。

From 0.3.1, default declarative preset names and descriptions follow Chinese/English settings while custom fields remain intact. Language changes update display fields only, retaining the older preset's content and version. Confirmed reinstallation uses the composition shipped with the current plugin.

插件管理中的展示信息独立于预设声明：0.2.1 通过导出的语言资源提供 `Super Code 模式` / `Super Code` 和对应描述，支持新版宿主读取根路径及子路径的展示信息。

Plugin management metadata is separate from the preset declaration. Version 0.2.1 exports locale resources for `Super Code 模式` / `Super Code` and their descriptions, allowing newer hosts to read metadata for the root and plugin subpaths.

### Harness 0.1.5/0.1.6：目录预设 · Directory Presets

如果 Harness 没发现插件自带的 `super-code`，插件首次加载时会尝试安装一份用户预设。仍然没看到时，打开“设置”→ **Super Code**，查看状态并手动安装；0.3.1 起此页始终展开。默认标识符 `super-code` 若已被占用，换一个即可；原有预设不会被覆盖。之后若主动删除这份用户副本，重启也不会自动重装，需要再次手动安装。0.2.0 以前的插件设置入口在“插件”→“插件配置”中。

If Harness doesn't find the bundled `super-code` preset, the plugin tries to install a user copy on first load. If it still isn't listed, open “Settings” → **Super Code** to check its status or install it manually; this page stays expanded from 0.3.1 onward. If the default identifier `super-code` is taken, choose another; the existing preset won't be overwritten. If you later delete this copy, a restart won't reinstall it automatically. Plugin versions before 0.2.0 place this page under “Plugins” → “Plugin configuration”.

## 查看预设版本 · Checking the Preset Version

0.3.1 起，“设置”→ **Super Code** 分别显示已加载的插件版本和当前预设版本。预设版本来自实际加载的预设组合；两者一致时表示预设与当前安装的插件同步，不代表 npm 上没有更新版本。旧预设没有版本记录时，会显示“未记录版本”，不会自动视为最新版。修改名称或切换语言不改变预设版本。

From 0.3.1 onward, “Settings” → **Super Code** shows the loaded plugin version and the current preset version separately. The preset version comes from its actual composition. Matching versions mean the preset is in sync with the installed plugin, not that no newer npm release exists. Older presets without version metadata show “Version not recorded”. Renaming a preset or changing the language does not change its version.

若版本不一致，先保留需要的自定义内容，再通过确认清单重装。目录式宿主替换用户副本，声明式宿主替换本插件拥有的声明，均保留恢复备份。重装后刷新仍不一致时，检查插件更新是否生效及宿主日志。

If versions differ, save the custom content you need, then confirm reinstallation. Directory hosts replace the user copy; declarative hosts replace this plugin's owned declaration. Both retain recovery backups. If refreshed versions still differ, check that the plugin update took effect and inspect host logs.

## 内嵌前端 Skill · Bundled Frontend Skill

插件携带 `super-code-frontend`，用于页面/组件开发、视觉调整、响应式布局、交互状态和浏览器验证。特别覆盖共同对齐轴、视觉与点击边界、控制位置稳定、操作距离和输入负担；通过空间关系与实际命中检查定位错位和难操作的问题，沿用产品自己的视觉语言。宿主向模型提供名称与短描述，匹配任务时由原生 `skill` 工具按需加载入口；视觉设计、状态交互和浏览器验证的参考文件再按需读取。也可以在请求中明确指定使用 `super-code-frontend`。它不依赖固定框架或新增工具，不把全文加入每轮提示。

The plugin includes `super-code-frontend` for pages/components, visual refinement, responsive layout, interaction states, and browser validation. Guidance covers shared alignment anchors, painted and interactive boundaries, stable control positions, reach, and input effort. Geometry and real hit-area checks help diagnose misalignment and awkward interaction within the product's own visual language. Harness exposes its name and short description; the native `skill` tool loads the entry point when applicable, followed by only the references needed. You can explicitly ask to use `super-code-frontend`. It requires no particular framework or added tools and does not insert its full text into every turn.

从 0.3.3 起，新安装或重装的 Super Code 预设包含此接入。已有用户副本或自定义声明需要先保留自己的调整，再通过“设置”→ **Super Code** 的重装流程更新；插件升级不会自动更新旧预设，设置页会显示其原有版本并提示差异。没有自动改写现有预设，也没有安装到全局 skills 目录。项目/用户同名 skill 仍按宿主原有优先级覆盖内置版本。

From 0.3.3 onward, newly installed or reinstalled Super Code presets include this integration. Existing user copies or custom declarations need reinstallation through “Settings” → **Super Code** after saving any customizations. Updating the plugin preserves the old preset version, and Settings flags any mismatch. Existing presets and global skill directories are not rewritten automatically. Project/user skills with the same name retain their normal host precedence.

浏览器验证方法会指导 Agent 复用可用会话，保留已完成步骤，并从实际失败阶段恢复。它是方法指导；本身不实现强制防循环，也不会自动写入长期记忆。是否提升前端成品质量需要单独的实际任务评测，不能用安装测试或 SWE 成绩代替。

Browser guidance reuses working sessions and confirmed progress, recovering at the actual failed stage. It is workflow guidance, with no enforced loop detector or automatic long-term memory writes. Frontend quality improvements require separate real-task evaluation; installation checks or SWE scores do not establish them.

## 名称与语言 · Names and Language

0.3.1 的名称同步和自定义安装名称同时支持目录式与声明式预设。

Version 0.3.1 supports display-language synchronization and custom installation names for directory and declarative presets.

标识符和显示名称是两回事：标识符用于选择预设，显示名称可以单独修改。默认名称会跟随 Harness 的中英文语言设置；自定义名称可以包含中文和空格，例如 `Super Code 模式`，最多 120 个字符。插件只更新仍保持默认值的名称和描述，不会改动你的自定义内容。

The identifier selects the preset, while its display name can be changed separately. The default name follows Harness's Chinese/English language setting. Custom names can include Chinese characters and spaces, such as `Super Code 模式`, up to 120 characters. The plugin updates a name or description only while it still has the default value; your custom text stays as it is.

旧版 Harness 会缓存预设列表，因此文案改变后页面会自动刷新一次，没有变化就不会刷新。同一宿主的预设文件共用一种展示语言，多个客户端不能同时显示不同语言的预设名称。只读安装目录或无法安全识别的 YAML 可能导致同步失败；可以在插件配置中刷新重试。

Older Harness versions cache the preset list, so the page refreshes once if the wording changes, but not otherwise. Preset files on one host share one display language: multiple clients can't show preset names in different languages at the same time. A read-only installation directory or YAML the plugin can't safely recognize may prevent synchronization; retry from the plugin configuration.

## 重装与备份 · Reinstallation and Backup

目录副本与声明式预设均支持此流程；插件只替换能够核实归属的预设。

This workflow supports directory copies and declarative presets. The plugin replaces only presets whose ownership can be verified.

已安装用户预设时，可以点“重新安装预设”。确认框会列出将被替换的预设及新名称、标识符，先核对再确认。可以从列表中移除条目，但全部移除后不能确认；取消或按 Escape 不会改动预设。重装会重置旧副本的内容，所以自定义内容请先自行留存。

If a user preset is already installed, you can choose “Reinstall preset”. The confirmation dialog shows which preset will be replaced, along with its new name and identifier. Check the list before confirming. You can remove entries, but can't confirm an empty list; Cancel or Escape leaves everything unchanged. Reinstallation resets the old copy's contents, so save any custom changes you want to keep.

为避免误删，插件只会替换安装记录、目录内 UUID、路径及目录身份都能核对上的副本，不会自动删除旧版无标记副本。重装前的目录会保留在用户预设根目录的 `.super-code-backup-*/<旧标识符>` 下，且不会出现在预设列表中。安装失败时会自动恢复旧目录；若进程意外中断，也可从备份手动恢复。

To avoid removing the wrong files, the plugin replaces only copies whose installation record, UUID, path, and directory identity all match. It never automatically deletes unmarked legacy copies. The previous directory stays under `.super-code-backup-*/<old-id>` in the user preset root and won't appear in the preset list. An installation failure restores the old directory; after an unexpected interruption, you can recover it manually from the backup.

声明式宿主通过 bundle 来源标记，或匹配的安装记录、声明标识符和 UUID 核实归属；同名的无标记声明不会自动认领。旧声明及原 profile 补丁保存在当前 profile 的 `.super-code-backup-*` 中，安装记录位于 `.super-code-presets.json`。失败时尝试恢复原补丁和记录；若进程中断，可从备份恢复。已有会话继续使用宿主保留的旧预设组合，新会话使用重装后的版本。

Declarative hosts verify a bundle source marker or matching installation record, entry identity and UUID. Unmarked same-name declarations are not adopted automatically. The previous declaration and profile patch stay in `.super-code-backup-*` under the current profile; `.super-code-presets.json` stores ownership records. Failures attempt to restore the original patch and record; backups allow recovery after interruption. Existing sessions retain their old composition through the host; new sessions use the reinstalled version.

## Agent 执行树 · Agent Execution Tree

打开右侧栏，选择“Super Code”，同一页面包含执行树和记忆库，默认展开执行树。点击任一区域的标题切换展开内容；两者互斥，始终保持一个展开，切换后保留阅读位置、筛选和编辑草稿。执行树显示当前会话中各 Agent 的状态、用量和缓存率。拖动空白处平移，滚轮或按钮缩放；点一个节点，就能在侧栏新标签查看详情，主对话不会切换。界面跟随 Harness 的中英文语言设置。

Open the right sidebar and choose “Super Code” for the Agent tree and memory library on one page. The tree is expanded by default. Click either section heading to switch; exactly one section stays expanded, while reading positions, filters, and edit drafts are retained. The tree shows status, usage, and cache hit rate for each Agent in the current session. Drag empty space to pan, zoom with the wheel or buttons, and click a node to open its details in a new sidebar tab. The main conversation stays put. The interface follows Harness's Chinese/English language setting.

[执行树截图](images/agent-tree.png)来自安装 0.3.2 包的隔离 Harness 网页宿主，展示主 Agent 和记忆读取子 Agent 的真实会话记录。模型响应由本地确定性验收程序提供，用于检查界面与记忆功能，不代表外部模型效果或评测成绩。

The [execution tree screenshot](images/agent-tree.png) comes from an isolated Harness web host with the 0.3.2 package installed. It shows real journal records for a lead Agent and a memory-reading child Agent. A local deterministic fixture supplies model responses for UI and memory checks; this is not an external-model result or benchmark score.

0.3.2 保留圆形节点，将顶部操作集中一行；“已收起”和“自动整理”有可见名称。历史的创建时间与排序使用自定义下拉，支持方向键、Home/End、Enter 和 Escape；所有插件按钮的名称气泡都在上方。

Version 0.3.2 retains circular nodes and groups actions in one row with visible Collapsed/Organize labels. Custom creation-time and sort dropdowns support arrow keys, Home/End, Enter, and Escape. All plugin button name bubbles appear above the control.

Agent 详情采用对话列表：用户任务、Agent 回复分开呈现，真实工具调用和结果可展开查看。顶部先显示状态、Token 与缓存，展开“详情”可看更多用量、任务档案与记忆使用记录。翻页、返回最新内容和滚动位置保留现有行为。

Agent details use a chat list with distinct user tasks, replies, and expandable real tool calls/results. The compact header shows status, tokens, and cache; open Details for additional usage, task records, and memory activity. Pagination, latest-content navigation, and scroll restoration retain their existing behavior.

## 记忆库 · Memory Library

在“Super Code”页面点击“记忆库”标题展开。先选“当前项目”或“全局偏好”，再从主题目录选择主题，或搜索主题、摘要与标识符；点一条记忆查看详情与来源。返回列表时会保留搜索和滚动位置。主题筛选与搜索可以同时使用，详情列出同主题条目。列表采用虚拟滚动，详情按需加载。

Click the “Memory library” heading on the “Super Code” page to expand it. Select “This project” or “Global preferences”, choose a topic or search by topic, summary, or identifier, and open an entry for its details and source. Search and scroll position are retained when you return. Topic filtering and search can be combined; details include related entries from the same topic. The list is virtualized; details load on demand.

记忆分三层，各管一件事：

Memory has three distinct roles:

| 层级 / Layer | 保存什么 / What it keeps | 范围 / Scope |
|---|---|---|
| 任务状态 / Task state | 当前目标、约束、进展与验证记录 / Goal, constraints, progress, and checks | 当前会话 / Current conversation |
| 项目记忆 / Project memory | 有来源的项目事实、经验与约定 / Sourced facts, experience, and agreements | 同一规范化工作区路径，并按任务主题区分 / Canonical workspace path, organized by task topic |
| 全局偏好 / Global preferences | 用户明确要求跨项目遵守的偏好 / Explicit cross-project user preferences | 同一 Harness 存储根目录 / Same Harness storage root |

想长期保留某个约定，直接告诉 Agent 即可；是否保存以工具成功结果和记忆库为准。Agent 保存的项目事实与经验必须关联真实工具结果和记录时版本，全局偏好必须有用户原文和明确的跨项目意图；在记忆库中直接维护的条目使用“手动维护”来源。不同路径的项目或 Git worktree 不会自动共享项目记忆。

Tell the Agent when an agreement should be kept. Check the successful tool result or memory library to confirm it was saved. Agent-saved facts and experience require a real tool-result source and recorded version; global preferences require a user quote and explicit cross-project intent. Entries edited directly in the library use a manual source. Different project or Git worktree paths do not automatically share project memory.

记忆存储在宿主本地，不写入项目文件，也不会整库送给模型。当前任务主题和全局偏好各最多自动带入 4 条摘要，分别受 2 KiB、1 KiB 上限约束；详情需要主动读取。记忆不代替当前指令、不授予权限，也不能证明代码仍然保持记录时的状态。

Memory lives in local host storage, not project files, and the full library is never injected into the model. The active task topic and global preferences each contribute at most four summaries, bounded by 2 KiB and 1 KiB respectively; details require an explicit read. Memory cannot override the current request, grant permission, or establish that code is unchanged.

## 每个 Agent 用了什么 · Per-Agent Memory Activity

在执行树中点一个节点，展开顶部“详情”，再展开“记忆使用记录”。这里区分“带入上下文”“读取摘要”“读取详情”“保存”和“删除”，并标明项目/全局与主题；点记录会回到同一个“Super Code”页面并打开记忆条目，不新增记忆库页，也不切换主对话。

Click an Agent node, then open “Details”, then expand “Memory activity” at the top of its details. Actions distinguish context inclusion, summary reads, detail reads, saves, and removals, with scope and topic. Click a record to return to the same “Super Code” page and open the current entry without creating another memory tab or switching the main conversation.

这些是宿主实际记录的动作，不代表模型一定理解或遵守了记忆。子 Agent 不会把继承的父会话历史算成自己的读取；失败调用也不显示为成功读取。界面最多显示最近 100 条不同动作，原始完整记录仍在会话日志中。条目后来修改或删除时，历史使用记录仍保留，但记忆库展示当前内容，不伪装成旧版本快照。

These are recorded host actions, not proof that the model understood or followed the memory. Inherited parent history is not counted as a child's own read, and failed calls are not shown as successful reads. The UI keeps the latest 100 distinct actions; full history stays in the session log. Activity survives later edits or removals, but the library shows the current entry—not a reconstructed snapshot of an older revision.

历史会话的记忆可直接查看，不需要恢复 Agent 或再次调用模型。记忆库支持新增、编辑、取消、保存和删除。编辑时可修改类型、标题和内容；取消不保存，删除需要确认。手动保存的条目标为“手动维护”，仅保留当前内容，不保留版本历史。

You can browse memory from stored conversations without resuming an Agent or making another model call. The library supports Add, Edit, Cancel, Save, and Delete. Edit the type, title, and content; Cancel discards the draft, and Delete asks for confirmation. Manually saved entries are marked accordingly. Only current content is kept, with no version history.
