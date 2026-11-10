# OpenSpec Skills

Source: https://github.com/Fission-AI/OpenSpec
Revision: `579fcac57ae00c2dff38f971b6d88b6f1f098b8a`
Repository package version: **1.17.0**. License: [MIT](LICENSE).

Includes the complete 12-Skill static `skills/` distribution published for skills.sh. These are the upstream generated SKILL.md files, copied unchanged; no generator or installer is run. Repository-maintenance `.agents/skills` are not part of this end-user distribution.

One plugin setting enables the entire package. It does not install the OpenSpec CLI or initialize a project. The workflows require an OpenSpec CLI compatible with this pinned revision in the project environment, and project initialization remains an explicit user action. Commands, artifact writes, spec synchronization and archive moves remain subject to DSH permissions and the user's authorization. This package does not add slash-command infrastructure or override host permissions. Updates ship with dsh-super-code.

See `distribution.json` for the source inventory and SHA-256 hashes.
