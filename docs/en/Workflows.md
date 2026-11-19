# Workflows

Open **Workflows** at the top of a conversation to browse the four bundled Skill packages. Disabled packages remain visible. Enable a package in **Settings → Super Code → Preset Skills**, and use a conversation preset that allows Skills.

Suggested routes cover requirements, implementation, diagnosis, research, continuous development, code refinement and UI design. Each step opens the actual Skill, its purpose, contents, version and source. Search the full catalog by package, keywords, favorites or recent use; pages contain at most 24 entries.

**Add to conversation draft** prepends the actual `/skill-name`, preserves existing text and returns to chat for you to review and send. Drafts with attachments or references, and drafts being sent, cannot be changed here. If the host resolves the same name to another package or project, the bundled entry explains the conflict and cannot be invoked.

Route progress records your manual confirmations. It does not certify AI execution or successful validation. Favorites, recent use and conversation progress are stored only in the current browser and do not sync between devices.

The code workbench's **All commands** combines existing actions and open files. Press `Ctrl+Shift+P` (`Cmd+Shift+P` on macOS), search, select with the arrow keys and press Enter. Escape closes it. Unsaved files and unavailable actions are identified.

## Maintaining bundled resources

Run from a clean source checkout with Node.js 22+, npm, Git, authenticated GitHub CLI and installed development dependencies:

```sh
npm run updates:check
npm run updates:apply -- --branch chore/bundled-updates
npm run updates:apply -- --branch chore/oil-and-marked --only oil-ui,dependencies:marked
```

Use `npm run updates:install` to prepare a maintenance environment. It temporarily matches development peers to the existing locked DSH test versions, then restores the public compatibility metadata on success or failure. It does not ignore peer conflicts, and verifies that host dependency versions have not changed.

Checking writes a report without changing product files. Applying creates or reuses an isolated local branch. A local commit is created only after building, type checking, testing and distribution checks succeed. The command never pushes, merges or publishes. Repeating it from the same base does not commit already applied updates.

Skills use fixed sources, revisions and file hashes. Only required, changed content is downloaded. Upstream installers are not executed, and oil-ui's standalone updater remains excluded. Compatible npm updates check direct and changed transitive licenses, sources, integrity and lifecycle scripts. Host compatibility versions are excluded.

Targets requiring review are reported while other eligible targets continue. PStack requires review of its DSH adapter before changing the pinned revision. OpenSpec Skills must match the bundled CLI; major upgrades require coordinated adaptation. Failed validation leaves an uncommitted candidate and logs. Existing candidate edits are never overwritten. Inspect interrupted candidates and reports before removing a reported stale lock.

Reports default to `.development/updates/run-*/report.json`; use `--report` to select another path. Reports include local paths and should not be published as documentation.

The included weekly GitHub Actions workflow becomes scheduled after reaching the default branch. It only checks by default. Set repository variable `SUPER_CODE_AUTO_UPDATE=true`, or select `apply` on a manual run, to push verified updates to `chore/bundled-updates-<run-id>`. It never merges or publishes. Reports remain available as run artifacts.
