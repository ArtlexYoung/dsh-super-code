# 完整成绩表 · Complete Result Tables

本页归档 README 精简后的完整公开成绩表，包括历史版本、官方预设、GLM、默认／旧预算及评分更正。逐题 JSON 与复核依据保留在同目录；详细口径见[评测说明](../../../docs/EvaluationResults.md)。

This archive retains the complete public tables behind the shorter README: historical versions, official presets, GLM, default/legacy budgets, and grading corrections. Per-task JSON and review evidence remain in this directory. See the [evaluation report](../../../docs/EvaluationResults.md) for methodology.

总 token 包含缓存输入、非缓存输入和输出（含思考）；缺失用量不估算。净耗时扣除已记录的失败请求及重试等待，历史原始耗时另有标注；均不含评分。更正后的均值按有效题目重算。

Total tokens include cached input, uncached input, and output including reasoning. Missing usage is not estimated. Net time excludes recorded failed requests and retry waits; historical raw time is labeled separately. Neither includes grading. Corrected means use the valid task set.

## 历史版本 · Historical Versions

DSH `0.1.5-rc.2` · `deepseek-v4.1-flash` · high。0.2.0 为分层记忆候选，0.3.0 为 Batch .3；耗时为历史原始口径。 / The evaluated memory-hierarchy and Batch .3 candidates represent 0.2.0 and 0.3.0; times use the original historical convention.

| 指标 / Metric | 官方 minimal + high | 0.0.9 | 0.1.2 | 0.2.0 分层记忆 | 0.3.0 Batch.3 |
|---|---:|---:|---:|---:|---:|
| 有效评分 / Valid scores | 100 | 100 | 100 | 100 | 100 |
| 通过 / Passed | 46 | 50 | 53 | 54 | 56 |
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

[四版本逐题记录 · Four-version records](CorrectedFourVersions.json) · [Batch .3](Batch3Results.json)

## 官方预设 · Official Presets

DSH `0.1.5-rc.2` · `deepseek-v4.1-flash`，思考等级按列标明；标准 max 紧跟标准 high。 / Reasoning effort is shown per column, with standard/max next to standard/high.

| 指标 / Metric | 极简 minimal + high | 极简 minimal + max | 标准 standard + high | 标准 standard + max | PTC + high | 创造 creative + high |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 有效进度 / Valid scores | 100/100 | 100/100 | 100/100 | 100/100 | 100/100 | 100/100 |
| 通过/有效 / Passed / valid | 46/100 | 50/100 | 51/100 | 50/100 | 47/100 | 49/100 |
| 待环境复评 / Pending regrades | 0 | 0 | 0 | 0 | 0 | 0 |
| 净耗时中位数 / Median net minutes | 25.598 | 32.167 | 16.639 | 16.878 | 13.455 | 16.452 |
| 净耗时 P90 / P90 net minutes | 41.658 | 45.179 | 36.681 | 33.834 | 25.031 | 30.104 |
| 原始分钟/题 / Original minutes | 25.685 | 32.529 | 20.683 | 20.389 | 17.302 | 19.856 |
| 净分钟/题 / Net minutes | 25.122 | 32.009 | 18.826 | 19.507 | 15.122 | 18.714 |
| 模型调用/题 / Model calls | 124.660 | 138.920 | 92.370 | 101.260 | 71.160 | 93.600 |
| 顶层工具调用/题 / Top-level tool calls | 127.360 | 150.070 | 110.480 | 124.940 | 70.990 | 113.780 |
| 总输入 token/题 / Input tokens | 11,477,169.950 | 14,849,497.540 | 8,771,693.040 | 11,434,388.180 | 6,160,934.650 | 9,205,287.290 |
| 总 token/题 / Total tokens | 11,578,046.900 | 14,966,097.260 | 8,854,513.910 | 11,543,772.990 | 6,238,434.510 | 9,292,949.400 |
| 缓存输入 token/题 / Cached input | 11,404,101.120 | 14,770,140.160 | 8,713,578.230 | 11,366,136.320 | 6,099,266.510 | 9,145,025.240 |
| 非缓存输入 token/题 / Uncached input | 73,068.830 | 79,357.380 | 58,114.810 | 68,251.860 | 61,668.140 | 60,262.050 |
| 输出 token/题 / Output | 100,876.950 | 116,599.720 | 82,820.870 | 109,384.810 | 77,499.860 | 87,662.110 |
| 输入缓存率 / Input cache hit rate | 99.363% | 99.466% | 99.337% | 99.403% | 98.999% | 99.345% |
| 扣除重试分钟（全组）/ Retry minutes excluded, total | 56.323 | 51.936 | 185.717 | 88.220 | 217.996 | 114.226 |
| 缺少用量的请求 / Requests without usage | 3 | 11 | 4 | 0 | 5 | 2 |

