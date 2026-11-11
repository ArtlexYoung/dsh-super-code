# Acknowledgements

[中文](../Acknowledgements.md) · English

Thanks to these projects and their maintainers. Each section describes how the project is used in this plugin.

## DeepSeek Harness

[Source](https://github.com/deepseek-ai/deepseek-harness) · [MIT](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE)

The host the plugin runs on.

- Agents, model routing, sessions, tools, permissions, cancellation, persistence, subagents, and usage records all come from the host. Batched calls use native PTC.
- The preset uses the official compaction, file, search, shell, Web, subagent, and Skill plugins.
- The UI uses the host's React, theme variables, Remotes, settings pages, sidebars, and session projections; Agent details follow the host's message and tool-call presentation.
- Cordis (plugin lifecycle and composition) and Schemastery (configuration) are also provided by the host.

Implementation: [preset composition](../../presets/super-code/agent.cordis.yml), [declarative preset](../../cordis.patch.yml), [host integration](https://github.com/ArtlexYoung/dsh-super-code/blob/main/src/dsh/index.ts), [client](../../client/index.js)

## ZCode

[Source](https://github.com/zai-org/ZCode) · [Apache-2.0](https://github.com/zai-org/ZCode/blob/main/LICENSE)

For the 0.3.2 UI work we studied its [DESIGN.md](https://github.com/zai-org/ZCode/blob/main/DESIGN.md), themes and type scale, Button / Input, settings groups, segmented tabs, search fields, confirmation dialogs, and WorkflowAgentPill. They helped us shape compact layouts, hierarchy, grouping, and interaction states.

Design reference only, not a dependency. The UI is built on Harness's public APIs, and the execution tree keeps its own circular nodes.

## Agent Skills

[Specification](https://agentskills.io/specification) · [Repository and license](https://github.com/agentskills/agentskills)

The bundled frontend Skill follows this format: `SKILL.md`, YAML metadata, and a `references/` directory. The model sees only the name and summary until the Skill is needed, then loads the body and relevant references. It coexists with project and user Skills. Parsing and loading use Harness's native support.

Implementation: [oil-ui](../../presets/super-code/skills/oil-ui/SKILL.md)

## oil-ui

[Source](https://github.com/oil-oil/oil-ui) · [MIT](../../presets/super-code/skills/oil-ui/LICENSE) · [Pinned version and adaptations](../../presets/super-code/skills/oil-ui/UPSTREAM.md)

Thanks to oil-oil for this open-source frontend design Skill. The plugin bundles oil-ui 0.32.0's workflow, references, comparison page, and helper scripts, loaded on demand through Harness's native Skill mechanism in place of the previous custom frontend Skill.

The bundled copy is pinned to upstream commit `0d64a00f3a5c45bf7a30d35bded9b7c0fdff2128`. Its only adaptation replaces the standalone update entrypoint with plugin-managed updates; neither the upstream installer nor a paid plugin is included. The MIT license and original copyright notice are preserved in the package.

The comparison page also bundles [Instrument Serif](https://github.com/Instrument/instrument-serif), under [SIL OFL 1.1](../../presets/super-code/skills/oil-ui/assets/fonts/instrument-serif/OFL.txt), for comparison-page typography.

## SWE-bench

[Source and grader](https://github.com/SWE-bench/SWE-bench) · [Dataset](https://huggingface.co/datasets/princeton-nlp/SWE-bench) · [MIT](https://github.com/SWE-bench/SWE-bench/blob/main/LICENSE)

Real software-engineering tasks, environments, and reproducible grading. The 33 hard tuning tasks are this project's own selection from the official dev split.

## SWE-bench Pro

[Source and grader](https://github.com/scaleapi/SWE-bench_Pro-os) · [Dataset](https://huggingface.co/datasets/ScaleAI/SWE-bench_Pro) · [MIT](https://github.com/scaleapi/SWE-bench_Pro-os/blob/main/LICENSE)

Thanks to Scale AI and the maintainers for long-horizon tasks and grading tools. hard-100 is this project's selection name, not an official hardest-100 list, and is used only for evaluation and bug investigation, never for tuning. [Evaluation results](EvaluationResults.md)

Both evaluation code bases are MIT, but datasets, tested repositories, images, and other assets have their own terms that the code license does not cover.

## Runtime dependencies

- [js-yaml](https://github.com/nodeca/js-yaml) (MIT): YAML parsing
- [Zod](https://github.com/colinhacks/zod) (MIT): data and input validation
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk): MCP connection

Full list in [package.json](../../package.json); locked versions in [package-lock.json](https://github.com/ArtlexYoung/dsh-super-code/blob/main/package-lock.json).

## License

This project uses [Apache-2.0](../../LICENSE). The projects, specifications, design resources, and datasets above keep their own copyrights and licenses as stated upstream (LICENSE, NOTICE, and dataset docs). A design reference does not imply a dependency, endorsement, or feature equivalence.

## OpenSpec

[Source](https://github.com/Fission-AI/OpenSpec) · [MIT](../../presets/super-code/skill-packs/openspec/LICENSE) · [Upstream](../../presets/super-code/skill-packs/openspec/UPSTREAM.md)

Thanks to the OpenSpec contributors for the complete specification-driven workflow Skill distribution. The plugin preserves the original prompts and licenses and loads them on demand through DSH.

## Matt Pocock Skills

[Source](https://github.com/mattpocock/skills) · [MIT](../../presets/super-code/skill-packs/mattpocock/LICENSE) · [Upstream](../../presets/super-code/skill-packs/mattpocock/UPSTREAM.md)

Thanks to Matt Pocock and contributors for the complete engineering and productivity Skill distribution. The plugin includes the official plugin inventory with its references, templates and invocation rules; it does not run setup on activation.

## PStack

[Source](https://github.com/cursor/plugins/tree/main/pstack) · [MIT](../../presets/super-code/skill-packs/pstack/LICENSE) · [Upstream](../../presets/super-code/skill-packs/pstack/UPSTREAM.md)

Thanks to Lauren Tan and the Cursor plugin contributors for PStack. The plugin preserves its 58 standard Skills, invocation rules, references and scripts, loaded on demand through native DSH Skills and slash commands. It does not register Cursor automations or run setup on activation. Some workflows still require Cursor capabilities or external tools; see the upstream notes.
