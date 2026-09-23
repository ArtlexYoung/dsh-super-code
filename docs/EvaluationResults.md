# SWE-bench Pro hard-100 结果 · Results

这次评测选用 SWE-bench Pro 中难度最高的 100 题，固定使用 `deepseek-v4.1-flash`、`high` 推理等级、原生 DSH Web RPC 和官方评分器。预评测中，DSH `minimal` 的正确率最高，因此选它作为基准。这些题来自真实开源仓库，往往需要读代码、动手修改、运行测试并继续修复；表中的“通过”以官方评分为准。

This evaluation uses the 100 hardest selected SWE-bench Pro tasks, with `deepseek-v4.1-flash`, `high` reasoning, native DSH Web RPC, and the official grader. DSH `minimal` had the highest accuracy in preliminary runs, so it serves as the baseline. The tasks come from real open-source repositories and often require reading code, making changes, running tests, and fixing what fails. A “pass” in the tables means a pass from the official grader.

## 主干 0.1.2 · Mainline 0.1.2

`0.1.2` 冻结候选和 DSH minimal 都完成了这 100 题的官方评分。下表重新汇总了两组的逐题结果，因此 minimal 的部分汇总值与下方历史表略有不同。

The frozen `0.1.2` candidate and DSH minimal both received official scores for all 100 tasks. The table recalculates both runs from per-task results, so some minimal averages differ slightly from the historical table below.

| 指标 / Metric | DSH minimal | super-code 0.1.2 | 变化 / Change |
|---|---:|---:|---:|
| 有效评分 / Valid scores | 100/100 | 100/100 | 持平 / unchanged |
| 通过题数 / Passed | 41 | **49** | **+8** |
| 正确率 / Accuracy | 41% | **49%** | **+8 个百分点 / +8 pp** |
| 平均模型调用/题 / Model calls per task | 124.85 | 99.78 | -20.1% |
| 平均工具调用/题 / Tool calls per task | 127.36 | 123.34 | -3.2% |
| 每题平均总输入 token / Average total input tokens per task | 11,477,170 | 9,840,383 | -14.3% |
| 每题平均总输出 token / Average total output tokens per task | 100,877 | 97,793 | -3.1% |
| 每题平均总 token / Average total tokens per task | 11,578,047 | 9,938,176 | -14.2% |
| 输入缓存命中率 / Input cache hit rate | 99.363% | 99.344% | -0.020 个百分点 / -0.020 pp |
| 平均回答耗时 / Average response time | 25.69 分钟 / min | 16.01 分钟 / min | -37.7% |

`0.1.2` 相对 minimal 新通过 12 题，但原先通过的 41 题中有 4 题回退（题号 63、368、456、503），净增 8 题。两次运行使用不同的 Harness 提交，不能将全部差异归因于插件。

Relative to minimal, `0.1.2` passed 12 additional tasks, but regressed on 4 of minimal's 41 passes (task IDs 63, 368, 456, and 503), for a net gain of 8. The runs used different Harness commits, so not every difference can be attributed to the plugin.

[`super-code-0.1.2.json`](../eval/results/swebench-pro-final-100/super-code-0.1.2.json) 包含脱敏的逐题评分和用量；[历史结果目录](../eval/results/swebench-pro-final-100/)提供基准题号、实例 ID 和明细。

The redacted [`super-code-0.1.2.json`](../eval/results/swebench-pro-final-100/super-code-0.1.2.json) contains per-task scores and usage. The [historical results directory](../eval/results/swebench-pro-final-100/) provides baseline task IDs, instance IDs, and details.

## 历史 0.0.9 · Historical 0.0.9

下表来自 `0.0.9` 候选；`0.1.0` 沿用这批历史基准，不能把它视为 `0.1.0` 重新运行的完整 100 题结果。

This table comes from the `0.0.9` candidate. Version `0.1.0` retained this historical benchmark; it is not a new full 100-task run of `0.1.0`.

| 指标 / Metric | DSH minimal | super-code 0.0.9 | 变化 / Change |
|---|---:|---:|---:|
| 有效评分 / Valid scores | 100/100 | 100/100 | 持平 / unchanged |
| 通过题数 / Passed | 41 | 46 | +5 |
| 正确率 / Accuracy | 41% | 46% | +5 个百分点 / +5 pp |
| 平均模型调用/题 / Model calls per task | 124.85 | 92.78 | -25.7% |
| 平均工具调用/题 / Tool calls per task | 126.54 | 115.41 | -8.9% |
| 每题平均总输入 token / Average total input tokens per task | 11,477,170 | 9,525,316 | -17.0% |
| 每题平均总输出 token / Average total output tokens per task | 100,877 | 97,901 | -3.0% |
| 缓存命中率 / Cache hit rate | 99.360% | 99.329% | -0.031 个百分点 / -0.031 pp |
| 平均测试时长 / Average test time | 25.49 分钟 / min | 16.27 分钟 / min | -36.2% |

## 统计口径 · Calculation Notes

每题先合计已记录模型调用的输入（含缓存）和输出 token，再对 100 题取平均，包含多轮调用与上下文增长。未返回用量的请求不作估算，因此这些数字不代表完整账单费用。输入和输出 token 同时下降时，缓存命中率的小幅下降不代表缓存用量增加。

For each task, input (including cached tokens) and output tokens are summed across recorded model calls, then averaged over the 100 tasks. This includes multi-turn calls and context growth. Requests without reported usage are not estimated, so these figures are not complete billing costs. A small decline in cache hit rate alongside lower input and output token totals does not mean cache usage increased.

公开的 JSON 是脱敏后的结果副本。必要时，模型使用统一展示名称；开发路由、本地环境配置、机器路径和原始工具诊断都已省略，但评分、计数、用量和耗时保留原值。你可以用它核对结果与统计，不能直接把它当作请求配置重放。原始运行证据和内部脚本不公开。

The public JSON is a redacted result copy. Where needed, it uses a consistent display name for the model and omits development routes, local environment settings, machine paths, and raw tool diagnostics. Scores, counts, usage, and elapsed times are unchanged. You can use it to check the results and calculations, but not to replay the requests. Raw run evidence and internal runner scripts are not published.
