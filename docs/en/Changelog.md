# Changelog

[中文](../Changelog.md) · English

Versions are `major.performance.maintenance`. The second number changes when coding results or efficiency improve; the third covers fixes, UI, and compatibility. See [Compatibility](Compatibility.md) for what each release was tested on.

## 0.4.0 · 2026-11-12

**Task and memory tools**

- Simplified calls to `super_code_task` and `super_code_memory`, with action-specific field guidance, examples, and recovery instructions to reduce trial and error.
- Read a named project-memory topic without creating or switching the focused task. Writes retain source checks and revision-based conflict protection; historical information does not replace checking current code.

**Preset Skills and workflows**

- Added standalone grill-me alongside OpenSpec, oil-ui, Matt Pocock Skills, and PStack, grouped into Skills and workflows. All five default off, and saved choices are preserved.
- Enabled packages sync their complete resources to the DSH Skill directory and take effect in existing conversations. Each entry shows its version and a short usage hint, with a shortcut to open the directory. Existing user files and edits are protected; conflicts are reported and can be retried.
- Uses the native `/` menu and real Skill names. Search by package names such as `/pstack` or `/mattpocock`, then select a specific command. Disabled packages no longer supply commands or bodies; content already loaded into context is not withdrawn.
- OpenSpec's command environment ships with the plugin. Toggling a package does not initialize a project, install project dependencies, or modify project files; initialization runs only when requested.
- PStack retains upstream workflows and resources, with adaptations for DSH tools, child Agents, approvals, and image handling. Workflow adaptation targets Harness `0.2.1-alpha.1` and later.
- Bundled and adapted sources are published under `builtin/skills`, with upstream versions, provenance, and licenses.

**UI, compatibility, and fixes**

- Improved Settings autosave, draft retention across tabs, reconnection, concurrent edits, and recovery after failed saves.
- Improved task, execution, tool-status, and changed-file displays while retaining circular Agent nodes and the existing memory page.
- Fixed cancellation, reconnection, and repeated enable/disable issues in preset installation and uninstall recovery, MCP connections and approvals, deletion protection, and the Windows command environment.
- Updated compatibility records for newer Harness versions. See [Compatibility](Compatibility.md) for version and platform coverage, distinguishing SDK checks from full-host acceptance; interface tests do not establish that every workflow and platform has passed.

- Added version, license, and total npm download badges, with Star and npm trend charts refreshed daily.

See the [README](../../README.en.md) and [evaluation notes](EvaluationResults.md) for results and statistical limits. Skill installation, UI, and compatibility tests are not evidence of coding performance.

## 0.3.11 · 2026-11-06

**Uninstall recovery and preset management**

- Fixed Super Code conversations failing to continue after uninstall: registered conversations with matching ownership continue with the official Standard preset and show one switch notice. Existing parent/child history, model, directory, and permissions are preserved.
- Fixed stale deletion-protection rules in official Minimal after protection is disabled, official-preset coverage is removed, or the plugin is disabled or uninstalled. Changing levels no longer stacks duplicate rules. Existing summaries remain intact, followed by an explicit revocation notice.
- Fixed stale preset recovery during asynchronous reads, user selection changes, plugin re-enablement, and module replacement. Retired instances no longer overwrite newer records or take over the service again.
- Fixed installation/reinstallation rollback and locale synchronization overwriting external changes or losing ownership records. User edits and symbolic links are preserved, invalid records are rejected, and conflicting writes stop.

**Task sidebar, execution records, and usage**

- Fixed the task sidebar showing only the current request. It retains the latest 20 earlier requests and their recorded steps, with a notice when display limits are exceeded.
- Fixed unrendered execution details by using the host's Markdown and code components, preserving literal user/tool output and allowing long content to expand.
- Completed PTC child-tool call, result, failure, and terminal-error records, with correct interrupted status after crash recovery. Successful file-change evidence survives slow calls leaving the recent activity window.
- Fixed duplicate history reads, shifting boundaries, and lost reading positions during pagination and reconnection. Failed history reads can be retried, and closed views ignore late responses.
- Fixed inherited fork history being counted again in child and tree usage, and distinct model IDs being merged when they contain separator characters. Old caches are rebuilt.
- Fixed all sidebar sections collapsing: exactly one of Tasks, Collaborative execution, and Memory stays open, with Tasks as the default. Switching preserves reading positions and drafts.

**Settings, budgets, and memory**

