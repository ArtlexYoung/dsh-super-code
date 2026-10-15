# SWE-bench Pro hard-100 · 校正结果 / Corrected Results

截至 2026-10-09，版本对比中的五组都完成了同一批 100 题的官方评分。0.2.0 使用冻结的分层记忆候选，0.3.0 使用冻结的 Batch.3 候选成绩。官方预设对比另列于下方，截至 2026-10-15，极简、标准、PTC 和创造的五组均已完成。

As of October 9, 2026, all five version-comparison runs have official scores for the same 100 tasks. Version 0.2.0 refers to the frozen memory-hierarchy candidate; 0.3.0 reports the frozen Batch.3 candidate. The official-preset comparison appears separately below. As of October 15, 2026, all five minimal, standard, PTC, and creative runs are complete.

## 版本对比 · Version Comparison

| 指标 / Metric | 官方 minimal + high | 0.0.9 | 0.1.2 | 0.2.0 分层记忆 | 0.3.0 Batch.3 |
|---|---:|---:|---:|---:|---:|
| 有效评分 / Valid scores | 100 | 100 | 100 | 100 | 100 |
| 通过题数 / Passed | 44 | 48 | 52 | 52 | 54 |
| 平均回答耗时（历史）/ Original mean minutes | 25.685 | 16.458 | 16.011 | 15.148 | 13.461 |
| 耗时中位数 / Median minutes | 26.138 | 14.398 | 13.736 | 13.510 | 12.197 |
| 耗时 P90 / P90 minutes | 43.696 | 28.816 | 29.360 | 24.145 | 21.381 |
| 模型调用/题 / Model calls per task | 124.660 | 92.780 | 99.780 | 93.830 | 69.290 |
| 顶层工具调用/题 / Top-level tool calls per task | 127.360 | 116.550 | 123.340 | 119.160 | 69.730 |
| 总输入 token/题 / Input tokens per task | 11,477,169.950 | 9,525,315.530 | 9,840,382.730 | 9,202,574.270 | 6,290,407.000 |
| 缓存输入 token/题 / Cached input per task | 11,404,101.120 | 9,461,981.440 | 9,775,799.040 | 9,142,005.760 | 6,231,823.360 |
| 非缓存输入 token/题 / Uncached input per task | 73,068.830 | 63,334.090 | 64,583.690 | 60,568.510 | 58,583.640 |
| 输出 token/题 / Output tokens per task | 100,876.950 | 97,900.990 | 97,793.480 | 96,519.570 | 91,561.850 |
| 总 token/题 / Total tokens per task | 11,578,046.900 | 9,623,216.520 | 9,938,176.210 | 9,299,093.840 | 6,381,968.850 |
| 输入缓存率 / Input cache hit rate | 99.363% | 99.335% | 99.344% | 99.342% | 99.069% |
| 缺少用量的请求 / Requests without usage | 3 | 8 | 1 | 1 | 0 |

工具次数按宿主 `tool/call` 统计。一次 PTC 调用内部可以执行多个操作，因此这列不能用来比较实际执行了多少次文件读取或命令。

Tool counts use host `tool/call` events. One PTC call can execute several operations, so this column does not compare the number of underlying file reads or commands.

## 官方预设对比 · Official Preset Comparison

截至 **2026-10-15 08:38（UTC+8）**，以下五组均已完成同一批 100 题。标准 + max 已暂停，部分成绩另列，未完成题不算错。

As of **October 15, 2026, 08:38 (UTC+8)**, all five runs below have completed the same 100 tasks. The paused standard + max run is listed separately; pending tasks are not counted as failures.

