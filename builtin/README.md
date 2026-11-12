# 内置 Skill

本项目内置及面向 DSH 适配的 Skill 源码统一放在 [`skills/`](skills/)，正文、参考资料、脚本和许可证随仓库公开。

| 包 | 可用内容 | 来源与许可证 |
|---|---|---|
| oil-ui | [设计流程与配套资源](skills/oil-ui/SKILL.md) | [来源与改动](skills/oil-ui/UPSTREAM.md) · [MIT](skills/oil-ui/LICENSE) |
| OpenSpec | [规范工作流](skills/openspec/skills/) | [来源](skills/openspec/UPSTREAM.md) · [MIT](skills/openspec/LICENSE) |
| Matt Pocock Skills | [工程工作流](skills/mattpocock/skills/) | [来源](skills/mattpocock/UPSTREAM.md) · [MIT](skills/mattpocock/LICENSE) |
| PStack | [DSH 适配版](skills/pstack/dsh/skills/)及[宿主操作说明](skills/pstack/dsh/DSH.md) | [来源与适配](skills/pstack/UPSTREAM.md) · [MIT](skills/pstack/LICENSE) |

设置按 Skill 和工作流分组：Skill 为 grill-me、OpenSpec、oil-ui，工作流为 Matt Pocock Skills、PStack。grill-me 独立开关复用 Matt 包中的 [grill-me](skills/mattpocock/skills/grill-me/SKILL.md) 与 [grilling](skills/mattpocock/skills/grilling/SKILL.md)，完整 Matt 包也包含这两项。开启后，完整资源同步到 DSH 用户 Skill 目录的 `dsh-super-code/` 下，保留包内路径关系，并由原生加载器实时提供启用项。开关不改动项目；项目和用户自己的 Skill 仍优先加载。旧用户预设保留原有资源，用于旧插件和独立加载；当前插件统一管理 DSH 目录中的副本。

PStack 的固定上游原件保存在 `skills/pstack/`，可运行的 DSH 适配版位于 `skills/pstack/dsh/`。薄适配器仍在 [`runtime/skills/pstack/`](../runtime/skills/pstack/README.md)：修改适配规则或覆盖文件后运行 `npm run skills:build`，通过 `npm run skills:check` 核对生成内容、资源引用及来源哈希。升级上游时先审查新版本，不直接修改固定原件进行适配。

npm 包包含可运行的内置 Skill、配套资源与许可证；PStack 的重复上游原件和构建期适配器保留在 Git，不重复装入 npm。各第三方内容遵循对应目录中的许可证，项目的适配代码按本仓库许可证公开。

## Bundled Skill sources

Bundled and DSH-adapted Skills are published under [`skills/`](skills/), with their instructions, resources, helpers, provenance, and licenses. The table above links to each package's usable entrypoints and source notes.

PStack's pinned originals remain in `skills/pstack/`; its runnable DSH edition lives in `skills/pstack/dsh/`. The build-time adapter stays in [`runtime/skills/pstack/`](../runtime/skills/pstack/README.md). Run `npm run skills:build` after adapter changes and `npm run skills:check` to verify generated files and resource references. npm ships the runnable edition; the upstream originals and build-time adapter stay in Git. Existing switches, invocation rules, project/user precedence, and legacy preset layouts are preserved.
