# 宿主兼容性 · Host Compatibility

## 0.3.7 · 删除保护与任务状态 · Deletion Protection and Task Status · 2026-10-24

正式发布候选保留稳定记忆库，未包含开发中的版本化记忆或任务 skills。229 项测试、类型检查、构建和客户端语法检查通过。下方相同的 20 个 Web、5 个官方 macOS arm64 Desktop 与 DSH NEXT，均在真实宿主组件上通过 25 项删除保护/任务投影检查，包含旧设置、官方预设隔离、逐次确认、旧/新日志、嵌套 PTC、文件归属和任务状态不干预模型请求的回归。

The release candidate retains the stable memory library and excludes experimental versioned memory and task skills. All 229 tests, type checking, build, and client syntax checks pass. The same 20 Web versions, five official macOS arm64 Desktop versions, and DSH NEXT listed below pass 25 deletion-protection/task-projection checks each against actual host components, including legacy settings, official-preset isolation, per-call approval, old/new journals, nested PTC, file attribution, and regression checks that task feedback leaves model requests unchanged.

页面增量复验覆盖最低 Web `0.1.5-alpha.1`、已适配最高 Web `0.2.1-rc.2`、官方 Desktop `0.2.1-rc.2` 和 NEXT `2.0.17-next`。每端通过 7 项任务状态检查，涵盖全部展开、实时更新、原圆圈树、减少动态效果、长文本、失败状态、373/374 行列表的滚动/键盘访问/锚点与缩短数据；仅挂载视口附近行。每端另通过 6 项删除保护设置检查，包含三档切换、独立官方开关、保存重载、旧布尔配置和恢复默认。

Incremental UI checks cover minimum Web `0.1.5-alpha.1`, latest adapted Web `0.2.1-rc.2`, official Desktop `0.2.1-rc.2`, and NEXT `2.0.17-next`. Each passes seven task-status checks covering expansion, live updates, the circular graph, reduced motion, wrapped text, failures, and scrolling/keyboard access/anchors/shrinking data across 373/374 rows while mounting only nearby rows. Each also passes six deletion-settings checks covering modes, independent official opt-in, save/reload, legacy booleans, and reset.

任务状态页面使用真实宿主 API 和构造日志，不新增模型调用，不将夹具文件记录当作真实文件编辑。运行环和暗色主题 tokens 已检查，不宣称所有宿主主题设置组合或十万行真实浏览器性能已测。严格删除确认的引擎检查由测试驱动器答复真实宿主审批服务，不等同人工点击原生确认对话框。NEXT 测试外壳已知的两条 ready 诊断另列，任务页面插件异常和其他控制台错误/警告为零。未重跑未变的安装器或扩展平台范围；中间版本页面沿用既有验证记录，Windows/Linux 原生客户端仍未验收。

Task-status UI uses real host APIs with constructed journals, with no new model calls or claims of real file edits. Running indicators and dark-theme tokens are checked; this is not every host theme-setting combination or a 100,000-row browser benchmark. Strict-deletion engine checks answer the real host approval service through the driver, not manual clicks in native approval dialogs. Two known NEXT test-shell ready diagnostics are recorded separately; task pages have no plugin exceptions or other console errors/warnings. Unchanged installers and additional platforms were not retested; intermediate-version pages retain prior evidence, and native Windows/Linux clients remain unvalidated.

## 0.3.6 · 旧预算默认配置 · Legacy Budget Defaults · 2026-10-20

0.3.6 默认使用此前 Pro 测试的旧预算：完整上下文窗口、80% 压缩触发、16% 原文保留、8,192 Token 摘要、压缩追加与溢出重试各 1 次；提供新版 PTC 的宿主默认/上限为 600 秒，仍受宿主上限约束。用户保存值和加载配置优先，运行中的 Agent 保留快照，恢复默认会回到旧预算。括号内宿主默认值提示保持不变，官方预设仍默认不应用。

Version 0.3.6 uses the older Pro-test budgets by default: full-context-window accounting, compression at 80%, 16% verbatim retention, an 8,192-token summary cap, and one additional compression attempt and overflow retry. Hosts with the newer PTC provider use 600-second default/maximum deadlines within the host ceiling. Saved values and plugin configuration take precedence; running Agents retain their snapshots, and reset restores the older budgets. Host-default hints in parentheses remain unchanged, and official presets remain opt-in.

对下方同一组 **20 个 Web、5 个官方 macOS arm64 Desktop 和 DSH NEXT** 完成默认策略的增量复验，每个目标通过 6 项页面/实际 Agent 检查和 1 项进程冷重启检查，135 个运行文件与新候选逐字节一致。195 项测试、类型、构建和客户端语法检查通过；20 个实际 Web 宿主与 NEXT 各 11 项引擎检查通过。旧宿主无 `ptcRuntime` 时不会补入不支持的时限字段。客户端源文件字节未变。

The same **20 Web versions, five official macOS arm64 Desktop versions, and DSH NEXT** listed below passed incremental checks for the new default policy: six UI/actual-Agent checks and one cold-process-restart check per target, with all 135 runtime files matching the new candidate. All 195 tests, type checking, build, and client syntax checks passed, along with 11 engine checks on each actual Web host and NEXT. Older hosts without `ptcRuntime` receive no unsupported deadline fields. The client source remains byte-identical.

本次复制此前隔离 profile 并加载新候选，未重跑未变的安装器或全部语言/冲突/布局组合；下方完整矩阵保留为上一候选的历史证据。平台限制不变，测试使用本地确定性模型，无外部模型调用或新增 SWE-bench 成绩。上述验收候选标记为 `0.3.5`；发布包改为 `0.3.6`，运行文件仅更新包版本与两种预设版本标记，其余运行内容逐文件核对一致。

This delta run cloned prior isolated profiles and loaded the new candidate. It did not rerun the unchanged installer or every language/conflict/layout combination; the complete matrix below remains evidence for the preceding candidate. Platform limits are unchanged. Tests use a local deterministic model with no external model calls or new SWE-bench scores. The tested candidate was labeled `0.3.5`. The `0.3.6` release changes only the package version and both preset-version markers; all other runtime content is verified file by file as identical.

