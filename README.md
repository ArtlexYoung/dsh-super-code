# dsh-super-agent

DeepSeek Harness 编码插件。用户只选择 `super-code`；Agent 按交付目标选择内部专业团队，简单任务直接完成，需要时再加载方法、建立任务档案或并行委派。没有独立路由模型调用、强制五阶段流程或统一反思循环。

0.0.7 增加紧凑任务上下文与侧栏 Agent 节点图，支持拖动、缩放、独立只读详情和分层用量；专业方法进一步明确交付与验证要求。已进行独立 Harness 安装和页面验收，模型端使用本地确定性 fixture；本版尚无新的真实模型质量或成本改善结论。

## 效果基准（0.0.6 历史结果）

SWE-bench Lite 前 100 题，`deepseek-v4.1-flash`、reasoning `high`，两组都通过完整 DeepSeek Harness Agent 流程：

| | DSH minimal | super-code |
|---|---:|---:|
| 正确率 | 99% | 99% |
| 平均总 token | 737,421 | 419,145（-43%） |
| 平均耗时 | 314 秒 | 89 秒（-72%） |

在这批题上，super-code 保持了相同正确率，同时减少了 token 和耗时。结果使用本地 focused tests，不是官方 Docker SWE-bench 分数。

## 安装与选择

要求 Node.js 22+、Harness **0.1.5-rc.2+**，使用当前 persona-prefix API 和右侧栏服务，不兼容 0.1.2-rc.1。使用宿主的模型、工具、权限、子 Agent 和 Session 持久化。

```bash
dsh plugin --profile web add dsh-super-agent
```

插件注册唯一的 `super-code` preset 并设为默认；宿主自带和用户自定义 preset 仍可用。插件不再增加预设切换控件；宿主原生预设入口及已开始会话的组合不可变规则保持不变。

```json
{ "request": { "agentPreset": "super-code" } }
```

原 `solo`、`team`、`research`、`optimization` preset 已删除，不提供别名、迁移或旧会话恢复兼容。升级后请新建 `super-code` 会话。联网调研使用宿主 web backend 和权限；没有可用 backend 时必须报告限制。

## 内部团队与方法

| 主责 | 交付目标 | 常用专项方法 |
| --- | --- | --- |
| research 调研 | 有证据的事实、诊断、技术判断 | 调查、集成 |
| design 设计 | 可实施的产品、接口、算法或架构方案 | 产品、架构、算法 |
| develop 开发 | 功能、修复、重构、迁移、集成 | 产品、bug 修复、架构、集成 |
| verify 测试 | 测试、审查发现、验收证据 | 测试、集成 |
| optimize 优化 | 有测量依据的改进 | 性能、算法、架构、质量 |

团队是专业方法集合，不是五个常驻 Agent。主 Agent 根据任务含义选择主责，通过 `super_code_method` 按需读取；专项方法跨团队共享。没有独立分类的工作按简单/复杂深度处理。架构优化与性能优化分别确定目标，不能把代码更短当作性能提升。

只解释或设计不授权改代码。独立、有收益的工作可用宿主 subagent 并行执行；共享文件需要单一写入者或隔离工作区。短简报明确目标、所有权、约束、验收和预算，负责人继续本地工作并整合结果。

## 长对话与任务档案

`super_code_task` 为复杂或跨轮任务保存有来源的要求、验收标准、决策、证据、下一步、工作区和代码版本。简单任务不强制建档。

- `create/read/list/update/focus`：要求以 id 合并，未修改的约束保留；修改必须引用本会话真实用户消息。并发写使用 `expectedRevision`，拒绝旧版本覆盖。
- `source`：通过用户事件序号取回原文。动态上下文包含任务目录、最近用户事件序号和焦点任务的紧凑视图：保留全部要求、验收、决策和来源序号，不重复原文；最多展示最近 3 条有效证据，预算不足时优先省略证据并标明数量，可通过 `read` 读取完整档案。硬约束不静默截断，必需字段超预算的更新会明确失败。
- `archive/archives/history/restore`：完成或取消的任务可归档；每页最多扫描 256 个事件、返回 10 个归档摘要，历史全文留在宿主日志。用户要求继续时，恢复工具要求新的用户来源和检查后的代码版本；保留约束、清空旧决策并让旧证据失效，不自动启动工作。
- `delegate/validate_member`：简报绑定会话、任务身份、要求版本、代码版本和成员责任。过期、失败、未确认停止或成本不全的返回不能进入验收。可评审不等于已验收，仍需负责人核对产物和检查。

任务焦点与执行状态分离，切换话题不自动取消工作。暂停再激活会改变委派版本，旧成员返回仍然过期；普通进度更新不影响有效简报。完成或取消的任务只能归档后凭归档之后的新用户消息恢复，不能直接改回 active。归档是显式操作，工作集默认最多 32 个任务，上限 128；上下文默认最多 32 KiB，可在 preset 的 `super-code` 插件配置中调整 `maxTasks`、`maxContextBytes`（1–256 KiB）。要求和证据还有各自条数/长度限制。

档案通过宿主支持的 plugin-source `user/message` 事件和 `superCodeTasks` projection 保存，写工具在宿主 `flush` 成功后才返回成功；失败后的下一次工具调用重试 checkpoint，不重复追加事件。宿主先发布内存 projection 再 flush，因此磁盘失败时 UI 可能短暂显示尚未确认持久化的记录。插件此时阻止模型动态上下文把该 checkpoint 当作已确认事实，但不提供跨 UI/磁盘事务保证。

