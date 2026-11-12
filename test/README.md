# 测试目录

源码测试与 `src` 保持对应：`core/`、`connection/`、`dsh/` 分别测试同名模块，`test` 根目录保留 `src` 根目录模块的测试。

其他入口按实现位置归类：

- `client/`：前端交互、设置自动保存与渲染。
- `runtime/skills/pstack/`：PStack 转换及配套脚本。
- `package/`：npm 分发资源与公开入口。

`validation-root.ts` 是共用的临时资源路径助手，验证产物统一放在 `source/validation/dsh-super-code`；隔离环境可通过 `SUPER_CODE_TEST_ROOT` 指定目录。

运行全部测试：

首次运行先执行 `npm install`，它会自动构建。`lib` 是本地生成的编译产物，不纳入 Git；`npm pack` 也会自动构建并将运行文件放入 npm 包。

```sh
npm test
```

测试命令中的 glob 保留引号，由测试工具递归发现，避免 shell 提前展开而遗漏根目录或更深层的测试。
