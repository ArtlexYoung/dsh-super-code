# 评测资料的磁盘占用与保留

保留准确代码和补丁、原始结果与必要日志、配置/依赖锁、报告和恢复入口。已结束实验的完整源码副本、临时单快照 Git、生成缓存和重复基线可以在恢复验证后退役；未知文件、修改过的离线依赖、尚在运行或续跑的现场继续保留。

2026-11-09 定位到两种增长来源：一类在切题时将完整源码和临时 `.git` 留为 `inherited-workspace-final`；另一类在每次提供方失败后续跑同一 Session，再把不断增长的完整 `.zstd` 会话复制到新 attempt。压缩后仍会反复包含全部历史。NodeBB 一个问题的 832 份累计快照约 3.79 GB，最后一份只有约 8.78 MB。

## 新会话归档使用原生克隆

本仓库维护的 [session-snapshots.mjs](../runtime/storage/session-snapshots.mjs) 提供与旧任务私有 `runtime-storage.mjs` 一致的 home/归档接口。它用独立 APFS clone 保存每份原字节，源会话继续追加时由 COW 分配新块，各 attempt 仍是可独立读取的普通文件，计时、审计和恢复不用先全量解压。最终会话收集也必须使用同一策略，否则收尾又会产生完整副本。

部分 macOS Node 的 `COPYFILE_FICLONE_FORCE` 实际返回 `ENOSYS`。脚本会改调系统 Python 的 `clonefile` 原生接口；两个接口都不能完成时明确失败，不悄悄完整复制，也不把硬链接当作独立副本。跨卷或不支持克隆的环境需要重新评估真实使用成本。

先正常生成**尚未 Prepared/Release/运行**的新评测版本，再在发布冻结前执行：

```sh
python3 -B runtime/storage/stage-evaluation-storage.py --new-release /绝对路径/新评测版本
node --test runtime/storage/session-snapshots.test.mjs
python3 -B -m unittest discover -s runtime/storage -p 'test_*.py' -v
```

新版本须有 `driver/runtime-storage.mjs` 和对应的 `accounting.py`。准备脚本同时更新归档和最终会话收集，保存原模板到 `storage-before-clone-policy`，写 `StoragePolicy.json`。已有 Release、Sources、Prepared、任务/运行现场或重复执行会拒绝修改。发布者仍须运行该版本原有验收，验证真实卷上的共享，再冻结新的身份和哈希；这一步不启动模型或更改 Docker。

已经生成一份可复用模板：`dsh-plugin/source/evaluation_runtime/session-clone-v1`。这是后续执行器的候选模板，不是已替换活跃冻结版本的声明。当前批次的 `Release.json` 和所有冻结脚本保持原样。

## 工作副本和基线

规范输入、兼容包和共享资源归本项目所在的 `dsh-plugin/source` 管理。基线按 SHA 保存规范份，保留原版本、补丁与结果索引。需要原路径时先用独立 clone 保持读取协议；不要让每次切题都用普通 `copytree` 再复制相同对象，也不要将每次运行的整个工作目录重新打包。

新工作区可复用已有入口：

```sh
python3 ../source/shared_content-20261105-project-local/storage.py copy /绝对路径/规范基线 /绝对路径/新工作区
```

该入口拒绝覆盖已有目标；普通复制回退必须明确选择且照实计费。缓存回收由任务 owner 在成果和恢复资料确认持久化、锁及最后引用释放后处理。当前的冻结 runner 不因本次文档更新自动改变；有完整代码/补丁但引用尚未闭合的目录可以先无损共享，不能直接删。

切题时保存 `.git-evidence` 的普通 `copytree` 也已提供下一版改法。在一个尚未冻结、尚未运行的新版本根目录执行：

```sh
python3 -B runtime/storage/stage-evaluation-storage.py --new-workspace-runner /绝对路径/新版本根目录
```

该版本须有 `runner/runtime/workspaces.py`，且仍使用已核对的 `allocate` 交接协议。准备脚本将其 Git 证据复制接入 [workspace-clones.py](../runtime/storage/workspace-clones.py)，逐文件使用原生 clone 并验证完整内容和源稳定性；保留目录路由身份、软链接、旧任务的完整 Git 证据和跨题隔离。它不删除旧工作副本。克隆失败保留正常交接的现场供恢复，不退回完整复制。新版本仍须通过其原有验收后冻结发布，当前 `Sources.json` 对应的 runner 保持原样。

工作副本交接候选模板在 `dsh-plugin/source/evaluation_runtime/workspace-clone-v1`，与会话模板分别对应两套原有执行器；它们都不是完整可启动的评测版本。

## 本次执行与恢复

逐文件白名单、分配变化、元数据收据和保留原因在 `dsh-plugin/.development/project-storage-cleanup-20261109-evaluation-retention`。独立恢复来源在外盘 `StorageCleanupBackups/20261109-evaluation-retention`；本机规范池在 `dsh-plugin/source/shared_content-20261109-evaluation-*`。使用本批随附恢复器恢复到全新目录，不覆盖现有业务路径。

原路径保留、内容验证通过和整个应用启动验证是不同覆盖。本次执行报告以稳定目标的实际独占缩减扣除新增池/审计开销；路径 `du`、历史预计量或整盘并发空闲变化不能替代实际收益。不要将本批报告再次当作下一轮删除清单。
