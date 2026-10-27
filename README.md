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

支持 Harness `0.1.5-alpha.1` ~ `0.2.1-rc.2`，详见[兼容性验证](docs/Compatibility.md)。

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
dsh plugin --profile web add ./dsh-super-code-0.3.8.tgz
```

</details>

## 使用

1. 打开「设置 → Agent 预设」，选择 **Super Code 模式**（标识符 `super-code`）。
2. 新建会话，描述任务即可。

模型、推理等级、权限和工具均沿用 Harness 的设置，无需单独配置；子 Agent 默认使用父 Agent 的模型。

若未找到预设，可在「设置 → Super Code 模式」中查看状态，或参阅[排查方法](docs/UsageGuide.md#找不到预设)。

[![Super Code 设置页](docs/images/preset-settings-preview.png)](docs/images/preset-settings.png)

在右侧边栏选择「Super Code」，包含三个部分：

- **任务状态**：目标、步骤进度、已执行的操作和已修改的文件，只读。
- **协作执行**：Agent 执行树，点击节点可查看详情。
- **记忆库**：查看、新增、编辑和删除项目记忆与全局偏好。

[![Agent 执行树](docs/images/agent-tree-preview.png)](docs/images/agent-tree.png)

## 功能

| 功能 | 说明 |
|---|---|
| 批量工具调用 | 在一次模型调用中并行读取多个文件，减少往返次数 |
| 分层记忆 | 当前任务、项目经验和全局偏好分别存储，每条记录均标注来源 |
| 运行预算 | 默认使用效果更好的旧压缩预算，可在设置中调整 |
| 删除保护 | 默认引导 Agent 使用可恢复的 `trash`，可切换为严格确认 |
| MCP 连接 | 允许外部 MCP 客户端将任务委派给 DSH 执行，默认关闭 |
| 前端 Skill | 开发页面时按需加载，检查对齐、点击区域和浏览器表现 |

详见[使用说明](docs/UsageGuide.md)。

## 最近更新

- **0.3.8**：新增 MCP 连接，外部客户端可委派、查看、继续和取消 DSH 对话；设置页新增首页概览。
- **0.3.7**：新增三档删除保护（默认宽松）；侧边栏新增任务状态。
- **0.3.6**：新版 Harness 收紧预算后效果下降，插件默认恢复旧预算。

[完整版本记录](docs/Changelog.md)

版本号格式为「主版本.效果版本.维护版本」：第二位变化表示编码效果或效率有提升，第三位表示修复、界面和兼容性更新。每次发布前均需完成大量回归测试，因此更新周期可能较长。

## 评测

### 评测方法

- **题集**：SWE-bench Pro hard-100，使用官方评分器。调优仅使用 SWE-bench dev 中筛选的 33 道困难题；hard-100 只用于评测冻结后的候选版本和排查问题，不参与调优，以避免对评测题过拟合。
- **对照**：官方标准预设，而非 minimal。旧宿主实测中，标准 + high 通过 51 题，minimal + high 通过 46 题，且标准每题 token 少 23.5%。与更强的对照比较，结论更严格。
- **控制变量**：同一宿主、同一模型、同一思考等级、同一预算，仅替换 Agent 预设。
- **指标**：通过数、每题净耗时（扣除失败请求和重试等待）、每题 token、每题模型调用次数。

### 评测过程

1. **旧宿主基线**（DSH `0.1.5-rc.2`，`deepseek-v4.1-flash`，high）：Super Code `0.3.0` 候选通过 56 题，官方标准预设 51 题，minimal 46 题。相对 minimal，耗时减少 47.6%，token 减少 44.9%。
2. **宿主升级后效果下降**：升级到 DSH `0.2.1-rc.2` 和 `deepseek-v4.1-flash-1017` 后，在默认预算下标准降至 46 题，Super Code `0.3.4` 降至 41 题，低于标准。排查发现新宿主收紧了上下文预算：压缩阈值由 800,000 降至 550,464 token，保留原文由 160,000 降至 98,560 token。
3. **恢复旧预算后复测**：双方均使用旧预算。标准仍为 46 题，token 增加 14.2%；Super Code `0.3.5` 提升至 49 题，token 仅增加 0.4%，净耗时减少 19.4%。据此，`0.3.6` 起插件默认使用旧预算。
4. **跨模型验证**（`glm-5.3-flash`，max）：Super Code `0.3.4` 通过 45 题，原生 ZCode 通过 29 题；Super Code 每题净耗时更少（32.9 vs 52.3 分钟），token 更多（550 万 vs 361 万）。

### 结果汇总

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
- `0.3.6` ~ `0.3.8` 未重新运行 100 题评测。
- 跨模型对比是两套完整系统之间的比较，无法单独分离插件的贡献。

[评测结果与口径](docs/EvaluationResults.md) · [完整成绩表](eval/results/swebench-pro-final-100/ResultsTables.md)

## 致谢

本项目认可 [LINUX DO](https://linux.do) 社区。

| 项目 | 参考内容 |
|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT） | 运行宿主：Agent、会话、工具、PTC、Skill、界面扩展 |
| [ZCode](https://github.com/zai-org/ZCode)（Apache-2.0） | 界面设计 |
| [Agent Skills](https://agentskills.io/specification) | 前端 Skill 的文件格式 |
| [Apple HIG](https://developer.apple.com/design/human-interface-guidelines)、[WCAG 2.2](https://www.w3.org/TR/WCAG22/) | 前端 Skill 的交互与无障碍原则 |
| [SWE-bench](https://github.com/SWE-bench/SWE-bench)、[SWE-bench Pro](https://github.com/scaleapi/SWE-bench_Pro-os)（代码 MIT） | 调优题与评测题 |
| [js-yaml](https://github.com/nodeca/js-yaml)、[Zod](https://github.com/colinhacks/zod)（MIT） | YAML 解析、数据校验 |

[详细致谢与许可证](docs/Acknowledgements.md) · 本项目采用 [Apache-2.0](LICENSE) 许可证。