紧凑视图只减少动态上下文的重复内容。当前完整快照仍通过上述消息事件持久化，并可能重复出现在模型历史中；尚未解决历史快照累积，不能据视图字节数推算整段对话的 token 节省。这些工具验证来源引用和版本，不证明模型对原文的解释正确，也不强制模型调用工具。真实长程理解和 token 收益需要模型评测。

## Web 界面与可选底层 API

Web client 使用公开 slots、Remote 和 Session projection：任务档案与插件用量统一收口到侧栏，输入区不再重复展示档案、用量汇总或预设选择。根 Agent 详情展示当前任务的目标、状态和下一步，其他任务按需展开。右侧节点树只展示当前会话及其成员；点击节点或按 Enter/空格在右侧打开该 Agent 的只读标签，重复打开会复用标签，不切换主对话。详情顶部展示层级路径、token 总量和缓存命中率，输入/输出及缓存读取/写入在“用量详情”展开；下面按时间展示用户任务、Agent 回复和执行错误，隐藏内部上下文、推理及工具调用和结果（包括 super_code_task）。宿主原生用量展示不受影响。

执行树采用从上到下的紧凑圆形节点图，自动读取可见节点的下级目录，无需逐层展开。点击节点直接打开侧栏详情，主对话不变；实色背景表示运行、待命、停止和不可用，摘要只显示子树 token 和按累计输入计算的缓存命中率。支持鼠标/触屏拖动平移、滚轮及按钮缩放（40%–200%）、适应窗口；双击空白处适应窗口，切换标签保留视图位置。首批最多渲染 200 个节点，大树分批显示。详情使用宿主 SessionEventStream 读取持久记录，按页加载历史、最多保留 200 条展示记录，隐藏/关闭详情时释放订阅。状态采用宿主活动事实，停止不等于验收成功；不可读记录和缺失用量单独标识，不伪造结果。token 服务使用固定大小计数器，不积累无限 usage 数组。

根入口提供 `TaskGraph`、`Dispatcher`、评审/研究/优化账本，依赖 Node.js 与 Zod；默认导出为按挂载加载的 Harness 插件，供 bundle 使用包根名称注册并发现浏览器模块。直接 Cordis 服务入口仍为 `dsh-super-agent/dsh`，单独导入领域 API 不加载 Harness 运行时。`dsh-super-agent/super-code` 只能装配在 Agent scope，不能全局覆盖其他 preset。

```ts
import { TaskGraph, Dispatcher } from 'dsh-super-agent'

const graph = new TaskGraph([
  { taskId: 'build', title: 'Build', acceptance: ['tests pass'] },
  { taskId: 'integrate', title: 'Integrate', dependencies: ['build'] },
])
const dispatcher = new Dispatcher(graph, { maxConcurrent: 2 })
// runAvailable(assign, execute, { signal, maxStarted, afterEach }) 按空槽补位。
// afterEach 可显式提交、评审并验收；仅执行完成不会解锁依赖。
```

`runAvailable` 是事件驱动的有界调度工具，不是 super-code 的强制模型循环；实际会话成员由宿主 subagent 执行。取消只影响本轮拥有的执行，超时且未确认停止的执行仍占容量；不自动重试。

已有 `runProgrammingWorkflow`、`runConversationWorkflow` 是调用方显式选择的独立工具，不会被 super-code 自动运行。设置页的 high/normal/low 模型池只影响这些显式 workflow；super-code 主 Agent 和成员的模型由宿主管理。不要用旧 workflow 测量替代 preset 的真实结果。

## 单候选评测

`evaluateSuperCodeBatch` 使用 `super-code/v2`：运行前固定 manifest，每题一条 `minimal` 基线和一条 `super-code` 候选。任务类别用于覆盖与退化检查，运行时团队只作诊断，不能逐题挑最优场景。

```bash
npm run build
npm run eval:super-code -- manifest.json measurements.jsonl
# 安装后也可使用 super-code-eval manifest.json measurements.jsonl
```

该命令只读取证据、输出 JSON，不运行模型或修改历史。退出码：0 表示通过，1 表示未通过/未测量完整，2 表示无效输入。

manifest 字段见 `SuperCodeManifest`，逐行测量见 `SuperCodeMeasurement`（`src/core/evaluation-v2.ts` / 包内声明）。必须固定任务、评测器、模型、推理档位、工具、资源、环境与宿主版本；版本标识应绑定实际源码/数据摘要。评测器必须完整提供主 Agent、成员、重试、工具和记忆维护成本，区分缓存/未缓存输入、输出、工具次数、墙钟耗时。此命令不会自动收集子 Agent 账单。

重复题拒绝，缺题为 `incomplete`，条件不匹配为 `unmatched`，mock/replay/基础设施故障/成本不全为 `unmeasured`。只有完整成对真实测量才为 `measured`；默认门槛仍是正确率提升至少 10 个百分点、token 减少至少 10%、耗时不增加，并禁止固定类别质量退化。失败题的成本也计入。

历史四场景聚合 API 保持原评测语义，仅用于读旧结果，不是当前发布入口。

## 开发

```bash
npm install
npm run typecheck
npm test
npm run build
node --check client/index.js
npm pack --dry-run
```


```text
presets/super-code/       # 唯一产品预设
src/core/teams.ts         # 五团队与共享方法
src/core/task-memory.ts   # 有界工作集和要求修订
src/core/delegation.ts    # 委派简报与结果版本核对
src/core/evaluation-v2.ts # 单候选成对验收
src/dsh/super-code.ts     # scoped 工具与动态上下文
src/evaluate.ts          # 离线评测 CLI
client/index.js          # 宿主 Web slots
```

Apache License 2.0，见 [LICENSE](LICENSE)。