## 运行预算 · Runtime Budgets · 2026-10-19

页面优化后已重新打包，对此前支持的 **20 个官方 Web 版本、5 个官方 macOS arm64 Desktop 版本及 DSH NEXT** 完成同一候选包复验。每个目标均通过 11 项页面功能检查、6 项真实会话检查和 3 项进程冷启动检查；安装副本的 133 个运行文件与冻结候选逐字节一致。该轮测试使用当时尚未发布、版本标记为 `0.3.5` 的开发候选。

After the settings-page changes, the same packaged candidate passed revalidation on **20 supported official Web versions, five official macOS arm64 Desktop versions, and DSH NEXT**. Each target passed 11 UI behavior checks, six real-conversation checks, and three cold-process-restart checks. All 133 installed runtime files match the frozen candidate. That run used the then-unreleased development candidate labeled `0.3.5`.

| 宿主 / Host | 本轮通过版本 / Versions revalidated |
|---|---|
| 官方 Web / Official Web | `0.1.5-alpha.1`、`alpha.2`、`rc.1`、`rc.2`、`rc.3`；`0.1.6-alpha.1`、`alpha.2`；`0.1.7-alpha.1`、`alpha.2`、`rc.1`、`rc.2`；`0.2.0-rc.1`、`rc.2`；`0.2.1-alpha.1`、`alpha.2`、`alpha.3`、`alpha.4`、`alpha.5`、`rc.1`、`rc.2` |
| 官方 Desktop / Official Desktop | `0.1.7-rc.1`、`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.0-rc.2`、`0.2.1-rc.2` |
| DSH NEXT | `2.0.17-next`（内置 Harness / bundled Harness `0.2.0-rc.2`）|

全部 20 个 Web 在 800px 宽窗口追加控件边界、滚动可见性和指针命中检查，均通过。440px 宽时宿主固定侧栏仅给插件留下 156px 内容区，不计入可用性通过范围；最低、最高版不加载插件的通用设置也存在相同限制。原先仅检查内部 scrollWidth 的第 12 项已剔除，避免误称窄窗口可用。

All 20 Web versions also pass control-boundary, scroll-visibility, and pointer-hit checks at an 800px viewport. At 440px the host navigation leaves only 156px for plugin content; narrow-window usability is not accepted. Plugin-free baselines on the earliest and latest hosts show the same settings-layout limitation. The original internal-scrollWidth check is excluded from the acceptance count.

覆盖“预设状态 / 上下文配置”标签页、按需读取、键盘切换、草稿保留、实际宿主默认值和单位、自定义选择器、保存、无效输入、并发修改冲突、重新读取、恢复默认、中英文、重载与冷启动持久化。官方预设开关默认关闭，开启与关闭后的新旧 Agent 预算隔离通过真实 Standard 会话验证，Super Code 的任务容量限制通过实际 PTC 工具调用验证；标准、PTC、极简和创造四种预设的选择、压缩、并发及卸载边界另由每版 10 项引擎专项覆盖。

Checks cover the Preset status / Context settings tabs, lazy reads, keyboard navigation, retained drafts, actual host defaults and units, custom selectors, save, invalid input, concurrent-edit conflicts, reload, reset, Chinese/English, and cold-start persistence. The official-preset switch defaults off. Real Standard conversations verify opt-in and creation-time snapshots; actual PTC calls verify Super Code task-capacity limits. Ten engine checks per Web version separately cover selection, compaction, concurrency, and disposal for Standard, PTC, Minimal, and Create.

本轮修复语言偏好尚未保存时插件提前重载、导致语言回退的问题。192 项测试、类型检查、构建及客户端语法检查通过；20 个 Web 宿主各 10 项压缩专项、NEXT 10 项压缩专项通过。15 个 Web 宿主及 NEXT 的实际 Node PTC 均验证默认预算与显式较短时限；`0.1.5` 五版没有新版 `ptcRuntime`，页面正确禁用这些时限字段，其余预算和旧版 run_code 正常使用。

A fix waits for the accepted language preference before preset synchronization can reload the page, preventing optimistic language changes from being lost. All 192 tests, type checking, build, and client syntax checks pass, along with ten compaction checks on each Web version and ten on NEXT. Actual Node PTC tests on 15 Web hosts and NEXT verify the plugin default and an explicit shorter deadline. The five `0.1.5` hosts lack the newer `ptcRuntime`; their deadline fields are correctly disabled while other budgets and legacy run_code remain usable.

官方桌面使用应用内插件页安装、启用，未修改日常应用或配置。测试使用本地确定性模型，没有外部模型调用或新增 SWE-bench 成绩。原生实测范围为 macOS arm64，Web 使用 Chromium；未覆盖原生 Windows/macOS x64 或 Safari 专属行为。逐宿主真实官方会话为 Standard，专项组合测试不代表所有内置工具、权限和终端场景均已逐一实测。

Official Desktop packages were installed and enabled through their native plugin pages without changing daily apps or profiles. A local deterministic model supplied responses, with no external model calls or new SWE-bench scores. Native testing covers macOS arm64 and Web testing uses Chromium; Windows/macOS x64 native apps and Safari-specific behavior were not checked. Per-host real official-preset conversations use Standard; the engine composition checks do not establish every built-in tool, permission, or terminal scenario.

## 0.3.5 · Harness 0.2.1-rc.2 · 2026-10-18

兼容范围扩展至 `0.2.1-rc.2`，最低保持 `0.1.5-alpha.1`。本次基于主干 0.3.4，逐版固定并审计宿主依赖，在独立 profile 中真实安装和运行。现有 peer 依赖范围已覆盖这些预发布版本；补充 v4 日志迁移检查后，修复旧插件来源记录的识别及投影缓存失效，未增加依赖，发布版本为 0.3.5。

Compatibility extends through `0.2.1-rc.2`, with the minimum remaining `0.1.5-alpha.1`. Based on main at plugin version 0.3.4, candidates were installed and run in isolated profiles, with each host's dependency graph pinned and audited. Existing peer ranges already cover these prereleases. Additional v4 migration checks identified and fixed legacy plugin-source recognition and projection-cache invalidation without adding dependencies. The release version is 0.3.5.

