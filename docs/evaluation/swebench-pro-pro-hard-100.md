# SWE-bench Pro hard-100 结果

固定模型 `deepseek-v4.1-flash`，reasoning `high`，原生 DSH Web RPC，官方 SWE-bench Pro 评分器。模型名为公开展示名称，开发路由与本地环境信息不包含在公开导出中。

| preset | 有效评分 | 通过 | 正确率 |
|---|---:|---:|---:|
| minimal | 100/100 | 41 | 41% |
| super-code 0.0.9 | 100/100 | 46 | 46% |

本表为 `0.0.9` 候选的历史评测，未重新运行 `0.1.0` 的完整 100 题评测。

[`index.json`](../../eval/results/swebench-pro-final-100/index.json) 提供每题编号、instance ID、通过状态和明细文件。