- Fixed Home reverting to stale settings when a save succeeds but the following refresh fails. Reset now waits with controls locked during pending autosave, preventing duplicate submissions and revision conflicts.
- Fixed cancellation during a model-information lookup being ignored by automatic compaction or still allowing tool-record pruning. Existing compaction policy and budget defaults are preserved.
- Fixed retained legacy-memory drafts using a retired API after reconnection. Drafts are kept, explicit retries use the current API, and in-flight writes are not replayed automatically.
- Fixed empty topics continuing to consume the 200-topic allowance after their last entry is deleted. Capacity counts non-empty topics while retaining concurrent-edit checks, without adding content version history.

**MCP connection**

- Fixed asynchronous preparation using revoked directory access or disabled settings. Current authorization and cancellation are checked again before conversation creation, model selection, and prompt submission.
- Fixed `newConversation: false` creating a conversation without `taskId`. The caller must now choose a specific conversation first.
- Fixed failed create, continuation, or cancellation saves changing in-memory state prematurely, consuming capacity, or causing delayed cancellation. Preparation retains previous-request tracking; restart and reconnection never automatically replay saved requests.
- Fixed late approval being accepted after an approval wait is cancelled. One-time decisions recheck cancellation, directory access, and settings; undecided requests can return to DSH.
- Fixed directory requests being approved after path replacement, expiry during validation, or withdrawal. Reusing an old request cannot restore revoked access.
- Fixed symbolic-link aliases producing duplicate allowed directories that reappear after removal. Each real directory appears once, and unavailable entries remain removable.
- Added missing public PTC child-call records to `dsh_read`. Child-tool activity now counts toward progress observation instead of being mistaken for a long idle period.
- Fixed connection-capacity, port, and lock leaks during initialization, token rotation, shutdown, and unload races. Successful saves return the actual settings; cleanup failures are explicit and retryable without resending tasks.

**Commands and runtime**

- Fixed missed and false deletion detections in some shell wrappers, `find`, `xargs`, and PowerShell launch arguments. Existing protection levels and host approval still decide execution.
- Fixed Windows shell filters, official-budget adapters, and PTC wrappers surviving unload or overwriting other wrappers. Plugin resources are released after asynchronous initialization settles, preserving host and other-plugin state.

Fixes have regression checks scoped to their changes. Version contracts, frontend checks, and full-host acceptance are recorded separately; this does not mean every version on every platform has passed full-process tests. No new 100-task effectiveness evaluation was run.

## 0.3.10 · 2026-11-03

**Windows command environment**

- Bundles GNU Bash, required MSYS DLLs, BusyBox, and GNU grep, so Git is not required just to run Bash commands. Developer tools such as Git, Node, and Python still need separate installation.
- Bundled Bash defaults on. **Also apply to official presets** defaults off and covers Standard, PTC, and Create when enabled; Minimal retains its persistent terminal. Settings autosave, running Agents retain their selection, and children inherit it.
- Command environment switches are editable only on Windows hosts; other platforms show gray switches with an **Only available on Windows** tooltip. Fixed readiness alignment and long-version wrapping; tooltips follow light and dark themes.
- Fixed host-shell module resolution for legacy directory presets with nested dependencies, Windows PATH aliases and overrides of fixed BusyBox options, and failed parent/child Agents being reactivated by another conversation's recovery.
- Strict deletion protection recognizes MSYS `cmd.exe //c` and `//k` deletion commands. Confined Bash calls refuse before execution and require DSH approval for that invocation, without automatic permission changes or replay through another shell.

**Documentation and checks**

- Appended full Pro100 comparisons with official and third-party configurations to README, sorted by tasks passed, preserving the opening results and each batch's accounting conventions.
- Added Windows Web process records from the minimum version through rc.5, plus official rc.5 Desktop and NEXT Windows acceptance. Component and static-frontend checks remain separate. Historical native Windows desktops have not been accepted version by version; see [Compatibility](Compatibility.md) for full scope.
- The fixed command suite passes 97/100; remaining differences concern `.cmd` quoting and MSYS conversion of native arguments. This is not a complete Linux environment. No new 100-task effectiveness evaluation was run for this release.

## 0.3.9 · 2026-10-28

**UI**

- Refined Home, preset, budget, deletion-protection, and connection settings. Budgets autosave; invalid input and failed saves retain drafts with retry and reset controls.
- A compact task sidebar summarizes tool successes, failures, and running state, and shows workspace-relative file paths. Long lists remain virtualized.
- At most one of Tasks, Collaborative execution, and Memory opens at a time. Tasks opens by default; clicking the current heading collapses all. Circular nodes, running animations, top tooltips, and legacy memory CRUD are kept.
- Refined bilingual installation, usage, and evaluation docs; refreshed README screenshots; included the existing main-branch grading reconciliation while preserving original verdicts and correction evidence.