| Harness | Web/CLI 与真实浏览器 / Web/CLI and real browser | 原生 Skill 加载 / Native Skill loading |
|---|---|---|
| `0.2.1-alpha.3` | 通过 / Pass | 组合与持久化 profile 均通过 / Bundle and persisted profile pass |
| `0.2.1-alpha.4` | 通过 / Pass | 组合与持久化 profile 均通过 / Bundle and persisted profile pass |
| `0.2.1-alpha.5` | 通过 / Pass | 组合与持久化 profile 均通过 / Bundle and persisted profile pass |
| `0.2.1-rc.1` | 通过 / Pass | 组合与持久化 profile 均通过 / Bundle and persisted profile pass |
| `0.2.1-rc.2` | 通过 / Pass | 组合与持久化 profile 均通过 / Bundle and persisted profile pass |

五版均验证原生 PTC、主/子 Agent、任务记忆、项目/全局记忆与归属、跨工作区隔离及冷重启后无需恢复会话的历史读取。真实浏览器覆盖执行树运行/完成动画、节点间距、减弱动态效果、320/400/560px 与缩放、互斥侧栏及状态恢复、记忆新增/编辑/取消/保存/删除、详情页记忆定位、中英文和明暗主题切换。十条 Skill 路径覆盖摘要目录、按需正文与三份参考文件读取、用户/项目同名覆盖。

All five passed native PTC, main/child Agents, task memory, project/global memory and attribution, workspace isolation, and historical reads after a cold restart without resuming the session. Real-browser checks cover running/completed tree animation, node spacing, reduced motion, 320/400/560px widths and zoom, exclusive sidebar sections and retained state, memory creation/editing/cancellation/saving/deletion, memory links from Agent details, and Chinese/English and light/dark switching. Ten Skill paths cover summary catalogs, on-demand content and three reference reads, and user/project overrides.

最低版本 `0.1.5-alpha.1` 另通过同一候选包的目录预设安装、主/子 Agent、PTC、记忆归属/隔离/重启和真实浏览器回归。171 项测试、类型检查、构建、客户端语法检查通过。

The minimum `0.1.5-alpha.1` also passed directory-preset installation, main/child Agents, PTC, memory attribution/isolation/restart, and real-browser regression with the same candidate. All 171 tests, type checking, build, and client syntax checks passed.

官方 macOS arm64 Desktop `0.2.1-rc.2` 从[官方下载地址](https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-0.2.1-rc.2-mac-arm64.zip)获取，并按官方更新源校验 SHA-512。在独立应用身份、DSH_HOME 和 userData 中，通过原生插件页安装并点击“立即启用”；设置页验证未安装预设的安装、重装确认/取消、从清单移除、按新标识符和中文名称重装、旧预设移除与恢复备份。真实原生主/子 Agent 的 PTC 和记忆流程、执行树动画、统一侧栏、记忆维护及中英文/明暗切换通过，保留截图；冷启动后确认改名预设、自定义名称与项目/全局记忆保留，历史子会话无需恢复即可读取记忆。正式应用和日常配置未修改。

Official macOS arm64 Desktop `0.2.1-rc.2` was obtained from the [official download](https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-0.2.1-rc.2-mac-arm64.zip) and SHA-512 verified against its update feed. In an isolated app identity, DSH_HOME, and userData, the native plugin page installed and enabled the plugin. Settings checks cover missing-preset installation, reinstall confirmation/cancellation, removing confirmation rows, reinstallation with a new identifier and Chinese name, removal of the old preset, and recovery backups. Real native main/child PTC and memory flows, tree animation, unified sections, memory maintenance, and Chinese/English and light/dark switching passed with screenshots. A cold start preserved the renamed preset, custom name, and project/global memory, with historical child memory readable without resuming the session. The official app and daily configuration were not changed.

截至本次检查，官方 npm `latest` 为 `0.2.0-rc.2`、`alpha` 为 `0.2.1-alpha.5`、`next` 为 `0.2.1-rc.2`；桌面 nightly 同为 `0.2.1-rc.2`。[官方发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)。本次模型响应由本地确定性程序提供，没有调用外部模型、没有新增 SWE-bench 成绩，也不代表 Windows、macOS x64 或其他新增版本的原生桌面已复验；其他版本保留以下历史记录。

At this check, official npm tags point to `latest: 0.2.0-rc.2`, `alpha: 0.2.1-alpha.5`, and `next: 0.2.1-rc.2`; Desktop nightly is also `0.2.1-rc.2`. [Official release notes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2). A local deterministic fixture supplied model responses, without external model calls or new SWE-bench scores. This does not establish native Desktop revalidation on Windows, macOS x64, or the other newly covered versions; earlier records remain below.

### v4 会话日志补充验证 · 2026-10-18

物理日志解压、格式迁移、分页与游标由 Harness 的 Session 和官方 journal API 处理；插件不直接解析用户的日志文件。v4 会把旧的 `{kind: "plugin", plugin: "…"}` 来源迁移为 `{kind: "plugin:…"}`。原读取器会跳过其中的任务记录，导致升级后的任务状态、历史与归档不可见。现已识别新旧包名对应的精确来源，同时保留原有直接来源和旧包装形式；任务投影版本由 1 提升到 2，使此前遗漏记录的缓存重新回放。无需为此依赖实验性的 plugin-record API，仍兼容旧宿主。

Harness Session and official journal APIs own physical decompression, migration, pagination, and cursors; the plugin does not parse users' log files directly. V4 migrates `{kind: "plugin", plugin: "…"}` to `{kind: "plugin:…"}`. The previous reader skipped these task records, hiding task state, history, and archives after an upgrade. It now recognizes the exact current and legacy package sources while preserving direct sources and old wrappers. The task projection version increases from 1 to 2 to replay caches that previously missed those records. This does not require the experimental plugin-record API or remove older-host support.