[官方预设逐题记录 · Official-preset records](OfficialPresetResults.json)

## 跨模型迁移 · Cross-Model Transfer

`glm-5.3-flash` · max。Super Code `0.3.4` 运行于 DSH `0.1.5-rc.2`，对照为完整原生 ZCode Desktop `3.14.4` / CLI `0.16.9`。这是完整系统对照，不单独归因于插件。 / This compares complete systems, without isolating the plugin contribution.

| 指标 / Metric | DSH + Super Code 0.3.4 | 原生 ZCode / Native ZCode |
|---|---:|---:|
| 通过 / Passed | 45/100 | 29/100 |
| 净分钟/题 / Net minutes | 32.896 | 52.320 |
| 模型调用/题 / Model calls | 66.890 | 64.310 |
| 总 token/题 / Total tokens | 5,499,154.470 | 3,609,511.930 |
| 缓存输入 token/题 / Cached input | 5,302,796.160 | 3,356,862.720 |
| 非缓存输入 token/题 / Uncached input | 126,050.640 | 144,405.020 |
| 输出 token/题 / Output | 70,307.670 | 108,244.190 |
| 缺少用量的请求 / Requests without usage | 29 | 120 |

[逐题记录 · Per-task records](GLMComparison.json) · [执行脚本 · Execution scripts](../../glm/README.md)

## 新版 DSH 与预算 · New DSH and Budgets

DSH `0.2.1-rc.2` · `deepseek-v4.1-flash-1017` · high。旧预算插件组实际为 `0.3.5` + 显式覆盖；`0.3.6` 起默认恢复这些预算，未另跑 0.3.6—0.3.8 的 100 题。 / The measured legacy-budget plugin is 0.3.5 with explicit overrides; later defaults are not a separate 100-task evaluation.

| 指标 / Metric | 标准 / Standard · 默认 / Default | Super Code 0.3.4 · 默认 / Default | 标准 / Standard · 旧预算 / Legacy | Super Code 0.3.5 · 旧预算 / Legacy |
|---|---:|---:|---:|---:|
| 通过/有效 / Passed / valid | 46/100 | 41/100 | 46/100 | 49/100 |
| 待核查 / Pending review | 0 | 0 | 0 | 0 |
| 净分钟/题 / Net minutes | 17.875 | 20.364 | 20.870 | 16.416 |
| 模型调用/题 / Model calls | 85.050 | 68.810 | 91.980 | 68.540 |
| 总 token/题 / Total tokens | 6,832,805.820 | 5,088,673.550 | 7,806,295.960 | 5,108,386.410 |
| 缓存输入 token/题 / Cached input | 6,710,566.400 | 4,972,166.400 | 7,679,298.560 | 4,993,935.320 |
| 非缓存输入 token/题 / Uncached input | 59,268.620 | 55,138.870 | 59,291.340 | 52,906.560 |
| 输出 token/题 / Output | 62,970.800 | 61,368.280 | 67,706.060 | 61,544.530 |
| 缺少用量的请求 / Requests without usage | 0 | 0 | 0 | 1 |

默认 → 旧预算的变化；两组插件的实际版本为 0.3.4 → 0.3.5。 / Default → legacy changes; the plugin versions are 0.3.4 → 0.3.5.

