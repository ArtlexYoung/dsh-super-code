# SWE-bench Pro hard-100 · 校正结果 / Corrected Results

截至 2026-10-09，版本对比中的五组都完成了同一批 100 题的官方评分。0.2.0 使用冻结的分层记忆候选，0.3.0 使用冻结的 Batch.3 候选成绩。官方预设对比另列于下方，最新官方预设进度与评分校正见下表。

As of October 9, 2026, all five version-comparison runs have official scores for the same 100 tasks. Version 0.2.0 refers to the frozen memory-hierarchy candidate; 0.3.0 reports the frozen Batch.3 candidate. The official-preset comparison appears separately below. Current official-preset progress and grading corrections are listed below.

## 版本对比 · Version Comparison

本表均使用 **DSH `0.1.5-rc.2`**、**`deepseek-v4.1-flash`** 与 `high` 思考等级。

All rows use **DSH `0.1.5-rc.2`**, **`deepseek-v4.1-flash`**, and `high` reasoning.

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

工具次数按宿主 `tool/call` 统计。一次 PTC 调用内部可以执行多个操作，因此这列不能用来比较实际执行了多少次文件读取或命令。

Tool counts use host `tool/call` events. One PTC call can execute several operations, so this column does not compare the number of underlying file reads or commands.

五组均按相同规则复核，通过数包含已核实的测试名称差异修正。仅当原始测试全部通过、每个缺失的必需测试名均能精确对应到通过测试时，才修正为通过；原始判分与修正依据保留在逐题数据中。用量和耗时保持原作答数据。

All five runs were reviewed under the same rules. Pass counts include verified test-name corrections, accepted only when every raw test passes and every missing required name maps exactly to a passing test. Per-task data retains the original grader verdict and correction evidence. Original usage and timing are unchanged.

## 官方预设对比 · Official Preset Comparison

本表使用 **DSH `0.1.5-rc.2`** 和 **`deepseek-v4.1-flash`**，思考等级按列标明；成绩包含后续原补丁复评与测试名称修正。各列只统计有效结果，未满 100 题的列不参与完整 100 题排名。

This table uses **DSH `0.1.5-rc.2`** and **`deepseek-v4.1-flash`**, with reasoning effort shown per column. Scores include subsequent original-patch regrades and verified test-name corrections. Each column uses valid scores only; incomplete columns are excluded from full 100-task rankings.

| 指标 / Metric | 极简 minimal + high | 极简 minimal + max | 标准 standard + high | PTC + high | 创造 creative + high | 标准 standard + max |
|---|---:|---:|---:|---:|---:|---:|
| 有效进度 / Valid scores | 100/100 | 100/100 | 100/100 | 100/100 | 100/100 | 99/100 |
| 通过/有效 / Passed / valid | 46/100 | 50/100 | 51/100 | 47/100 | 49/100 | 49/99 |
| 待环境复评 / Pending regrades | 0 | 0 | 0 | 0 | 0 | 0 |
| 净耗时中位数 / Median net minutes | 25.598 | 32.167 | 16.639 | 13.455 | 16.452 | 16.887 |
| 净耗时 P90 / P90 net minutes | 41.658 | 45.179 | 36.681 | 25.031 | 30.104 | 34.583 |
| 原始分钟/题 / Original minutes | 25.685 | 32.529 | 20.683 | 17.302 | 19.856 | 20.452 |
| 净分钟/题 / Net minutes | 25.122 | 32.009 | 18.826 | 15.122 | 18.714 | 19.561 |
| 模型调用/题 / Model calls | 124.660 | 138.920 | 92.370 | 71.160 | 93.600 | 101.061 |
| 顶层工具调用/题 / Top-level tool calls | 127.360 | 150.070 | 110.480 | 70.990 | 113.780 | 124.636 |
| 总输入 token/题 / Input tokens | 11,477,169.950 | 14,849,497.540 | 8,771,693.040 | 6,160,934.650 | 9,205,287.290 | 11,417,324.020 |
| 总 token/题 / Total tokens | 11,578,046.900 | 14,966,097.260 | 8,854,513.910 | 6,238,434.510 | 9,292,949.400 | 11,526,872.192 |
| 缓存输入 token/题 / Cached input | 11,404,101.120 | 14,770,140.160 | 8,713,578.230 | 6,099,266.510 | 9,145,025.240 | 11,349,317.818 |
| 非缓存输入 token/题 / Uncached input | 73,068.830 | 79,357.380 | 58,114.810 | 61,668.140 | 60,262.050 | 68,006.202 |
| 输出 token/题 / Output | 100,876.950 | 116,599.720 | 82,820.870 | 77,499.860 | 87,662.110 | 109,548.172 |
| 输入缓存率 / Input cache hit rate | 99.363% | 99.466% | 99.337% | 98.999% | 99.345% | 99.404% |
| 扣除重试分钟（全组）/ Retry minutes excluded, total | 56.323 | 51.936 | 185.717 | 217.996 | 114.226 | 88.220 |
| 缺少用量的请求 / Requests without usage | 3 | 11 | 4 | 5 | 2 | 0 |

