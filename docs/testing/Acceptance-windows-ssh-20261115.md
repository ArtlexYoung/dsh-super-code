# Windows 真实 SSH 挂载与离线安装补充验收

2026-11-15 的补充验收结论是**部分通过**。macOS、Windows 空缓存禁外网安装通过；Windows 轻量 SSH 已完成真实挂载及完整 DSH 程序测试，远程命令、原生读取、任务、记忆、方法、审批和冷恢复通过，原生文件写入失败。因此目前不能声明 Windows 轻量 SSH 的全部功能通过。

候选运行代码为 `822e9556577395957ce1d32ec4b304c0ebfc413e`，测试开始时文档提交为 `7e5c02a258fa343b85d8e1bedf7d608eb18f1b14`。测试包仍标记 `0.4.1`，包含该版本发布后的修改，SHA-256 为 `9da7c9674f32b5fa7903ca081520433b49629e0a0683182d3a798fb99d5b64d6`。本轮未修改产品运行代码、根配置或依赖，也没有重新发布。

## 原生工具与 BusyBox 的边界

`src/dsh/tool-presentation.ts` 在 Windows 初始会话工作目录长度达到 259 字符时自动选择 DSH 原生执行器；有 `remote_bash` 的轻量远程会话也使用原生工具。这里改变的是模型调用工具的入口，工具实现、权限检查和第三方程序仍由 DSH 负责。

因此，自动选择原生 `read/write/edit` 可以避开本地 BusyBox 的文件命令，但选择原生 Bash 并不会把 Bash/BusyBox 替换成系统文件接口，搜索工具也仍可能调用 ripgrep。长文件路径和长进程工作目录是不同限制；Shell 内部先 `cd`，不能修复 Shell 在长工作目录中尚未启动就失败的问题。此前本地 Windows 长目录原生读写通过的结果，也不能推导为网络挂载上的原生写入通过。

## 禁外网、空缓存安装

两个平台使用同一候选 tgz、全新 npm 缓存和空 npm 配置，安装命令仅增加 `--offline`，没有关闭重试、更新提示、审计、安装脚本或 peer 处理：

```sh
npm install ./dsh-super-code-0.4.1.tgz --offline --cache ./empty-cache
```

| 平台 | 网络条件 | 安装及运行检查 | 结果 |
| --- | --- | --- | --- |
| macOS ARM64 | 系统沙箱禁止测试进程联网，外连实际返回 EPERM | 10,732 毫秒；运行依赖导入、OpenSpec CLI 1.17.0 | 通过 |
| Windows 11 ARM64 虚拟机 | QEMU 测试进程被系统禁止非本机回环网络，仍可访问隔离测试服务 | 86,935 毫秒；运行依赖导入、OpenSpec CLI 1.17.0 | 通过 |

两次均保持 `fetchRetries=2`、`updateNotifier=true`、`audit=true`、`legacyPeerDeps=false`、`force=false`、`ignoreScripts=false`，没有补装 DSH。计时包括安装后的运行检查，不是单独的 npm 安装耗时，也不是性能对比。

原 `0.4.0` 缺少随包运行依赖的问题已修复。此前未加 `--offline` 的普通 npm 安装，仍可能查询可选 DSH peer 的注册表元数据，在网络被阻止时重试；该路径超过 180 秒未完成的历史结果不改为通过。本轮补验的是显式离线安装，其余设置保持默认。测试使用系统网络限制，不称为物理拔网。

## Windows 真实轻量 SSH

客户端为 Windows 11 Enterprise ARM64 虚拟机，运行官方 x64 Desktop `0.2.2-rc.2`，由系统模拟执行；远程插件为原装 `dsh-ssh-workspaces 0.4.0`，服务器为隔离 Linux ARM64 SSH 容器。候选实际解包到当前 DSH profile，原远程工具拦截器、DSH 权限检查及写入流程均未修改。

Windows 通过 SSH/SFTP 访问服务器文件，不以客户端目录副本或 Docker 共享目录代替网络挂载。服务器目录由容器挂载到测试数据目录，另从服务器内部独立核对了文件内容与不存在的标记。

