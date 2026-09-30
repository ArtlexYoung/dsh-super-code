# 使用 Super Code · Using Super Code

[README 的三步说明](../README.md)适合第一次上手。这里补充模型设置、找不到预设时的处理方法，以及执行树和预设管理的细节。

The [three steps in the README](../README.md) will get you started. This page covers model settings, missing presets, the Agent tree, and preset management in more detail.

## 模型怎么选 · Choosing a Model

已有可用模型时，不用为插件再配一遍。如果还没设置，在 Harness“设置”→“模型”添加提供方，再从对话输入框下方选择模型和推理等级。Super Code 跟随当前会话的选择，不另设模型池；子 Agent 默认继承父 Agent 的模型，权限和工具也由 Harness 管理。

If you already have a working model, there is nothing extra to configure for the plugin. Otherwise, add a provider under Harness “Settings” → “Models”, then choose a model and reasoning effort below the message input. Super Code uses the current session's choice rather than a separate model pool. Child Agents inherit the parent Agent's model by default, while Harness manages permissions and tools.

## 找不到预设 · Can't Find the Preset?

先确认插件已启用，并按[兼容矩阵](Compatibility.md)核对宿主版本与实际依赖。插件按宿主提供的预设机制选择以下两条路径。

First confirm the plugin is enabled and check the host version and installed dependencies against the [compatibility matrix](Compatibility.md). The plugin uses the preset mechanism provided by the host.

### Harness 0.1.7 / 0.2.0：声明式预设 · Declarative Presets

在已验证的 0.1.7 和 0.2.0 版本上，Super Code 由插件 bundle 声明，宿主负责发现和加载；插件不会创建用户预设目录。设置页显示宿主报告的预设状态，不提供安装、重命名或重装目录副本的流程。若状态为缺失或损坏，检查插件是否启用、宿主组件是否混版，以及日志中的预设依赖错误，而不是反复点击安装。

On the verified 0.1.7 and 0.2.0 versions, the plugin bundle declares Super Code and the host discovers and loads it; the plugin does not create a user preset directory. Settings show the host's preset status rather than a workflow for installing, renaming, or reinstalling directory copies. If the preset is missing or broken, check plugin activation, mixed host versions, and preset dependency errors in the logs instead of retrying directory installation.

声明默认名称为 `Super Code`，描述为 `A faster, more efficient, smarter coding mode.`；插件不在此路径同步预设名称/描述的语言或改写用户 profile。定制应通过宿主支持的配置机制进行，本轮兼容冒烟不覆盖全部定制场景。插件界面本身仍支持中英文。

The declaration defaults to the name `Super Code` and description `A faster, more efficient, smarter coding mode.` On this path, the plugin does not synchronize the preset name/description language or rewrite the user profile. Use the host's supported configuration mechanisms for customization; the smoke checks do not cover every customization scenario. The plugin interface itself still supports Chinese and English.

### Harness 0.1.5/0.1.6：目录预设 · Directory Presets

如果 Harness 没发现插件自带的 `super-code`，插件首次加载时会尝试安装一份用户预设。仍然没看到时，打开“设置”→ **Super Code**，展开卡片查看状态并手动安装。默认标识符 `super-code` 若已被占用，换一个即可；原有预设不会被覆盖。之后若主动删除这份用户副本，重启也不会自动重装，需要再次手动安装。0.2.0 以前的插件设置入口在“插件”→“插件配置”中。

If Harness doesn't find the bundled `super-code` preset, the plugin tries to install a user copy on first load. If it still isn't listed, open “Settings” → **Super Code** and expand the card to check its status or install it manually. If the default identifier `super-code` is taken, choose another; the existing preset won't be overwritten. If you later delete this copy, a restart won't reinstall it automatically. Plugin versions before 0.2.0 place this page under “Plugins” → “Plugin configuration”.

## 名称与语言 · Names and Language

本节的名称同步和自定义安装名称适用于旧宿主的目录预设，不适用于 0.1.7 / 0.2.0 的声明式预设。

The name synchronization and custom installation names in this section apply to directory presets on older hosts, not declarative presets on 0.1.7 / 0.2.0.