净耗时扣除最终有效作答中的失败请求和重试等待；两种耗时均不含官方评分。调用次数排除已记录的失败请求。总 token = 缓存输入 + 非缓存输入 + 输出，输出含思考 token。复评分保留原作答的用量和耗时；有效题目范围变化时，均值会随之变化。未返回的用量不估算，数字不等于完整账单。

Net time excludes failed requests and retry waits in the final valid answer; both time measures exclude grading. Call counts exclude logged failed requests. Total tokens = cached input + uncached input + output, including reasoning. Regrading preserves each answer's original usage and timing; means change when the valid subset changes. Missing usage is not estimated, so these figures are not a complete bill.

创造保留官方预设与工具定义；评测隔离禁止 `cordis_run` 在宿主上执行动态代码，只读检查仍可使用。极简 + high 复用历史基线，宿主修订与本轮不同，不能把差异完全归因于思考等级。

Creative retains the official preset and tools; evaluation isolation blocks host-side dynamic execution through `cordis_run`, while read-only inspection remains available. Minimal + high reuses a historical baseline with different Harness revisions, so the results do not isolate reasoning effort.

此前发现的 12 条 Node 构建依赖下载异常均已完成原补丁复评分：11 条恢复通过、1 条仍失败。每条需要两次无环境异常且一致的官方结果；存在分歧时保留待确认，不挑选最好一次。已有历史环境复核所带来的修正仍保留，未重复加分。

All 12 previously identified Node dependency-download failures have been regraded with the original patches: 11 recovered to a pass and one remained a failure. Each requires two consistent official scores without environmental errors. Conflicting scores remain unresolved; the best retry is never selected. Earlier environmental corrections remain in place and are not counted twice.

全量复核覆盖 3,296 条保留的 Pro / Dev 主记录，包含不同候选、历史批次和重复保留记录，不代表独立题数。全部完成原始日志重解析；Dev 的 1,212 条记录判分一致，原补丁及 base/gold 环境检查均通过。公开历史四版本的 400 条记录均精确绑定原始摘要和评分日志。旧实验中新发现的 7 项环境异常均已完成原补丁复评：3 项恢复通过、4 项仍失败。本次复核不新增模型调用。

The full review covers 3,296 preserved Pro / Dev primary records across candidates and historical batches, including retained duplicates rather than unique tasks. All raw logs were reparsed. All 1,212 Dev verdicts agree, with patch identities and base/gold environment checks verified. All 400 published historical-version records bind exactly to original summaries and grading logs. All seven newly identified environmental failures in older experiments have been regraded with their original patches: three recovered to a pass and four remained failures. This review adds no model calls.

此前标为“缺日志”的两条记录，实际保存在旧复评目录中，现已找到并复核：早期 minimal 冒烟第 4 题的 175 项测试全部通过；旧 Graph 第 623 题解析出 93 项通过，但仍缺 15 项必需测试，保留失败。另一条旧 Graph 冒烟第 99 题，摘要误用了第 378 题的补丁、会话和用量信息；本题实际执行补丁正确，17 项必需测试失败，保留失败。原摘要保留，更正依据单独记录；这三条均不属于上述五组发布成绩，公开正确率与用量不变。

The two records previously marked as missing logs were found in legacy regrading directories. The early minimal smoke test for task 4 passed all 175 tests. Old Graph task 623 parsed 93 passing tests but still missed 15 required tests, so it remains a failure. A separate old Graph smoke summary for task 99 copied patch, session, and usage metadata from task 378. Task 99 was graded with its own correct patch and failed 17 required tests, so its failure also stands. Original summaries are retained with separate correction evidence. These three records are outside the five published runs above; published scores and usage are unchanged.