| 挂载方式 | 实际结果 | 判定 |
| --- | --- | --- |
| WinFsp `2.1.25156` + SSHFS-Win `3.5.20357` x64 | 异步目录解析、读取和普通写入可用；对已存在目录执行递归创建返回 EPERM，DSH 创建会话失败。盘根、子目录和登记网络路径均复现 | 失败 |
| 同一 WinFsp + Rclone `1.76.0` ARM64 SFTP | 异步目录解析、已有目录递归创建及原装远程插件双向挂载探针通过，能创建完整 DSH 会话；原生写工具报 `EINVAL: invalid argument, fchmod` | 部分通过 |

SSHFS-Win 的已有目录错误与上游 [issue #472](https://github.com/winfsp/sshfs-win/issues/472) 一致。Rclone 的结果不能作为 SSHFS-Win 已修复的证据。

Rclone 挂载中的真实模型测试结果如下：

| 场景 | 实际结果 |
| --- | --- |
| `remote_bash` 查询目录、读取、计算、写入并回读 | 通过，服务器文件含计算结果 42 |
| 原生 `read` 读取服务器输入与结果 | 通过 |
| 原生 `write` 新建文件 | 失败，重复调用均报 `EINVAL: fchmod`，最终目标文件不存在 |
| 任务创建、聚焦和第二轮读取 | 通过 |
| 项目记忆保存、实际回读和方法读取 | 通过；模型起初的主题参数错误纠正后成功，不将错误调用计为成功 |
| Windows 界面拒绝和单次批准远程命令 | 通过，拒绝文件不存在，批准文件内容符合预期 |
| 原装远程插件主动断开拦截 | 通过，没有写入或本机命令回退 |
| 实际停止 SSH 服务、恢复服务后续聊 | 通过；命令报告连接关闭，会话报告挂载目录 EIO；恢复后文件、任务和记忆可读，没有迟到写入 |
| 完全退出 DSH 后使用同一 profile 和原会话 | 通过，任务在再次提示前已恢复，模型实际读取任务、记忆、方法、文件并调用远程命令 |

文件系统定向探针还发现：两个网络挂载上的文件句柄 `chmod` 均返回 `EINVAL`，硬链接均返回 `ENOTSUP`；同机本地目录的对应操作通过。普通写入、同步、路径 `chmod` 和改名成功。DSH `0.2.2-rc.2` 的文件写入实现使用句柄权限设置，新建保护还使用硬链接发布，因此普通 `writeFile` 成功不足以证明 DSH 原生写工具可用。当前没有绕过这些检查来让验收通过。

此外，直接向会话接口传入盘符别名时，远程插件未匹配其登记的网络路径，模型只获得 PTC 工具。按远程插件登记后返回的项目路径创建会话后，才正确获得 `remote_bash` 和原生文件工具。该路径匹配限制与 Super Code 在已提供 `remote_bash` 时自动选择原生执行器，是两个不同环节。

一次中断验收脚本错误地要求连接关闭必须产生 `isError=true`，而实际工具返回非零退出码和连接关闭文本，随后会话以挂载 EIO 结束。该脚本失败没有删除；后续独立核对了真实退出内容、无本机回退、服务器无迟到文件及恢复调用，按实际行为判定中断处理通过。

## 覆盖范围与后续处理

本轮补齐了 Windows 真实挂载环境，明确了失败入口，没有解决第三方挂载与 DSH 安全写入流程的兼容问题。需要完整文件操作时，推荐使用在远程机器上运行完整 DSH 的模式；继续完善 Windows 轻量模式，需要在远程文件系统实现或挂载兼容性上处理，不能靠模型先 `cd` 或自动切换工具展示解决。

没有进行 Windows x64 实机、物理拔网或所有挂载工具的测试。此前 1,182 项自动测试属于上一批同一运行代码的结果，本轮未重复执行，也不计为新的通过数量。新增测试步骤已写入 `dsh-super-code-test`，包括异步目录检查、句柄权限、硬链接、实际原生写入及登记路径与盘符别名的区别。

本轮证据目录为外层 `source/validation/dsh-super-code/windows-ssh-mount-20261115-kPNRm6`。关键结果为 `Assessment.json`、`Offline-default-settings.json`、`received/Windows-offline-default.json`、`received/Mount-parent.json`、`received/Rclone-mount-r3.json`、`received/FS-contract.json`、`Remote-rclone-first-r2.json`、`Remote-rclone-rest-result.json`、`Remote-rclone-recovery-result.json`、`Remote-rclone-cold-result.json` 和 `Server-independent.json`。
