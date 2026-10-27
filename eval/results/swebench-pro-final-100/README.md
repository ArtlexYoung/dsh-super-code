# SWE-bench Pro hard-100 结果 · Results

最新成绩和统计口径见[评测说明](../../../docs/EvaluationResults.md)。DSH 经原生 Web RPC 作答，ZCode 使用完整原生 CLI，均使用官方 SWE-bench Pro 评分器；宿主、模型和思考等级在各组数据中标明。

See the [evaluation report](../../../docs/EvaluationResults.md) for current scores and methodology. DSH uses native Web RPC and ZCode uses its complete native CLI; both use the official SWE-bench Pro grader. Each run identifies its host, model, and reasoning effort.

| 文件 / File | 内容 / Contents |
|---|---|
| [ResultsTables.md](ResultsTables.md) | 完整成绩表：历史版本、官方预设、跨模型、默认／旧预算及评分更正。 / Complete historical-version, official-preset, cross-model, budget, and correction tables. |
| [CorrectedFourVersions.json](CorrectedFourVersions.json) | minimal、0.0.9、0.1.2、0.2.0 的历史环境复评结果。 / Historical environmental regrades for four versions. |
| [Batch3Results.json](Batch3Results.json) | 0.3.0 冻结候选的逐题成绩。 / Per-task results for the frozen 0.3.0 candidate. |
| [OfficialPresetResults.json](OfficialPresetResults.json) | 官方预设成绩、用量、净耗时及待复评记录。 / Official presets, usage, net timing, and pending regrades. |
| [GradingReviewResults.json](GradingReviewResults.json) | 构建依赖网络异常复评分、全量 Pro / Dev 复核覆盖，以及31 条测试名称修正依据。 / Dependency-network regrades, full Pro / Dev review coverage, and evidence for 31 test-name corrections. |
| [GradingReconciliation.json](GradingReconciliation.json) | 10 月 21—23 日的 NodeBB 原答案复评、标准 max 漏导出补录及原始哈希。 / October 21–23 NodeBB original-answer regrades, the omitted standard/max export row, and original hashes. |
| [GLMComparison.json](GLMComparison.json) | GLM / max 下 Super Code 与完整原生 ZCode 的两组 100 题；[执行脚本](../../glm/README.md)。 / Two 100-task GLM / max runs, with [execution scripts](../../glm/README.md). |
| [ZCodeNativeCandidate.json](ZCodeNativeCandidate.json) | 原生 ZCode 版本与完整包文件哈希，不含第三方源码或二进制。 / Native ZCode versions and package-file hashes, without third-party sources or binaries. |
| [HarnessRc2Results.json](HarnessRc2Results.json) | DSH 0.2.1-rc.2、新 Flash / high 的四组正式预设与预算对照，不含开发分支。 / Four released-preset and budget controls on DSH 0.2.1-rc.2 with the newer Flash / high; no development branches. |
| [HostBudgetDiagnostics.json](HostBudgetDiagnostics.json) | 压缩与 PTC 预算的宿主集成探针摘要。 / Host integration probe summary for compression and PTC budgets. |

`index.json`、`all-summary.json` 等早期文件保留最初的原始结果，不代表最新校正成绩。环境异常未完成复评前不计入有效评分；已核实的测试名称差异修正计入通过数，原始判分留作追溯。

Earlier files such as `index.json` and `all-summary.json` retain the original results, rather than the latest corrected scores. Environmental failures are excluded from valid scores until regraded. Verified test-name corrections are included in pass counts, with original verdicts retained for review.

四个历史版本的 400 条记录及 Batch.3 的 100 条记录均已复核原始评分日志。`passed` 为包含测试名称修正的通过结果；发生修正的记录用 `grader_passed` 保留评分器原判，`identifier_review` 保存修正依据。原始 Token、调用次数和耗时不变；关联的复核文件以 SHA-256 绑定。

Original grading logs have been reviewed for all 400 historical-version records and all 100 Batch.3 records. `passed` includes verified test-name corrections. Corrected records retain the original grader verdict in `grader_passed` and correction evidence in `identifier_review`. Original tokens, call counts, and timing are unchanged. Linked review data is bound by SHA-256.

这里只保存脱敏结果，运行配置和详细诊断留在本地。复评分不重新调用模型，保留每条原作答的补丁、用量和耗时。

This directory contains sanitized results; runtime configuration and detailed diagnostics remain local. Regrading adds no model calls and preserves each answer's patch, usage, and timing.

旧版本及旧官方预设表使用 DSH `0.1.5-rc.2` / `deepseek-v4.1-flash`。新版 Flash 显示名 `deepseek-v4.1-flash-1017` 对应此次测试的调用标识 `deepseek/deepseek-flash`。0.3.6 恢复的默认预算由 0.3.5 + 显式覆盖组验证，未另跑 0.3.6 发布包的 100 题。GLM 对照比较完整系统，不能分离插件作用。

Historical version and official-preset tables use DSH `0.1.5-rc.2` / `deepseek-v4.1-flash`. The newer Flash label `deepseek-v4.1-flash-1017` identifies the tested API route `deepseek/deepseek-flash`. The defaults restored in 0.3.6 were evaluated with 0.3.5 plus explicit budget overrides; no separate 100-task run of the 0.3.6 package is claimed. GLM compares complete systems, without isolating the plugin.

最新同步包含 NodeBB 的六组复核，以及旧宿主标准 max 的第 610 题漏导出补录。新版 DSH 四组、GLM 两组和旧宿主官方六组现在均有 100 题有效评分；均值按补齐后的题目范围重算，原始逐题用量与耗时不变。开发分支结果不加入公开成绩。

The latest reconciliation includes six NodeBB reviews and the restored standard/max export for task 610 on the older host. All four newer-DSH groups, both GLM groups, and all six older-host official groups now have 100 valid scores. Means use the completed task sets; original per-task usage and timing are unchanged. Development-branch results remain outside the public tables.
