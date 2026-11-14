# 代码工作台

内置模块源码随插件公开。使用说明见 [代码工作台](../../docs/CodeWorkbench.md)。

- `components/`：工作台三栏页面、可调文件区、彩色图标、文件菜单、设置、页面内浮窗和选区对话。
- `editor/`：CodeMirror 配置、语言、导航、补全和外观。
- `analysis/`：后台线程中的基础源码声明、引用和文档索引。
- `assistant/`：选区对话、标记、取消及替换检查。
- `git/`：双引擎 Git 管理、两侧栏共享的修改文件统计、虚拟文件列表与差异对比。
- `reading/`：工作台内的学习侧栏、阅读流程与引用定位。
- `controller.js`：每个会话的缓冲区、文件切换、保存和索引。
- `buffer.js`：分块文档的编辑状态与按需全文读取。
- `layout.js`：文件目录与右栏宽度、文件区高度和折叠状态记忆。
- `remote.js`：与宿主通信的公开描述。

真实文件访问和模型调用位于 `src/workbench/`，宿主接入位于 `src/dsh/workbench.ts`，失效目录续聊位于 `src/dsh/workbench-directory.ts`。构建执行 `npm run build`，前端产物为 `dist/client.js`，第三方许可证为 `dist/THIRD_PARTY_NOTICES.txt`。

文件变更由 `src/workbench/operations.ts` 统一校验，系统回收站由 `src/workbench/trash.ts` 调用；不覆盖同名目标，不使用永久删除兜底。

右侧当前对话复用 `client/index.js` 的消息渲染与公共 `SessionEventStream`，普通草稿及发送使用宿主 `useInput/inputActions`，不重复挂载宿主输入编辑器。连续工具记录复用任务侧栏的计数摘要，隐藏零标签；问题导航只覆盖已加载记录，保留历史分页。
