# 致谢与借鉴 · Acknowledgements and Design References

感谢为 Super Code 提供运行基础、设计启发、开放规范和评测资源的项目与维护者。本文展开 [README 致谢表格](../README.md#4-致谢--acknowledgements)中的具体贡献，范围为当前 `0.3.4` 主干及其已有研究记录。

We thank the projects and maintainers who provide Super Code's runtime foundation, design references, open specifications, and evaluation resources. This document expands the [README acknowledgements](../README.md#4-致谢--acknowledgements), covering the current `0.3.4` main branch and its recorded design studies.

## DeepSeek Harness

**[项目与源码](https://github.com/deepseek-ai/deepseek-harness) · [MIT 许可证](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE)**

DeepSeek Harness 是本插件的运行基础。Super Code 复用宿主的 Agent、模型路由、会话、工具、权限、取消、持久化、子 Agent 和用量记录；批量调用与独立读取通过宿主原生 PTC 调度。预设组合沿用官方的 compaction、文件、搜索、终端、网页、子 Agent 与 Skill 插件。

DeepSeek Harness is the runtime foundation. Super Code uses its Agents, model routing, sessions, tools, permissions, cancellation, persistence, subagents, and usage records. Native PTC schedules batched calls and independent reads. Preset compositions use the official compaction, file, search, shell, Web, subagent, and Skill plugins.

Web 与桌面界面依托 Harness 的 React、主题变量、Remote、设置页、侧栏和会话投影接口。对话式 Agent 详情也参考宿主的消息与工具调用呈现。Cordis 的插件生命周期和组合机制、Schemastery 的配置机制同样来自宿主提供的基础设施。

The Web and desktop interfaces use Harness-provided React, theme variables, Remotes, settings pages, sidebars, and session projections. Chat-style Agent details also draw on its message and tool-call presentation. Cordis supplies plugin lifecycles and composition, while Schemastery supplies configuration facilities through the host.

实现对应：[预设组合](../presets/super-code/agent.cordis.yml)、[声明式预设](../cordis.patch.yml)、[宿主接入](https://github.com/ArtlexYoung/dsh-super-code/blob/main/src/dsh/index.ts)、[客户端](../client/index.js)。

Implementation: [preset composition](../presets/super-code/agent.cordis.yml), [declarative preset](../cordis.patch.yml), [host integration](https://github.com/ArtlexYoung/dsh-super-code/blob/main/src/dsh/index.ts), and [client](../client/index.js).

## ZCode

**[项目与源码](https://github.com/zai-org/ZCode) · [Apache-2.0 许可证](https://github.com/zai-org/ZCode/blob/main/LICENSE)**

0.3.2 界面设计阶段研究了 ZCode 的 [DESIGN.md](https://github.com/zai-org/ZCode/blob/main/DESIGN.md)、语义主题与字号、Button / Input、设置资源分组、分段切换、搜索框、确认对话框和 WorkflowAgentPill。感谢这些可供阅读的设计与组件实现，它们帮助梳理紧凑布局、清晰层级、分组操作和交互状态。

During the 0.3.2 UI design work, we studied ZCode's [DESIGN.md](https://github.com/zai-org/ZCode/blob/main/DESIGN.md), semantic themes and typography, Button / Input components, settings resource groups, segmented tabs, search fields, confirmation dialogs, and WorkflowAgentPill. These design documents and component implementations informed compact layouts, clear hierarchy, grouped actions, and interaction states.

Super Code 的界面接入仍采用 Harness 的公开接口与主题变量。ZCode 在这里是设计参考，没有作为插件依赖引入；执行树保留 Super Code 的圆形节点与运行反馈。

Super Code implements its interface through Harness's public APIs and theme variables. ZCode is a design reference rather than a package dependency; the execution tree keeps Super Code's circular nodes and running feedback.

## Agent Skills

**[格式规范](https://agentskills.io/specification) · [规范仓库与许可证](https://github.com/agentskills/agentskills)**

内嵌前端 Skill 采用 Agent Skills 的目录格式：SKILL.md、YAML 元数据和 references/ 资源目录。宿主先提供名称与短描述，匹配任务后再加载正文和相关参考文件。感谢这套开放约定，使指导内容可以保持简短入口、按需展开，并与项目和用户自己的 Skill 共存。

The bundled frontend Skill follows Agent Skills conventions: SKILL.md, YAML metadata, and a references/ resource directory. The host exposes a name and short description first, then loads the body and relevant resources when needed. This open format supports a short entry point, progressive disclosure, and coexistence with project and user Skills.

实现对应：[super-code-frontend](../presets/super-code/skills/super-code-frontend/SKILL.md)。格式与内容加载复用 Harness 的原生 Skill 能力。

Implementation: [super-code-frontend](../presets/super-code/skills/super-code-frontend/SKILL.md). Parsing and content loading use Harness's native Skill facilities.

## 前端设计与无障碍资料 · Frontend Design and Accessibility

### Apple Human Interface Guidelines

**[布局](https://developer.apple.com/design/human-interface-guidelines/layout) · [无障碍](https://developer.apple.com/design/human-interface-guidelines/accessibility) · [按钮](https://developer.apple.com/design/human-interface-guidelines/buttons) · [反馈](https://developer.apple.com/design/human-interface-guidelines/feedback)**

前端 Skill 的补充研究阅读了上述官方指南，采纳对齐表达关系、布局适应容器与字体、控制尺寸与间隔降低操作负担、交互可预测、反馈就近且适度等原则。这些原则被整理进视觉设计、交互状态和浏览器验证三份按需参考，感谢指南对具体交互问题的细致说明。

The frontend Skill study used these official guides for alignment, layouts that adapt to containers and typography, control size and spacing, predictable interaction, and timely, proportionate feedback. These principles inform the Skill's visual-design, interaction-state, and browser-validation references.

采纳范围是可迁移的交互原则；产品仍沿用自己的视觉语言。原生平台尺寸单位不直接换成 Web 的 CSS pixel，材质、字体和图标也不作为统一模板。资料适用条款见 [Apple Developer 条款](https://developer.apple.com/support/terms/)。

The reference concerns transferable interaction principles, applied within each product's visual language. Native platform units are not treated as CSS pixels, and platform materials, typography, and icons are not prescribed as a template. See [Apple Developer terms](https://developer.apple.com/support/terms/) for applicable documentation terms.

### W3C WCAG 2.2

**[WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [2.5.8 Target Size (Minimum) 说明](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)**

感谢 W3C Web Accessibility Initiative 对操作目标尺寸、间距和例外条件的公开说明。前端 Skill 使用 WCAG 2.2 AA 2.5.8 的 24 × 24 CSS pixel 尺寸及间距等例外作为 Web 检查依据，并要求通过实际命中、键盘操作和内容验证检查可用性。数字检查通过不等于整个界面已满足无障碍要求。

We thank the W3C Web Accessibility Initiative for its target-size, spacing, and exception guidance. The frontend Skill uses WCAG 2.2 AA 2.5.8's 24 × 24 CSS pixel criterion and its exceptions when checking Web controls, alongside real hit-area, keyboard, and content checks. Passing numeric checks does not establish accessibility compliance for the whole interface.

实现对应：[交互状态参考](../presets/super-code/skills/super-code-frontend/references/interaction-states.md)、[浏览器验证参考](../presets/super-code/skills/super-code-frontend/references/browser-validation.md)。版权与使用条件见各 W3C 文档随附声明。

Implementation: [interaction-state guidance](../presets/super-code/skills/super-code-frontend/references/interaction-states.md) and [browser-validation guidance](../presets/super-code/skills/super-code-frontend/references/browser-validation.md). Copyright and usage conditions are recorded in the respective W3C documents.

## 评测项目 · Evaluation Projects

### SWE-bench

**[项目与评分工具](https://github.com/SWE-bench/SWE-bench) · [数据集](https://huggingface.co/datasets/princeton-nlp/SWE-bench) · [代码许可证](https://github.com/SWE-bench/SWE-bench/blob/main/LICENSE)**

感谢 SWE-bench 提供真实软件工程任务、任务环境和可复现的评分基础。当前版本迭代使用从官方 dev 集中筛选并验证有效的 33 道困难题进行效果优化与开发验证。这 33 题是本项目的筛选集合。

We thank SWE-bench for real software-engineering tasks, task environments, and reproducible grading infrastructure. Current iterations use 33 valid difficult tasks selected from the official dev split for performance improvement and development checks. This is a project-selected subset.

### SWE-bench Pro

**[项目与评分工具](https://github.com/scaleapi/SWE-bench_Pro-os) · [数据集](https://huggingface.co/datasets/ScaleAI/SWE-bench_Pro) · [代码许可证](https://github.com/scaleapi/SWE-bench_Pro-os/blob/main/LICENSE)**

感谢 Scale AI 与 SWE-bench Pro 的维护者提供长流程软件工程任务及评分工具。本项目固定的 hard-100 用于候选冻结后的效果评测和 bug 排查，不参与效果调优；“hard-100”是本项目的集合名称，不代表官方认定的最难 100 题。

We thank Scale AI and the SWE-bench Pro maintainers for long-horizon software-engineering tasks and grading tools. The project's frozen hard-100 set is used to evaluate frozen candidates and investigate bugs, not for performance tuning. “hard-100” is this project's selection name, rather than an official hardest-100 designation.

评测口径、限制和逐题证据见[评测文档](EvaluationResults.md)。两项评测项目的代码许可证均为 MIT；数据集、被测仓库、镜像与其他资产保留各自条款，代码许可证不统一覆盖这些内容。

See the [evaluation report](EvaluationResults.md) for methodology, limitations, and per-task evidence. Both evaluation code repositories use MIT licenses. Datasets, tested repositories, images, and other assets retain their own terms, which are not replaced by the evaluation code licenses.

## 运行依赖 · Runtime Dependencies

感谢 [js-yaml](https://github.com/nodeca/js-yaml) 与 [Zod](https://github.com/colinhacks/zod) 的维护者。前者提供 YAML 解析，后者提供数据结构与输入校验；两者均以 MIT 许可证发布，是本插件的直接运行依赖。完整直接依赖及宿主 peer dependencies 见 [package.json](../package.json)，版本锁定见 [package-lock.json](https://github.com/ArtlexYoung/dsh-super-code/blob/main/package-lock.json)。

We thank the maintainers of [js-yaml](https://github.com/nodeca/js-yaml) and [Zod](https://github.com/colinhacks/zod). They provide YAML parsing and schema/input validation, respectively. Both are direct runtime dependencies under MIT licenses. See [package.json](../package.json) for direct and host peer dependencies, and [package-lock.json](https://github.com/ArtlexYoung/dsh-super-code/blob/main/package-lock.json) for locked versions.

## 版权与许可证 · Copyright and Licenses

Super Code 使用 [Apache License 2.0](../LICENSE)。上述项目、规范、设计资料和数据保留各自版权、许可证或文档条款；具体内容以对应上游的 LICENSE、NOTICE、数据说明和版权声明为准。本页记录贡献与借鉴范围，设计参考本身不表示运行依赖、上游背书或功能等价。

Super Code uses the [Apache License 2.0](../LICENSE). Referenced projects, specifications, design resources, and datasets retain their own copyrights, licenses, or documentation terms, as stated by their upstream LICENSE, NOTICE, dataset documentation, and copyright notices. This page records contributions and design influence; a design reference does not imply a runtime dependency, upstream endorsement, or feature equivalence.
