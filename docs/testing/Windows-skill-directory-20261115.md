# Windows Skill目录打开修复

基线ec60e10；改动仅src/dsh/skill-directory.ts和对应测试，无根配置、公共签名或依赖变更。

官方Windows Desktop 0.2.2-rc.2运行于Windows 11 ARM64虚拟机（x64程序由系统模拟）。隔离进程PATH不含WindowsPowerShell目录，系统powershell.exe仍存在。原按钮回执为Cannot open Skill directory；绝对路径Invoke-Item成功。修复直接按SystemRoot/WINDIR定位系统PowerShell，保持LiteralPath转义。

先失败回归：Directory-regression-before.log。修后20项定向、1179项全测试、类型检查、构建、2项分发检查通过，无失败/跳过。Windows同一入口回执opened:true、无错误提示，见Windows-directory-fixed-ui-r2.json。

首次从工作区打包的85730877包含其他会话README修改，仅用于验证，不作为交付包。随后从HEAD干净导出、只加入本修复构建2ab11ac878d87bd44ce07e7e9c01a325c669b5db907aaebb7ff342f24452d309包。与首次修复包逐文件比对仅两份README不同，运行内容完全相同；未改其他会话文件。原6e44包的其余运行文件与新包相同，变化是skill-directory.js及其映射文件；新增argparse/which同版本CHANGELOG不涉及运行变更。

测试技能SKL-07已加入PowerShell不在PATH场景；quick_validate.py通过。无推送发布。

最终干净包已实际解包到Windows本轮独立node_modules，冷启动后同一按钮回执opened:true（Windows-directory-clean-ui.json）；加载的opener SHA为33a32b8ea93240f3d67790ebc737255b158466f3384751e4e1b30a8415630fb4。没有写入上批junction目标目录。最终干净源码分发2检查再次通过。
