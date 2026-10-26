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

## 任务状态 · Task Status

Super Code 侧边栏依次显示“任务状态”“协作执行”“记忆库”。任务状态默认展开，三项互斥且始终保留一项展开；原圆圈 Agent 执行树保留在“协作执行”中。每个 Agent 的任务树根节点显示其名字，步骤、动作、文件条目不重复标注名字。

The Super Code sidebar contains Task status, Agent execution, and Memory library in that order. Task status opens by default; exactly one section stays open. The original circular Agent graph remains under Agent execution. Each Agent's name appears at its task-tree root only.

任务状态只读取已有会话记录：目标取已有任务/目标记录，缺少时展示用户原文；步骤取模型已经写入的待办，进度显示已完成数/总数；动作与结果取工具日志。运行结束不会被当作任务完成。没有步骤时不会补造计划、百分比或阶段说明。

This view reads existing journal facts: recorded objectives or the user's original request, existing todos and their completed/total counts, and tool activity and results. A stopped run is not treated as a completed objective. Missing plans or progress are not invented.

任务、步骤、已加载动作和补充要求都直接展开，不需要逐项点击。任务状态使用单一虚拟滚动列表，只渲染视口附近的行；长文本按实际高度显示，滚动即可查看所有已加载记录和文件，无需点击“更多”。切换侧栏区块后保留阅读位置。运行环遵循系统的“减少动态效果”设置。

Tasks, steps, loaded activity, and follow-up requests are fully expanded. One virtualized list renders rows near the viewport and measures wrapped text at its actual height. Scroll through every loaded record and file without a More button. Switching sections retains the reading position, and running indicators respect reduced-motion preferences.

文件变更记录列出已成功执行并能从工具参数或结果 diff 元数据确认的文件操作，包含普通和 PTC 嵌套调用。它不是当前工作区的完整 Git diff：终端或外部脚本的间接修改可能缺失，历史操作也不代表文件当前仍有净修改。未完成、失败、只读操作及子 Agent 继承的历史不会被计作本次成功修改。

File operations show successful mutations identifiable from tool arguments or result diff metadata, including native and nested PTC calls. This is not a complete current Git diff: indirect terminal/script changes may be absent, and historical operations do not establish a current net change. Pending, failed, read-only, and fork-inherited operations are not counted as that Agent's successful changes.

此功能不增加提示词、模型请求、工具定义或执行钩子，也不向模型上下文写入界面内容；不要求使用特定模型、预设、Skill 或固定步骤。未知工具仍显示其调用与结果，缺少结构化记录时只减少相应展示，不影响模型继续工作。记录有显示上限，未加载或超出范围时会提示；完整执行内容可打开详情查看。

This feature adds no instructions, model requests, tool definitions, or execution hooks, and never writes display data into model context. It requires no specific model, preset, Skill, or workflow. Unknown tools retain their activity and results; absent structured facts reduce the displayed detail only. Bounded or unloaded records are labeled, with full execution content available in details.

## 删除保护 · Deletion Protection

“上下文配置”中的“删除保护”支持三种模式，**默认宽松**。

| 模式 / Mode | 行为 / Behavior |
| --- | --- |
| 关闭 / Off | 不添加删除保护提示，不额外拦截命令。No deletion instructions or extra command interception. |
| 宽松 / Relaxed（默认 / default） | 默认使用 `trash`，脚本中也建议使用；用户明确要求时可使用 `rm`，无需本插件额外二次确认。Prefer recoverable trash, including in scripts; explicit user requests may use `rm` without additional plugin confirmation. |
| 严格 / Strict | 脚本也禁止直接使用 `rm`；识别到永久删除命令时，仅临时文件或构建产物清理可经用户逐次二次确认放行。Scripts must also avoid `rm`; recognized permanent deletion requires one-time confirmation for each temporary-file or build-artifact cleanup. |

宽松模式保留指令：**删除文件或目录默认用 `trash <path>`（可恢复）；仅清理临时文件、构建产物且我已确认时才用 `rm`。** 脚本、内联脚本和间接调用中也建议使用回收站。用户明确说明使用 `rm` 时，该要求可作为确认，并按用户指定范围执行；宽松依靠指令引导，不增加命令拦截，宿主原有权限检查仍然有效。

Relaxed mode instructs Agents to use recoverable `trash <path>` by default and prefer it in scripts and indirect calls. An explicit request to use `rm` counts as confirmation within the requested scope. Guidance is prompt-based; host permission checks still apply.

