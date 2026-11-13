# 代码工作台

内置模块源码随插件公开。使用说明见 [代码工作台](../../docs/CodeWorkbench.md)。

- `components/`：宿主页面、设置、浮窗和选区对话。
- `editor/`：CodeMirror 配置、语言、导航、补全和外观。
- `analysis/`：基础源码声明、引用和文档索引。
- `assistant/`：选区对话、标记、取消及替换检查。
- `controller.js`：每个会话的缓冲区、文件切换、保存和索引。
- `remote.js`：与宿主通信的公开描述。

真实文件访问和模型调用位于 `src/workbench/`，宿主接入位于 `src/dsh/workbench.ts`。构建执行 `npm run build`，前端产物为 `dist/client.js`，第三方许可证为 `dist/THIRD_PARTY_NOTICES.txt`。
