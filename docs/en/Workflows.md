# Workflows

Enable a package in Settings → Super Code → Preset Skills to reveal its independent conversation page: Matt Workflows, PStack Workflows or OpenSpec. Narrow windows may place the entry under More conversation views. Disabling the package hides the entry and preserves saved tasks and outcomes. oil-ui appears only in the Skill Library. The library lists enabled packages; the conversation preset must also allow Skills.

Matt uses paper task cards, a focused single-change page, an investigation desk and a decision frontier. PStack Feature separates understanding and design from implementation and evidence. Its Refactoring page keeps the behavior baseline beside the new structure and equivalence evidence. OpenSpec groups document cards into proposal, implementation and verification folios.

Author templates guide the work without locking every task into a fixed sequence. Add specific tasks, use the same Skill more than once, insert optional branches, reorder cards and edit prerequisites. Only explicit prerequisites block starting or accepting a task. Cycles are rejected without losing input. Changing an accepted task’s goal, output, Skill or prerequisites reopens it and retains the prior evidence for review. A workflow supports up to 64 cards. Filter by state or search task names and Skills.

Task cards show saved outcomes and blockers. Acceptance requires an outcome or an attached file and remains an explicit user action. Tool success, completed conversation todos and an idle AI do not automatically accept tasks. Reopening preserves the outcome. Only one task per workflow is current.

Matt's multi-session guidance uses fresh context for each implementation ticket; prototypes are optional. Configure a project's tracker and documents with setup-matt-pocock-skills when needed. PStack uses poteto-mode with the Feature or Refactoring playbook, with model setup as needed and decision records throughout longer work. sharpen improves prompts rather than refactoring code. Author notes link to the bundled version's primary source. Delegation, remote changes and publication still follow project and session authorization.

Prepare task instruction places the real /skill-name, task goal, expected output and saved prerequisite outcomes in the native draft, preserves existing text and returns to the conversation for review and sending. Rich drafts and sending are protected. Conflicting higher-priority Skills are identified and cannot be invoked through the bundled entry.

Conversation activity reads actual current tasks, next actions, todos, tool calls and file operations. Default Super Code PTC tasks are supported; native todo availability depends on tool configuration. Open recorded files in the enabled code workbench or attach them to a task. These records do not replace Git diffs or content verification.

Each author page restores its last-used workflow. Task definitions, goals and outcomes are saved separately per conversation and workflow. Stable task identities retain outcomes when reordering. Unsaved inputs remain while switching tasks; saving one field does not discard another draft. Failed writes preserve input and state. Independent pages share current preferences without overwriting another page's saved work. Local browser storage retains up to 32 conversations and does not synchronize across devices. Earlier confirmations migrate without inventing artifacts.

The Skill Library supports package, keyword, favorites and recent-use filtering, with 24 entries per page. Task cards are local working records; they do not automatically create GitHub/GitLab issues, schedule AI work or verify file contents. Skills and the host perform execution.

The workbench command palette opens with Ctrl+Shift+P (Cmd+Shift+P on macOS). Search existing commands or open files, select with arrow keys and Enter, and close with Escape. Unsaved and disabled states remain visible.

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
