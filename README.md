# dsh-super-code

DeepSeek Harness 编码插件。用户只选择 `super-code`；Agent 按交付目标选择内部专业团队，简单任务直接完成，需要时再加载方法、建立任务档案或并行委派。没有独立路由模型调用、强制五阶段流程或统一反思循环。

0.0.9 收敛为一套宿主原生执行路径：移除旧 workflow、任务图和模型池设置；任务写入与读取分离，页面只接收档案摘要；成员费用缺失不再阻止产物评审，但始终明确未核实。离线评测支持同 preset 的版本对照及完整请求计费。没有增加循环、调度器或必经模型调用，也不宣称未经真实对照验证的质量或费用收益。

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
dsh plugin --profile web add dsh-super-code
```

插件注册唯一的 `super-code` preset 并设为默认；宿主自带和用户自定义 preset 仍可用。插件不再增加预设切换控件；宿主原生预设入口及已开始会话的组合不可变规则保持不变。

项目与 npm 包统一命名为 `dsh-super-code`，源码仓库为 [ArtlexYoung/dsh-super-code](https://github.com/ArtlexYoung/dsh-super-code)。本地改名不代表新包已发布到 npm。已有安装需更新包引用和 preset 根目录路径；新任务档案使用新包名标识，仍可读取更名前的档案。0.0.9 移除旧 `SuperAgent*` / `ctx.superAgent` API、旧模型池设置及 `core/*` 通配出口，不提供兼容包装；历史 runner 使用冻结旧包。已保存档案的读取、`superAgentUsage` 用量字段与侧栏资源协议仍保持原值，避免丢失已有记录。

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

按需加载优化的是全任务成本，不是单次文本长度：已知方法可直接读取，无需先查询团队目录；专项返回仅保留交付目标和完整方法。上下文已包含有效指导、任务状态或执行结果时不重复取回，独立读取尽量同批；缺失、过期或存疑的信息仍需检查。工具调用不等于模型请求，但额外往返通常会再次计入输入上下文和输出，缓存部分也依供应商计费。实际收益应比较全部请求的累计费用、次数及延迟，不能用少几百字符代替效果评测。

只解释或设计不授权改代码。独立、有收益的工作可用宿主 subagent 并行执行；共享文件需要单一写入者或隔离工作区。成员只在范围相关、上下文仍有效时复用；短简报明确目标、所有权、约束、验收和预算，负责人继续本地工作并整合结果。交付简要说明产物、实际执行的检查和剩余缺口，不强制回答模板。这些是指导要求，不是新增调度或自动验收机制。

### 可选的具体指导

默认使用标准指导。不按模型名字猜测强弱，不自动切换模型。部署方可在 preset 的 `super-code` 插件配置中显式指定需要更具体提醒的精确路由：

```yaml
guidedRoutes:
  - provider: your-provider
    model: your-exact-model
```

指导依据宿主本次装配后的 `provider/model` 变量选择，配合宿主 `installModelSelection` 的单步快照；未知路由或缺失身份回退标准指导，不从旧 header 猜测。自定义宿主路由若在装配后另行改写请求，不在该一致性保证内。两种指导遵循相同授权和证据要求，配置收益需实际评测，不默认给任何品牌分档。

## 长对话与任务档案

`super_code_task` 为复杂或跨轮任务保存有来源的要求、验收标准、决策、证据、下一步、工作区和代码版本。简单任务不强制建档。

预设使用 Harness 原生、按 Agent 隔离的压缩服务：自动压缩沿用宿主默认策略，也可使用 `/compact` 手动压缩。压缩可调用当前模型生成摘要，其费用计入任务；不保证摘要的语义完整性，关键约束仍通过任务档案恢复。不新增插件摘要器或循环。

- `create/read/list/update/focus`：要求以 id 合并，未修改的约束保留；修改必须引用本会话真实用户消息。并发写使用 `expectedRevision`，拒绝旧版本覆盖。`read` 默认或 `view: resume` 返回 `{current}` 紧凑恢复视图，保留目标、全部硬约束、验收、决定、下一步和有界有效证据；`omittedEvidence` 标明省略的有效证据数量，`staleEvidence` 标明不再适用的数量。需要原始来源、其他证据或记录字段时可直接传 `view: full`，返回原始完整档案，无需先读恢复视图。完整档案中的证据须核对要求/代码版本，不能直接视为当前证明；读取不切换焦点或新增任务快照。
- `source`：通过用户事件序号取回原文。动态上下文包含任务目录、最近用户事件序号和焦点任务的紧凑视图：保留全部要求、验收、决策和来源序号，不重复原文；最多展示最近 3 条有效证据，预算不足时优先省略证据并标明数量，可通过 `read(view: full)` 读取完整档案。硬约束不静默截断，必需字段超预算的更新会明确失败。
- `archive/archives/history/restore`：完成或取消的任务可归档；每页最多扫描 4,096 个事件、返回 10 个归档摘要，每 256 条让出执行并检查取消。稀疏历史在工具内部继续查找，达到上限返回 `nextBeforeSeq` 和 `done`；`done: false` 不能解释成没有记录。历史全文留在宿主日志。用户要求继续时，恢复工具要求新的用户来源和检查后的代码版本；保留约束、清空旧决策并让旧证据失效，不自动启动工作。
- `delegate/validate_member`：简报绑定会话、任务身份、要求版本、代码版本和成员责任。过期、失败、取消或未确认停止的返回不可评审。`reviewable` 只表示可以交给负责人核对，不等于已验收。成员无须猜测费用：缺失费用返回 `accounting.kind: unavailable`；可选自报费用标为 `model-reported`，预算结论仍为 `unknown`，不会被当作宿主认证或硬预算执行。
- `evidence`：已有引用时传 `record:{callSeq,resultSeq}` 或 `{ref}`，两次索引读取回查本会话配对记录。长输出默认保留首尾并明确省略中间，最多 8,000 个 UTF-16 单元；短输出完整返回，参数预览最多 2,000 单元。需要原始输出时使用返回的 `readMore`，或 `record:{ref,offset:0}` 连续分页；偏移由工具返回，不需要猜测，原始日志不变。此处“完整”只指已记录文本，不保证原工具未截断或执行了全部测试。不知道序号时省略 `record`，按需列出最多 12 条调用/返回身份；参数预览最多 240 单元并标明截断，按 `callId/turn/step` 配对并检查参数。目录每页最多扫描 4,096 条、每 256 条让出执行；通过 `eventSeq: nextBeforeSeq` 继续。跨会话、缺失或不匹配引用不可用；不执行命令、不维护新账本，工具返回不等于测试通过或当前代码已验证。

恢复视图中，证据只按记录的需求/源码版本匹配，不自动核验当前工作区；`evidenceBasis` 明确这一边界。源码版本应区分相关未提交改动，不能只依赖未变化的 HEAD。更新版本会使旧证据失效，但完整记录保留供回查。没有新增文件监听、自动版本猜测或恢复时的强制测试。

同值 `update` 和重复 `focus` 返回 `unchanged: true`，不追加任务快照、不增加修订；来源和旧版本校验仍先执行，用户来源变化、暂停恢复不会被去重。未确认的 checkpoint 也会先重试，持久化失败不能被“无变化”掩盖。参数错误返回有限字段位置、错误种类及必要的类型或数量要求，缺少 `expectedRevision` 明确提示；不回显提交值，不自动修正版本、来源或输入。

真实进度更新夹带相同目标、工作区、验收或要求时，只增加普通修订，不清空决定或使成员绑定失效；真实要求、纠正来源、代码版本和状态变化仍按相应规则失效。首次装配的动态上下文可能早于最新用户消息入库；最新来源序号缺席时使用 `list` 的 `recentUserEventSeqs`，不要猜序号。

任务焦点与执行状态分离，切换话题不自动取消工作。暂停再激活会改变委派版本，旧成员返回仍然过期；普通进度更新不影响有效简报。完成或取消的任务只能归档后凭归档之后的新用户消息恢复，不能直接改回 active。归档是显式操作，工作集默认最多 32 个任务，上限 128；上下文默认最多 32 KiB，可在 preset 的 `super-code` 插件配置中调整 `maxTasks`、`maxContextBytes`（1–256 KiB）。要求和证据还有各自条数/长度限制。

档案通过宿主支持的 plugin-source `user/message` 事件和 `superCodeTasks` projection 保存，写工具在宿主 `flush` 成功后才返回成功；失败后的下一次工具调用重试 checkpoint，不重复追加事件。宿主先发布内存 projection 再 flush，因此磁盘失败时 UI 可能短暂显示尚未确认持久化的记录。插件此时阻止模型动态上下文把该 checkpoint 当作已确认事实，但不提供跨 UI/磁盘事务保证。

紧凑视图只减少动态上下文的重复内容。当前完整快照仍通过上述消息事件持久化，并可能重复出现在模型历史中；尚未解决历史快照累积，不能据视图字节数推算整段对话的 token 节省。这些工具验证来源引用和版本，不证明模型对原文的解释正确，也不强制模型调用工具。真实长程理解和 token 收益需要模型评测。

## Web 界面与插件入口

Web client 使用公开 slots、Remote 和 Session projection：任务档案与插件用量统一收口到侧栏，输入区不再重复展示档案、用量汇总或预设选择。根 Agent 详情展示当前任务的目标、状态和下一步，其他任务按需展开。右侧节点树只展示当前会话及其成员；点击节点或按 Enter/空格在右侧打开该 Agent 的只读标签，重复打开会复用标签，不切换主对话。详情顶部展示层级路径、token 总量和缓存命中率，输入/输出及缓存读取/写入在“用量详情”展开；下面按时间展示用户任务、Agent 回复和执行错误，隐藏内部上下文、推理及工具调用和结果（包括 super_code_task）。宿主原生用量展示不受影响。

执行树采用从上到下的紧凑圆形节点图，自动读取可见节点的下级目录，无需逐层展开。点击节点直接打开侧栏详情，主对话不变；实色背景表示运行、待命、停止和不可用，摘要只显示子树 token 和按累计输入计算的缓存命中率。支持鼠标/触屏拖动平移、滚轮及按钮缩放（40%–200%）、适应窗口；双击空白处适应窗口，切换标签保留视图位置。首批最多渲染 200 个节点，大树分批显示。详情使用宿主 SessionEventStream 读取持久记录，按页加载历史、最多保留 200 条展示记录，隐藏/关闭详情时释放订阅。状态采用宿主活动事实，停止不等于验收成功；不可读记录和缺失用量单独标识，不伪造结果。token 服务使用固定大小计数器，不积累无限 usage 数组。

页面档案 projection 只传任务目录和当前目标、状态、下一步，不传原文、证据或完整要求。完整状态仍由宿主保存，模型恢复视图保留全部硬约束。减少页面传输不等于减少模型历史 token。读取取得已确认快照后，历史扫描不占写队列；写入仍串行，并在 flush 成功后确认。

包根默认导出注册宿主投影并提供浏览器发现入口；`dsh-super-code/dsh` 仅注册投影；`dsh-super-code/super-code` 仅用于 Agent scope。根入口导出当前团队、指导、任务和证据的领域函数，离线评测独立从 `dsh-super-code/evaluation` 导入。主 Agent 与成员模型始终由 Harness 选择，不再提供无效的模型池控件。

## 困难问题的有界实验

现有 `super_code_method` 可附带 `recipe: reduce | differential | interleavings | metamorphic`，直接返回所选示例和已安装模块地址；不需要先读目录。不选 recipe 时返回内容不变，主提示词不注入示例。

独立模块 `dsh-super-code/experiments` 提供失败输入缩减、差分、两条有序序列的交错枚举及契约关系验证。模型调整示例后，通过宿主前台 `bash` 的一次调用运行多个检查，组合搜索和缩减时共享 `ExperimentBudget`。不新增 Agent、模型循环、依赖或宿主执行器。模块不在插件常驻入口加载。

调用者必须提供可靠判据、结构化可克隆的数据，并隔离每次实验状态。差分参考实现应独立可信，关系来自真实契约；输入缩减仅接受相同故障签名的两次复现，宽泛签名可能混淆不同故障。`one-removal` 只表示在可重复判据下不能再删单个元素，不保证全局最小。`checked` 仅覆盖给定样本；交错枚举保持两条序列各自顺序，最多 256 步，`limited` 明确表示没有穷尽，也不代表覆盖真实系统全部调度。

差分示例只报告原始差异反例，不把通用 `behavior-difference` 自动用于同故障缩减。需要组合时，用任务契约限定目标判据和签名；同签名仍不证明同一根因。各示例只附带相关说明，输出保留状态、原因、实际检查预算及适用的覆盖/最小性信息，数组预览最多 8 项，明确原始长度；完整结果仍在脚本变量中，大报告按需保存到任务文件。

`maxChecks` 按 probe 次数计数，含复现确认；一个差分或关系 probe 含两次观察。`timeoutMs` 和可选 `AbortSignal` 为协作式限制，不能打断死循环或不合作的 Promise，必须同时设置宿主前台 `bash.timeoutMs`。预算耗尽只返回已确认结果；`unknown`、异常、未稳定复现都不能当通过。回调异常向外抛出；副作用只可针对已授权且可安全重复的操作。大报告可保存在任务文件中，终端只输出必要摘要。能力测试不等于已证明真实模型正确率或费用改善。

## 版本对照评测

`evaluateSuperCodeBatch` 使用 `super-code/v3`：运行前固定 manifest，`baseline` 和 `candidate` 分别声明 preset、版本与实际包摘要；允许同为 super-code 的两个版本直接比较。每个任务每侧一条汇总，包含全部尝试的请求记录；不挑最好一次、不覆盖历史。

```bash
npm run build
npm run eval:super-code -- manifest.json measurements.jsonl
# 安装后：super-code-eval manifest.json measurements.jsonl
```

命令只读离线证据，不运行模型。退出码 0 为通过，1 为未通过/不完整，2 为输入无效。旧协议输入明确拒绝；历史四场景和 v2 使用冻结旧版本工具。

manifest 与逐行输入类型见 `src/core/evaluation.ts` 或包内声明。必须固定任务、模型、推理、评分器、工具、资源、环境及 Harness 条件，并在运行前明确 `gates`，例如：

```json
{ "minAccuracyUplift": 0, "maxLostSuccesses": 0, "minCostReduction": 0.1 }
```

这是“质量不退化、费用至少下降 10%”的实验目标示例，不是本版已达到的收益。可省略费用/延迟改善门槛，但报告仍需完整计费证据。每个类别禁止净质量退化，报告同题新增成功、丢失成功及不可评分项；小样本无退化不是统计证明。

每侧提供 `expectedRequests`、`requestManifestComplete` 与实际 `requests`。每个请求记录 session/attempt 身份、root/member/retry/compaction 类型、provider/model、价格引用、互斥的 uncachedInput/cacheRead/cacheWrite/output 桶及工具费用。价格表提供币种、来源、有效时间、各桶每百万 token 单价和实际 perRequest 费用（没有时明确 0）。请求清单必须来自完整宿主日志，CLI 本身不能证明清单未遗漏。

重复或异常请求拒绝；缺题 `incomplete`，版本/条件变化 `unmatched`，mock/replay、环境/评分故障、未知结果、缺请求/用量/价格或混合币种 `unmeasured`。Agent 未交付和审计拒绝计为失败，环境故障单列，所有已观察尝试的请求与用量仍保留。失败分类由评测适配器负责，不能用环境标签掩盖能力失败。

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
src/core/evaluation.ts    # v3 版本配对与请求计费
src/dsh/super-code.ts     # scoped 工具与动态上下文
src/task-memory-store.ts # 会话写屏障与持久化确认
src/evaluate.ts          # 离线评测 CLI
client/index.js          # 宿主 Web slots
```

Apache License 2.0，见 [LICENSE](LICENSE)。