使用官方 rc.2 格式迁移器与真实 v3 会话（含历史子会话事实）验证直接来源、新包名旧包装、旧包名旧包装三条路径；对照原生 v4 日志，核对任务状态、11 对工具证据、9 条记忆使用记录、按模型用量和历史详情。另验证旧空缓存失效、全量重建及后续尾部回放，并增加任务保存、归档、聚焦与无关插件隔离回归；173 项测试、类型检查、构建和客户端语法检查通过。本补充不代表已遍历所有历史损坏或中断日志；上方五版和原生桌面界面记录来自首轮候选包。

The official rc.2 format migrator restored real v3 sessions with historical child facts for direct sources and wrappers using both current and legacy package names. Comparisons with native v4 logs cover task state, 11 tool-evidence pairs, nine memory-usage rows, per-model usage, and historical details. Checks also cover invalidating stale empty caches, full replay, and subsequent tail replay. Added regressions cover task saving, archiving, focus, and unrelated-plugin isolation. All 173 tests, type checking, build, and client syntax checks passed. This supplement does not cover every damaged or interrupted historical log; the five-version and native Desktop UI records above used the initial candidate.

修复后的安装包另在 `0.1.5-alpha.1` 和 `0.2.1-rc.2` 中通过真实安装、激活、主/子 Agent、PTC、记忆归属、工作区隔离和冷重启历史读取回归；实际安装的任务投影实现与候选包一致。本补充未重跑浏览器及原生桌面界面，客户端仅更正日志格式注释。

The fixed package also passed real installation, activation, main/child Agents, PTC, memory attribution, workspace isolation, and historical reads after a cold restart on `0.1.5-alpha.1` and `0.2.1-rc.2`. The installed task projection matches the candidate. This supplement did not rerun browser or native Desktop UI checks; the client change only corrects a log-format comment.

## 0.3.4 · 2026-10-15

本次更新评测文档、公开结果快照与致谢，宿主依赖和运行行为不变。构建后 112 个运行文件与 0.3.3 发布包逐字节一致，两份预设组合仅将版本标记更新为 0.3.4；此前 0.3.3 的宿主验收记录继续适用，本轮未重跑 Web / 原生 Desktop 界面，也未新增模型效果评测。

This release updates evaluation documentation, the public results snapshot, and acknowledgements, with unchanged host dependencies and runtime behavior. After building, 112 runtime files are byte-for-byte identical to the 0.3.3 release package; the two preset compositions only update their version marker to 0.3.4. The 0.3.3 host-validation records below remain applicable. Web/native Desktop UI checks and new model-quality evaluations were not rerun for this release.

171 项测试、类型检查、构建及客户端语法检查通过；另核对评测快照汇总、文档链接、版本一致性和打包范围。

All 171 tests, type checking, build, and client syntax checks passed. Additional checks cover evaluation-snapshot aggregates, documentation links, version consistency, and package contents.

## 0.3.3 · 2026-10-14

支持下限保持 `0.1.5-alpha.1`，依赖范围不变。本次核对官方 npm `latest`/`next` 为 `0.2.0-rc.2`，`alpha` 为 `0.2.1-alpha.2`。以下三个宿主使用固定并审计的依赖和隔离 profile，真实安装 0.3.3 组合候选包；其他版本保留此前逐版记录，本次没有全部重测。

The minimum remains `0.1.5-alpha.1`, with unchanged dependency ranges. Official npm `latest`/`next` is `0.2.0-rc.2` and `alpha` is `0.2.1-alpha.2` on this date. The three pinned, audited hosts below installed the combined 0.3.3 candidate in isolated profiles. Other versions retain earlier per-version records and were not all rerun.

| Harness | 预设机制 / Presets | 0.3.3 Web/CLI 与浏览器 / Web/CLI and browser |
|---|---|---|
| `0.1.5-alpha.1` | 目录 / Directory | 通过 / Pass |
| `0.2.0-rc.2` | 声明式 / Declarative | 通过 / Pass |
| `0.2.1-alpha.2` | 声明式 / Declarative | 通过 / Pass |

三版均通过安装/激活、主/子 Agent、项目/全局记忆、跨工作区隔离和重启读取。实际浏览器验证覆盖单个 Super Code 入口、默认执行区、互斥展开与键盘/焦点、整行标题、同页及重复记忆定位、树分支与历史筛选恢复、记忆新增/编辑/取消/保存/删除确认、草稿及进行中保存跨区恢复；另验证运行与完成动画、减弱动态效果、320/400/560px 与极限缩放时节点/文字/连线间距。稳定版与 alpha 版另实际切换中英文、明暗主题，无页面或控制台错误。模型由本地确定性验收程序提供，没有调用外部模型。

All three passed installation/activation, main/child Agents, project/global memory, workspace isolation, and restart reads. Real-browser checks covered the unified Super Code entry, the default tree, mutually exclusive sections, keyboard/focus behavior, full-width headings, repeated same-page memory navigation, retained tree/history filters, memory creation/editing/cancellation/saving/confirmed deletion, and drafts/in-flight saves across section switches. Checks also covered running/completed animation, reduced motion, node/label/connector spacing at 320/400/560px and zoom limits. Stable and alpha hosts additionally passed Chinese/English and light/dark switching, without page or console errors. A local deterministic fixture supplied model responses; no external model was called.

内嵌前端 Skill 从同一候选包验证三版宿主的六条原生加载路径，覆盖目录预设及复制安装、声明式组合及持久化 profile、摘要目录、按需正文/参考读取和项目/用户同名覆盖。安装与加载验证不代表模型前端作品质量已经提升。

The bundled frontend Skill passed six native loading paths from the same candidate across these hosts: directory presets/copied installs, declarative bundles/persisted profiles, summary catalogs, on-demand content/reference reads, and project/user overrides. Installation and loading checks do not establish improved model-generated frontend quality.

官方 macOS arm64 Desktop `0.2.0-rc.2` 在隔离应用及 profile 中通过原生插件页面从 0.3.2 升级到 0.3.3，重启后旧预设仍为 0.3.2，差异提示与确认取消通过；确认重装及宿主自动重载后，预设版本更新为 0.3.3 并包含内嵌 Skill。统一侧栏切换、草稿恢复与完整记忆维护流程通过并留有截图；真实主会话的运行/完成动画、切换恢复、宽度/缩放、减弱动态效果及节点间距通过，不将主会话检查视为原生 live 子 Agent 工具验收。副本保留原始 CFBundleName，隔离应用身份、profile 和 userData；正式应用及日常配置未修改。

