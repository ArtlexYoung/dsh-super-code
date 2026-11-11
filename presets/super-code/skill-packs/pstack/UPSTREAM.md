# PStack Skills

Source: https://github.com/cursor/plugins/tree/main/pstack
Revision: `63912a91d52c43946f974f2aaf661334a6116a82`
Official plugin version: **0.15.36**. Author: Lauren Tan. License: [MIT](LICENSE).

Includes all 58 standard Skills from the Cursor plugin's `./skills/` declaration, with scripts, fixtures and references. The 558 original files remain unchanged for provenance. Guide docs, assets and agent definitions are retained as references. Cursor plugin manifests and the separate `automations/` distribution are excluded; DSH does not register Cursor agents or automations.

One setting enables this package, off by default. DSH's native filesystem provider parses the Skills and its conversation slash menu invokes user-invocable Skills. Upstream invocation flags are preserved: 57 Skills are user-only; `setup-pstack` also permits model invocation. With Matt Pocock Skills also enabled, native registration order selects Matt's `tdd` and `teach`; disabling Matt exposes PStack's versions. Project and user Skill precedence is unchanged.

DSH loads the generated `dsh/skills/` edition, targeting **DSH 0.2.1-alpha.1 and later**. The build-time adapter in `runtime/skills/pstack/` translates delegation/model contracts, flattens dependent dispatch to the root, uses exposed conversation history or explicit handoffs, and writes approved project Skills under `.dsh/skills/`. Setup writes optional project preferences instead of global rules. Bot UI workflows use this plugin's MCP connection. Long runs use real completion notifications and checkpoints instead of an invented loop scheduler. All 58 entrypoints, 23 playbooks and original invocation flags are retained.

No scripts, dependency installs, setup workflows or global rules run when the plugin starts or this switch changes. The conversion does not add a second agent runtime or rewrite model requests. Missing model diversity, history, browsers or other external capabilities must be reported explicitly. Workflows preserve host permissions and the user's authorization for external effects.

Explicit helper use may require Bun (poteto-mode's helper installs its frozen dependencies), authenticated gh/git (PR observation and workflows), mise/Java/TLC (statechart), or Pele (rendering). Statechart executes the caller's supplied view module. Review and authorize any installation, network, global configuration, Git write or removal through the host's normal permissions; enabling a package does not grant these permissions. External tools are not bundled or auto-installed. Updates ship with dsh-super-code.

See `distribution.json` for exact original source mapping and hashes, and `dsh/adaptation.json` for source/generated hashes and adaptation modes. `npm run skills:build` regenerates the edition; `npm run skills:check` verifies reproducibility, resources and known host dependencies. An upstream revision change requires review before regeneration. See `runtime/skills/pstack/README.md` for the upgrade procedure.
