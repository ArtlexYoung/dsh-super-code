# Changelog

[中文](../Changelog.md) · English

Versions are `major.performance.maintenance`. The second number changes when coding results or efficiency improve; the third covers fixes, UI, and compatibility. See [Compatibility](Compatibility.md) for what each release was tested on.

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

**Task status**: a read-only section in the sidebar, open by default. [Guide](UsageGuide.md#task-status)

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
