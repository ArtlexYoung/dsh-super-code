# dsh-super-agent

DeepSeek Harness 编码插件。用户只选择 `super-code`；Agent 按交付目标选择内部专业团队，简单任务直接完成，需要时再加载方法、建立任务档案或并行委派。没有独立路由模型调用、强制五阶段流程或统一反思循环。

## 效果基准

SWE-bench Lite 前 100 题，`deepseek-v4.1-flash`、reasoning `high`，两组都通过完整 DeepSeek Harness Agent 流程：

| | DSH minimal | super-code |
|---|---:|---:|
| 正确率 | 99% | 99% |
| 平均总 token | 737,421 | 419,145（-43%） |
| 平均耗时 | 314 秒 | 89 秒（-72%） |

在这批题上，super-code 保持了相同正确率，同时减少了 token 和耗时。结果使用本地 focused tests，不是官方 Docker SWE-bench 分数。

## 安装与选择

要求 Node.js 22+、Harness **0.1.2-rc.1 或满足 peer 约束的版本**。使用宿主的模型、工具、权限、子 Agent 和 Session 持久化。

```bash
dsh plugin --profile web add dsh-super-agent
```

插件注册唯一的 `super-code` preset 并设为默认；宿主自带和用户自定义 preset 仍可用。Web 输入栏可在空白会话选择预设；已开始的会话遵循宿主组合不可变规则。

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
- `source`：通过用户事件序号取回原文。当前上下文只包含任务目录、最近用户事件序号和焦点任务；硬约束不静默截断，超预算的更新会明确失败。
- `archive/archives/history/restore`：完成或取消的任务可归档；每页最多扫描 256 个事件、返回 10 个归档摘要，历史全文留在宿主日志。用户要求继续时，恢复工具要求新的用户来源和检查后的代码版本；保留约束、清空旧决策并让旧证据失效，不自动启动工作。
- `delegate/validate_member`：简报绑定会话、任务身份、要求版本、代码版本和成员责任。过期、失败、未确认停止或成本不全的返回不能进入验收。可评审不等于已验收，仍需负责人核对产物和检查。

任务焦点与执行状态分离，切换话题不自动取消工作。暂停再激活会改变委派版本，旧成员返回仍然过期；普通进度更新不影响有效简报。完成或取消的任务只能归档后凭归档之后的新用户消息恢复，不能直接改回 active。归档是显式操作，工作集默认最多 32 个任务，上限 128；上下文默认最多 32 KiB，可在 preset 的 `super-code` 插件配置中调整 `maxTasks`、`maxContextBytes`（1–256 KiB）。要求和证据还有各自条数/长度限制。

档案通过宿主支持的 plugin-source `user/message` 事件和 `superCodeTasks` projection 保存，写工具在宿主 `flush` 成功后才返回成功；失败后的下一次工具调用重试 checkpoint，不重复追加事件。宿主先发布内存 projection 再 flush，因此磁盘失败时 UI 可能短暂显示尚未确认持久化的记录。插件此时阻止模型动态上下文把该 checkpoint 当作已确认事实，但不提供跨 UI/磁盘事务保证。

这些工具验证来源引用和版本，不证明模型对原文的解释正确，也不强制模型调用工具。真实长程理解和 token 收益需要模型评测。

## Web 界面与可选底层 API

Web client 使用公开 slots、Remote 和 Session projection：输入栏显示预设选择与可折叠任务档案；底部显示 token 汇总；右侧执行树打开宿主子 Agent 会话。token 服务使用固定大小计数器，不积累无限 usage 数组。浏览器交互和大规模宿主历史性能需要单独验证。

根入口提供 `TaskGraph`、`Dispatcher`、评审/研究/优化账本，依赖 Node.js 与 Zod；Cordis 服务入口为 `dsh-super-agent/dsh`。`dsh-super-agent/super-code` 只能装配在 Agent scope，不能全局覆盖其他 preset。

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
