# 宿主兼容性 · Host Compatibility

Super Code 0.2.1 的兼容适配于 2026-10-08 继续验证了 `0.2.0-rc.2` 与 `0.2.1-alpha.1`。官方 npm 发布记录在这个范围内没有其他版本；两版分别使用精确固定的宿主组件和新的隔离 profile。安装、激活、声明式预设、主/子 Agent、任务及项目/全局记忆、跨工作区隔离、重启读取均通过；Safari 中完成执行树、缩放、子 Agent 详情、记忆记录跳转及插件停用后重新启用的检查。alpha.1 另验证中英文切换时打开的 tab 和插件管理文案同步更新。以下更早版本保留此前的验收结果，本轮没有全部重测。

The Super Code 0.2.1 adaptation checked `0.2.0-rc.2` and `0.2.1-alpha.1` again on 2026-10-08. The official npm release history contains no other version between them. Each used precisely pinned host components and a fresh isolated profile. Installation, activation, declarative presets, main/child Agents, task and project/global memory, workspace isolation, and restart reads passed. Safari checks covered the execution tree, zoom, child Agent details, memory activity navigation, and disabling/re-enabling the plugin. Alpha.1 also passed Chinese/English switching for open tabs and plugin management text. Earlier rows retain their previous results; they were not all rerun in this batch.

截至 2026-09-30，下表中从 `0.1.5-alpha.1` 到 `0.2.0-rc.2` 的十个指定 Harness 版本通过了 Super Code 0.2.0 候选的隔离 Web/CLI 集成冒烟和真实浏览器验收，覆盖记忆库、Agent 详情、筛选和缩放。每个环境固定并审计宿主依赖，使用本地确定性模型，不访问外部模型服务；本轮也使用该验证方式。

As of 2026-09-30, the Super Code 0.2.0 candidate passed isolated Web/CLI integration and real browser checks on the ten listed Harness versions from `0.1.5-alpha.1` through `0.2.0-rc.2`, covering the memory library, Agent details, filtering, and zoom controls. Each environment pins and audits host dependencies and uses a local deterministic model, not an external model service. This batch uses the same verification approach.

| Harness | 预设机制 / Preset mechanism | 冒烟结果 / Smoke result |
|---|---|---|
| `0.1.5-alpha.1` | 目录 / Directory | 通过 / Pass |
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

预发布依赖的 caret 范围可能解析到其他 alpha/rc 版本。此前默认安装 `0.1.6-alpha.1` 时混入 alpha.2，导致宿主在插件加载前报 `watchUserPatches` 导出缺失；`0.1.7-alpha.1` 也曾解析到 rc.1。验证环境通过精确 overrides 解决混版，但这并未修复上游发布的依赖声明，也不证明未锁定的默认安装总能成功。遇到类似错误时，应先核对实际安装的宿主组件版本。

Caret ranges on prerelease dependencies can resolve to other alpha/rc versions. A previous default `0.1.6-alpha.1` installation pulled alpha.2 components and failed on a missing `watchUserPatches` export before loading the plugin; `0.1.7-alpha.1` also pulled rc.1 components. Exact overrides removed this drift in the verification environments, but do not repair upstream dependency declarations or establish that every unpinned default installation works. Check the installed host component versions first when diagnosing such errors.

旧宿主在隔离 profile 中需要能够解析宿主包；测试按需补齐了该解析路径，并显式激活插件。各版本使用新的独立 profile 安装同一候选包；缓存宿主依赖，因此不等于十版都重新做过冷下载。

Older hosts need host packages to be resolvable from the isolated profile; the checks prepare that resolution path where needed and explicitly activate the plugin. Each version installs the same candidate package into a fresh profile, reusing cached host dependencies rather than downloading every host again.

`zod` 用于运行时输入校验，`js-yaml` 用于旧宿主的预设文件；依赖文件未内嵌到插件 tarball。发布包包含插件、用户文档和截图，不包含本地验证环境、原始日志或内部脚本。

`zod` validates runtime input and `js-yaml` handles preset files on older hosts; their files are not bundled into the plugin tarball. The package includes the plugin, public guides, and screenshots, not local verification environments, raw logs, or internal scripts.

## 官方 Desktop · Official Desktop

以下是此前 `0.2.0-rc.2` 的 Desktop 验收记录。本轮新增验收使用 Web/CLI 和 Safari；`0.2.1-alpha.1` 的官方 GitHub Release 无 Desktop 附件，官方更新源也未获取到该版 macOS arm64 安装包，因此尚未完成该版原生 Desktop 验收。

The following is the previous Desktop verification for `0.2.0-rc.2`. This batch adds Web/CLI and Safari checks. The official `0.2.1-alpha.1` GitHub Release has no Desktop assets, and its macOS arm64 installer was not available from the official update source, so native Desktop verification for that version remains outstanding.

官方 Desktop `0.2.0-rc.2` 的 macOS arm64 发行包已另行通过原生窗口验收：安装和启用插件、选择 Super Code、主/子 Agent 执行、执行树、缩放、侧栏详情、记忆库、记忆使用记录及可折叠设置。中英文切换时，已打开的 tab 标题和界面文案同步更新，任务标题与记忆正文保留原文；重启后记忆和界面语言可恢复。该验收使用隔离配置和本地确定性模型。

The official Desktop `0.2.0-rc.2` macOS arm64 release also passed checks in its native window: plugin installation and activation, Super Code selection, main/child Agent execution, the tree, zoom, sidebar details, the memory library, memory activity, and collapsible settings. Open tab titles and interface labels update when switching between Chinese and English; task titles and memory text stay in their original language. Memory and the interface language persist after restart. These checks use an isolated profile and a local deterministic model.

## 未覆盖项 · Not Covered

其他 Desktop 版本和平台、真实模型服务、完整升级/自定义配置回归、所有工具组合，以及 0.2.0 候选整合包的新 SWE-bench 效果评测仍未覆盖。依赖声明中的版本范围不是未列版本的验证结论。

Other Desktop versions and platforms, live model services, complete upgrade/customization regression, every tool combination, and a new SWE-bench quality evaluation of the integrated 0.2.0 candidate remain outside this scope. Declared dependency ranges are not verification results for unlisted versions.

预设管理差异见[使用指南](UsageGuide.md)，版本变更见[更新日志](Changelog.md)。

See the [usage guide](UsageGuide.md) for preset management differences and the [changelog](Changelog.md) for release changes.
