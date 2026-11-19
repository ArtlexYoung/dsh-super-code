# 系统窗口

这里的启动器只提供系统窗口和 WebView，编辑、文件、Git、模型操作仍由 DSH 原页面处理。不会复制 Electron，也不自动安装系统组件；不可用时保留内嵌工作台。

| 平台 | 包内启动器 | 使用的系统组件 |
|---|---|---|
| macOS | 通用应用，arm64 / x86_64 | Cocoa、WKWebView |
| Windows | .NET Framework 应用，含三种架构的加载器 | .NET Framework 4.6.2 以上、WebView2 Runtime |
| Linux | arm64 / x86_64 可执行文件 | GTK 3、WebKitGTK 4.1 或 4.0、图形会话 |

源码与可执行文件均随插件分发。Windows 的 SDK 固定来源见 `win32/WebView2.version.json`，分发许可证见 `win32/WebView2.LICENSE.txt`；系统 WebView 运行库不随插件分发。

重新构建启动器：

```sh
# macOS：需要 Xcode 命令行工具
node runtime/workbench/native/build-macos.mjs

# Linux：在对应架构上编译，只链接系统 libc / libdl
sh runtime/workbench/native/build-linux.sh
```

```powershell
# Windows：参数指向已解压的 Microsoft.Web.WebView2 SDK
./runtime/workbench/native/build-windows.ps1 -WebView2Sdk <SDK目录>
```

`npm run build` 复用这些已构建的文件，生成独立窗口前端，不在安装时下载运行库或要求用户具备编译环境。