标识符和显示名称是两回事：标识符用于选择预设，显示名称可以单独修改。默认名称会跟随 Harness 的中英文语言设置；自定义名称可以包含中文和空格，例如 `Super Code 模式`，最多 120 个字符。插件只更新仍保持默认值的名称和描述，不会改动你的自定义内容。

The identifier selects the preset, while its display name can be changed separately. The default name follows Harness's Chinese/English language setting. Custom names can include Chinese characters and spaces, such as `Super Code 模式`, up to 120 characters. The plugin updates a name or description only while it still has the default value; your custom text stays as it is.

旧版 Harness 会缓存预设列表，因此文案改变后页面会自动刷新一次，没有变化就不会刷新。同一宿主的预设文件共用一种展示语言，多个客户端不能同时显示不同语言的预设名称。只读安装目录或无法安全识别的 YAML 可能导致同步失败；可以在插件配置中刷新重试。

Older Harness versions cache the preset list, so the page refreshes once if the wording changes, but not otherwise. Preset files on one host share one display language: multiple clients can't show preset names in different languages at the same time. A read-only installation directory or YAML the plugin can't safely recognize may prevent synchronization; retry from the plugin configuration.

## 重装与备份 · Reinstallation and Backup

仅适用于插件在旧宿主上管理的用户目录副本；0.1.7 / 0.2.0 声明式预设没有此重装/备份流程。

This applies only to user-directory copies managed by the plugin on older hosts. Declarative presets on 0.1.7 / 0.2.0 do not use this reinstallation/backup workflow.

已安装用户预设时，可以点“重新安装预设”。确认框会列出将被替换的预设及新名称、标识符，先核对再确认。可以从列表中移除条目，但全部移除后不能确认；取消或按 Escape 不会改动预设。重装会重置旧副本的内容，所以自定义内容请先自行留存。

If a user preset is already installed, you can choose “Reinstall preset”. The confirmation dialog shows which preset will be replaced, along with its new name and identifier. Check the list before confirming. You can remove entries, but can't confirm an empty list; Cancel or Escape leaves everything unchanged. Reinstallation resets the old copy's contents, so save any custom changes you want to keep.

为避免误删，插件只会替换安装记录、目录内 UUID、路径及目录身份都能核对上的副本，不会自动删除旧版无标记副本。重装前的目录会保留在用户预设根目录的 `.super-code-backup-*/<旧标识符>` 下，且不会出现在预设列表中。安装失败时会自动恢复旧目录；若进程意外中断，也可从备份手动恢复。

To avoid removing the wrong files, the plugin replaces only copies whose installation record, UUID, path, and directory identity all match. It never automatically deletes unmarked legacy copies. The previous directory stays under `.super-code-backup-*/<old-id>` in the user preset root and won't appear in the preset list. An installation failure restores the old directory; after an unexpected interruption, you can recover it manually from the backup.

## Agent 执行树 · Agent Execution Tree

右侧执行树显示当前会话中各 Agent 的状态、用量和缓存率。拖动空白处平移，滚轮或按钮缩放；点一个节点，就能在侧栏新标签查看详情，主对话不会切换。界面跟随 Harness 的中英文语言设置。

The Agent tree on the right shows status, usage, and cache hit rate for each Agent in the current session. Drag empty space to pan, zoom with the wheel or buttons, and click a node to open its details in a new sidebar tab. The main conversation stays put. The interface follows Harness's Chinese/English language setting.

[执行树截图](images/agent-tree.png)来自全新隔离的 DSH 网页会话，展示 hard-100 难度排名第一题 `task-099`（`future-architect/vuls` 的 OS 生命周期预警）的初步调研。主 Agent 和三个子 Agent 分别调查 EOL/版本解析、告警链路与测试边界。截图只展示协作过程，不代表该题已修复或通过评分。

The [execution tree screenshot](images/agent-tree.png) comes from a fresh, isolated DSH web session. It shows the initial investigation of the highest-ranked hard-100 task, `task-099` (`future-architect/vuls`, OS lifecycle warnings). A lead Agent and three child Agents investigate EOL/version parsing, the warning pipeline, and test boundaries. The screenshot shows how they work together, not a completed fix or a passing grade.