| 指标 / Metric | 极简 minimal + high | 极简 minimal + max | 标准 standard + high | PTC + high | 创造 creative + high |
|---|---:|---:|---:|---:| ---: |
| 有效进度 / Valid scores | 100/100 | 100/100 | 100/100 | 100/100 | 100/100 |
| 通过/有效 / Passed / valid | 44/100 | 48/100 | 49/100 | 44/100 | 46/100 |
| 原始分钟/题 / Original minutes | 25.685 | 32.529 | 20.683 | 17.302 | 19.856 |
| 净分钟/题 / Net minutes | 25.122 | 32.009 | 18.826 | 15.122 | 18.714 |
| 净耗时中位数 / Median net minutes | 25.598 | 32.167 | 16.639 | 13.455 | 16.452 |
| 净耗时 P90 / P90 net minutes | 41.658 | 45.179 | 36.681 | 25.031 | 30.104 |
| 模型调用/题 / Model calls | 124.660 | 138.920 | 92.370 | 71.160 | 93.600 |
| 顶层工具调用/题 / Top-level tool calls | 127.360 | 150.070 | 110.480 | 70.990 | 113.780 |
| 总输入 token/题 / Input tokens | 11,477,169.950 | 14,849,497.540 | 8,771,693.040 | 6,160,934.650 | 9,205,287.290 |
| 总 token/题 / Total tokens | 11,578,046.900 | 14,966,097.260 | 8,854,513.910 | 6,238,434.510 | 9,292,949.400 |
| 缓存输入 token/题 / Cached input | 11,404,101.120 | 14,770,140.160 | 8,713,578.230 | 6,099,266.510 | 9,145,025.240 |
| 非缓存输入 token/题 / Uncached input | 73,068.830 | 79,357.380 | 58,114.810 | 61,668.140 | 60,262.050 |
| 输出 token/题 / Output | 100,876.950 | 116,599.720 | 82,820.870 | 77,499.860 | 87,662.110 |
| 输入缓存率 / Input cache hit rate | 99.363% | 99.466% | 99.337% | 98.999% | 99.345% |
| 扣除重试分钟（全组）/ Retry minutes excluded, total | 56.323 | 51.936 | 185.717 | 217.996 | 114.226 |
| 缺少用量的请求 / Requests without usage | 3 | 11 | 4 | 5 | 2 |

| 方案 / Mode | 状态 / Status | 有效进度 / Valid scores | 通过 / Passed | 净分钟/题 / Net minutes | 模型调用/题 / Model calls | 总 token/题 / Total tokens |
|---|---|---:|---:|---:|---:|---:|
| 标准 standard + max | 已暂停 / Paused | 2/100 | 0/2 | 18.273 | 110.500 | 14,100,705.000 |

标准 + max 的均值只覆盖其 2 道有效完成题，不参与完整 100 题排名。

Standard + max means cover its two valid completed tasks and are excluded from the completed 100-task ranking.

极简 + high 复用历史基线，其宿主修订与本轮不同，不能把差异完全归因于思考等级。极简 + max、标准 + high、PTC + high 和创造 + high 使用同一冻结 Harness 修订和原生 Web RPC，插件未加载。各组均使用同一固定 100 题和官方评分器。

Minimal + high reuses the historical baseline, whose host revision differs from this run; reasoning effort alone cannot explain the difference. Minimal + max, standard + high, PTC + high, and creative + high use the same frozen Harness revision and native Web RPC, without the plugin. All modes target the same frozen 100 tasks and official grader.

创造保留官方预设与工具定义；评测隔离禁止 `cordis_run` 在宿主上执行动态代码，只读检查仍可使用。

Creative retains the official preset and tool definitions. Evaluation isolation blocks host-side dynamic execution through `cordis_run`; read-only inspection remains available.

“原始分钟”是最终有效作答的 Web RPC 耗时，不含镜像准备和官方评分。“净分钟”进一步扣除该次作答中的失败模型请求与重试等待，不扣除正常思考、工具或测试时间。

Original minutes measure Web RPC time for the final valid answer, excluding image preparation and grading. Net minutes additionally remove failed model requests and retry waits within that answer, while retaining normal reasoning, tool calls, and tests.

本次逐题核对了极简 + high 的全部 100 份原始证据、补丁及会话日志。已记录 29 次失败请求，扣除失败请求及等待共 **56.323 分钟**，净耗时为 **25.122 分钟/题**。旧调用统计已排除其中 10 次，但仍多计 19 次，本次修正后为 **124.660 次/题**；这 19 次没有有效用量，Token 总量不变。旧统计的 7 次缺失用量中，4 次属于失败请求，剩余 **3 次**发生在预算结束时，日志未返回 usage，无法补齐。版本表同步修正极简的调用数和缺失用量数，历史 JSON 保留原貌。

