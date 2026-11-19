# 工作台字体

内嵌 JetBrains Mono 可变普通体与可变斜体，构建时转为 data URL，主界面和独立窗口均可离线使用。使用独立的 CSS 字体家族名 `Super Code JetBrains Mono`，避免被本机其他版本覆盖；原始字体文件未修改。

两份 WOFF2 共 236832 字节，覆盖 100–800 字重，不包含中文字形。中文字形由设置中的中文回退字体或系统字体提供。

来源固定为 [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono/tree/19371302b95d218af43299bce79ddbddd0bc364d)，文件路径、上游提交与完整性哈希见 [upstream.json](upstream.json)。版权归 JetBrains Mono Project Authors，字体遵循 [SIL OFL 1.1](OFL.txt)，不改变插件其他代码的许可证。

系统字体枚举只取得家族名称，并在当前客户端验证本机可用性。Chromium 授权后可读取完整本机字体列表；不支持该浏览器接口或远程连接时，使用宿主候选和常用字体检测，不保证枚举出所有客户端字体。
