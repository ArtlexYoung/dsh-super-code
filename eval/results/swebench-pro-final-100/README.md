# SWE-bench Pro hard-100 结果

固定模型 `deepseek-v4.1-flash`，reasoning `high`，原生 DSH Web RPC，官方 SWE-bench Pro 评分器。

本目录为脱敏后的公开结果，不是运行配置。模型名采用公开展示名称；开发提供方、请求路由、环境配置、机器路径和原始工具诊断仅保留在本地证据中。JSON 中的 `public_export` 标记说明了这一边界；评分、请求用量及耗时数值保持不变。

| preset | 有效评分 | 通过 | 正确率 |
|---|---:|---:|---:|
| minimal | 100/100 | 41 | 41% |
| super-code 0.0.9 | 100/100 | 46 | 46% |

`index.json` 提供每题编号、instance ID、通过状态和明细文件。