共有 31 条记录只存在已确认的测试名称差异：OpenLibrary 的 16 条动态年份，以及 NodeBB 的 15 条末尾引号或空格。原始测试分别为 92 项、714 项全部通过，必需测试缺失集合逐项精确对应。复核只接受这两种已核实的名称映射，不做模糊匹配，也不根据同题其他版本的成绩加分。上述各版本与官方预设均已按相同规则检查，确认通过的记录已计入通过数；原始判分与精确名称映射留作追溯。

There are 31 confirmed test-name mismatch records: 16 dynamic-year cases in OpenLibrary and 15 trailing-quote or space cases in NodeBB. Raw results show all 92 or 714 tests passing, with every missing required name mapped exactly. Review accepts only these two verified mappings, without fuzzy matching or borrowing a pass from another candidate. The versions and official presets above were checked under the same rules. Confirmed passes are included in pass counts; original verdicts and exact name mappings remain available for review.

请求明细核算覆盖 3,224 条记录，调用数、Token 汇总和缺失用量数均与摘要一致，未发现重复请求 ID；72 条没有保留请求明细。但加总一致不代表归属正确：对全部摘要的会话路径和用量来源检查后，发现上述旧 Graph 第 99 题这一条串题记录，已从旧实验的用量均值中排除。其本题主会话收据已找回，但旧清单未保证覆盖所有请求，不能视为完整账单。3,274 条摘要的 Token 加总关系一致，22 条缺少完整指标。本次检查不等于重新核对所有原始会话或供应商账单。

Saved request ledgers were reconciled for 3,224 records: call counts, token sums, and unknown-usage counts agree with summaries, with no duplicate request IDs. Seventy-two records lack a saved ledger. Matching sums do not prove task ownership: checks of session paths and usage sources across all summaries found the single cross-task record for old Graph task 99 described above. Its copied metrics are excluded from historical experiment averages. Its own main-session receipt was recovered, but the old request inventory does not establish complete coverage. Token totals are internally consistent in 3,274 summaries; 22 lack complete metrics. This is not a full audit of raw sessions or provider bills.

[逐条评分复核](../eval/results/swebench-pro-final-100/GradingReviewResults.json) · [官方预设逐题快照](../eval/results/swebench-pro-final-100/OfficialPresetResults.json)

[Per-case grading review](../eval/results/swebench-pro-final-100/GradingReviewResults.json) · [Official-preset snapshot](../eval/results/swebench-pro-final-100/OfficialPresetResults.json)

## 跨模型迁移 · Cross-Model Transfer

将模型换为 **`glm-5.3-flash`**，思考等级统一为 **`max`**，仍使用同一批 hard-100。两组均完成 100 题：Super Code 使用 **DSH `0.1.5-rc.2` + 插件 `0.3.4`**；对照使用完整原生 **ZCode Desktop `3.14.4` / CLI `0.16.9`**，没有抽取部分源码模拟 Agent。

Both runs completed the same hard-100 set using **`glm-5.3-flash`** with **`max`** reasoning. Super Code ran on **DSH `0.1.5-rc.2` + plugin `0.3.4`**; the comparison used the complete native **ZCode Desktop `3.14.4` / CLI `0.16.9`**, rather than an extracted Agent implementation.

| 指标 / Metric | DSH + Super Code 0.3.4 | 原生 ZCode / Native ZCode |
|---|---:|---:|
| 通过 / Passed | 44/100 | 28/100 |
| 净分钟/题 / Net minutes | 32.896 | 52.320 |
| 模型调用/题 / Model calls | 66.890 | 64.310 |
| 总 token/题 / Total tokens | 5,499,154.470 | 3,609,511.930 |
| 缓存输入 token/题 / Cached input | 5,302,796.160 | 3,356,862.720 |
| 非缓存输入 token/题 / Uncached input | 126,050.640 | 144,405.020 |
| 输出 token/题 / Output | 70,307.670 | 108,244.190 |
| 缺少用量的请求 / Requests without usage | 29 | 120 |

这轮 Super Code 通过率高 **16 个百分点**，平均净耗时更少，但 token 更多。这说明方案可在 GLM 上运行并取得有效结果；对照比较的是两套完整系统，不能据此分离插件的贡献，也不能推及所有模型。缺失用量未估算。[测试脚本与记录](../eval/glm/README.md)

