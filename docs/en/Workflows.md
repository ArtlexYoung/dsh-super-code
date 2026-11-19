# Workflows

Open **Workflows** at the top of a conversation. Enable packages in **Settings → Super Code → Preset Skills** and use a conversation preset that allows Skills.

The **Quest map** presents four worlds. Select a landmark to inspect a real Skill, its goal and expected output. Confirm completion to light up the route, continue to the next quest, or reopen a completed checkpoint. Every checkpoint remains available to inspect.

Routes follow the bundled authors’ guidance. **The author’s method** explains the conditions and links to the source. This is Super Code’s visualization of those methods, not an author-provided task execution system.

| Route | Method |
| --- | --- |
| Matt · Single-session change | Use `grill-with-docs` in a repository, then `implement` and `retro`. Go directly to implementation when the requirements are clear. Implementation includes TDD at agreed seams and Standards + Spec review. |
| Matt · Multi-ticket build | `grill-with-docs` → `to-spec` → `to-tickets` → per-ticket `implement` → `retro`. Follow blocking dependencies, or use `implement-spec` to orchestrate the ready frontier on an integration branch. |
| Matt · Diagnose and fix | Establish a reliable failing feedback loop with `diagnosing-bugs`, diagnose and fix, then review and improve the agent environment through `retro`. |
| Matt · Large exploration | Use `wayfinder` to resolve decision tickets, then hand a clear path to `to-spec`. Exploration produces decisions rather than building the feature. |
| PStack · Feature | `poteto-mode` drives understanding, data and interface design, verifiable units, implementation/review and verification on the real artifact. |
| PStack · Refactoring | `poteto-mode` pins behavior, defines the target shape, subtracts and migrates, then proves equivalence. |
| OpenSpec | Explore, propose, implement, verify and archive. |
| oil-ui | Define the task, structure the interface, implement and inspect actual screens and interactions. |

**Tools when needed** contains conditional detours. Matt’s prototype answers a concrete design question; first-time project setup configures the tracker and document layout. PStack model setup is optional. Start `show-me-your-work` at the beginning of long work; `sharpen` rewrites a prompt rather than editing code. Delegation, remote writes and publication remain subject to the project and conversation authorization.

**Skill atlas** searches all bundled Skills by package, keywords, favorites or recent use, with 24 entries per page. Details show the original description, contents, version and source.

**Add to conversation draft** prepends the real `/skill-name`, adds the checkpoint goal and expected output, preserves existing text and returns to the conversation. You review and send it. Selecting another checkpoint using the same Skill updates its generated context. Drafts with attachments, references or an active send are protected. A bundled entry cannot invoke a name overridden by another project or package.

**Confirm quest complete** records your confirmation, not automatic execution or acceptance. Routes keep separate progress for each conversation, including after reload. Favorites, recent use and progress stay in this browser and do not sync across devices. Older progress transfers only to checkpoints with the same meaning, never by a reused numeric position.

The workbench **All commands** panel opens with `Ctrl+Shift+P` (`Cmd+Shift+P` on macOS). Search actions and open files, use arrow keys and Enter to select, or Escape to close. Unavailable actions remain disabled and unsaved files are marked.

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
