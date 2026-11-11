# 致谢

中文 · [English](en/Acknowledgements.md)

感谢以下项目及其维护者。下文列出各项目在本插件中的具体用途。

## DeepSeek Harness

[源码](https://github.com/deepseek-ai/deepseek-harness) · [MIT](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE)

插件的运行宿主。

- Agent、模型路由、会话、工具、权限、取消、持久化、子 Agent 和用量记录均由宿主提供。批量调用使用宿主原生 PTC。
- 预设组合沿用官方的压缩、文件、搜索、终端、网页、子 Agent 和 Skill 插件。
- 界面基于宿主的 React、主题变量、Remote、设置页、侧边栏和会话投影接口实现；Agent 详情参考了宿主的消息与工具调用展示。
- Cordis（插件生命周期与组合）和 Schemastery（配置）同样由宿主提供。

对应实现：[预设组合](../presets/super-code/agent.cordis.yml)、[声明式预设](../cordis.patch.yml)、[宿主接入](https://github.com/ArtlexYoung/dsh-super-code/blob/main/src/dsh/index.ts)、[客户端](../client/index.js)

## ZCode

[源码](https://github.com/zai-org/ZCode) · [Apache-2.0](https://github.com/zai-org/ZCode/blob/main/LICENSE)

0.3.2 界面改版时参考了其 [DESIGN.md](https://github.com/zai-org/ZCode/blob/main/DESIGN.md)、主题与字号、Button / Input、设置分组、分段切换、搜索框、确认框和 WorkflowAgentPill，用于梳理紧凑布局、层级、分组和交互状态。

仅作为设计参考，并非依赖。界面仍基于 Harness 公开接口实现，执行树保留自有的圆形节点样式。

## Agent Skills

[规范](https://agentskills.io/specification) · [仓库与许可证](https://github.com/agentskills/agentskills)

内置前端 Skill 按该规范组织：`SKILL.md`、YAML 元数据和 `references/` 目录。平时仅向模型提供名称和简介，需要时才加载正文和参考资料，可与项目及用户自有的 Skill 共存。解析和加载使用 Harness 原生能力。

对应实现：[oil-ui](../presets/super-code/skills/oil-ui/SKILL.md)

## oil-ui

[源码](https://github.com/oil-oil/oil-ui) · [MIT](../presets/super-code/skills/oil-ui/LICENSE) · [固定版本与改动](../presets/super-code/skills/oil-ui/UPSTREAM.md)

感谢 oil-oil 提供开源前端设计 Skill。本插件内置 oil-ui 0.32.0 的设计流程、参考资料、风格对比页及辅助脚本，通过 Harness 原生 Skill 机制按需加载，替代原来自写的前端 Skill。

内置副本固定到上游 commit `0d64a00f3a5c45bf7a30d35bded9b7c0fdff2128`，仅将独立版本检查和更新入口改为随插件升级，未引入上游安装器或付费插件。MIT 许可证与原作者版权声明随包保留。

风格对比页还包含 [Instrument Serif](https://github.com/Instrument/instrument-serif)，采用 [SIL OFL 1.1](../presets/super-code/skills/oil-ui/assets/fonts/instrument-serif/OFL.txt)，用于对比页字体。

## SWE-bench

[源码与评分工具](https://github.com/SWE-bench/SWE-bench) · [数据集](https://huggingface.co/datasets/princeton-nlp/SWE-bench) · [MIT](https://github.com/SWE-bench/SWE-bench/blob/main/LICENSE)

提供真实的软件工程任务、环境和可复现的评分。调优所用的 33 道困难题由本项目从官方 dev 集中筛选。

## SWE-bench Pro

[源码与评分工具](https://github.com/scaleapi/SWE-bench_Pro-os) · [数据集](https://huggingface.co/datasets/ScaleAI/SWE-bench_Pro) · [MIT](https://github.com/scaleapi/SWE-bench_Pro-os/blob/main/LICENSE)

感谢 Scale AI 及维护者提供长流程任务和评分工具。hard-100 是本项目选定的题集名称，并非官方的「最难 100 题」，仅用于评测和排查问题，不参与调优。[评测结果](EvaluationResults.md)

两个评测项目的代码采用 MIT 许可证，但数据集、被测仓库和镜像等各有其条款，不在代码许可证覆盖范围内。

## 运行依赖

- [js-yaml](https://github.com/nodeca/js-yaml)（MIT）：YAML 解析
- [Zod](https://github.com/colinhacks/zod)（MIT）：数据与输入校验
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)：MCP 连接

完整依赖见 [package.json](../package.json)，锁定版本见 [package-lock.json](https://github.com/ArtlexYoung/dsh-super-code/blob/main/package-lock.json)。

## 许可证

本项目采用 [Apache-2.0](../LICENSE) 许可证。上述项目、规范、设计资料和数据各自保留版权与许可证，以上游的 LICENSE、NOTICE 和说明为准。设计参考不代表依赖关系、上游背书或功能等价。

## OpenSpec

[Source](https://github.com/Fission-AI/OpenSpec) · [MIT](../presets/super-code/skill-packs/openspec/LICENSE) · [Upstream](../presets/super-code/skill-packs/openspec/UPSTREAM.md)

感谢 OpenSpec 贡献者提供完整的规范驱动工作流 Skill。插件保留上游正文和许可证，通过 DSH 原生机制按需加载，不自动安装其 CLI。

## Matt Pocock Skills

[Source](https://github.com/mattpocock/skills) · [MIT](../presets/super-code/skill-packs/mattpocock/LICENSE) · [Upstream](../presets/super-code/skill-packs/mattpocock/UPSTREAM.md)

感谢 Matt Pocock 及贡献者提供完整的工程与生产力 Skill 包。插件内置正式插件清单及其配套参考、模板和调用规则，不在启用时运行 setup。

## PStack

[Source](https://github.com/cursor/plugins/tree/main/pstack) · [MIT](../presets/super-code/skill-packs/pstack/LICENSE) · [Upstream](../presets/super-code/skill-packs/pstack/UPSTREAM.md)

感谢 Lauren Tan 与 Cursor 插件贡献者提供 PStack。插件保留其58个标准 Skill 的正文、调用规则、配套参考与脚本，通过 DSH 原生 Skill 和斜杠命令按需加载；不注册 Cursor 自动化，也不在开启时运行安装或全局配置。部分流程仍依赖 Cursor 或外部工具，详见上游说明。
