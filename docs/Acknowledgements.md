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

对应实现：[super-code-frontend](../presets/super-code/skills/super-code-frontend/SKILL.md)

## Apple Human Interface Guidelines

[布局](https://developer.apple.com/design/human-interface-guidelines/layout) · [无障碍](https://developer.apple.com/design/human-interface-guidelines/accessibility) · [按钮](https://developer.apple.com/design/human-interface-guidelines/buttons) · [反馈](https://developer.apple.com/design/human-interface-guidelines/feedback) · [条款](https://developer.apple.com/support/terms/)

前端 Skill 采纳了其中的原则：以对齐表达关系、布局适应容器和字号、通过控件尺寸和间距降低操作负担、交互可预测、反馈就近且适度。上述原则整理为视觉设计、交互状态和浏览器验证三份参考文档。

仅借鉴原则，产品仍保持自身视觉风格。原生平台的尺寸单位不直接作为 CSS 像素使用，材质、字体和图标也不作为模板。

## W3C WCAG 2.2

[WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [2.5.8 目标尺寸（最小）](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

前端 Skill 检查 Web 控件时，采用 2.5.8 的 24 × 24 CSS 像素标准及其间距例外，并结合实际点击、键盘和内容检查。尺寸达标不代表整个界面满足无障碍要求。

对应实现：[交互状态](../presets/super-code/skills/super-code-frontend/references/interaction-states.md)、[浏览器验证](../presets/super-code/skills/super-code-frontend/references/browser-validation.md)

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