**MCP** (service still off by default)

- Added **Allow MCP to create conversations**, on by default; when off, explicit reuse is required. New conversations join an existing workspace, or register the directory under its own name, and use `[MCP]` titles.
- Query and select model/effort IDs, retaining the conversation's current/default choice when omitted. Selected choices persist in the conversation.
- Added `dsh_status`, `dsh_models`, `dsh_read`, and `dsh_approve` for capacity diagnosis, paged public history, and explicit failure/recovery guidance. Old failed child tasks no longer fail later continuations.
- Added **Allow caller approval**, off by default: decisions apply to one exact operation and fall back to DSH when unhandled. New directory access still requires user consent in DSH.
- Fixed MCP approval routing for child tools inside `run_code`: when caller approval is enabled, match the live Agent, call ID, and tool name to the actual arguments. Grants apply only to that call; rejection and cancellation clear the request. With the switch off, DSH still handles confirmation.
- Improved busy, retry, and disconnect handling; clarified stable request IDs, waiting for capacity, and releasing sessions with DELETE. Added the `super-code-mcp` CLI.

Only legacy memory is included, without experimental memory, type switching, or migration. Normal conversation prompts and model behavior are unchanged. No new 100-task evaluation was run; historical grading reconciliation is not a claim of better 0.3.9 results. See [Compatibility](Compatibility.md) for test scope.

## 0.3.8 · 2026-10-26

