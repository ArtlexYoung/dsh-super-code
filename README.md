# dsh-super-code

中文 · [English](README.en.md)

[![npm 总下载量](https://img.shields.io/npm/dt/dsh-super-code?label=npm%20downloads)](https://npmtrends.com/dsh-super-code) [![npm 当前发布版本](https://img.shields.io/npm/v/dsh-super-code)](https://www.npmjs.com/package/dsh-super-code) [![许可证：Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

一个更聪明、更节省、更快速、更好用的 DeepSeek Harness 编码插件。

**因大模型波动，不同评测结果会有略有变化，以最新测试为准。**

在 SWE-bench Pro hard-100 上，与官方标准预设对比（同一宿主 DSH `0.2.1-rc.2`、同一模型、均为 high 思考等级）：

| | 官方标准 + high | Super Code 0.3.11 | Super Code 0.4.0 |
|---|---:|---:|---:|
| 通过 | 47/100 | 50/100（+3题） | **52/100（+5题）** |
| 每题耗时 | 16.26 分钟 | 16.69 分钟（+2.7%） | 17.66 分钟（+8.6%） |
| 每题 Token | 771.8 万 | 667.3 万（-13.5%） | 689.5 万（-10.7%） |
| 每题模型调用 | 89.54 次 | 76.44 次（-14.6%） | 79.42 次（-11.3%） |

2026-11-11 测试，`0.4.0` 为本次冻结候选。全部按100题汇总，含原失败尝试及补答，百分比相对官方标准。耗时含工具与会话等待，不含评分；模型调用按原始请求计，含失败及辅助调用。用量记录不完整题数依次为 **17、10、13题**，Token 数值及变化比例仅比较已采集记录。[历史评测结果与口径](docs/EvaluationResults.md)

## 安装

支持 Harness `0.1.5-alpha.1` ～ `0.2.2-rc.2`，包括 `0.2.2-alpha.3`。0.4.0 已逐版验证 27 个 Web 版本，并验证官方 macOS 桌面版 `0.2.2-rc.2`、NEXT `2.0.22-next`（内置 Harness `0.2.2-rc.1`）；各版本与平台的实测范围见[兼容性记录](docs/Compatibility.md)。

**桌面版**：在左侧打开「插件 → 添加插件」，输入 `dsh-super-code`，依次点击「安装」和「立即启用」（旧版本请按提示重载或重启）。桌面版内置运行环境，无需安装 Node.js。

**Web / 命令行版**：插件要求 Node.js 22 及以上；Harness `0.2.2-rc.2` 要求 Node.js 24.9 及以上。

```bash
npm install -g @deepseek-ai/dsh            # 已安装 dsh 命令可跳过
dsh plugin --profile web add dsh-super-code
```

<details>
<summary>使用 Release 安装包</summary>

从 [GitHub Releases](https://github.com/ArtlexYoung/dsh-super-code/releases) 下载 `.tgz` 文件。

桌面版：在「包名或地址」中填写安装包的完整路径，然后点击「安装」。

[![填写安装包路径](docs/images/install-tgz-preview.png)](docs/images/install-tgz.png)

Web 版：运行以下命令（文件名以实际下载的为准）：

```bash
dsh plugin --profile web add ./dsh-super-code-0.4.0.tgz
```

</details>

### Windows 命令支持

内置 GNU Bash、必要的 MSYS DLL、BusyBox 和 GNU grep，无需为了运行 Bash 命令额外安装 Git。Git、Node、Python 等开发工具仍需自行安装；macOS、Linux 沿用宿主环境。

在「设置 → Super Code 模式 → 预设配置 → 命令环境」中，内置 Bash 默认开启，「同时应用到官方预设」默认关闭。开启后可用于官方标准、PTC、创建模式；极简模式保留持久终端。仅 Windows 宿主可修改开关，其他平台显示为灰色并提供悬浮提示。

受限环境下，Bash 命令需要通过 DSH 对该条命令的审批。配置和兼容边界见[使用说明](docs/UsageGuide.md#windows-命令环境)。

## 使用

1. 打开「设置 → Agent 预设」，选择 **Super Code 模式**（标识符 `super-code`）。
2. 新建会话，描述任务即可。

模型、推理等级、权限和工具均沿用 Harness 的设置，无需单独配置；子 Agent 默认使用父 Agent 的模型。

若未找到预设，可在「设置 → Super Code 模式」中查看状态，或参阅[排查方法](docs/UsageGuide.md#找不到预设)。

[![Super Code 设置页](docs/images/preset-settings-preview.png)](docs/images/preset-settings.png)

在右侧边栏选择「Super Code」，包含三个部分：

- **任务**：目标、步骤进度、工具调用汇总和已修改的文件，只读。
- **协作执行**：Agent 执行树，点击节点可查看详情。
- **记忆**：查看、新增、编辑和删除项目记忆与全局偏好。

三个部分始终只展开一项，默认显示任务；再次点击当前标题会保持展开。

[![任务侧边栏](docs/images/task-status-preview.png)](docs/images/task-status.png)

[![Agent 执行树](docs/images/agent-tree-preview.png)](docs/images/agent-tree.png)

截图使用当前界面与演示数据，仅展示插件外观。

## 功能

| 功能 | 说明 |
|---|---|
| 批量工具调用 | 在一次模型调用中并行读取多个文件，减少往返次数 |
| 分层记忆 | 当前任务、项目经验和全局偏好分别存储，每条记录均标注来源 |
| 运行预算 | 默认使用效果更好的旧压缩预算，可在设置中调整 |
| 删除保护 | 默认引导 Agent 使用可恢复的 `trash`，可切换为严格确认 |
| Windows 命令环境 | 内置 Bash 与常用命令，可选应用到官方预设 |
| MCP 连接 | 允许外部 MCP 客户端将任务委派给 DSH 执行，默认关闭 |
| 预设 Skill | grill-me、OpenSpec、oil-ui 与 Matt Pocock Skills、PStack 分组控制，开启后同步到 DSH Skill 目录、实时生效，支持快捷打开目录 |

详见[使用说明](docs/UsageGuide.md)。

内置及适配后的 Skill 源码统一公开在 [builtin/skills](builtin/skills)，保留各自的来源、许可证和配套资源；[目录与维护说明](builtin/README.md)。

## 最近更新

- **0.4.0**

  1. 简化任务与记忆工具的调用，提供按操作的帮助与示例，支持直接读取指定主题的项目记忆。
  2. 新增 grill-me、OpenSpec、oil-ui、Matt Pocock Skills 和 PStack 五项预置 Skill 与工作流，默认关闭。启用后同步到 DSH Skill 目录，在已有对话中实时生效，支持按包名搜索原生命令。
  3. 优化设置与任务侧栏，完善新版 Harness 兼容，修复预设恢复、MCP、删除保护等功能中的大量问题。

- **0.3.11**：修复了大量 bug。
- **0.3.10**：新增 Windows 内置 Bash 和官方预设开关，修复旧宿主兼容与提示气泡样式。

[完整版本记录](docs/Changelog.md)

版本号格式为「主版本.效果版本.维护版本」：第二位变化表示编码效果或效率有提升，第三位表示修复、界面和兼容性更新。每次发布前均需完成大量回归测试，因此更新周期可能较长。

## 评测

### 插件方案对比

SWE-bench Pro hard-100 完整成绩，按通过数量降序排列。统一使用 Harness `0.2.1-rc.2`、`评测模型 B`、high、旧预算，各组内部连续复用环境。

| 方案 | 通过/有效 | 平均总 Token（M） | 平均耗时（分钟） | 平均模型调用 | 平均工具调用 | 缓存率 |
|---|---:|---:|---:|---:|---:|---:|
| Super Code 0.3.5 | **51/100** | 6.435 | 24.751 | 76.660 | 75.840 | 98.927% |
| 官方标准 | 50/100 | 8.030 | 17.198 | 91.990 | 113.880 | 99.167% |
| 原版 dsh-ops 0.4.4 · 标准 | 49/100 | 7.099 | 23.132 | 82.500 | 102.360 | 99.062% |
| 官方标准＋billion-context 0.1.209 | 45/100 | 6.359 | 18.471 | 108.950 | 131.140 | 97.654% |
| 原版 dsh-ops 0.4.4 · PTC | 44/100 | 7.322 | 23.695 | 81.490 | 80.960 | 99.056% |

M 为百万 Token，包含思考 Token；耗时包含部分运行内服务等待。这批追加成绩与开头及下方历史预算实验分开记录。[完整结果与口径](docs/EvaluationResults.md)

### 评测方法

- **题集**：SWE-bench Pro hard-100，使用官方评分器。调优仅使用 SWE-bench dev 中筛选的 33 道困难题；hard-100 只用于评测冻结后的候选版本和排查问题，不参与调优，以避免对评测题过拟合。
- **对照**：官方标准预设及第三方插件方案。历史官方预设对比中，旧宿主的标准 + high 通过 51 题，minimal + high 通过 46 题，且标准每题 token 少 23.5%，因此选用标准预设作为基线。
- **控制变量**：同宿主对比保持模型、思考等级和预算一致，对比不同预设及插件组合；跨宿主、跨模型的实验单独说明。
- **指标**：通过数、平均总 Token、耗时、模型与工具调用次数、缓存率。上述插件方案对比表的耗时包含部分运行内服务等待；下方历史预算实验使用净耗时，扣除失败请求和重试等待。

### 历史评测过程

1. **旧宿主基线**（DSH `0.1.5-rc.2`，`评测模型 B`，high）：Super Code `0.3.0` 候选通过 56 题，官方标准预设 51 题，minimal 46 题。相对 minimal，耗时减少 47.6%，token 减少 44.9%。
2. **宿主升级后效果下降**：升级到 DSH `0.2.1-rc.2` 和 `评测模型 B` 后，在默认预算下标准降至 46 题，Super Code `0.3.4` 降至 41 题，低于标准。排查发现新宿主收紧了上下文预算：压缩阈值由 800,000 降至 550,464 token，保留原文由 160,000 降至 98,560 token。
3. **恢复旧预算后复测**：双方均使用旧预算。标准仍为 46 题，token 增加 14.2%；Super Code `0.3.5` 提升至 49 题，token 仅增加 0.4%，净耗时减少 19.4%。据此，`0.3.6` 起插件默认使用旧预算。
4. **跨模型验证**（`glm-5.3-flash`，max）：Super Code `0.3.4` 通过 45 题，原生 ZCode 通过 29 题；Super Code 每题净耗时更少（32.9 vs 52.3 分钟），token 更多（550 万 vs 361 万）。

### 历史结果汇总

以下为较早的评测批次，不与上述插件方案对比的成绩合并计算。

| 对比 | 通过 | 效率 |
|---|---|---|
| 新宿主、旧预算：Super Code `0.3.5` vs 标准 + high | 49 vs 46 | 净耗时 -21.3%，token -34.6%，模型调用 -25.5% |
| 新宿主、默认预算：Super Code `0.3.4` vs 标准 + high | 41 vs 46 | token -25.5%，净耗时 +13.9% |
| 旧宿主：Super Code `0.3.0` 候选 vs 标准 + high | 56 vs 51 | 原始耗时 -34.9%，token -27.9% |
| 旧宿主：Super Code `0.3.0` 候选 vs minimal + high | 56 vs 46 | 耗时 -47.6%，token -44.9% |
| GLM-5.3-flash：Super Code `0.3.4` vs 原生 ZCode | 45 vs 29 | 耗时 -37.1%，token +52.4% |

### 限制

- 每组配置只运行一轮。同一道题在不同轮次中结果可能不同，目前尚未估计固定配置下的随机波动。
- 默认预算与旧预算两组的插件版本不同（`0.3.4` → `0.3.5`），收益不能全部归因于预算。
- `0.3.6` ~ `0.3.10` 未重新运行 100 题评测。
- 跨模型对比是两套完整系统之间的比较，无法单独分离插件的贡献。

[评测结果与口径](docs/EvaluationResults.md) · [完整成绩表](eval/results/swebench-pro-final-100/ResultsTables.md)

## Star 趋势

<a href="https://star-history.com/#ArtlexYoung/dsh-super-code&amp;Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/star-history-dark.svg">
    <img alt="dsh-super-code Star history" src="docs/images/star-history.svg" width="800">
  </picture>
</a>

## npm 下载趋势

<a href="https://npmtrends.com/dsh-super-code">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/npm-downloads-dark.svg">
    <img alt="dsh-super-code 最近 13 周 npm 下载趋势" src="docs/images/npm-downloads.svg" width="800">
  </picture>
</a>

## 致谢

本项目认可 [LINUX DO](https://linux.do) 社区。

| 项目 | 参考内容 |
|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT） | 运行宿主：Agent、会话、工具、PTC、Skill、界面扩展 |
| [ZCode](https://github.com/zai-org/ZCode)（Apache-2.0） | 界面设计 |
| [Agent Skills](https://agentskills.io/specification) | 前端 Skill 的文件格式 |
| [oil-ui](https://github.com/oil-oil/oil-ui)（MIT） | 内置前端设计 Skill，提供设计流程、风格对比与画面评审 |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec)（MIT） | 完整的规范驱动工作流 Skill 包 |
| [Matt Pocock Skills](https://github.com/mattpocock/skills)（MIT） | 完整的工程工作流 Skill 包 |
| [PStack](https://github.com/cursor/plugins/tree/main/pstack)（MIT） | 架构、开发、验证与评审的协作 Skill 包 |
| [SWE-bench](https://github.com/SWE-bench/SWE-bench)、[SWE-bench Pro](https://github.com/scaleapi/SWE-bench_Pro-os)（代码 MIT） | 调优题与评测题 |
| [js-yaml](https://github.com/nodeca/js-yaml)、[Zod](https://github.com/colinhacks/zod)（MIT） | YAML 解析、数据校验 |

[详细致谢与许可证](docs/Acknowledgements.md) · 本项目采用 [Apache-2.0](LICENSE) 许可证。