默认只保护 Super Code。“同时应用到官方预设”开关默认关闭，与预算的同名开关独立；开启后，所选模式也应用到标准、PTC、极简、创造预设。关闭模式时保留此开关的选择。保存后作用于后续命令。旧配置 `true` 保留为严格，`false` 保留为关闭；缺省配置及恢复默认使用宽松。

Only Super Code is protected by default. “Also apply to official presets” defaults off, independently of official-preset budgets, and applies the chosen mode to Standard, PTC, Minimal, and Create. Off retains this preference. Saved changes affect subsequent calls. Legacy `true` maps to Strict and `false` to Off; missing settings and reset use Relaxed.

极简预设通过可记录、可回放的插件消息接收规则，模式变化时明确替代先前规则，兼容 v4 会话日志。

Minimal receives rules through logged, replayable plugin messages compatible with v4 session logs; mode changes explicitly replace earlier rules.

严格模式在终端执行前识别 `rm`、常见包装、内联 shell 脚本及 PowerShell 删除别名（如 `Remove-Item`），PTC 内的终端调用也适用。宿主对当前命令和工作目录请求一次性确认；拒绝、取消、确认不可用或出错均拦截。此确认不授予后续调用权限，也不代替宿主其他权限检查。缺少 `trash` 时应使用其他可恢复方式或停止。

Strict mode checks terminal calls, including those nested in PTC, for `rm`, common wrappers, inline shell scripts, and PowerShell deletion aliases such as `Remove-Item`. Only a real one-time host approval for the current command and working directory proceeds. Rejection, cancellation, unavailable approval, and errors block execution. If trash is unavailable, use another recoverable mechanism or stop.

严格模式的命令识别并非操作系统沙箱：不解析外部脚本文件或任意混淆程序，不覆盖所有语言的文件删除 API；脚本仍须遵守指令，需要进程级隔离时继续使用宿主沙箱。

Strict command recognition is not an OS sandbox: it does not inspect external script files, arbitrary obfuscated programs, or every language's deletion API. Scripts must follow the instructions; use the host sandbox for process-level isolation.

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


## MCP 连接 · MCP Connection

设置 → Super Code 模式默认打开“首页”，集中显示预设状态与版本、保护等级、MCP 开关，以及正在连接和历史对话的数量。客户端和关联会话详情、打开会话及断开操作位于“连接”标签。预设、上下文、删除保护、连接分别配置；预设配置页直接展示表单。MCP 默认关闭，在“连接”标签中勾选允许的工作目录、调整本机端口和最大连接数；修改会自动保存，无需确认按钮。服务只监听 `127.0.0.1`，地址以页面显示为准；端口冲突会显示错误。

Settings → Super Code opens **Home**, with preset status and versions, protection level, the MCP switch, and counts of connected and past conversations. Client and linked-session details, opening conversations and disconnect actions are in **Connection**. Preset, context, deletion protection and connection settings have separate tabs. Preset configuration shows its form directly. MCP is disabled by default. In **Connection**, select allowed working directories and adjust the local port and maximum connections. Changes save automatically without a confirmation button. The service listens on `127.0.0.1` only; use the displayed URL. Port conflicts are reported explicitly.

工作目录以勾选列表展示，每次进入连接页会重新读取 DSH 工作区。首次配置时预选已有有效工作区，修改后自动保存并保留用户选择；后来新增的工作区不会静默获得访问权限。可以通过目录选择器添加目录，取消勾选会撤销该目录的入口授权，取消最后一个允许目录时会同时关闭 MCP。手动添加但未勾选的目录仍保留在列表中。允许目录包含其子目录。

Directories appear as a checkbox list refreshed from DSH workspaces when opening Connection. Existing valid workspaces are initially selected in the first configuration draft; edits save automatically and later workspaces are never silently granted access. Add directories with the directory picker. Unchecking revokes that directory's admission grant; removing the last grant also turns MCP off. Unchecked manually added directories remain listed. Each grant includes descendants.

最大连接数限制真实 MCP 协议会话（默认 3，上限 32），并同时作为任务执行并发上限。在连接页可以断开客户端，空闲 10 分钟也会释放连接；断开不会取消已接收任务。正在连接的对话按其关联 MCP 连接是否在线统计，断开后计入历史；与任务是否执行完成无关。连接凭证默认展开，离开连接页后隐藏，再次进入时重新读取。

