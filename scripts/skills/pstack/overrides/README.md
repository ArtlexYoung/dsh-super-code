# PStack on DSH

This is the DSH edition of PStack 0.15.36, for DeepSeek Harness 0.2.1-alpha.1 and later. Enable the PStack package under Super Code settings → Preset Skills, then choose a workflow from the native `/` menu. Enabling the package runs no setup or scripts.

Read [DSH host operations](DSH.md) when running a workflow. All 58 Skills and 23 poteto-mode playbooks are retained. [poteto-help](skills/poteto-help/SKILL.md) provides the entrypoint guide. [setup-pstack](skills/setup-pstack/SKILL.md) optionally records project-local workflow preferences; it does not configure global rules or host models.

The upstream source is preserved beside this generated edition. `adaptation.json` records each source hash and generated hash. The build-time adapter translates delegation, models, history, project Skill paths, long-running checkpoints and bot UI connections. Git/GitHub, browser/media and model-checking workflows still need their real external tools and the user's authorization. A missing capability is reported explicitly; no second host or simulated proof is substituted.

The docs/ directory retains upstream background material, with a DSH notice. Use the adapted Skills and DSH.md for executable procedures. Cursor/Claude installation, custom modes and automation instructions in those upstream guides do not apply to DSH.
