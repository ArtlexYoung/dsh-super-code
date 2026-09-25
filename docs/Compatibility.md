# 0.1.4 兼容性 · Compatibility

截至 2026-09-25，以下七个指定 Harness 版本通过了 Super Code 0.1.4 的隔离 Web/CLI 集成冒烟。每个环境固定并审计宿主依赖，使用本地确定性模型，不访问外部模型服务。

As of 2026-09-25, Super Code 0.1.4 passed isolated Web/CLI integration smoke checks on the seven Harness versions below. Each environment pins and audits host dependencies and uses a local deterministic model, not an external model service.

| Harness | 预设机制 / Preset mechanism | 冒烟结果 / Smoke result |
|---|---|---|
| `0.1.5-rc.3` | 目录 / Directory | 通过 / Pass |
| `0.1.6-alpha.1` | 目录 / Directory | 通过 / Pass |
| `0.1.6-alpha.2` | 目录 / Directory | 通过 / Pass |
| `0.1.7-alpha.1` | 声明式 / Declarative | 通过 / Pass |
| `0.1.7-alpha.2` | 声明式 / Declarative | 通过 / Pass |
| `0.1.7-rc.1` | 声明式 / Declarative | 通过 / Pass |
| `0.1.7-rc.2` | 声明式 / Declarative | 通过 / Pass |

## 检查范围 · Checks

- CLI 版本与启动、插件安装和激活、配置加载、Web 服务启动。
  CLI identity and startup, plugin installation and activation, configuration loading, and Web startup.
- Super Code 预设发现及状态、工作区和会话创建、选模、发送提示词，以及 `super_code_method` 返回非错误结果。
  Super Code preset discovery and status, workspace/session creation, model selection, prompting, and a non-error `super_code_method` result.
- 宿主 npm 与 profile pnpm 锁文件审计。0.1.7 profile 单独保留 `@deepseek-ai/dsh-agent-presets@0.1.6-alpha.1` 作为插件旧目录逻辑的兼容辅助依赖，不将其算作 0.1.7 宿主组件。
  Host npm and profile pnpm lockfile audits. A 0.1.7 profile separately retains `@deepseek-ai/dsh-agent-presets@0.1.6-alpha.1` as a compatibility helper for the plugin's legacy directory code, not as a 0.1.7 host component.

## 依赖与安装注意事项 · Dependency and Installation Notes

预发布依赖的 caret 范围可能解析到其他 alpha/rc 版本。此前默认安装 `0.1.6-alpha.1` 时混入 alpha.2，导致宿主在插件加载前报 `watchUserPatches` 导出缺失；`0.1.7-alpha.1` 也曾解析到 rc.1。验证环境通过精确 overrides 解决混版，但这并未修复上游发布的依赖声明，也不证明未锁定的默认安装总能成功。遇到类似错误时，应先核对实际安装的宿主组件版本。

Caret ranges on prerelease dependencies can resolve to other alpha/rc versions. A previous default `0.1.6-alpha.1` installation pulled alpha.2 components and failed on a missing `watchUserPatches` export before loading the plugin; `0.1.7-alpha.1` also pulled rc.1 components. Exact overrides removed this drift in the verification environments, but do not repair upstream dependency declarations or establish that every unpinned default installation works. Check the installed host component versions first when diagnosing such errors.

旧宿主在隔离 profile 中需要能够解析宿主包；测试按需补齐了该解析路径，并显式激活插件。`0.1.7-rc.2` 已从空目录安装验证；七版本通过不等于七版本全部做过冷安装。

Older hosts need host packages to be resolvable from the isolated profile; the checks prepare that resolution path where needed and explicitly activate the plugin. `0.1.7-rc.2` was also verified from an empty host directory. Seven passing versions do not mean seven completed cold installations.

`zod` 用于运行时输入校验，仍为生产依赖，但其文件未内嵌到插件 tarball。发布包仅新增公开文档与截图，不包含本地验证环境、原始日志或内部脚本。

`zod` remains a production dependency for runtime input validation, but its files are not bundled into the plugin tarball. The documentation additions contain public guides and screenshots, not local verification environments, raw logs, or internal scripts.

## 未覆盖项 · Not Covered

原生 Desktop、真实模型服务、完整 UI/升级/自定义配置回归、所有工具与平台组合，以及 0.1.4 的 SWE-bench 效果评测均不在本轮范围内。依赖声明中的版本范围不是上述未列版本的验证结论。

Native Desktop, live model services, complete UI/upgrade/customization regression, every tool/platform combination, and a SWE-bench quality evaluation of 0.1.4 are outside this scope. Declared dependency ranges are not verification results for unlisted versions.

预设管理差异见[使用指南](UsageGuide.md)，版本变更见[更新日志](Changelog.md)。

See the [usage guide](UsageGuide.md) for preset management differences and the [changelog](Changelog.md) for release changes.
