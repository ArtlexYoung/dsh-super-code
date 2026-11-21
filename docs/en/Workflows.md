# Workflows

Enable a package in Settings → Super Code → Preset Skills to reveal its independent conversation page: Matt Workflows, PStack Workflows or OpenSpec. Narrow windows may place the entry under More conversation views. Disabling the package hides the entry and preserves saved tasks and outcomes. oil-ui appears only in the Skill Library. The library lists enabled packages; the conversation preset must also allow Skills.

To get started, set a goal and choose what to work on. The page prepares a conversation draft; review and send it to let AI run the instruction. Each page follows its author’s working model:

- **Matt** uses warm paper task cards, forest-green ink, task numbers and status stamps. Separate layouts support multi-ticket builds, small changes, investigations and exploratory decisions. Click a card to inspect it, or use Work on this in chat to prepare its instruction and make it the current task.
- **PStack** uses a handwritten working journal. Choose the complete Feature or Refactoring playbook, record decisions and verification evidence by topic, and attach conversation files. Topics remain open for revisiting, without card-by-card acceptance. Save notes and open chat saves all edited topics in the current playbook together and includes the latest notes in the draft. Save notes also remains available for saving just the current topic.
- **OpenSpec** uses a blueprint-style change index and document reader. Browse active and archived directories under the conversation workspace’s `openspec/changes`, including proposals, designs and nested specification files. Progress comes from the selected change’s `tasks.md` checkboxes; files and checked tasks do not prove that implementation is verified. Refresh change files rereads the workspace. Implement the change appears next to the selected change. More actions contains Explore, Propose, Verify and Archive; each directly prepares its own native draft without a separate action-selection step. External stores are used through OpenSpec in the conversation and are not presented as local changes. Earlier manual outcomes remain accessible as historical notes.

The following task-card controls apply to Matt:

Author templates guide the work without locking every task into a fixed sequence. Add specific tasks, use the same Skill more than once, insert optional branches, reorder cards and edit prerequisites. Only explicit prerequisites block starting or accepting a task. Cycles are rejected without losing input. Changing an accepted task’s goal, output, Skill or prerequisites reopens it and retains the prior evidence for review. A workflow supports up to 64 cards. Filter by state or search task names and Skills.

Task cards show saved outcomes and blockers. Acceptance requires an outcome or an attached file and remains an explicit user action. Tool success, completed conversation todos and an idle AI do not automatically accept tasks. Reopening preserves the outcome. Only one task per workflow is current.

Matt's multi-session guidance uses fresh context for each implementation ticket; prototypes are optional. Configure a project's tracker and documents with setup-matt-pocock-skills when needed. PStack uses poteto-mode with the Feature or Refactoring playbook, with model setup as needed and decision records throughout longer work. sharpen improves prompts rather than refactoring code. Author notes link to the bundled version's primary source. Delegation, remote changes and publication still follow project and session authorization.

Every action that opens the conversation places the real /skill-name, goal and context in the native draft and preserves existing text for review and sending. Matt also includes the expected output and saved prerequisite outcomes. Rich drafts and sending are protected. Conflicting higher-priority Skills are identified and cannot be invoked through the bundled entry.

Conversation progress reads actual current tasks, next actions, todos, tool calls and file operations. Default Super Code PTC tasks are supported; native todo availability depends on tool configuration. Open recorded files in the enabled code workbench or attach them to a task. These records do not replace Git diffs or content verification.

Each author page restores its last-used workflow. Matt cards, PStack journal entries and page goals are saved in the current browser by conversation and workflow, retaining up to 32 conversations without cross-device synchronization. Stable task identities preserve Matt outcomes when reordering. Returning from the conversation, workbench or another workflow restores Matt’s selected card, filters and unfinished outcomes, PStack’s topic and unfinished notes, and OpenSpec’s selected change, document and reading position. This temporary state lasts for the current client; reloading restores explicitly saved records. Saving one task, topic or goal preserves other drafts; failed writes retain input, and refreshing restores successfully saved records. Pages share favorites and recent use without overwriting another page's work. OpenSpec reads artifacts and task progress directly from project files; earlier manual records remain available only as historical notes.

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