Super Code passed **16 percentage points** more tasks and used less net time, but more tokens. This demonstrates working transfer to GLM in this run. The comparison covers two complete systems, so it neither isolates the plugin's contribution nor establishes gains across all models. Missing usage is not estimated. [Scripts and records](../eval/glm/README.md)

## 新版 DSH 与预算 · New DSH and Budgets

以下四组均使用 **DSH `0.2.1-rc.2`**、新模型 **`deepseek-v4.1-flash-1017`**（调用标识 `deepseek/deepseek-flash`）和 **`high`** 思考，完成同一批 100 题。这里只展示官方预设与正式插件版本。

All four runs completed the same 100 tasks on **DSH `0.2.1-rc.2`**, using the newer **`deepseek-v4.1-flash-1017`** model (API ID: `deepseek/deepseek-flash`) with **`high`** reasoning. Only official presets and released plugin versions are shown here.

| 指标 / Metric | 标准 / Standard · 默认 / Default | Super Code 0.3.4 · 默认 / Default | 标准 / Standard · 旧预算 / Legacy | Super Code 0.3.5 · 旧预算 / Legacy |
|---|---:|---:|---:|---:|
| 通过/有效 / Passed / valid | 45/100 | 40/99 | 46/100 | 48/99 |
| 待核查 / Pending review | 0 | 1 | 0 | 1 |
| 净分钟/题 / Net minutes | 17.875 | 20.458 | 20.870 | 16.486 |
| 模型调用/题 / Model calls | 85.050 | 69.051 | 91.980 | 68.616 |
| 总 token/题 / Total tokens | 6,832,805.820 | 5,125,240.424 | 7,806,295.960 | 5,131,724.556 |
| 缓存输入 token/题 / Cached input | 6,710,566.400 | 5,008,071.111 | 7,679,298.560 | 5,016,822.909 |
| 非缓存输入 token/题 / Uncached input | 59,268.620 | 55,443.192 | 59,291.340 | 53,125.495 |
| 输出 token/题 / Output | 62,970.800 | 61,726.121 | 67,706.060 | 61,776.152 |
| 缺少用量的请求 / Requests without usage | 0 | 0 | 0 | 1 |

两组 Super Code 各有一条 NodeBB 环境异常待核查，暂不计入有效评分和均值。npm 依赖已离线打包，但参考答案仍遇到初始化超时；原答案、判分记录和用量保留。

Each Super Code run has one NodeBB environment issue pending review, excluded from valid-score counts and means. npm dependencies are bundled offline, but reference setup still times out; original answers, verdicts, and usage are retained.

- **新版组合出现退化。** 相比旧 DSH / 旧模型，标准通过数从 51 降到 45，Super Code 从 0.3.0 候选的 56 降到 0.3.4 的 40；这同时涉及宿主、模型和插件版本变化。
- **预算是已定位的影响因素。** 新版更早压缩上下文、保留更少原文，PTC 执行时限也有变化。恢复旧预算后，Super Code 从 40 回升至 48，标准从 45 到 46。**0.3.6 已默认恢复旧预算**；表中验证组实际是 **0.3.5 + 显式旧预算**，不是另跑的 0.3.6 成绩。
- **结果仍有波动。** v4.1 的多轮实验中，同一道题存在一轮通过、另一轮失败的情况。后续版本会尝试改善这种不稳定性；各轮配置也有变化，本轮回升不代表已消除波动，也不能证明全部退化都由预算造成。

- **The newer combination regressed.** Standard fell from 51 passes on the older host/model to 45; Super Code fell from 56 for the 0.3.0 candidate to 40 for 0.3.4. Host, model, and plugin versions changed together.
- **Budgets are one identified factor.** The newer host compresses earlier, retains less verbatim context, and changes PTC execution deadlines. Restoring the older budgets raised Super Code from 40 to 48 and standard from 45 to 46. **Version 0.3.6 restores these defaults.** The measured row is **0.3.5 with explicit legacy budgets**, not a separate 0.3.6 run.
- **Run-to-run variation remains.** Across v4.1 experiments, the same task has both passed and failed. Future versions will aim to reduce this variability. Configurations also changed between runs; the recovery does not establish stability or attribute the entire regression to budgets.

