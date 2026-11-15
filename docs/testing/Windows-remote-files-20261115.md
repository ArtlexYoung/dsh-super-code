# Windows 轻量远程文件适配验收

2026-11-15，本轮批准的使用方式已通过验收：Windows 轻量远程项目保留原生读取，文件创建和修改使用已有 `remote_bash`，审批、取消、断连和冷恢复正常。本轮没有修复 DSH 原生挂载写入；也没有更换 BusyBox、SSHFS、Rclone 或插件依赖。

版本按用户要求保持 `0.4.1`，这份包包含未发布修复，不能冒充已发布的 0.4.1，也不能向 npm 重复发布。发布前仍需确定新版本，更新版本元数据和双语 README，再生成对应正式包。

## 对象与实现

基线是 `main@4b7005e`，另整合 GitHub `main@4f57c1b` 中两个仅更新趋势图的提交。实现位于 `src/dsh/tool-presentation.ts`：Windows 且当前会话提供 `remote_bash` 时，隐藏 `write`、`edit`、`str_replace_editor` 及对应写入提示，历史调用也明确拒绝；保留读取、任务、方法和记忆。文件修改沿用原远程工具，不自动执行、重试或扩大权限。本地及非 Windows 会话保持原行为。两种 DSH 工具展示接口都有回归覆盖。

修复遵循“在负责这一行为的边界处理”的原则：仅调整工具选择，不在插件内另写文件系统，不跳过 DSH 的权限、原子写入或并发保护。

候选 SHA-256：`98e1958017415dc58a70c36d728a7204c597bed8ea4b06e875fef11d976b3b75`。包中5926个普通文件逐一匹配隔离工作目录，5637个第三方文件与上一候选逐字节相同；没有混入其他会话的 Storage、README 改动或压缩包。

## 实际环境与结果

Windows 使用 Windows 11 Enterprise ARM64 虚拟机，在系统 x64 模拟层运行官方 Desktop `0.2.2-rc.2`，远程插件 `dsh-ssh-workspaces 0.4.0`，挂载使用 Rclone `1.76.0` / WinFsp `2.1.25156`；Linux ARM64 SSH 服务与项目目录均为本轮隔离资源。SSH 主机公钥经过核对，挂载关闭写缓存。联网模型使用已授权的现有服务；不是断网云推理。

| 检查 | 本轮结果 |
|---|---|
| 全套自动测试 | 1184通过，失败、取消、跳过均为0 |
| Windows Shell与远程定向回归 | 33通过；新增规则修改前失败、修改后通过 |
| 类型、构建、客户端语法、差异格式 | 通过 |
| 实际模型看到的远程工具 | 27份声明快照包含read、remote_bash、任务和记忆，无write/edit/str_replace_editor/run_code/bash |
| 真实挂载文件操作 | 原生read读取输入；remote_bash创建并修改answer.txt；回读与服务器独立字节、哈希一致，内容为WINDOWS_REMOTE_READY和结果=42 |
| 任务、方法、项目记忆 | 实际创建、聚焦、保存和读取，第二轮可继续读取 |
| Windows界面审批 | Reject后无文件；Allow once后服务器实际内容一致 |
| 取消与断连 | 界面取消长命令、主动断开、真实停止SSH服务均未产生迟到文件；恢复后读取、任务和记忆可用 |
| 完全退出后冷恢复 | 发消息前任务已存在；模型实际调用read、remote_bash、任务、记忆和方法并回答42 |
| 同机普通本机会话 | 保留PTC，实际创建local-answer.txt并回读；未出现远程文件误写到本机项目 |
| macOS空缓存离线安装 | 系统禁止网络，仅增加--offline，其余npm默认；7678毫秒，依赖实际导入和OpenSpec CLI通过 |
| Windows空缓存离线安装 | 系统禁止非loopback网络，仅增加--offline，其余npm默认；83953毫秒，依赖实际导入和OpenSpec CLI通过 |
| 测试Skill | 增加REM-16及批准策略的验收边界，格式校验通过 |

安装专项没有自动装入 DSH。Windows 完整程序使用同一候选实际解包到独立 profile，入口哈希与构建结果一致。普通 npm 安装不加 `--offline` 时仍可能因检查可选 peer 元数据而重试；本轮不将显式离线模式通过写成普通默认安装快速通过。

逻辑代码量为 `src/dsh` 3702至3709行，增加7行，32个文件不变，新增超过提醒线的函数或文件为0。

## 失败与适用限制

挂载探针仍可复现句柄 `chmod` 返回 `EINVAL`。此前完整 DSH 原生写入失败的结论保留；本轮验收的是用户批准的远程命令修改方式。SSHFS-Win `3.5.20357` 的已有目录 `mkdir` 错误仍会阻止 DSH `0.2.2-rc.2` 创建会话，本轮没有修复该第三方问题。项目使用远程插件登记返回的路径，盘符别名不能保证匹配。

测试准备过程有失败：干净副本未先构建导致两项分发检查失败；构建后1183项基线通过，最终新增回归后1184项通过。挂载首次公钥不完整、测试配置漏启远程插件及未提供已有OpenSSH完整路径，修正隔离配置后接通；YAML误用JSON解析也已更正。审批观察器最初未选择测试会话而超时，选中正确会话后在同一待审批请求上完成拒绝，随后单次批准通过。Windows首次离线安装超过90秒预算；新目录240秒预算复测约84秒完成。冷启动首次在插件就绪前查询接口失败，等待就绪后冷恢复通过。上述情况不计为新产品修复，也不称测试全程零失败。

本轮没有重跑27个DSH版本、全部手机通道、98份Skill具体场景或离线小模型矩阵；这些历史结果只按各批实际范围引用。当前变化集中在 Windows 轻量远程工具选择，两种展示接口由自动测试覆盖，真实完整程序验证为上述 Windows 组合。手机历史验收使用 Android 模拟器，实体手机和 iOS 未验证。BusyBox、ripgrep 等外部程序自身的长路径限制仍在。

本轮查询到 PortableGit `2.56.1.windows.1`、PStack `0.15.42`、OpenSpec `2.0.0`、oil-ui `0.33.5` 和 js-yaml `5.5.0` 等上游版本；候选继续固定已验收的组件，不自动升级。随包 PortableGit 仅提供部分Shell资源，不包含Git可执行文件。

## 发布准备结论

本轮批准的修复与验证已完成。新版本号、正式 README 最近更新、最终版本包、推送与发布尚未执行；这是用户明确暂缓版本修改的范围，不是当前包可以直接重复发布。未提交的其他会话文件与原暂存区逐字节保留。

可核对的本批资料位于外层 `source/validation/dsh-super-code/release-ready-20261115-TrgwV0`：`Assessment.json`、`Tests-final.log`、`Remote-tests-red.log`、`Remote-tests-green-r2.log`、`Model-first.json`、`Approval-recovery.json`、`Interruption.json`、`Cold-validation-r2.json`、`received/Final-installed.json`、`Package-verification.json` 与两平台的 `Offline-default-settings` 结果。历史挂载原生写入失败见[真实挂载补验](Acceptance-windows-ssh-20261115.md)，BusyBox补救见[对应验收](BusyBox-recovery-20261115.md)。
