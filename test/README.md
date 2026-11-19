# 测试目录

源码测试与 `src` 保持对应：`core/`、`connection/`、`dsh/` 分别测试同名模块，`test` 根目录保留 `src` 根目录模块的测试。

其他入口按实现位置归类：

- `client/`：通过实际构建的 `dist/client.js` 验证前端交互、模块故障、设置自动保存与渲染；修改客户端源码后先运行 `npm run build:client`。
- `scripts/skills/pstack/`：PStack 转换及配套脚本。
- `package/`：npm 分发资源与公开入口。
- `workbench/`、`builtin/workbench/`：工作台文件、Git、语言与窗口后端及实际编辑器界面。

合并工作台与工具方案时，先在外层验收目录固定双方已验快照和本次修改范围；原15版本×3系统结果只覆盖原包和未变路径。本轮差异通过唯一批量入口执行，包含前后端独立加载、依赖撤销/恢复、模型及Git异常隔离、共享Shell选择、资源闭包和正常收尾，不手工逐版本运行。

`validation-root.ts` 是共用的临时资源路径助手，验证产物统一放在 `source/validation/dsh-super-code`；隔离环境可通过 `SUPER_CODE_TEST_ROOT` 指定目录。

运行全部测试：

首次运行先执行 `npm install`，它会自动构建。`lib` 是本地生成的编译产物，不纳入 Git；`npm pack` 也会自动构建并将运行文件放入 npm 包。

```sh
npm test
```

发布前执行 `npm run build && npm run pack:check`。分发检查验证实际 npm 文件清单，确保全部运行依赖及其传递依赖随包携带，并排除 DSH 模块和开发工具。新增依赖会自动纳入检查；`offline-install.test.ts` 另用真实 tgz、空安装目录和空 npm 缓存执行离线安装，保留默认 peer 解析和安装脚本，防止 DSH peer 被自动补装。实际 DSH 管理器安装、加载和工具运行仍需在已安装 DSH 的隔离环境中验收。

离线安装检查通过全部断言后，移除本轮 `安装 目录/node_modules` 和 `cache/_cacache`，保留 `.tgz`、安装目录的包声明和锁文件、`Pack.log`、`Install.log` 及 `cache/_logs`。安装或断言失败时保留现场。复查旧包可在新的空目录用原 `.tgz` 执行 `npm install <tgz 的绝对路径> --offline --cache <空缓存目录> --no-audit --no-fund --legacy-peer-deps=false --force=false`，不覆盖历史结果。

连接模块加载方式变更时，还需在官方 Electron 桌面宿主中冷启动验证：确认 MCP 配置可写，在设置中切换并恢复一个 Skill 开关后，再拒绝和批准中文、空格路径的目录申请，核对服务端授权目录。连接功能入口已由独立子插件延迟加载，内部依赖应随入口一起加载；内部再次动态导入可能触发宿主热加载与 CommonJS 缓存冲突。普通 Node 测试和只检查配置默认值不能代替这项回归。

测试命令中的 glob 保留引号，由测试工具递归发现，避免 shell 提前展开而遗漏根目录或更深层的测试。
