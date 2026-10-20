# GLM 评测材料 · GLM Evaluation Artifacts

同一批 SWE-bench Pro hard-100、同一模型 `glm-5.3-flash`、同一 `max` 思考等级：DSH `0.1.5-rc.2` + Super Code `0.3.4` 对照完整原生 ZCode Desktop `3.14.4` / CLI `0.16.9`。两组均完成 100 题，通过数分别为 **44 和 28**。[完整指标与限制](../../docs/EvaluationResults.md#跨模型迁移--cross-model-transfer)

The same SWE-bench Pro hard-100 set, `glm-5.3-flash`, and `max` reasoning: DSH `0.1.5-rc.2` + Super Code `0.3.4` versus complete native ZCode Desktop `3.14.4` / CLI `0.16.9`. Both completed 100 tasks, with **44 and 28 passes**. [Metrics and limitations](../../docs/EvaluationResults.md#跨模型迁移--cross-model-transfer)

## 文件 · Files

| 文件 / File | 用途 / Purpose |
|---|---|
| [dsh-page-driver.ts](dsh-page-driver.ts) | 启动真实 DSH Web，经原生 RPC 创建会话、选择已安装预设并执行任务。 / Starts real DSH Web and runs the installed preset through native session RPC. |
| [zcode-driver.mjs](zcode-driver.mjs) | 校验完整官方包的哈希，调用原生 CLI，不抽取或重写 Agent。 / Hash-checks the complete official package and invokes its native CLI; no extracted or rewritten Agent. |
| [native-resume.mjs](native-resume.mjs) | 已证实的传输故障后续接同一原生会话，保持原有效工作预算。 / Resumes the same native session after confirmed transport failure while retaining the original effective-work budget. |
| [wire-observer.mjs](wire-observer.mjs) / [wire_metrics.py](wire_metrics.py) | 校验模型和思考等级，核算成功响应、缓存、思考 token 和重试扣除。 / Checks model/effort and accounts for successful responses, cache, reasoning tokens, and retry exclusions. |
| [export-results.mjs](export-results.mjs) | 从最终规范记录导出脱敏逐题成绩并复算均值，不调用模型。 / Exports sanitized final canonical records and recomputes means without model calls. |
| [ScriptProvenance.json](ScriptProvenance.json) | 原脚本与公开副本的 SHA-256、移植改动说明。 / Original/exported SHA-256 fingerprints and portability changes. |
| [GLMComparison.json](../results/swebench-pro-final-100/GLMComparison.json) | 两组 200 条最终记录、补丁与原摘要哈希、用量及净耗时。 / The 200 final records, patch/summary hashes, usage, and net timing. |
| [ZCodeNativeCandidate.json](../results/swebench-pro-final-100/ZCodeNativeCandidate.json) | 实际使用的原生包版本和文件哈希。 / Evaluated native package versions and file hashes. |

## 执行前提 · Execution Prerequisites

这些是本次评测的**执行层脚本**，不是一键下载环境的评测平台。公开副本将本机导入路径改成相对路径，模型入口由运行环境提供，未改解题提示和原生会话续接逻辑。没有打包密钥、环境配置文件、原始对话、第三方二进制、题目参考答案或本机调度器。

These are the **execution-layer scripts** used in this evaluation, not a turnkey environment installer. Published copies use relative imports and an externally supplied model endpoint; solution prompts and native-session recovery are unchanged. Credentials, environment configuration files, raw sessions, third-party binaries, reference solutions, and the machine-specific scheduler are excluded.

实际作答前需要准备官方题目容器与依赖，固定仓库 base commit、清除远端和目标提交，将工作区放在 `/app`，并隔离其他题目、参考补丁和评分文件。只允许模型接口联网；评分另用官方 SWE-bench Pro 评分器。逐题 JSON 的 `instance_id` 和 `base_commit` 标识题目，`patch_sha256` 和 `summary_sha256` 绑定原始记录。

Before solving, prepare official task containers and dependencies, pin each base commit, remove remotes and the target commit, place the repository at `/app`, and isolate other tasks, reference patches, and grading files. Allow only the model endpoint over the network; grade separately with the official SWE-bench Pro evaluator. Per-task `instance_id` and `base_commit` identify the task; `patch_sha256` and `summary_sha256` bind the original artifacts.

- **DSH：** 需已构建的 Harness `0.1.5-rc.2` 源码和已安装 Super Code `0.3.4` 的隔离 profile。脚本读取运行环境中的宿主路径、profile、模型入口和密钥，输入为 `repo`、`problem_statement`、`workspace`、`run_dir`、`container_name`、`timeout_ms`。保持 `glm-5.3-flash` / `max`，用 Harness 自带 `tsx` 运行 `dsh-page-driver.ts <input.json> <output.json>`。
- **ZCode：** 使用 Node.js 24 与完整官方 CLI。输入包含上述任务字段，并增加 `native_candidate_dir`，指向完整 CLI 及 `manifest.json`；manifest 使用公开的原生候选哈希。容器需挂载原生 CLI、Node、专用配置和可写会话目录，原生配置固定同一模型及 `max`。运行 `node eval/glm/zcode-driver.mjs <input.json> <output.json>`。中断恢复使用原生 `--resume`，不会换成新会话重答。

- **DSH:** Requires built Harness `0.1.5-rc.2` sources and an isolated profile with Super Code `0.3.4` installed. Host/profile paths, endpoint, and credentials come from the runtime environment. Input fields are `repo`, `problem_statement`, `workspace`, `run_dir`, `container_name`, and `timeout_ms`. Keep `glm-5.3-flash` / `max` and use Harness's `tsx` to run `dsh-page-driver.ts <input.json> <output.json>`.
- **ZCode:** Requires Node.js 24 and the complete official CLI. Add `native_candidate_dir` to the task input, pointing to the CLI and `manifest.json` using the published native-candidate hashes. Mount the native CLI, Node, dedicated configuration, and writable session storage in the task container, with the same model and `max` reasoning. Run `node eval/glm/zcode-driver.mjs <input.json> <output.json>`. Recovery uses native `--resume`, never a replacement session.

## 离线复核 · Offline Checks

在项目根目录运行，不产生模型调用：

Run from the project root; these checks make no model calls:

```bash
node --test eval/glm/test_native_resume.mjs eval/glm/test_export_results.mjs
python3 -m unittest discover -s eval/glm -p 'test_transport_metrics.py'
```

从保留的规范结果目录重新导出：

Export again from a retained canonical run directory:

```bash
node eval/glm/export-results.mjs --root=./completed-run --output=./PublicResults.json
```

该目录需包含 `runs/<instance_id>/summary.json`。新版 DSH 的净耗时还需摘要指向的最终 attempt 下的 `NetResponseTiming.json`；脚本缺记录即失败，不按目录名猜成绩、不自动挑最好一次。净耗时扣除已记录的失败请求与重试等待，token 只加总有用量的成功响应；思考属于输出、缓存属于输入，不重复加总。缺失用量不估算，因此记录不等于完整账单。公开结果为单轮系统对照，不能分离插件作用或保证所有模型都提升。

The directory must contain `runs/<instance_id>/summary.json`. Newer DSH runs also require `NetResponseTiming.json` in the final attempt referenced by each summary. Missing records fail explicitly; the script neither guesses scores from directory names nor selects the best retry. Net time excludes logged failures and retry waits; tokens sum successful responses with known usage. Reasoning is part of output and cached tokens are part of input, without double counting. Missing usage is not estimated, so records are not a complete bill. This single-run system comparison does not isolate the plugin or guarantee improvements across models.

导出器读取规范记录本身。单独核查中的环境异常在公开快照中用 `valid_score: false` 和 `score_review` 标记，保留原始判分与用量，并从有效评分和均值中排除；重新导出原记录不会自动应用这些核查标记。

The exporter reads canonical records as stored. Public snapshots mark environmental cases under separate review with `valid_score: false` and `score_review`, retaining original verdicts and usage while excluding them from valid-score counts and means. Re-exporting the original records does not automatically apply those review markers.
