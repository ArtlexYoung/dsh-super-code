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

Implementation: [super-code-frontend](../../presets/super-code/skills/super-code-frontend/SKILL.md)

## Apple Human Interface Guidelines

[Layout](https://developer.apple.com/design/human-interface-guidelines/layout) · [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) · [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) · [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback) · [Terms](https://developer.apple.com/support/terms/)

The frontend Skill adopts these principles: alignment expresses relationships, layouts adapt to containers and type size, control size and spacing reduce effort, interactions are predictable, feedback is close and proportionate. They're organized into three references: visual design, interaction states, and browser validation.

Only principles are borrowed; each product keeps its own visual style. Native platform units aren't treated as CSS pixels, and materials, fonts, and icons aren't used as a template.

## W3C WCAG 2.2

[WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

When checking Web controls, the frontend Skill uses 2.5.8's 24 × 24 CSS pixel criterion and its spacing exceptions, alongside real click, keyboard, and content checks. Passing the numbers does not make the whole interface accessible.

Implementation: [interaction states](../../presets/super-code/skills/super-code-frontend/references/interaction-states.md), [browser validation](../../presets/super-code/skills/super-code-frontend/references/browser-validation.md)

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