Maximum connections counts MCP protocol sessions (default 3, maximum 32) and is also the task execution concurrency limit. Disconnect clients from Connection; idle connections also expire after 10 minutes. Disconnecting does not cancel accepted tasks. Conversations count as connected while their linked MCP connection is online, regardless of task completion; after disconnect they count as past conversations. The token is expanded by default in Connection, cleared when leaving the tab and reloaded on return.

### 连接 Prompt · Connection Prompt

1. 在连接页复制“连接 Prompt”，交给支持 Streamable HTTP MCP 的客户端配置连接。提示词包含页面当前地址、认证方式、六项工具与任务状态约定，不包含真实凭证，也不绑定特定客户端。连接后先调用 `dsh_sessions` 按工作目录查看最近对话、状态和连接额度，再由调用方选择传 `taskId` 复用历史或传 `newConversation: true` 新建；不会默认复用最新对话。
2. 单独复制连接凭证，在客户端安全保存并配置为 `Authorization: Bearer <连接凭证>`。不要把实际凭证写进仓库或共享提示词。
3. 保持提供连接的 DSH Web 服务或桌面应用运行。更换凭证后同步更新客户端；旧凭证立即失效。客户端是否允许由提示词自动配置 MCP，取决于客户端自身能力；也可以使用页面地址和认证方式手动配置。

Copy **Connection Prompt** from the Connection tab and give it to a client that supports Streamable HTTP MCP. It contains the current URL, authentication method, six tools and task-state conventions, without an actual token or client-specific command. After connecting, call `dsh_sessions` for the working directory to see recent conversations, statuses and connection capacity. Let the caller choose whether to pass `taskId` to reuse history or `newConversation: true` to create a new root; `dsh_run` never defaults to the latest conversation. Copy the token separately and securely configure `Authorization: Bearer <connection token>` in the client. Keep the serving DSH process running, and update the client after token rotation. Whether a prompt can configure MCP automatically depends on the client; manual setup using the shown URL and authentication is also supported. Never put actual credentials in repository files or shared prompts.

| 工具 / Tool | 用途 / Behavior |
|---|---|
| `dsh_sessions` | 连接后按允许的工作目录返回最近对话、状态、可复用标记、每条对话的连接数，以及当前/最大/剩余连接数和任务并发占用。调用方据此选择复用或新建。 / After connecting, list recent conversations for an allowed working directory with status, reuse availability, per-conversation connection count, current/maximum/available connections, and active task capacity. Use it to choose reuse or a new root. |
| `dsh_run` | 传 `taskId` 精确复用历史根会话；传 `newConversation: true` 明确新建，未传时为兼容旧客户端也新建。相同 `requestId` 与相同输入不会重复提交，输入不同会报冲突。 / Pass `taskId` to reuse an exact history entry; pass `newConversation: true` to make a new root explicit. Omitting both also creates a new root for backward compatibility. Retrying identical input with the same request ID does not dispatch again; conflicting input is rejected. |
| `dsh_wait` | 提供任务 ID 时读取状态、输出、工作区观察及游标后的事件，最长等待 30 秒；省略任务 ID 时分页列出本服务持有的任务。 / Read task state, output, workspace observations and events after a cursor, with waits bounded to 30 seconds; omit the task ID to list owned tasks. |
| `dsh_send` | 在同一根会话补充要求或明确继续，使用新的请求 ID；不会代替用户批准宿主权限。 / Queue a follow-up or explicitly continue the same root session with a new request ID. Does not approve host permissions. |
| `dsh_request_directory` | 申请新增工作目录，由 DSH 用户明确批准；重复请求查询审批状态。 / Request additional directory access with explicit consent in DSH; repeat to poll the decision. |
| `dsh_cancel` | 请求取消根会话及受管理后代；需继续观察真实状态，不能把取消请求当成全部停止。 / Request cancellation of the root and managed descendants; observe the resulting state to confirm execution stopped. |

### 新增目录申请 · Additional Directory Requests

外部会话可调用 `dsh_request_directory`，提交稳定的 `requestId`、已存在的绝对 `path` 和 `reason`。DSH 会在全局弹出确认对话框，显示客户端名称、实际目录和申请理由，不需要先打开设置。只有用户点击“允许访问”，才会将该目录加入列表并勾选；审批沿用最新配置，不覆盖同时发生的其他设置修改，也不会断开已有 MCP 连接。申请不会触发模型调用，且不能由模型的自动审批策略代为同意。