Official macOS arm64 Desktop `0.2.0-rc.2` upgraded from 0.3.2 to 0.3.3 through its native plugin page in an isolated app/profile. After restart, the old preset retained 0.3.2, with a mismatch notice and cancellable confirmation. Confirmed reinstallation and the host's automatic reload updated the preset to 0.3.3 with the bundled Skill. Unified-section switching, draft recovery, and the complete memory maintenance flow passed with screenshots. A live main session passed running/completed animation, section recovery, width/zoom, reduced motion, and node spacing; this does not constitute native live child-Agent tool validation. The copy retains CFBundleName and isolates application identity, profile, and userData; the official app and daily configuration were not modified.

171 项全量测试、类型检查、构建、客户端语法及 diff 检查通过。其他原生桌面版本和平台沿用历史覆盖，不宣称本轮全量复验；没有新增 SWE-bench 效果成绩。

All 171 tests, type checking, build, client syntax, and diff checks passed. Other native desktop versions and platforms retain historical coverage rather than a claim of full revalidation. This release adds no new SWE-bench performance scores.

## 0.3.2 · 2026-10-11

支持下限保持 `0.1.5-alpha.1`，没有新增依赖或宿主私有 UI 接口。官方 npm `latest`/`next` 仍为 `0.2.0-rc.2`，`alpha` 为 `0.2.1-alpha.2`。本次使用固定并审计的依赖和隔离 profile，在以下三个宿主重新安装 0.3.2 候选包并验收；中间版本保留下面 0.3.1 的逐版记录，本次没有全部重测。

The minimum remains `0.1.5-alpha.1`, without new dependencies or private host UI APIs. Official npm `latest`/`next` remains `0.2.0-rc.2`, and `alpha` is `0.2.1-alpha.2`. This release installed the 0.3.2 candidate in the three pinned, audited hosts below using isolated profiles. Intermediate versions retain the per-version 0.3.1 records below and were not all rerun.

| Harness | 预设机制 / Presets | 0.3.2 Web/CLI 与浏览器 / Web/CLI and browser |
|---|---|---|
| `0.1.5-alpha.1` | 目录 / Directory | 通过 / Pass |
| `0.2.0-rc.2` | 声明式 / Declarative | 通过 / Pass |
| `0.2.1-alpha.2` | 声明式 / Declarative | 通过 / Pass |

三版均通过插件安装/激活、主/子 Agent、任务与项目/全局记忆、跨工作区隔离和重启读取。浏览器检查覆盖圆形执行树、缩放拖动、320/400/560px 单行操作、上方名称气泡、自定义时间/排序菜单的鼠标与键盘操作、紧凑 Agent 详情、旧/新版真实工具卡、主题目录/关联条目/搜索、展开设置、版本、刷新及确认列表移除/取消。没有浏览器控制台或页面错误。稳定版另实际切换中英文和明暗主题，核对默认名称、版本和气泡并截图。模型由本地确定性验收程序提供，没有调用外部模型。

All three passed installation/activation, main/child Agents, task/project/global memory, workspace isolation and restart reads. Browser checks covered circular trees, zoom/pan, one-row actions at 320/400/560px, above-button name bubbles, custom time/sort menus with mouse and keyboard, compact Agent details, real tool cards from old/new journals, topic navigation/related entries/search, expanded settings, versions, refresh and removable/cancellable confirmation lists. No console or page errors occurred. The stable host additionally passed actual Chinese/English and light/dark switching with default-name, version and tooltip screenshots. A local deterministic fixture supplied model responses; no external model was called.

官方 macOS arm64 Desktop `0.2.0-rc.2` 的隔离应用副本实际验收了圆形树、命名操作、自定义菜单、真实工具详情、主题记忆库、版本和确认重装；移除后确认禁用、Escape 保留设置页、实际确认成功及恢复备份均已核对。副本保留原始 CFBundleName，隔离 bundle ID、profile 和 userData。后续启动语言等待修复由三版 Web 和单元测试复验；原生控制接口恢复时超时，未补录该最终修复的原生窗口截图。其他桌面版本和平台沿用历史范围，不宣称本次已全部验收。

An isolated copy of official macOS arm64 Desktop `0.2.0-rc.2` passed actual UI checks for circular trees, named actions, custom menus, real tool details, topic memory, versions and confirmed reinstallation. Removal disabled confirmation, Escape retained Settings, and actual reinstallation and recovery backups were checked. The copy preserves CFBundleName and isolates its bundle ID, profile and userData. The later startup-language wait fix passed all three Web hosts and unit tests; desktop-control recovery timed out, so a final native-window screenshot for that fix was not obtained. Other desktop versions and platforms retain historical coverage rather than a claim of full revalidation.

158 项测试、类型检查、构建与客户端语法检查通过。预设安装、归属校验、用户字段保护和备份逻辑未改；启动同步通过宿主公开语言偏好服务等待加载，并按宿主版本声明 `settingsScope` 或 `configForms` 依赖。

All 158 tests, type checking, build and client syntax checks passed. Preset installation, ownership checks, user-field protection and backup logic are unchanged. Startup synchronization waits through the host's public language-preference service and declares the host-appropriate `settingsScope` or `configForms` dependency.

## 0.3.1 · 2026-10-10

支持下限保持 `0.1.5-alpha.1`。截至本次核对，官方 npm 的 `latest`/`next` 指向 `0.2.0-rc.2`，`alpha` 指向 `0.2.1-alpha.2`；官方 macOS arm64 Desktop 更新源指向 `0.2.0-rc.2`。

The minimum remains `0.1.5-alpha.1`. On this date, official npm `latest`/`next` points to `0.2.0-rc.2` and `alpha` to `0.2.1-alpha.2`; the official macOS arm64 Desktop update feed points to `0.2.0-rc.2`.