| 指标 / Metric | 标准 high · 默认 → 旧预算 / Default → Legacy | Super Code high · 0.3.4 默认 → 0.3.5 旧预算 / Default → Legacy |
|---|---:|---:|
| 通过 / Passed | 46/100 → 46/100 | 41/100 → 49/100 |
| 通过率变化 / Pass-rate change | 0.000 pp | +8.000 pp |
| 净分钟/题 / Net minutes | 17.875 → 20.870 | 20.364 → 16.416 |
| 模型调用/题 / Model calls | 85.050 → 91.980 | 68.810 → 68.540 |
| 总 token/题 / Total tokens | 6,832,805.820 → 7,806,295.960 | 5,088,673.550 → 5,108,386.410 |

标准模式通过数不变，总 token 增加 **14.247%**；插件多通过 **8 题**，总 token 增加 **0.387%**、净耗时减少 **19.387%**。旧预算没有让所有预设同步提升；插件两组的版本和配置也有变化，这轮结果不能把收益全部归因于预算。采用相同旧预算横向比较，插件比标准多通过 **3 题**，净耗时、总 token、调用次数分别减少 **21.342%**、**34.561%**、**25.484%**。

Standard's pass count stayed unchanged while total tokens rose **14.247%**. Super Code passed **eight more tasks**, with **0.387%** more total tokens and **19.387%** less net time. Legacy budgets did not improve every preset equally; the plugin version and configuration also changed, so this run does not attribute all gains to budgets. Comparing both systems under the same legacy budgets, Super Code passed **three more tasks**, using **21.342%** less net time, **34.561%** fewer total tokens, and **25.484%** fewer model calls.

[四组逐题记录 · All four runs](HarnessRc2Results.json) · [预算探针 · Budget probes](HostBudgetDiagnostics.json)

## 历史版本相对 minimal 的变化 · Historical Changes versus Minimal

使用上方历史版本组的相同 100 题，不能与新版宿主／模型混用。 / Uses the same historical 100-task runs above; do not combine with newer host/model results.

| 版本 / Version | 通过率变化 / Pass-rate change | 平均耗时 / Mean time | 总 token / Total tokens | 新通过 / Gains | 回退 / Regressions |
|---|---:|---:|---:|---:|---:|
| 0.0.9 | +4.000 pp | -35.923% | -16.884% | 7 | 3 |
| 0.1.2 | +7.000 pp | -37.663% | -14.164% | 10 | 3 |
| 0.2.0 | +8.000 pp | -41.025% | -19.683% | 11 | 3 |
| 0.3.0 Batch.3 | +10.000 pp | -47.593% | -44.879% | 13 | 3 |

[详细解释 · Interpretation](../../../docs/EvaluationResults.md)

## 评分更正 · Grading Corrections

保留原答案、原判、逐题用量和耗时；原补丁补评分和漏导出补齐没有新增模型调用。 / Original answers, verdicts, per-task usage, and timing are preserved; regrading and export reconciliation add no model calls.

| 方案 / Run | 同步前 / Before | 同步后 / After | 结论日期 / Resolved |
|---|---:|---:|---|
| Super Code 0.3.4 · 默认预算 / Default | 40/99 | 41/100 | 2026-10-21 |
| Super Code 0.3.5 · 旧预算 / Legacy | 48/99 | 49/100 | 2026-10-21 |
| 标准 high · 默认预算 / Standard high · Default | 45/100 | 46/100 | 2026-10-22 |
| 标准 high · 旧预算 / Standard high · Legacy | 46/100 | 46/100 | 2026-10-22 |
| GLM Super Code 0.3.4 | 44/100 | 45/100 | 2026-10-22 |
| GLM 原生 ZCode / Native ZCode | 28/100 | 29/100 | 2026-10-22 |
| 标准 max · DSH 0.1.5-rc.2 / Standard max | 49/99 | 50/100 | 2026-10-23 |

| 版本 / Version | 原始通过 / Original passes | 通过 / Passed | 环境复评题数 / Environment regrades |
|---|---:|---:|---:|
| minimal | 41 | 46 | 4 |
| 0.0.9 | 46 | 50 | 3 |
| 0.1.2 | 49 | 53 | 4 |
| 0.2.0 | 48 | 54 | 5 |

[更正依据 · Reconciliation evidence](GradingReconciliation.json) · [历史复核 · Earlier reviews](GradingReviewResults.json)
