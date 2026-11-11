# dsh-super-code

中文 · [English](README.en.md)

一个更聪明、更节省、更快速、更好用的 DeepSeek Harness 编码插件。

在 SWE-bench Pro hard-100 上，与官方标准预设对比（同一宿主 DSH `0.2.1-rc.2`、同一模型、均为 high 思考等级与旧预算）：

| | 标准 + high | Super Code |
|---|---:|---:|
| 通过 | 46/100 | **49/100** |
| 每题净耗时 | 20.9 分钟 | **16.4 分钟**（-21.3%） |
| 每题 token | 781 万 | **511 万**（-34.6%） |
| 每题模型调用 | 92 次 | **69 次**（-25.5%） |

基于版本 `0.3.5` 测试。[完整结果与限制](docs/EvaluationResults.md)

## 安装

支持 Harness `0.1.5-alpha.1` 起的版本；Web、官方桌面版和 NEXT 的实测范围见[兼容性记录](docs/Compatibility.md)。

**桌面版**：在左侧打开「插件 → 添加插件」，输入 `dsh-super-code`，依次点击「安装」和「立即启用」（旧版本请按提示重载或重启）。桌面版内置运行环境，无需安装 Node.js。

**Web / 命令行版**：需要 Node.js 22 及以上版本。

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
dsh plugin --profile web add ./dsh-super-code-0.3.11.tgz
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
| 预设 Skill | oil-ui、OpenSpec、Matt Pocock Skills、PStack 四个整包开关，按需加载、实时生效 |

详见[使用说明](docs/UsageGuide.md)。

## 最近更新

- **0.3.11**：修复了大量 bug。
- **0.3.10**：新增 Windows 内置 Bash 和官方预设开关，修复旧宿主兼容与提示气泡样式。
- **0.3.9**：美化设置和任务侧栏，完善 MCP 对话控制并修复 PTC 子工具审批，验证 rc.4 Web 兼容性。

[完整版本记录](docs/Changelog.md)

版本号格式为「主版本.效果版本.维护版本」：第二位变化表示编码效果或效率有提升，第三位表示修复、界面和兼容性更新。每次发布前均需完成大量回归测试，因此更新周期可能较长。

## 评测

### 插件方案对比

SWE-bench Pro hard-100 完整成绩，按通过数量降序排列。统一使用 Harness `0.2.1-rc.2`、`deepseek-v4.1-flash-1017`、high、旧预算，各组内部连续复用环境。

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

1. **旧宿主基线**（DSH `0.1.5-rc.2`，`deepseek-v4.1-flash`，high）：Super Code `0.3.0` 候选通过 56 题，官方标准预设 51 题，minimal 46 题。相对 minimal，耗时减少 47.6%，token 减少 44.9%。
2. **宿主升级后效果下降**：升级到 DSH `0.2.1-rc.2` 和 `deepseek-v4.1-flash-1017` 后，在默认预算下标准降至 46 题，Super Code `0.3.4` 降至 41 题，低于标准。排查发现新宿主收紧了上下文预算：压缩阈值由 800,000 降至 550,464 token，保留原文由 160,000 降至 98,560 token。
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
- `0.3.6` ~ `0.3.11` 未重新运行 100 题评测。
- 跨模型对比是两套完整系统之间的比较，无法单独分离插件的贡献。

[评测结果与口径](docs/EvaluationResults.md) · [完整成绩表](eval/results/swebench-pro-final-100/ResultsTables.md)

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