下表 15 个官方 Harness 版本均真实安装 0.3.1 候选包，使用固定并审计的宿主依赖和隔离 profile。预设检查覆盖缺失安装、确认流程所用的改名/改标识符重装接口、冲突保护、语言同步和重启后读取/重装。主/子 Agent、任务与项目/全局记忆、跨工作区隔离、重启读取及网页执行树、缩放拖动、侧栏详情、记忆库、展开设置、版本展示和确认列表移除/取消均通过。模型由本地确定性测试提供，没有调用外部模型。

All 15 official Harness versions below installed the 0.3.1 candidate with pinned, audited host dependencies and isolated profiles. Preset checks covered missing installation, rename/identifier reinstallation, conflicts, language synchronization and restart recovery. Main/child Agents, task/project/global memory, workspace isolation and restart reads passed, along with web tree/zoom/pan, sidebar details, memory library, expanded settings, independent versions, and removable/cancellable confirmation lists. Tests used a local deterministic model without external model calls.

| Harness | 预设机制 / Presets | 0.3.1 Web/CLI 与浏览器 / Web/CLI and browser |
|---|---|---|
| `0.1.5-alpha.1` | 目录 / Directory | 通过 / Pass |
| `0.1.5-alpha.2` | 目录 / Directory | 通过 / Pass |
| `0.1.5-rc.1` | 目录 / Directory | 通过 / Pass |
| `0.1.5-rc.2` | 目录 / Directory | 通过 / Pass |
| `0.1.5-rc.3` | 目录 / Directory | 通过 / Pass |
| `0.1.6-alpha.1` | 目录 / Directory | 通过 / Pass |
| `0.1.6-alpha.2` | 目录 / Directory | 通过 / Pass |
| `0.1.7-alpha.1` | 声明式 / Declarative | 通过 / Pass |
| `0.1.7-alpha.2` | 声明式 / Declarative | 通过 / Pass |
| `0.1.7-rc.1` | 声明式 / Declarative | 通过 / Pass |
| `0.1.7-rc.2` | 声明式 / Declarative | 通过 / Pass |
| `0.2.0-rc.1` | 声明式 / Declarative | 通过 / Pass |
| `0.2.0-rc.2` | 声明式 / Declarative | 通过 / Pass |
| `0.2.1-alpha.1` | 声明式 / Declarative | 通过 / Pass |
| `0.2.1-alpha.2` | 声明式 / Declarative | 通过 / Pass |

原生 PTC 另在最低版、稳定最新版和预发布最新版（`0.1.5-alpha.1`、`0.2.0-rc.2`、`0.2.1-alpha.2`）验证独立读取并行、写入顺序、权限拒绝与部分失败保留。0.1.7 的两个 alpha 版没有预设文档读取接口，因此归属核验要求唯一、启用的 Loader 声明；其他声明式版本核验实际活跃组合的来源标记。桌面宿主使用自己的安装位置解析管理 API，避免加载第二份宿主模块。

Native PTC additionally passed parallel independent reads, ordered writes, permission denial and partial-failure preservation on the minimum, stable latest and prerelease latest versions. The two 0.1.7 alpha hosts lack the document reader, so ownership requires a unique enabled Loader declaration; later hosts verify the marker in the active composition. Desktop management resolves APIs from the running host installation to avoid loading a separate host module.

官方 macOS arm64 的 `0.1.7-rc.1`、`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.0-rc.2` 发行包均在隔离应用副本中启动，验证原生后端的预设安装、改名重装、语言和版本状态。副本保留原始 CFBundleName，仅隔离应用身份、profile 与测试端口。Safari 最新 alpha.2 与官方 Desktop rc.2 的实际界面验收另留截图。DSH NEXT 2.0.17-next（Harness rc.2）也使用隔离副本验收。

The official macOS arm64 releases of `0.1.7-rc.1`, `0.1.7-rc.2`, `0.2.0-rc.1` and `0.2.0-rc.2` launched in isolated app copies and passed native-backend preset installation, renamed reinstallation, language and version-state checks. Copies retain the original CFBundleName and isolate application identity, profiles and test ports. Separate screenshots record Safari alpha.2 and official Desktop rc.2 UI checks. DSH NEXT 2.0.17-next (Harness rc.2) uses an isolated copy as well.

四版原生后端均验证重启后的归属与版本恢复。官方 Desktop rc.2 和 DSH NEXT 实际点击完成缺失安装、改名/改标识符确认重装，核对设置回填及旧内容恢复备份。官方 Desktop 的中文版本不一致提示通过截图；移除聚焦条目后 Escape 只关闭确认框、保留设置页的修复已复验。英文及未知版本状态有双语单元覆盖，但后续原生截图受桌面控制接口超时限制，未记作通过。

All four native backends restored ownership and version state after restart. Actual clicks in official Desktop rc.2 and DSH NEXT completed missing installation and confirmed rename/identifier reinstallation, with form values and recovery backups checked. The official Desktop Chinese mismatch notice was captured, and Escape after removing the focused row now closes only the confirmation while retaining Settings. Unit tests cover English and unknown-version states; subsequent native screenshots were limited by desktop-control timeouts and are not claimed as passed.

更早版本及 `0.2.1-alpha.1/alpha.2` 的对应官方 macOS arm64 安装包未从本次核对的下载地址获取（HTTP 404），不能据此宣称这些版本的原生桌面窗口已通过。Web/CLI 验证与原生 Desktop 验证分别记录；其他平台、外部模型和完整用户升级场景仍需单独验收。下面保留历史发布记录。

Matching official macOS arm64 installers for earlier versions and `0.2.1-alpha.1/alpha.2` returned HTTP 404 at the checked download URLs; their native desktop windows are not claimed as verified. Web/CLI and native Desktop results are recorded separately. Other platforms, external models and complete user-upgrade scenarios require separate checks. Historical release records follow.

## 历史发布验证 · Previous Release Checks

