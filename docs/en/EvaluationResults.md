# Evaluation Results

[中文](../EvaluationResults.md) · English

## Evaluation design

### Task set

SWE-bench Pro hard-100 (frozen ID `swebench-pro-hard-100-ddd22492f1c38839`), graded with the official grader.

- "hard-100" is this project's selection of 100 tasks by an existing difficulty method, not an official hardest-100 list.
- Tuning uses only 33 valid hard tasks selected from the SWE-bench dev split. hard-100 is used only to evaluate frozen candidates and investigate issues, **never for tuning**, to avoid overfitting to the evaluation tasks.
- All scores include later reviews (see [Grading corrections](#grading-corrections)); every run has 100 valid scores.

### Baseline

The baseline is the official Standard preset rather than Minimal. On the old host, Standard + high passed 51 tasks and Minimal + high passed 46, with Standard using 23.5% fewer tokens per task. Comparing against the stronger baseline gives a stricter conclusion.

### Controlled variables

Within each comparison, host, model, reasoning effort, and budgets are held constant; only the Agent preset differs. Where the host or model changes, this is stated explicitly.

### Process

1. **Old-host baseline**: official presets and plugin versions were evaluated on DSH `0.1.5-rc.2` with `deepseek-v4.1-flash`. The Super Code `0.3.0` candidate passed 56 tasks, above the best official result (Standard + high, 51).
2. **Regression after the host upgrade**: on DSH `0.2.1-rc.2` with `deepseek-v4.1-flash-1017`, under default budgets Standard fell to 46 and Super Code `0.3.4` to 41, below Standard.
3. **Root-cause analysis**: a host probe showed that the new host tightened context budgets (see [Contents of the legacy budgets](#contents-of-the-legacy-budgets)), identifying budgets as one cause of the regression.
4. **Retest with legacy budgets**: both sides switched to legacy budgets. Standard stayed at 46; Super Code `0.3.5` rose to 49. Based on this, the plugin uses legacy budgets by default from `0.3.6`.
5. **Cross-model check**: compared with native ZCode on `glm-5.3-flash` to test whether the approach depends on a specific model.

## Summary

| Comparison | Result |
|---|---|
| New host, both on legacy budgets: Super Code `0.3.5` vs Standard + high | 49 vs 46; net time -21.3%, tokens -34.6%, model calls -25.5% |
| New host, default → legacy budgets | Super Code 41 → 49; Standard 46 → 46 |
| Old host: Super Code `0.3.0` candidate vs best official (Standard + high) | 56 vs 51 |
| Old host: Super Code `0.3.0` candidate vs Minimal + high | 56 vs 46; time -47.6%, tokens -44.9% |
| GLM-5.3-flash: Super Code `0.3.4` vs native ZCode | 45 vs 29; time -37.1%, tokens +52.4% |

## New DSH and budgets

DSH `0.2.1-rc.2` · model `deepseek-v4.1-flash-1017` (API ID `deepseek/deepseek-flash`) · high.

| Metric (per-task mean) | Standard · default | Super Code 0.3.4 · default | Standard · legacy | Super Code 0.3.5 · legacy |
|---|---:|---:|---:|---:|
| Passed | 46/100 | 41/100 | 46/100 | **49/100** |
| Net minutes | 17.875 | 20.364 | 20.870 | 16.416 |
| Model calls | 85.050 | 68.810 | 91.980 | 68.540 |
| Total tokens | 6,832,805.820 | 5,088,673.550 | 7,806,295.960 | 5,108,386.410 |
| Cached input tokens | 6,710,566.400 | 4,972,166.400 | 7,679,298.560 | 4,993,935.320 |
| Uncached input tokens | 59,268.620 | 55,138.870 | 59,291.340 | 52,906.560 |
| Output tokens | 62,970.800 | 61,368.280 | 67,706.060 | 61,544.530 |
| Requests without usage | 0 | 0 | 0 | 1 |

- **Standard**: legacy budgets left the pass count unchanged and used 14.2% more tokens. Per task: 7 gains, 7 regressions.
- **Super Code**: legacy budgets passed 8 more tasks with only 0.4% more tokens and 19.4% less net time. Per task: 12 gains, 4 regressions.
- The two plugin runs used different versions (0.3.4 → 0.3.5), so not all of the gain can be attributed to budgets.
- The legacy-budget plugin run is `0.3.5` with explicit overrides. These budgets are the default from `0.3.6`, but there is **no** separate 100-task run of 0.3.6–0.3.8.
- The Standard legacy-budget run only overrides host budgets; Super Code is not loaded.

### Contents of the legacy budgets

They restore the `0.1.5-rc.2` context policy: measure against the full window, compress at 80%, keep the latest 16% verbatim, cap summaries at 8,192 tokens, one extra compression attempt and one overflow retry. On newer hosts, the default and maximum PTC deadlines are 600 seconds. Several settings were restored together; this is not a single-parameter experiment. [How to configure](UsageGuide.md#runtime-budgets)

A [host probe](../../eval/results/swebench-pro-final-100/HostBudgetDiagnostics.json) with a fixed 1,000,000-token window and 384,000 reserved output tokens measured:

| | Old | New |
|---|---:|---:|
| Compression threshold | 800,000 | 550,464 |
| Verbatim retention | 160,000 | 98,560 |
| Summary request cap | 8,192 | 65,536 |

Summary instructions are identical in both. The probe used deterministic summaries, so it does not measure summary quality or show that every task triggered these changes.

### Regression of the newer combination

Compared with the old host and model, Standard fell from 51 to 46 and Super Code from 56 (0.3.0 candidate) to 41 (0.3.4). Host, model, and plugin changed together. Budgets are one identified cause, but this does not prove they explain the whole regression.

The same task has passed in one run and failed in another. Because configurations also changed between runs, these data cannot estimate random variation under a fixed setup.

[Per-task data for all four runs](../../eval/results/swebench-pro-final-100/HarnessRc2Results.json)

## Official presets

DSH `0.1.5-rc.2` · `deepseek-v4.1-flash`.

| Metric (per-task mean) | Minimal + high | Minimal + max | Standard + high | Standard + max | PTC + high | Create + high |
|---|---:|---:|---:|---:|---:|---:|
| Passed | 46/100 | 50/100 | **51/100** | 50/100 | 47/100 | 49/100 |
| Raw minutes | 25.685 | 32.529 | 20.683 | 20.389 | 17.302 | 19.856 |
| Net minutes | 25.122 | 32.009 | 18.826 | 19.507 | 15.122 | 18.714 |
| Median net minutes | 25.598 | 32.167 | 16.639 | 16.878 | 13.455 | 16.452 |
| P90 net minutes | 41.658 | 45.179 | 36.681 | 33.834 | 25.031 | 30.104 |
| Model calls | 124.660 | 138.920 | 92.370 | 101.260 | 71.160 | 93.600 |
| Top-level tool calls | 127.360 | 150.070 | 110.480 | 124.940 | 70.990 | 113.780 |
| Total input tokens | 11,477,169.950 | 14,849,497.540 | 8,771,693.040 | 11,434,388.180 | 6,160,934.650 | 9,205,287.290 |
| Total tokens | 11,578,046.900 | 14,966,097.260 | 8,854,513.910 | 11,543,772.990 | 6,238,434.510 | 9,292,949.400 |
| Cached input tokens | 11,404,101.120 | 14,770,140.160 | 8,713,578.230 | 11,366,136.320 | 6,099,266.510 | 9,145,025.240 |
| Uncached input tokens | 73,068.830 | 79,357.380 | 58,114.810 | 68,251.860 | 61,668.140 | 60,262.050 |
| Output tokens | 100,876.950 | 116,599.720 | 82,820.870 | 109,384.810 | 77,499.860 | 87,662.110 |
| Input cache hit rate | 99.363% | 99.466% | 99.337% | 99.403% | 98.999% | 99.345% |
| Retry minutes excluded (total) | 56.323 | 51.936 | 185.717 | 88.220 | 217.996 | 114.226 |
| Requests without usage | 3 | 11 | 4 | 0 | 5 | 2 |

- Create keeps the official tools, but evaluation isolation blocks `cordis_run` from running dynamic code on the host; read-only inspection still works.
- Minimal + high reuses a historical baseline on a different Harness revision, so differences cannot be attributed entirely to reasoning effort.

[Per-task data](../../eval/results/swebench-pro-final-100/OfficialPresetResults.json)

## Historical versions

DSH `0.1.5-rc.2` · `deepseek-v4.1-flash` · high. Times use the historical raw convention (see [Methodology](#methodology)); don't compare them with the net times above.

| Metric (per-task mean) | Minimal + high | 0.0.9 | 0.1.2 | 0.2.0 layered memory | 0.3.0 Batch.3 |
|---|---:|---:|---:|---:|---:|
| Passed | 46 | 50 | 53 | 54 | **56** |
| Raw minutes | 25.685 | 16.458 | 16.011 | 15.148 | 13.461 |
| Median minutes | 26.138 | 14.398 | 13.736 | 13.510 | 12.197 |
| P90 minutes | 43.696 | 28.816 | 29.360 | 24.145 | 21.381 |
| Model calls | 124.660 | 92.780 | 99.780 | 93.830 | 69.290 |
| Top-level tool calls | 127.360 | 116.550 | 123.340 | 119.160 | 69.730 |
| Total input tokens | 11,477,169.950 | 9,525,315.530 | 9,840,382.730 | 9,202,574.270 | 6,290,407.000 |
| Cached input tokens | 11,404,101.120 | 9,461,981.440 | 9,775,799.040 | 9,142,005.760 | 6,231,823.360 |
| Uncached input tokens | 73,068.830 | 63,334.090 | 64,583.690 | 60,568.510 | 58,583.640 |
| Output tokens | 100,876.950 | 97,900.990 | 97,793.480 | 96,519.570 | 91,561.850 |
| Total tokens | 11,578,046.900 | 9,623,216.520 | 9,938,176.210 | 9,299,093.840 | 6,381,968.850 |
| Input cache hit rate | 99.363% | 99.335% | 99.344% | 99.342% | 99.069% |
| Requests without usage | 3 | 8 | 1 | 1 | 0 |

Relative to Minimal:

| Version | Pass rate | Mean time | Total tokens | Gains | Regressions |
|---|---:|---:|---:|---:|---:|
| 0.0.9 | +4 pp | -35.9% | -16.9% | 7 | 3 |
| 0.1.2 | +7 pp | -37.7% | -14.2% | 10 | 3 |
| 0.2.0 | +8 pp | -41.0% | -19.7% | 11 | 3 (37, 396, 503) |
| 0.3.0 Batch.3 | +10 pp | -47.6% | -44.9% | 13 | 3 |

- 0.3.0 vs 0.2.0: time -11.1%, tokens -31.4%, model calls -26.2%, passes 54 → 56 (8 gains, 6 regressions). One run; a net gain of two is not a stable improvement.
- 0.2.0 vs 0.1.2: time -5.4%, tokens -6.4%, passes 53 → 54 (7 gains, 6 regressions). Better overall does not mean every earlier pass held.
- One PTC call can run several operations, so top-level tool calls don't measure how many files were read or commands run.

Candidate identity:

- **0.2.0** is the frozen layered-memory candidate. Its package still carried version 0.1.3, SHA-256 `164cc1b505c05288f01b6f12c0756af049dbde8f1a49bdb11f9a320a19c925f5`.
- **0.3.0** is the installed candidate with internal version `0.3.0-batch.3`. The release package was checked file by file against the frozen runtime modules and passed unit tests and real-host regression; the 100 tasks were not rerun.
- Both share Harness commit `649bfcddf0e3532510a38380b9620570d8b13818`, but prompt changes and tool presentation still can't be separated. Memory tools were triggered only occasionally, so differences can't be attributed to memory alone.

[Four-version per-task data](../../eval/results/swebench-pro-final-100/CorrectedFourVersions.json) · [Batch.3 per-task data](../../eval/results/swebench-pro-final-100/Batch3Results.json)

## Cross-model

`glm-5.3-flash` · max. Super Code `0.3.4` on DSH `0.1.5-rc.2`, versus the complete native ZCode Desktop `3.14.4` / CLI `0.16.9` (not an extracted Agent).

| Metric (per-task mean) | DSH + Super Code 0.3.4 | Native ZCode |
|---|---:|---:|
| Passed | **45/100** | 29/100 |
| Net minutes | 32.896 | 52.320 |
| Model calls | 66.890 | 64.310 |
| Total tokens | 5,499,154.470 | 3,609,511.930 |
| Cached input tokens | 5,302,796.160 | 3,356,862.720 |
| Uncached input tokens | 126,050.640 | 144,405.020 |
| Output tokens | 70,307.670 | 108,244.190 |
| Requests without usage | 29 | 120 |

This shows the approach also works on GLM. It compares two complete systems, so it doesn't isolate the plugin's contribution or generalize to all models.

[Per-task data](../../eval/results/swebench-pro-final-100/GLMComparison.json) · [Execution scripts](../../eval/glm/README.md)

## Grading corrections

Every correction regrades an **original answer** or restores an omitted export row. No model was asked to answer again. Original verdicts, patch hashes, usage, and timing are kept.

### 2026-10-21 to 23

| Run | Before | After | Date |
|---|---:|---:|---|
| Super Code 0.3.4 · default | 40/99 | 41/100 | 10-21 |
| Super Code 0.3.5 · legacy | 48/99 | 49/100 | 10-21 |
| Standard high · default | 45/100 | 46/100 | 10-22 |
| Standard high · legacy | 46/100 | 46/100 | 10-22 |
| GLM Super Code 0.3.4 | 44/100 | 45/100 | 10-22 |
| GLM native ZCode | 28/100 | 29/100 | 10-22 |
| Standard max · DSH 0.1.5-rc.2 | 49/99 | 50/100 | 10-23 |

- The first six are the same NodeBB task. After fixing offline dependency setup (base fails, reference passes), each run's original patch was graded twice; only complete, matching results count. Only four exact quote/space test-name differences are accepted; assertions, timeouts, and statuses are unchanged, and grading runs offline. Standard with legacy budgets still has a real failure, so it's unchanged.
- Standard max restores Teleport task 610: its original grade was a pass but was missing from the export.

[Correction evidence and original hashes](../../eval/results/swebench-pro-final-100/GradingReconciliation.json)

### Earlier reviews

| Version | Original passes | Corrected | Environment regrades |
|---|---:|---:|---:|
| Minimal | 41 | 46 | 4 |
| 0.0.9 | 46 | 50 | 3 |
| 0.1.2 | 49 | 53 | 4 |
| 0.2.0 | 48 | 54 | 5 |

- **Environment failures**: 16 records hit issues such as a ConfigFileTest 500 ms timeout or a SIGKILLed Jest worker. Each was regraded with its original patch and needed two matching, clean results — **not** retried until it passed. 12 recovered, 4 still failed.
- **Dependency downloads**: 12 Node build-dependency download failures in the official-preset runs, same rule: 11 recovered, 1 still failed.
- **Test-name mismatches**: 31 records differed only in test names (16 dynamic-year cases in OpenLibrary, 15 trailing quote/space cases in NodeBB). All raw tests passed and every missing required name mapped exactly. Only these two mappings are accepted; no fuzzy matching, no borrowing results from other versions.
- **Older experiments**: 7 newly found environment failures were regraded: 3 recovered, 4 still failed. Three other old records (early Minimal task 4, old Graph task 623, and old Graph task 99, which had copied task 378's metadata) were found and reviewed. None are in the published scores, which are unchanged.

### Review coverage

- All 3,296 Pro / Dev primary records had their raw logs reparsed (this counts retained duplicates, not unique tasks). All 1,212 Dev verdicts agree. All 400 published four-version records bind exactly to their original summaries and grading logs.
- For 3,224 records, request ledgers match summaries (calls, tokens, missing usage) with no duplicate request IDs; 72 have no saved ledger.
- This is not a full audit of every raw session or provider bill.

[Per-record review](../../eval/results/swebench-pro-final-100/GradingReviewResults.json)

## Methodology

- **Net time**: excludes failed requests and retry waits in the final valid answer; excludes grading.
- **Raw time** (historical table): Web RPC time of the final valid answer, excluding grading, image downloads, and regrading, but without subtracting internal failed requests or retries. The median averages the 50th and 51st values; P90 is the 90th. An older 0.0.9 document said 16.27 minutes; the unified convention gives 16.458.
- **Call counts**: exclude logged failed requests.
- **Tokens**: total = cached input + uncached input + output (including reasoning). Cache hit rate = all cached input / all input, not a per-task average. Summed per task, then averaged over valid tasks.
- **Missing usage is not estimated**, so tokens are not a full bill and exclude earlier abandoned attempts.
- **Execution**: DSH via native Web RPC; ZCode via its complete native CLI.
- **Privacy**: public data keeps only fields needed for auditing — no private provider addresses, credentials, environment configuration, local paths, or verbatim user messages. Per-task result files stay in the repository, not the npm package.

[All result tables](../../eval/results/swebench-pro-final-100/ResultsTables.md) · [Result files](../../eval/results/swebench-pro-final-100/README.md)
