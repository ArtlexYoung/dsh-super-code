# 版本记录 · Changelog

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
