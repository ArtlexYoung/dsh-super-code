# 内置 Git 引擎

本模块将 `isomorphic-git`、其 Node HTTP 客户端与 `diff` 打包为 `dist/git.cjs`，由宿主中的 `src/workbench/git` 调用，不把仓库复制到浏览器。运行时优先使用本机 Git，仅检测不到可用 Git 时选择内置引擎；执行失败不会切换引擎重放。

运行 `npm run client:build` 构建前端和 Git 产物。版本由根目录锁文件固定，第三方许可证随包汇总到 `dist/THIRD_PARTY_NOTICES.txt`。源文件与适配代码公开，生成文件不提交到源码仓库。

用户入口、操作范围和限制见 [代码工作台](../../docs/CodeWorkbench.md)。