重复相同输入可查询 `pending` / `approved` / `rejected` / `expired` 状态；相同 ID 改变输入会报冲突。批准前不能在该目录委派任务。待审批请求最多 8 条，5 分钟过期；拒绝、关闭服务或重启均不自动授权。请求历史为有界的进程内记录（最多 100 条），已批准的目录配置会保存。客户端名称和理由来自客户端，仅供辨认。

External sessions call `dsh_request_directory` with a stable `requestId`, an existing absolute `path` and a `reason`. A global DSH dialog shows the client name, canonical directory and reason even when settings is closed. Only the user's **Allow access** action adds and selects the directory. Approval merges into the latest configuration without overwriting concurrent changes or disconnecting clients. It does not invoke a model and cannot be approved by a model's automatic permission policy.

Repeat identical input to read `pending`, `approved`, `rejected` or `expired`; changing input under the same ID conflicts. Delegation is blocked until access is approved. At most eight pending requests are allowed, expiring after five minutes. Rejection, service shutdown and restart never grant access. Request history is in memory and bounded to 100 entries; approved directory settings persist. Client names and reasons are supplied by the caller for identification.

### 状态、权限与恢复 · State, Permissions and Recovery

任务沿用当前宿主的默认模型、Super Code 预设和权限；不修改普通会话的提示词或执行策略，也不会自动放行权限。调用方的沙箱不会自动传播到 DSH。允许目录限制用于任务入口，不构成文件系统沙箱；实际工具权限由 DSH 管理。同一工作区不会并行委派，可由调用方自行准备独立 worktree；插件不创建、删除或合并 worktree。

Tasks use the host’s default model, Super Code preset and permissions without changing ordinary conversation prompts or execution strategy. Caller sandbox restrictions do not automatically propagate to DSH. Allowed directories govern task admission, not filesystem isolation; DSH controls tool permissions. Delegations in the same workspace do not run concurrently. Callers may supply separate worktrees; the plugin does not create, delete or merge them.

`waiting_confirmation` 表示需要在 DSH 处理权限确认或受阻的回合。`finished` 仅表示根会话和已观测的受管理后代执行结束，返回的 `acceptance` 始终为 `not-verified`，需要调用方验证结果。文件信息来自执行前基线与当前 Git 工作区的有界观察，会保留原有脏文件列表，不能证明全部变化均由本任务产生；非 Git 目录、超出观察上限或读取失败时会标记不可用。

`waiting_confirmation` requires action in DSH. `finished` means the root and observed managed descendants have settled; it does not certify acceptance. Results carry `acceptance: not-verified`. File information is a bounded Git workspace observation relative to the starting baseline, including pre-existing dirty files, and does not establish exclusive attribution. Non-Git directories, exceeded observation limits and read failures are reported as unavailable.

等待超时或客户端断线不会取消执行。关闭连接停止接收请求，已接收任务继续由 DSH 管理。重启或热重载后不自动重发 prompt；可通过 `dsh_sessions` 或任务列表找回 ID，先观察会话，再明确继续。无法确认状态时保留 `interrupted` 或 `unavailable`，避免误报完成；未确认停止的任务会继续占用并发额度。

Wait timeouts and client disconnections do not cancel execution. Disabling the connection stops accepting requests while DSH continues managing accepted work. Restart and hot reload never automatically replay prompts. Recover task IDs through `dsh_sessions` or the task listing, inspect the session, then explicitly continue. Unconfirmed tasks remain interrupted or unavailable and retain their concurrency reservation.

任务记录、配置和凭证保存在当前 profile 的 `super-code-connection` 目录中，目录权限为 0700，文件为 0600；同一配置目录只允许一个服务实例持有。当前上限为 200 个任务记录、每任务 128 个补充操作和最近 200 条状态事件，输出保留最后 12,000 个字符。达到记录上限会明确拒绝新任务，不会悄悄丢弃幂等记录并重跑。

State, configuration and credentials are stored in the profile’s `super-code-connection` directory, with directory mode 0700 and file mode 0600. A profile has one service owner. Limits are 200 task records, 128 follow-up operations per task, the latest 200 state events, and the last 12,000 output characters. Reaching the history limit explicitly rejects new tasks rather than silently discarding idempotency records and redispatching work.
