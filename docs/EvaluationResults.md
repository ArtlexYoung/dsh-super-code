# SWE-bench Pro hard-100 · 校正结果 / Corrected Results

截至 2026-10-09，下面五组都完成了同一批 100 题的官方评分。0.2.0 使用冻结的分层记忆候选，0.3.0 使用冻结的 Batch.3 候选成绩；本页不混入其他实验方案。

As of October 9, 2026, all five runs have official scores for the same 100 tasks. Version 0.2.0 refers to the frozen memory-hierarchy candidate; 0.3.0 reports the frozen Batch.3 candidate. Other experiments are not included.

## 版本对比 · Version Comparison

| 指标 / Metric | 官方 minimal | 0.0.9 | 0.1.2 | 0.2.0 分层记忆 | 0.3.0 Batch.3 |
|---|---:|---:|---:|---:|---:|
| 有效评分 / Valid scores | 100 | 100 | 100 | 100 | 100 |
| 通过题数 / Passed | 44 | 48 | 52 | 52 | 54 |
| 平均回答耗时 / Mean minutes | 25.69 | 16.46 | 16.01 | 15.15 | 13.46 |
| 耗时中位数 / Median minutes | 26.14 | 14.40 | 13.74 | 13.51 | 12.20 |
| 耗时 P90 / P90 minutes | 43.70 | 28.82 | 29.36 | 24.14 | 21.38 |
| 模型调用/题 / Model calls per task | 124.85 | 92.78 | 99.78 | 93.83 | 69.29 |
| 顶层工具调用/题 / Top-level tool calls per task | 127.36 | 116.55 | 123.34 | 119.16 | 69.73 |
| 总输入 token/题 / Input tokens per task | 11,477,170 | 9,525,316 | 9,840,383 | 9,202,574 | 6,290,407 |
| 缓存输入 token/题 / Cached input per task | 11,404,101 | 9,461,981 | 9,775,799 | 9,142,006 | 6,231,823 |
| 非缓存输入 token/题 / Uncached input per task | 73,069 | 63,334 | 64,584 | 60,569 | 58,584 |
| 输出 token/题 / Output tokens per task | 100,877 | 97,901 | 97,793 | 96,520 | 91,562 |
| 总 token/题 / Total tokens per task | 11,578,047 | 9,623,217 | 9,938,176 | 9,299,094 | 6,381,969 |
| 输入缓存率 / Input cache hit rate | 99.363% | 99.335% | 99.344% | 99.342% | 99.069% |
| 缺少用量的请求 / Requests without usage | 7 | 8 | 1 | 1 | 0 |

工具次数按宿主 `tool/call` 统计。一次 PTC 调用内部可以执行多个操作，因此这列不能用来比较实际执行了多少次文件读取或命令。

Tool counts use host `tool/call` events. One PTC call can execute several operations, so this column does not compare the number of underlying file reads or commands.

## 相比官方 minimal · Relative to Official minimal

| 版本 / Version | 通过率变化 / Pass-rate change | 平均耗时 / Mean time | 总 token / Total tokens | 新通过 / Gains | 回退 / Regressions |
|---|---:|---:|---:|---:|---:|
| 0.0.9 | +4 pp | -35.9% | -16.9% | 7 | 3 |
| 0.1.2 | +8 pp | -37.7% | -14.2% | 10 | 2 |
| 0.2.0 | +8 pp | -41.0% | -19.7% | 11 | 3 |
| 0.3.0 Batch.3 | +10 pp | -47.6% | -44.9% | 13 | 3 |

Batch.3 相比 0.2.0 平均耗时减少 11.1%、总 token 减少 31.4%、模型调用减少 26.2%，通过数从 52 增至 54；逐题新通过 8 题、回退 6 题。这是同题单轮结果，2 题的净增不能据此认定为稳定的质量提升。

Against 0.2.0, Batch.3 uses 11.1% less time, 31.4% fewer total tokens, and 26.2% fewer model calls. Passes rise from 52 to 54, with eight gains and six regressions. This is one run on the same tasks; a net gain of two does not establish a stable quality improvement.

0.2.0 与 0.1.2 都通过 52 题，平均耗时下降 5.4%、总 token 下降 6.4%，但逐题有 6 题改善、6 题回退。相对 minimal，0.2.0 新通过 11 题、回退 3 题（37、396、503），净增 8 题。不能把总体提升写成“原先正确的都没有退化”。

Both 0.2.0 and 0.1.2 pass 52 tasks. Version 0.2.0 uses 5.4% less time and 6.4% fewer total tokens, with six gains and six regressions. Against minimal, it gains 11 tasks and regresses on three (37, 396, 503), for a net gain of eight. Aggregate improvement does not mean every previous pass is preserved.

## 修正了什么 · What Was Corrected

| 版本 / Version | 原始通过 / Original passes | 校正通过 / Corrected passes | 复核题数 / Regraded tasks |
|---|---:|---:|---:|
| minimal | 41 | 44 | 4 |
| 0.0.9 | 46 | 48 | 3 |
| 0.1.2 | 49 | 52 | 4 |
| 0.2.0 | 48 | 52 | 5 |

16 条评分记录出现 ConfigFileTest 500ms 超时或 Jest worker SIGKILL 等环境异常，已用**原补丁**重新运行官方评分；每条取两次无该异常且一致的结果，不采用“重试到通过”的取优口径。12 条恢复通过，4 条仍失败。复评分没有新增模型调用，原始评分、用量和补丁均保留。