Super Code 0.3.0 于 2026-10-09 重新验证了最低支持版 `0.1.5-alpha.1`、`0.2.0-rc.2` 和最新已适配版 `0.2.1-alpha.1`。三版均在隔离 profile 中真实安装发布候选包，通过原生 PTC 独立读取并行、写入顺序、权限拒绝、部分失败保留、主/子 Agent 记忆及重启读取；Playwright 网页回归覆盖执行树、拖动和缩放、侧栏详情、记忆库、记忆使用记录及可折叠设置。使用本地确定性模型，没有调用外部模型服务。

On October 9, 2026, Super Code 0.3.0 rechecked the minimum supported host, `0.1.5-alpha.1`, plus `0.2.0-rc.2` and the latest adapted host, `0.2.1-alpha.1`. All three installed the release candidate in isolated profiles and passed native PTC parallel reads, ordered writes, permission denial, partial-failure preservation, main/child Agent memory, and restart reads. Playwright web checks covered the tree, drag and zoom, sidebar details, the memory library, memory activity, and collapsible settings. These checks used a local deterministic model with no external model calls.

本次补齐了 PTC 内部记忆调用的使用记录解析；读取摘要、详情、保存和删除仍分别展示，父 Agent 的历史记录不会算成子 Agent 的操作。0.2.1 的语言资源及兼容改动保留，支持下限没有提高；中间版本保留此前验收记录，本次未全部重测。

This release adds memory activity for nested PTC calls. Summary reads, detail reads, saves, and removals remain distinct, and parent history is not attributed to a child's actions. The 0.2.1 locale and compatibility updates remain in place, with no increase in the minimum supported version. Intermediate versions retain their earlier verification records and were not all rerun for this release.

Super Code 0.2.1 的兼容适配于 2026-10-08 继续验证了 `0.2.0-rc.2` 与 `0.2.1-alpha.1`。官方 npm 发布记录在这个范围内没有其他版本；两版分别使用精确固定的宿主组件和新的隔离 profile。安装、激活、声明式预设、主/子 Agent、任务及项目/全局记忆、跨工作区隔离、重启读取均通过；Safari 中完成执行树、缩放、子 Agent 详情、记忆记录跳转及插件停用后重新启用的检查。alpha.1 另验证中英文切换时打开的 tab 和插件管理文案同步更新。以下更早版本保留此前的验收结果，本轮没有全部重测。

The Super Code 0.2.1 adaptation checked `0.2.0-rc.2` and `0.2.1-alpha.1` again on 2026-10-08. The official npm release history contains no other version between them. Each used precisely pinned host components and a fresh isolated profile. Installation, activation, declarative presets, main/child Agents, task and project/global memory, workspace isolation, and restart reads passed. Safari checks covered the execution tree, zoom, child Agent details, memory activity navigation, and disabling/re-enabling the plugin. Alpha.1 also passed Chinese/English switching for open tabs and plugin management text. Earlier rows retain their previous results; they were not all rerun in this batch.

截至 2026-09-30，下表中从 `0.1.5-alpha.1` 到 `0.2.0-rc.2` 的十个指定 Harness 版本通过了 Super Code 0.2.0 候选的隔离 Web/CLI 集成冒烟和真实浏览器验收，覆盖记忆库、Agent 详情、筛选和缩放。每个环境固定并审计宿主依赖，使用本地确定性模型，不访问外部模型服务；本轮也使用该验证方式。

As of 2026-09-30, the Super Code 0.2.0 candidate passed isolated Web/CLI integration and real browser checks on the ten listed Harness versions from `0.1.5-alpha.1` through `0.2.0-rc.2`, covering the memory library, Agent details, filtering, and zoom controls. Each environment pins and audits host dependencies and uses a local deterministic model, not an external model service. This batch uses the same verification approach.

| Harness | 预设机制 / Preset mechanism | 历史冒烟 / Previous smoke | 0.3.0 Web/PTC |
|---|---|---|---|
| `0.1.5-alpha.1` | 目录 / Directory | 通过 / Pass | 通过 / Pass |
| `0.1.5-rc.3` | 目录 / Directory | 通过 / Pass | 未重测 / Not rerun |
| `0.1.6-alpha.1` | 目录 / Directory | 通过 / Pass | 未重测 / Not rerun |
| `0.1.6-alpha.2` | 目录 / Directory | 通过 / Pass | 未重测 / Not rerun |
| `0.1.7-alpha.1` | 声明式 / Declarative | 通过 / Pass | 未重测 / Not rerun |
| `0.1.7-alpha.2` | 声明式 / Declarative | 通过 / Pass | 未重测 / Not rerun |
| `0.1.7-rc.1` | 声明式 / Declarative | 通过 / Pass | 未重测 / Not rerun |
| `0.1.7-rc.2` | 声明式 / Declarative | 通过 / Pass | 未重测 / Not rerun |
| `0.2.0-rc.1` | 声明式 / Declarative | 通过 / Pass | 未重测 / Not rerun |
| `0.2.0-rc.2` | 声明式 / Declarative | 通过 / Pass | 通过 / Pass |
| `0.2.1-alpha.1` | 声明式 / Declarative | 通过 / Pass | 通过 / Pass |

## 0.2.1-alpha.1 适配 · Adaptation

该版宿主通过导出的 `<插件标识>/locale/*.json` 读取展示信息，子路径不再读取独立 `package.json`。插件为根路径、`/dsh` 和 `/super-code` 提供相同的中英文名称和描述，官方元数据读取器在两版宿主中均验证通过。Harness peer 依赖范围新增 `^0.2.1-alpha.1`，明确允许该预发布系列；范围内的未来版本仍需单独验收。

This host reads display metadata through exported `<plugin-specifier>/locale/*.json` resources and no longer reads separate `package.json` files for plugin subpaths. The package exports the same Chinese/English names and descriptions for its root, `/dsh`, and `/super-code` entries. Both versions' official metadata readers passed these checks. Harness peer ranges now include `^0.2.1-alpha.1` to allow this prerelease series explicitly; future versions within the range still require separate verification.

宿主同时拆分 composer 的 `stats` 并移除运行时 `invariant` 导出；插件未使用这两个旧接口，无须增加兼容分支。用量展示和插件启停后的界面恢复已通过上述集成及浏览器检查。