**MCP connection** (off by default). [Guide](UsageGuide.md#mcp-connection)

- Streamable HTTP MCP service on `127.0.0.1`, token-authenticated.
- Six tools: `dsh_sessions`, `dsh_run`, `dsh_wait`, `dsh_send`, `dsh_cancel`, `dsh_request_directory`. External clients can delegate DSH conversations, check progress, follow up, and cancel.
- Uses the host's model, preset, and permissions. Normal conversation prompts are unchanged and no permission is auto-approved.
- Call `dsh_sessions` first to see recent conversations and connection capacity per directory; the caller then explicitly picks reuse or new. The latest conversation is never reused automatically.
- Max connections and task concurrency are kept in sync, both defaulting to 3. Saved user values are kept.
- Working directories are a checkbox list refreshed on open. External requests for a new directory need your approval in a DSH dialog; revoked access can't be bypassed by reuse.
- Idempotent requests; interrupted tasks are marked, not replayed, after restart; bounded output; Git workspace observations.

**Settings**

- New Home tab: preset status and versions, deletion protection level, MCP switch, connected/past conversation counts.
- Client and linked-session details live in Connection; deletion protection has its own tab; preset configuration shows directly.
- Connection settings save automatically; the token is shown expanded.

**Fix**: workspace paths were read incorrectly, so valid directories showed as unavailable and the connection couldn't be enabled.

## 0.3.7 · 2026-10-24

**Deletion protection**: Off / Relaxed / Strict, Relaxed by default. [Guide](UsageGuide.md#deletion-protection)

- Relaxed: Agents are told to use recoverable `trash` by default, including in scripts; `rm` is fine when you explicitly ask.
- Strict: recognized permanent-deletion commands need your approval every time.
- Official presets have a separate switch, off by default. Legacy boolean settings and v4 logs are supported.

**Task status**: a read-only section in the sidebar, open by default. [Guide](UsageGuide.md#tasks)

- Shows recorded goals, step progress, actions, and successful file operations. Agent names appear only at task roots.
- Everything is expanded in a variable-height virtual list, with reading position, keyboard navigation, and running indicators.
- The Agent tree and memory library stay; the three sections switch exclusively.
- No change to prompts, model requests, tool definitions, or execution. File records aren't a full Git diff; missing or truncated data is labeled.

## 0.3.6 · 2026-10-20

Newer Harness versions cut budgets and results got worse. The plugin adds budget settings and restores the legacy budgets that did better in earlier Pro tests, with no manual setup. [Guide](UsageGuide.md#runtime-budgets)

- Defaults: full context window basis, compress at 80%, keep the last 16% verbatim, 8,192-token summary cap, one extra compaction attempt and one overflow retry; on hosts with the newer PTC, 600-second default and maximum deadlines.
- User values win; running Agents keep their config; unsupported deadline fields are disabled on old hosts; host ceilings always apply.
- Official presets still need opt-in.
- Settings split into Preset status / Context settings, with save, reset, and concurrent-edit conflict checks.
- Fix: language changes were lost when the page reloaded before the preference was saved.
- No historical scores were added or changed.

## 0.3.5 · 2026-10-18

- Supports Harness `0.2.1-rc.2`; minimum is still `0.1.5-alpha.1`.
- Fix: old task records disappeared after v4 log migration.
- Clearer official desktop install steps.

## 0.3.4 · 2026-10-15

- Adds official preset results on the same 100 tasks, plus how usage and time are counted.
- Adds the acknowledgements table and [detailed acknowledgements](Acknowledgements.md), included in the npm package.

## 0.3.3 · 2026-10-14

- Agent tree and memory library merged into one Super Code sidebar. Sections are exclusive; switching keeps state, filters, search, reading position, and drafts.
- Memory library supports add, edit, cancel, save, and confirmed delete. Manual entries are labeled and keep only current content; failed saves keep your input; concurrent overwrites are blocked.
- Clearer running animation; fixed overlapping halos, labels, and connectors.
- Bundled on-demand frontend Skill (alignment, comfortable controls, responsive layout, interaction states, browser checks). Existing presets need confirmed reinstall to get it.
- Cleaner bilingual install notes, evaluation purpose, and version rules.

## 0.3.2 · 2026-10-11

- Unified look for preset settings, Agent tree, and memory library; circular nodes kept. Toolbar shows "Collapsed" / "Organize" labels; button tooltips sit above; time/sort use keyboard-accessible dropdowns.
- Agent details show user messages, replies, and expandable tool calls, for both old and new logs.
- Memory library adds topic navigation, filtering, and related entries.
- Fixes: dropdown options unclickable when newer sidebars took focus; startup now waits for the host language, so presets don't resync and reload repeatedly.

## 0.3.1 · 2026-10-10

- Settings always expanded; plugin and preset versions shown separately, with a notice when they differ or aren't recorded.
- Declarative hosts get install, confirmed reinstall, rename, backup restore, and default-name language sync.
- Fixes: desktop management API resolved from the wrong place; Esc closed Settings after removing a row in the confirm dialog.
- Tested on 15 Harness versions (`0.1.5-alpha.1` – `0.2.1-alpha.2`) and 4 macOS arm64 desktop builds.

## 0.3.0 · 2026-10-09

- Harness-native PTC for combined tool calls and parallel independent reads (Batch.3).
- Memory activity now recorded for calls inside batches.
- Refreshed full 100-task results and usage guide.

## 0.2.1 · 2026-10-08

- Adapts to the new plugin metadata reader in Harness `0.2.0-rc.2` / `0.2.1-alpha.1`, with Chinese/English display resources.
- Native desktop for `0.2.1-alpha.1` not verified.

## 0.2.0 · 2026-09-30

- Layered task memory; new memory library and per-Agent memory activity.
- UI follows the Chinese/English setting.
- Adapted to Harness `0.1.5-alpha.1` – `0.2.0-rc.2`; official desktop checked.

## 0.1.4

- Supports both preset mechanisms: directory install on older hosts, bundle declaration on newer ones; Settings adapts to the host. The declarative path doesn't yet support rename, reinstall, or name language sync.
- Wider Harness dependency range; bilingual docs.
- Isolated smoke tests on 7 versions (`0.1.5-rc.3` – `0.1.7-rc.2`); no native desktop, external models, or new scores.

## 0.1.3

- Default names and descriptions follow the UI language; upgrades only touch fields you haven't changed.
- Install names support Chinese and spaces; confirmed reinstall with a new name and identifier keeps the old directory as backup.

## 0.1.2

Better on-demand guidance, failure diagnosis, and state recovery; minimum Harness `0.1.5-alpha.1`.

## 0.1.1

Fixes presets missing after install on some hosts; adds a collapsible status panel and custom-name install; supports Harness `0.1.5-rc.1`.

## 0.1.0

First unified Super Code coding preset, with multi-Agent tree, task memory, and usage display.

## 0.0.9

Package renamed to `dsh-super-code`; switches to Harness-native task memory and on-demand specialist guidance.

## Earlier (`dsh-super-agent`)

These belong to the predecessor `dsh-super-agent`; `dsh-super-code` never shipped these versions. There is no 0.0.8.

- **0.0.7**: unified Super Code preset, Agent graph, compact task context.
- **0.0.6**: first unified preset; better planning and model selection; Harness packages as peer deps.
- **0.0.5**: Harness Web support, host UI integration, model-pool routing; simple tasks plan only when needed.
- **0.0.4**: bounded multi-turn task context, repair hints on failed checks, evaluation aggregation.
- **0.0.3**: docs cleanup, Apache-2.0 license.
- **0.0.2**: typed task and metric protocols, first evaluation tool.
- **0.0.1**: scenario presets and installable plugin package.