预算恢复的配置包括：按完整上下文窗口计算压力、80% 触发压缩、保留最近 16% 原文、摘要上限 8,192 token、压缩追加与溢出重试各 1 次，以及新版 PTC 默认 / 最大 600 秒。它是多项预算的联合恢复，不是某个参数的单变量实验。官方标准的旧预算组仅覆盖宿主预算，未加载 Super Code；插件对官方预设的预算覆盖需用户主动开启。[预算设置](UsageGuide.md#运行预算--runtime-budgets)

The restored configuration uses the full context window for pressure accounting, an 80% compression threshold, 16% recent verbatim retention, an 8,192-token summary cap, one additional compression attempt and one overflow retry, plus 600-second default/maximum PTC deadlines on newer hosts. Several budgets were restored together; this is not a single-parameter experiment. The standard legacy-budget run overrides host budgets without loading Super Code. Applying plugin budget settings to official presets remains opt-in. [Budget settings](UsageGuide.md#运行预算--runtime-budgets)

[宿主集成探针](../eval/results/swebench-pro-final-100/HostBudgetDiagnostics.json)固定 1,000,000 token 窗口、384,000 输出预留，实际测得压缩阈值从 800,000 变为 550,464，原文尾部预算从 160,000 变为 98,560；两版摘要指令相同，摘要请求上限则从 8,192 变为 65,536。探针使用确定性摘要适配器，不代表摘要质量评测，也不能证明每道 Pro 题都触发了这些变化。更换模型和宿主的历史结果只用于呈现现象；确定因果仍需固定其他条件的重复对照。

A [host integration probe](../eval/results/swebench-pro-final-100/HostBudgetDiagnostics.json) fixed a 1,000,000-token window with 384,000 reserved output tokens. The measured compression threshold changed from 800,000 to 550,464, and recent verbatim retention from 160,000 to 98,560. Summary instructions were identical; the summary request cap changed from 8,192 to 65,536. The probe used deterministic summaries, so it neither measures summary quality nor shows that every Pro task triggered these changes. Historical host/model comparisons describe observations; causal attribution requires repeated controls with other conditions fixed.

逐题对照中，Super Code 旧预算组相较默认预算组新增通过 12 题、回退 4 题，净增 8 题；标准对应新增 7 题、回退 6 题，净增 1 题。这证实了跨轮通过集合并不固定，但预算和插件配置也在变，尚不能据此估计固定配置下的随机波动率。评分环境异常的原补丁复核与模型重新作答是两回事，不把前者当作模型不稳定的证据。

Paired task results show 12 gains and four regressions for Super Code under legacy budgets, a net gain of eight. Standard has seven gains and six regressions, a net gain of one. Passing sets differ across runs, but budget/plugin configurations also changed; these comparisons do not estimate random variability under a fixed configuration. Regrading an unchanged patch after an environmental failure is distinct from generating a new answer and is not evidence of model instability.

[新版 DSH 逐题快照](../eval/results/swebench-pro-final-100/HarnessRc2Results.json) · [GLM 逐题快照](../eval/results/swebench-pro-final-100/GLMComparison.json)

[New-DSH per-task snapshot](../eval/results/swebench-pro-final-100/HarnessRc2Results.json) · [GLM per-task snapshot](../eval/results/swebench-pro-final-100/GLMComparison.json)

## 相比官方 minimal · Relative to Official minimal

| 版本 / Version | 通过率变化 / Pass-rate change | 平均耗时 / Mean time | 总 token / Total tokens | 新通过 / Gains | 回退 / Regressions |
|---|---:|---:|---:|---:|---:|
| 0.0.9 | +4.000 pp | -35.923% | -16.884% | 7 | 3 |
| 0.1.2 | +7.000 pp | -37.663% | -14.164% | 10 | 3 |
| 0.2.0 | +8.000 pp | -41.025% | -19.683% | 11 | 3 |
| 0.3.0 Batch.3 | +10.000 pp | -47.593% | -44.879% | 13 | 3 |

Batch.3 相比 0.2.0 平均耗时减少 11.1%、总 token 减少 31.4%、模型调用减少 26.2%，通过数从 54 增至 56；逐题新通过 8 题、回退 6 题。这是同题单轮结果，2 题的净增不能据此认定为稳定的质量提升。

Against 0.2.0, Batch.3 uses 11.1% less time, 31.4% fewer total tokens, and 26.2% fewer model calls. Passes rise from 54 to 56, with eight gains and six regressions. This is one run on the same tasks; a net gain of two does not establish a stable quality improvement.

0.2.0 通过 54 题，0.1.2 通过 53 题；平均耗时下降 5.4%、总 token 下降 6.4%，逐题有 7 题改善、6 题回退。相对 minimal，0.2.0 新通过 11 题、回退 3 题（37、396、503），净增 8 题。不能把总体提升写成“原先正确的都没有退化”。

Version 0.2.0 passes 54 tasks versus 53 for 0.1.2. It uses 5.4% less time and 6.4% fewer total tokens, with seven gains and six regressions. Against minimal, it gains 11 tasks and regresses on three (37, 396, 503), for a net gain of eight. Aggregate improvement does not mean every previous pass is preserved.

## 修正了什么 · What Was Corrected

| 版本 / Version | 原始通过 / Original passes | 通过 / Passed | 环境复评题数 / Environment regrades |
|---|---:|---:|---:|
| minimal | 41 | 46 | 4 |
| 0.0.9 | 46 | 50 | 3 |
| 0.1.2 | 49 | 53 | 4 |
| 0.2.0 | 48 | 54 | 5 |

16 条评分记录出现 ConfigFileTest 500ms 超时或 Jest worker SIGKILL 等环境异常，已用**原补丁**重新运行官方评分；每条取两次无该异常且一致的结果，不采用“重试到通过”的取优口径。12 条恢复通过，4 条仍失败。表中通过数还包含这四组已核实的 7 条测试名称差异修正。复评分没有新增模型调用，原始评分、用量和补丁均保留。

Sixteen grading records had anomalies such as the ConfigFileTest 500 ms timeout or a killed Jest worker. Each was regraded with the **original patch**, requiring two matching results without that anomaly—not selecting the best result from retries. Twelve recovered to a pass and four remained failures. Pass counts also include seven verified test-name corrections across these four runs. Regrading added no model calls; the original scores, usage, and patches are preserved.

[四版本逐题数据](../eval/results/swebench-pro-final-100/CorrectedFourVersions.json)包含全部 400 条评分、调用数、token、耗时、补丁与证据哈希，以及逐条修正原因。历史 JSON 保留原貌；极简的调用数和缺失用量数采用上述原会话核算，其余版本指标来自这份校正汇总。结果文件留在仓库，不重复放进 npm 包。

The [four-version per-task data](../eval/results/swebench-pro-final-100/CorrectedFourVersions.json) contains all 400 scores, call counts, tokens, times, patch/evidence hashes, and individual correction reasons. Historical JSON is unchanged. Minimal call and unknown-usage counts use the session audit above; other version metrics come from the corrected summary. Result files remain in the repository rather than the npm package.

[Batch.3 逐题数据](../eval/results/swebench-pro-final-100/Batch3Results.json)另存 100 条成绩、用量、耗时和原始证据及补丁哈希，汇总数字已逐题复算，并核对与上述基线使用同一批任务。Batch.3 的评分异常同样用原补丁复核，不把作废尝试的调用和用量加到最终结果中；这些数据也不进入 npm 包。

The separate [Batch.3 per-task data](../eval/results/swebench-pro-final-100/Batch3Results.json) contains 100 scores, usage, timing, and original evidence/patch hashes. Aggregates were recomputed from the rows, and task identities checked against the baselines above. Batch.3 grading anomalies were also rechecked with the original patches; discarded attempts' calls and usage are excluded from final results. These data stay outside the npm package too.

## 如何理解 · How to Read These Results

- **同题比较：** 固定题集标识为 `swebench-pro-hard-100-ddd22492f1c38839`，使用官方评分器。旧版本与官方预设表使用 DSH `0.1.5-rc.2` / `deepseek-v4.1-flash`；GLM 与新版 DSH 对照的宿主、模型、预算另列。DSH 通过原生 Web RPC 执行，ZCode 使用完整原生 CLI。版本表均为 `high` 思考等级，官方预设表的等级按列标明。这 100 题按既有难度方法选出，并非官方认定的“最难 100 题”；用于候选冻结后的效果评测及 bug 排查，不参与效果调优。
  **Same tasks:** The frozen selection is `swebench-pro-hard-100-ddd22492f1c38839`, using the official grader. Historical version and official-preset tables use DSH `0.1.5-rc.2` / `deepseek-v4.1-flash`; GLM and newer-DSH tables identify their own hosts, models, and budgets. DSH uses native Web RPC; ZCode uses its complete native CLI. All version-comparison runs use `high` reasoning; the official-preset table labels each effort level. These 100 tasks were selected using the existing difficulty-ranking method, rather than an official hardest-100 designation. They are used to evaluate frozen candidates and investigate bugs, not for performance tuning.
- **时间：** 版本表保留每题最终有效作答的原始 Web RPC 耗时，不计官方评分、下载镜像和复评分，但未逐项扣除该次作答内部的失败请求与重试等待。中位数取第 50、51 项均值，P90 取排序后的第 90 项。0.0.9 的旧文档曾写 16.27 分钟，这里按历史统一口径为 16.458 分钟。官方预设表另列净耗时，两种口径不混用。
  **Time:** The version table retains raw Web RPC time for each final valid answer, excluding grading, image downloads, and regrading, but without subtracting individual failed requests and retry waits within that answer. The median averages the 50th and 51st values; P90 is the 90th ordered value. An older 0.0.9 document reported 16.27 minutes; the historical convention gives 16.458 minutes. The official-preset table reports net time separately; the two measures must not be mixed.
- **用量：** 纳入每题最终评分尝试的已记录调用，先逐题合计再对有效评分题数取平均；待环境核查的题目暂不计入均值。输入包含缓存读取，输出包含思考 token；缓存率为全部缓存输入除以全部输入，而非逐题缓存率的平均。未返回用量的请求不估算，因此 token 不代表完整账单费用，也不包括先前被放弃的尝试成本。
  **Usage:** Recorded calls from each task’s final scored attempt are summed per task, then averaged over tasks with valid scores; pending environmental reviews are excluded from means. Input includes cache reads and output includes reasoning tokens; the cache rate is total cached input divided by total input, not the mean per-task rate. Missing usage is not estimated, so tokens do not represent a complete bill or the cost of earlier abandoned attempts.
- **候选身份：** 0.2.0 表示已评测的分层记忆候选，其实验包内部版本仍为 0.1.3，包 SHA-256 为 `164cc1b505c05288f01b6f12c0756af049dbde8f1a49bdb11f9a320a19c925f5`。新整合的记忆 UI 与兼容改动进行单测及真实宿主回归，未重新运行这 100 次模型任务。
  **Candidate identity:** The evaluated memory-hierarchy candidate is reported as 0.2.0; its experimental package still carried version 0.1.3 and SHA-256 `164cc1b505c05288f01b6f12c0756af049dbde8f1a49bdb11f9a320a19c925f5`. The integrated memory UI and compatibility changes undergo unit and real-host regression checks, not a fresh 100-task model run.
- **0.3.0 来源：** 本页成绩属于内部版本 `0.3.0-batch.3` 的实际安装候选。整合时按冻结的运行模块逐文件核对，保留主干 0.2.1 的语言资源和兼容改动；发布包做类型、单测、打包及真实宿主回归，没有重新执行这 100 次模型任务。Batch.3 与分层记忆候选的 Harness 提交同为 `649bfcddf0e3532510a38380b9620570d8b13818`，仍不能分离提示词和工具呈现方式各自的作用。
  **0.3.0 source:** These scores belong to the installed candidate carrying internal version `0.3.0-batch.3`. Integration checks the frozen runtime modules individually and retains main's 0.2.1 locale and compatibility updates. The release package undergoes type checks, unit tests, package checks, and real-host regression rather than rerunning those 100 model tasks. Batch.3 and the memory-hierarchy candidate share Harness commit `649bfcddf0e3532510a38380b9620570d8b13818`; their results still do not isolate prompt changes from tool presentation changes.
- **归因与隐私：** 各轮 Harness 提交不同，记忆工具实际触发也有限，不能把全部差异归因于记忆或单一改动。公开数据仅保留核对所需字段，不包含私有提供方地址、凭据、环境配置、本机路径或用户消息原文。
  **Attribution and privacy:** Harness revisions differ, and memory-tool use was limited; these results do not isolate memory or any single change. Public data retains audit fields without private provider addresses, credentials, environment configuration, machine paths, or verbatim user messages.