The host also splits composer `stats` and removes the runtime `invariant` export. The plugin uses neither old interface, so no compatibility branch is needed. Usage display and interface recovery after plugin reactivation passed the integration and browser checks above.

## 检查范围 · Checks

- CLI 版本与启动、插件安装和激活、配置加载、Web 服务启动、记忆持久化和重启读取。
  CLI identity and startup, plugin installation and activation, configuration loading, Web startup, and persistent memory reads after restart.
- Super Code 预设发现及状态、工作区和会话创建、选模、发送提示词，以及 `super_code_method` 返回非错误结果。
  Super Code preset discovery and status, workspace/session creation, model selection, prompting, memory persistence/restart reads, and a non-error `super_code_method` result.
- 宿主 npm 与 profile pnpm 锁文件审计。插件不再依赖新版宿主已停用的目录预设辅助包；旧版目录副本仍由插件管理。
  Host npm and profile pnpm lockfile audits. The plugin no longer depends on the retired directory-preset helper package; it still manages directory copies on older hosts.

## 依赖与安装注意事项 · Dependency and Installation Notes

对外说明按 Harness `0.1.5-alpha.1`～`0.2.1-alpha.2` 的适配范围写；npm 依赖声明仍需分别列出预发布系列。按 npm 的版本规则，单写 `>=0.1.5-alpha.1 <0.3.0` 会排除 `0.1.6-alpha.1`、`0.2.0-rc.2` 等已支持的 alpha/rc 版本，因此不能直接合并成一个连续范围。

User-facing guidance describes adaptations for Harness `0.1.5-alpha.1`–`0.2.1-alpha.2`; npm dependency declarations still list the prerelease series individually. Under npm's version rules, a single `>=0.1.5-alpha.1 <0.3.0` range excludes supported prereleases such as `0.1.6-alpha.1` and `0.2.0-rc.2`, so those declarations cannot be collapsed into one continuous range.

预发布依赖的 caret 范围可能解析到其他 alpha/rc 版本。此前默认安装 `0.1.6-alpha.1` 时混入 alpha.2，导致宿主在插件加载前报 `watchUserPatches` 导出缺失；`0.1.7-alpha.1` 也曾解析到 rc.1。验证环境通过精确 overrides 解决混版，但这并未修复上游发布的依赖声明，也不证明未锁定的默认安装总能成功。遇到类似错误时，应先核对实际安装的宿主组件版本。

Caret ranges on prerelease dependencies can resolve to other alpha/rc versions. A previous default `0.1.6-alpha.1` installation pulled alpha.2 components and failed on a missing `watchUserPatches` export before loading the plugin; `0.1.7-alpha.1` also pulled rc.1 components. Exact overrides removed this drift in the verification environments, but do not repair upstream dependency declarations or establish that every unpinned default installation works. Check the installed host component versions first when diagnosing such errors.

旧宿主在隔离 profile 中需要能够解析宿主包；测试按需补齐了该解析路径，并显式激活插件。各版本使用新的独立 profile 安装同一候选包，并复用缓存的宿主依赖；这些结果不代表全部版本的冷下载验收。

Older hosts need host packages to be resolvable from the isolated profile; the checks prepare that resolution path where needed and explicitly activate the plugin. Each version installs the same candidate package into a fresh profile and reuses cached host dependencies. These results do not cover cold downloads for every version.

`zod` 用于运行时输入校验，`js-yaml` 用于旧宿主的预设文件；依赖文件未内嵌到插件 tarball。发布包包含插件、用户文档和截图，不包含本地验证环境、原始日志或内部脚本。

`zod` validates runtime input and `js-yaml` handles preset files on older hosts; their files are not bundled into the plugin tarball. The package includes the plugin, public guides, and screenshots, not local verification environments, raw logs, or internal scripts.

## 官方 Desktop · Official Desktop

以下是此前 `0.2.0-rc.2` 的 Desktop 验收记录。0.3.0 本轮使用 Web/CLI 和 Playwright，未重测原生 Desktop；此前 `0.2.1-alpha.1` 的官方 GitHub Release 无 Desktop 附件，官方更新源也未获取到该版 macOS arm64 安装包，因此尚未完成该版原生 Desktop 验收。

The following is the previous Desktop verification for `0.2.0-rc.2`. The 0.3.0 checks use Web/CLI and Playwright; native Desktop was not rerun. The official `0.2.1-alpha.1` GitHub Release had no Desktop assets, and its macOS arm64 installer was not available from the official update source, so native Desktop verification for that version remains outstanding.

官方 Desktop `0.2.0-rc.2` 的 macOS arm64 发行包已另行通过原生窗口验收：安装和启用插件、选择 Super Code、主/子 Agent 执行、执行树、缩放、侧栏详情、记忆库、记忆使用记录及可折叠设置。中英文切换时，已打开的 tab 标题和界面文案同步更新，任务标题与记忆正文保留原文；重启后记忆和界面语言可恢复。该验收使用隔离配置和本地确定性模型。

The official Desktop `0.2.0-rc.2` macOS arm64 release also passed checks in its native window: plugin installation and activation, Super Code selection, main/child Agent execution, the tree, zoom, sidebar details, the memory library, memory activity, and collapsible settings. Open tab titles and interface labels update when switching between Chinese and English; task titles and memory text stay in their original language. Memory and the interface language persist after restart. These checks use an isolated profile and a local deterministic model.

## 未覆盖项 · Not Covered

其他 Desktop 版本和平台、真实模型服务、完整升级/自定义配置回归、所有工具组合，以及整合发布包的新 SWE-bench 效果评测仍未覆盖。公开成绩采用[冻结候选结果](EvaluationResults.md)；依赖声明中的版本范围不是未列版本的验证结论。

Other Desktop versions and platforms, live model services, complete upgrade/customization regression, every tool combination, and a new SWE-bench quality evaluation of the integrated release package remain outside this scope. Published scores use the [frozen candidate results](EvaluationResults.md); declared dependency ranges are not verification results for unlisted versions.

预设管理差异见[使用指南](UsageGuide.md)，版本变更见[更新日志](Changelog.md)。

See the [usage guide](UsageGuide.md) for preset management differences and the [changelog](Changelog.md) for release changes.
