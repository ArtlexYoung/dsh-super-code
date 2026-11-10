# Matt Pocock Skills

Source: https://github.com/mattpocock/skills
Revision: `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`
Official plugin version: **1.3.2**. License: [MIT](LICENSE).

Includes the complete 27-Skill distribution from `.claude-plugin/plugin.json`, with all references, templates and agent metadata. The upstream category directories are flattened into `skills/` for the native DSH filesystem provider. Skill contents and invocation flags are unchanged. Unreleased `in-progress`, `misc` and repository development instructions are outside the official plugin distribution.

One plugin setting enables the entire package. No upstream installer, setup workflow or helper script runs on startup or when toggled. Skills load on demand and remain subject to the user's instructions, available host tools and DSH permissions. GitHub/GitLab workflows require the corresponding authenticated CLI and authorization for their writes; setup is an explicit user workflow. The wizard template may write `.env` and CI secrets when deliberately generated and run; it is never executed by the plugin. Updates ship with dsh-super-code, not an independent updater.

See `distribution.json` for the exact source-to-bundle mapping and SHA-256 hashes.
