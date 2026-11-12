# OpenSpec Skills

Source: https://github.com/Fission-AI/OpenSpec
Revision: `579fcac57ae00c2dff38f971b6d88b6f1f098b8a`
Repository package version: **1.17.0**. License: [MIT](LICENSE).

Includes the complete 12-Skill static `skills/` distribution published for skills.sh. These are the upstream generated SKILL.md files, copied unchanged; no generator or installer is run. Repository-maintenance `.agents/skills` are not part of this end-user distribution.

One plugin setting enables the entire package. The matching OpenSpec CLI 1.17.0 is an exact runtime dependency installed with dsh-super-code. Enabled Super Code shell calls receive a process-local command shim using the host Node/Electron runtime; no global installation, system PATH change or project dependency is needed. Toggling or loading Skills runs no commands and creates no project files. Project initialization remains an explicit user action. Commands, artifact writes, spec synchronization and archive moves remain subject to DSH permissions and the user's authorization. This package does not add slash-command infrastructure or override host permissions. Updates ship with dsh-super-code.

See `distribution.json` for the source inventory and SHA-256 hashes.