## 记忆库 · Memory Library

打开右侧栏，点新标签页中的“记忆库”。先选“当前项目”或“全局偏好”，再搜索主题、摘要或标识符；点一条记忆查看详情、来源和记录时的代码版本。返回列表时会保留搜索和滚动位置。列表采用虚拟滚动，详情按需加载。

Open the right sidebar and choose “Memory library” on its new-tab page. Select “This project” or “Global preferences”, search by topic, summary, or identifier, and open an entry for its details, source, and recorded code version. Search and scroll position are retained when you return. The list is virtualized; details load on demand.

记忆分三层，各管一件事：

Memory has three distinct roles:

| 层级 / Layer | 保存什么 / What it keeps | 范围 / Scope |
|---|---|---|
| 任务状态 / Task state | 当前目标、约束、进展与验证记录 / Goal, constraints, progress, and checks | 当前会话 / Current conversation |
| 项目记忆 / Project memory | 有来源的项目事实、经验与约定 / Sourced facts, experience, and agreements | 同一规范化工作区路径，并按任务主题区分 / Canonical workspace path, organized by task topic |
| 全局偏好 / Global preferences | 用户明确要求跨项目遵守的偏好 / Explicit cross-project user preferences | 同一 Harness 存储根目录 / Same Harness storage root |

想长期保留某个约定，直接告诉 Agent 即可；是否保存以工具成功结果和记忆库为准。项目事实与经验必须关联真实工具结果和记录时版本，全局偏好必须有用户原文和明确的跨项目意图。不同路径的项目或 Git worktree 不会自动共享项目记忆。

Tell the Agent when an agreement should be kept. Check the successful tool result or memory library to confirm it was saved. Facts and experience require a real tool-result source and recorded version; global preferences require a user quote and explicit cross-project intent. Different project or Git worktree paths do not automatically share project memory.

记忆存储在宿主本地，不写入项目文件，也不会整库送给模型。当前任务主题和全局偏好各最多自动带入 4 条摘要，分别受 2 KiB、1 KiB 上限约束；详情需要主动读取。记忆不代替当前指令、不授予权限，也不能证明代码仍然保持记录时的状态。

Memory lives in local host storage, not project files, and the full library is never injected into the model. The active task topic and global preferences each contribute at most four summaries, bounded by 2 KiB and 1 KiB respectively; details require an explicit read. Memory cannot override the current request, grant permission, or establish that code is unchanged.

## 每个 Agent 用了什么 · Per-Agent Memory Activity

在执行树中点一个节点，展开详情顶部的“记忆使用记录”。这里区分“带入上下文”“读取摘要”“读取详情”“保存”和“删除”，并标明项目/全局、主题与修订号；点记录可在侧栏记忆库查看当前条目，不切换主对话。

Click an Agent node, then expand “Memory activity” at the top of its details. Actions distinguish context inclusion, summary reads, detail reads, saves, and removals, with scope, topic, and revision. Click a record to open the current entry in the sidebar without switching the main conversation.

这些是宿主实际记录的动作，不代表模型一定理解或遵守了记忆。子 Agent 不会把继承的父会话历史算成自己的读取；失败调用也不显示为成功读取。界面最多显示最近 100 条不同动作，原始完整记录仍在会话日志中。条目后来修改或删除时，历史使用记录仍保留，但记忆库展示当前内容，不伪装成旧版本快照。

These are recorded host actions, not proof that the model understood or followed the memory. Inherited parent history is not counted as a child's own read, and failed calls are not shown as successful reads. The UI keeps the latest 100 distinct actions; full history stays in the session log. Activity survives later edits or removals, but the library shows the current entry—not a reconstructed snapshot of an older revision.

历史会话的记忆可直接查看，不需要恢复 Agent 或再次调用模型。当前记忆库是只读页面；需要修改或删除时，通过对话明确告诉 Agent，并核对执行结果。

You can browse memory from stored conversations without resuming an Agent or making another model call. The library is currently read-only; ask the Agent to change or remove a memory and check the result.