This audit checked all 100 original minimal + high receipts, patches, and session logs. It identified 29 failed requests and excluded **56.323 minutes** of failed-request and retry time, giving **25.122 net minutes per task**. The old call count had already excluded ten failures but still included 19; the corrected count is **124.660 calls per task**. Those 19 requests added no valid usage, so token totals are unchanged. Four of the seven previously unknown-usage requests were failures. The remaining **three** occurred at the budget cutoff and have no recorded usage to recover. The version table uses the corrected minimal call and unknown-usage counts; historical JSON remains unchanged.

标准 + high、PTC + high、极简 + max 和创造 + high 的净计时已覆盖全部有效题。其余缺失用量也已检查原始结算和流记录，未找到可恢复的 usage；这些缺失不会被估算成零费用。调用数排除已记录的失败请求，预算结束时尚未结算用量的请求仍计入次数并单列为缺失用量。总 token = 缓存输入 + 非缓存输入 + 输出，输出含思考 token，不再次叠加。数字保留三位小数，独立舍入可能造成末位差异。

Net timing covers every valid task for standard + high, PTC + high, minimal + max, and creative + high. Original settlement and stream records were also checked for the remaining missing usage, with no recoverable usage found; this does not imply zero cost. Call counts exclude logged failed requests. Requests interrupted at the budget cutoff remain counted and are marked as unknown usage. Total tokens = cached input + uncached input + output, which already includes reasoning. Do not add reasoning again. Values use three decimal places; independent rounding can produce a last-digit difference.

[官方预设逐题快照](../eval/results/swebench-pro-final-100/OfficialPresetResults.json)保留全部 **502 个有效结果**（五组各 100 题、标准 + max 2 题）的成绩、用量、原始 / 净耗时、核算说明与证据哈希。README 和本表来自同一快照。

The [official-preset snapshot](../eval/results/swebench-pro-final-100/OfficialPresetResults.json) contains all **502 valid results**—100 for each of the five completed modes and 2 for standard + max—with usage, raw/net timing, audit notes, and evidence hashes. README and this table use the same snapshot.

## 相比官方 minimal · Relative to Official minimal

| 版本 / Version | 通过率变化 / Pass-rate change | 平均耗时 / Mean time | 总 token / Total tokens | 新通过 / Gains | 回退 / Regressions |
|---|---:|---:|---:|---:|---:|
| 0.0.9 | +4.000 pp | -35.923% | -16.884% | 7 | 3 |
| 0.1.2 | +8.000 pp | -37.663% | -14.164% | 10 | 2 |
| 0.2.0 | +8.000 pp | -41.025% | -19.683% | 11 | 3 |
| 0.3.0 Batch.3 | +10.000 pp | -47.593% | -44.879% | 13 | 3 |

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

[四版本逐题数据](../eval/results/swebench-pro-final-100/CorrectedFourVersions.json)包含全部 400 条评分、调用数、token、耗时、补丁与证据哈希，以及逐条修正原因。历史 JSON 保留原貌；极简的调用数和缺失用量数采用上述原会话核算，其余版本指标来自这份校正汇总。结果文件留在仓库，不重复放进 npm 包。

The [four-version per-task data](../eval/results/swebench-pro-final-100/CorrectedFourVersions.json) contains all 400 scores, call counts, tokens, times, patch/evidence hashes, and individual correction reasons. Historical JSON is unchanged. Minimal call and unknown-usage counts use the session audit above; other version metrics come from the corrected summary. Result files remain in the repository rather than the npm package.

[Batch.3 逐题数据](../eval/results/swebench-pro-final-100/Batch3Results.json)另存 100 条成绩、用量、耗时和原始证据及补丁哈希，汇总数字已逐题复算，并核对与上述基线使用同一批任务。Batch.3 的评分异常同样用原补丁复核，不把作废尝试的调用和用量加到最终结果中；这些数据也不进入 npm 包。

The separate [Batch.3 per-task data](../eval/results/swebench-pro-final-100/Batch3Results.json) contains 100 scores, usage, timing, and original evidence/patch hashes. Aggregates were recomputed from the rows, and task identities checked against the baselines above. Batch.3 grading anomalies were also rechecked with the original patches; discarded attempts' calls and usage are excluded from final results. These data stay outside the npm package too.

## 如何理解 · How to Read These Results