Sixteen grading records had anomalies such as the ConfigFileTest 500 ms timeout or a killed Jest worker. Each was regraded with the **original patch**, requiring two matching results without that anomaly—not selecting the best result from retries. Twelve recovered to a pass and four remained failures. Regrading added no model calls; the original scores, usage, and patches are preserved.

[四版本逐题数据](../eval/results/swebench-pro-final-100/CorrectedFourVersions.json)包含全部 400 条评分、调用数、token、耗时、补丁与证据哈希，以及逐条修正原因。历史 JSON 保留原貌，以这份校正汇总为当前展示口径；结果文件留在仓库，不重复放进 npm 包。

The [four-version per-task data](../eval/results/swebench-pro-final-100/CorrectedFourVersions.json) contains all 400 scores, call counts, tokens, times, patch/evidence hashes, and individual correction reasons. Historical JSON is unchanged; the corrected summary is the current reporting source. Result files remain in the repository rather than the npm package.

[Batch.3 逐题数据](../eval/results/swebench-pro-final-100/Batch3Results.json)另存 100 条成绩、用量、耗时和原始证据及补丁哈希，汇总数字已逐题复算，并核对与上述基线使用同一批任务。Batch.3 的评分异常同样用原补丁复核，不把作废尝试的调用和用量加到最终结果中；这些数据也不进入 npm 包。

The separate [Batch.3 per-task data](../eval/results/swebench-pro-final-100/Batch3Results.json) contains 100 scores, usage, timing, and original evidence/patch hashes. Aggregates were recomputed from the rows, and task identities checked against the baselines above. Batch.3 grading anomalies were also rechecked with the original patches; discarded attempts' calls and usage are excluded from final results. These data stay outside the npm package too.

## 如何理解 · How to Read These Results

- **同题比较：** 固定题集标识为 `swebench-pro-hard-100-ddd22492f1c38839`，使用同一开发测试模型、`high` 推理等级、原生 DSH Web RPC 和官方评分器。这是按既有难度方法选出的历史 100 题，不是官方认定的“最难 100 题”，也不是未接触过的盲测集。
  **Same tasks:** The frozen selection is `swebench-pro-hard-100-ddd22492f1c38839`, using the same development test model, `high` reasoning, native DSH Web RPC, and the official grader. It is a historically exposed selection from the existing difficulty-ranking method—not an official hardest-100 designation or a fresh blind test.
- **时间：** 统一采用每题 Web RPC 回答耗时，不计官方评分、下载镜像和复评分；中位数取第 50、51 项均值，P90 取排序后的第 90 项。旧文档 0.0.9 的 16.27 分钟使用不同口径，现统一为 16.46 分钟。
  **Time:** Per-task Web RPC response time excludes grading, image downloads, and regrading. The median averages the 50th and 51st values; P90 is the 90th ordered value. The older 16.27-minute figure for 0.0.9 used a different timing convention; the consistent figure is 16.46 minutes.
- **用量：** 纳入每题最终评分尝试的已记录调用，先逐题合计再对 100 题取平均。输入包含缓存读取；缓存率为全部缓存输入除以全部输入，而非逐题缓存率的平均。未返回用量的请求不估算，因此 token 不代表完整账单费用，也不包括先前被放弃的尝试成本。
  **Usage:** Recorded calls from each task’s final scored attempt are summed per task, then averaged over 100 tasks. Input includes cache reads; the cache rate is total cached input divided by total input, not the mean per-task rate. Missing usage is not estimated, so tokens do not represent a complete bill or the cost of earlier abandoned attempts.
- **候选身份：** 0.2.0 表示已评测的分层记忆候选，其实验包内部版本仍为 0.1.3，包 SHA-256 为 `164cc1b505c05288f01b6f12c0756af049dbde8f1a49bdb11f9a320a19c925f5`。新整合的记忆 UI 与兼容改动进行单测及真实宿主回归，未重新运行这 100 次模型任务。
  **Candidate identity:** The evaluated memory-hierarchy candidate is reported as 0.2.0; its experimental package still carried version 0.1.3 and SHA-256 `164cc1b505c05288f01b6f12c0756af049dbde8f1a49bdb11f9a320a19c925f5`. The integrated memory UI and compatibility changes undergo unit and real-host regression checks, not a fresh 100-task model run.
- **0.3.0 来源：** 本页成绩属于内部版本 `0.3.0-batch.3` 的实际安装候选。整合时按冻结的运行模块逐文件核对，保留主干 0.2.1 的语言资源和兼容改动；发布包做类型、单测、打包及真实宿主回归，没有重新执行这 100 次模型任务。Batch.3 与分层记忆候选的 Harness 提交同为 `649bfcddf0e3532510a38380b9620570d8b13818`，仍不能分离提示词和工具呈现方式各自的作用。
  **0.3.0 source:** These scores belong to the installed candidate carrying internal version `0.3.0-batch.3`. Integration checks the frozen runtime modules individually and retains main's 0.2.1 locale and compatibility updates. The release package undergoes type checks, unit tests, package checks, and real-host regression rather than rerunning those 100 model tasks. Batch.3 and the memory-hierarchy candidate share Harness commit `649bfcddf0e3532510a38380b9620570d8b13818`; their results still do not isolate prompt changes from tool presentation changes.
- **归因与隐私：** 各轮 Harness 提交不同，记忆工具实际触发也有限，不能把全部差异归因于记忆或单一改动。公开数据仅保留核对所需字段，不包含开发模型路由、凭据、环境变量、本机路径或用户消息原文。
  **Attribution and privacy:** Harness revisions differ, and memory-tool use was limited; these results do not isolate memory or any single change. Public data retains audit fields without development model routes, credentials, environment variables, machine paths, or verbatim user messages.