- **同题比较：** 固定题集标识为 `swebench-pro-hard-100-ddd22492f1c38839`，使用同一开发测试模型、原生 DSH Web RPC 和官方评分器。版本表均为 `high` 思考等级，官方预设表的等级按列标明。这 100 题按既有难度方法选出，并非官方认定的“最难 100 题”；用于候选冻结后的效果评测及 bug 排查，不参与效果调优。
  **Same tasks:** The frozen selection is `swebench-pro-hard-100-ddd22492f1c38839`, using the same development test model, native DSH Web RPC, and the official grader. All version-comparison runs use `high` reasoning; the official-preset table labels each effort level. These 100 tasks were selected using the existing difficulty-ranking method, rather than an official hardest-100 designation. They are used to evaluate frozen candidates and investigate bugs, not for performance tuning.
- **时间：** 版本表保留每题最终有效作答的原始 Web RPC 耗时，不计官方评分、下载镜像和复评分，但未逐项扣除该次作答内部的失败请求与重试等待。中位数取第 50、51 项均值，P90 取排序后的第 90 项。0.0.9 的旧文档曾写 16.27 分钟，这里按历史统一口径为 16.458 分钟。官方预设表另列净耗时，两种口径不混用。
  **Time:** The version table retains raw Web RPC time for each final valid answer, excluding grading, image downloads, and regrading, but without subtracting individual failed requests and retry waits within that answer. The median averages the 50th and 51st values; P90 is the 90th ordered value. An older 0.0.9 document reported 16.27 minutes; the historical convention gives 16.458 minutes. The official-preset table reports net time separately; the two measures must not be mixed.
- **用量：** 纳入每题最终评分尝试的已记录调用，先逐题合计再对 100 题取平均。输入包含缓存读取，输出包含思考 token；缓存率为全部缓存输入除以全部输入，而非逐题缓存率的平均。未返回用量的请求不估算，因此 token 不代表完整账单费用，也不包括先前被放弃的尝试成本。
  **Usage:** Recorded calls from each task’s final scored attempt are summed per task, then averaged over 100 tasks. Input includes cache reads and output includes reasoning tokens; the cache rate is total cached input divided by total input, not the mean per-task rate. Missing usage is not estimated, so tokens do not represent a complete bill or the cost of earlier abandoned attempts.
- **候选身份：** 0.2.0 表示已评测的分层记忆候选，其实验包内部版本仍为 0.1.3，包 SHA-256 为 `164cc1b505c05288f01b6f12c0756af049dbde8f1a49bdb11f9a320a19c925f5`。新整合的记忆 UI 与兼容改动进行单测及真实宿主回归，未重新运行这 100 次模型任务。
  **Candidate identity:** The evaluated memory-hierarchy candidate is reported as 0.2.0; its experimental package still carried version 0.1.3 and SHA-256 `164cc1b505c05288f01b6f12c0756af049dbde8f1a49bdb11f9a320a19c925f5`. The integrated memory UI and compatibility changes undergo unit and real-host regression checks, not a fresh 100-task model run.
- **0.3.0 来源：** 本页成绩属于内部版本 `0.3.0-batch.3` 的实际安装候选。整合时按冻结的运行模块逐文件核对，保留主干 0.2.1 的语言资源和兼容改动；发布包做类型、单测、打包及真实宿主回归，没有重新执行这 100 次模型任务。Batch.3 与分层记忆候选的 Harness 提交同为 `649bfcddf0e3532510a38380b9620570d8b13818`，仍不能分离提示词和工具呈现方式各自的作用。
  **0.3.0 source:** These scores belong to the installed candidate carrying internal version `0.3.0-batch.3`. Integration checks the frozen runtime modules individually and retains main's 0.2.1 locale and compatibility updates. The release package undergoes type checks, unit tests, package checks, and real-host regression rather than rerunning those 100 model tasks. Batch.3 and the memory-hierarchy candidate share Harness commit `649bfcddf0e3532510a38380b9620570d8b13818`; their results still do not isolate prompt changes from tool presentation changes.
- **归因与隐私：** 各轮 Harness 提交不同，记忆工具实际触发也有限，不能把全部差异归因于记忆或单一改动。公开数据仅保留核对所需字段，不包含开发模型路由、凭据、环境变量、本机路径或用户消息原文。
  **Attribution and privacy:** Harness revisions differ, and memory-tool use was limited; these results do not isolate memory or any single change. Public data retains audit fields without development model routes, credentials, environment variables, machine paths, or verbatim user messages.
