# Compatibility

[中文](../Compatibility.md) · English

Web is verified from Harness `0.1.5-alpha.1` through `0.2.1-rc.4`, with incremental rc.4 coverage detailed below. Official Desktop is verified through `0.2.1-rc.4` (x64 archive under Rosetta), and NEXT at `2.0.19-next` (bundled `0.2.1-rc.2`).

## Verified hosts

The 26 targets below were each checked as a full set for 0.3.6, 0.3.7, and 0.3.8.

| Host | Versions | Preset mechanism |
|---|---|---|
| Official Web | `0.1.5-alpha.1`, `alpha.2`, `rc.1`, `rc.2`, `rc.3` | Directory |
| Official Web | `0.1.6-alpha.1`, `alpha.2` | Directory |
| Official Web | `0.1.7-alpha.1`, `alpha.2`, `rc.1`, `rc.2` | Declarative |
| Official Web | `0.2.0-rc.1`, `rc.2` | Declarative |
| Official Web | `0.2.1-alpha.1` – `alpha.5`, `rc.1`, `rc.2` | Declarative |
| Official Desktop (macOS arm64) | `0.1.7-rc.1`, `0.1.7-rc.2`, `0.2.0-rc.1`, `0.2.0-rc.2`, `0.2.1-rc.2` | Declarative |
| DSH NEXT | `2.0.17-next` (bundled Harness `0.2.0-rc.2`) | Declarative |

The 0.3.8 incremental features were also checked on NEXT `2.0.19-next` (bundled Harness `0.2.1-rc.2`).

## How it was tested

- Each host runs in an isolated profile with pinned, audited host dependencies. Daily apps and configuration are untouched.
- A local deterministic program supplies model responses through the real host Agents and tools. **No external model is called**; these are not effectiveness evaluations.
- Web uses Chromium; native tests run on macOS arm64, with the official rc.4 x64 archive additionally tested under Rosetta, not Intel hardware.
- Every release also runs the full unit tests, type checking, build, and client syntax checks.

## Not covered

- Native Windows/Linux clients, Intel hardware, Safari-specific behavior
- Live model services, full upgrade and custom-configuration regression, every tool combination
- Narrow windows: at 440px the host sidebar leaves only 156px for the plugin, which is not counted as usable (the settings page without the plugin has the same problem)
- Confirm/cancel in the native directory picker (OS accessibility API timed out)
- Whether MCP clients can configure themselves from the Connection Prompt
- Cold-download installs for every version (tests reused cached host dependencies)

Declared dependency ranges are not test results. Unlisted versions need their own checks.

## Installation troubleshooting

Caret ranges on prerelease versions can resolve to other alpha/rc versions and mix host components. For example:

- Installing `0.1.6-alpha.1` pulled in alpha.2 and failed on a missing `watchUserPatches` export before the plugin loaded.
- Installing `0.1.7-alpha.1` pulled in rc.1.

The test environments use exact overrides, but that does not fix the upstream declarations. If you see similar errors, check the actually installed host component versions first.

Under npm rules, a range like `>=0.1.5-alpha.1 <0.3.0` excludes prereleases such as `0.1.6-alpha.1` and `0.2.0-rc.2`, so peer dependencies have to list each series separately.

`zod`, `js-yaml`, and `@modelcontextprotocol/sdk` are runtime dependencies and are not bundled. The published package contains only the plugin, public docs, and screenshots.

## 0.3.9 · 2026-10-27–28

These records distinguish the initial UI acceptance from the approval fix checked before npm publication. They do not mean all 26 full hosts above were rerun.

- **Initial UI acceptance**: the integrated candidate was labeled 0.3.8; the initial 0.3.9 runtime matched it byte for byte, with 284 passing tests. Official React, themes, and controls plus local fixture services passed 390 interaction groups across 30 frontend targets (Web `0.1.5-alpha.1`–`0.2.1-rc.4`, six official Desktop frontends, two NEXT frontends). Coverage includes languages, themes, autosave and failures, preset states, custom dropdowns, narrow layouts, running circles, and long lists. **Frontend checks are not full-host acceptance.**
- **Real UI and persistence**: official Desktop `0.2.1-rc.3`, NEXT `2.0.19-next`, and the full Web `0.2.1-rc.4` and official Desktop `0.2.1-rc.4` x64/Rosetta hosts added on October 28 passed Settings, real MCP SDK connections, workspace refresh and grant revocation, legacy memory CRUD/cancel, task projections/virtualization, and cold restart. No page script errors. The rc.4 host pins and audits 274 official components.
- **Fix regression**: fixed caller approval routing for child tools inside `run_code`. All 289 tests, type checking, build, and client syntax checks pass. Each of the 20 existing Web engine versions (minimum `0.1.5-alpha.1` through `0.2.1-rc.2`) plus `0.2.1-rc.4` passes 28 approval/deletion-protection checks.
- **Real approval paths**: the fixed package passes serial `run_code → bash` checks on Web `0.1.5-alpha.1`, Web `0.2.1-rc.4`, official Desktop `0.2.1-rc.3` / `0.2.1-rc.4` (x64/Rosetta), and NEXT `2.0.19-next`: exact arguments, approve/reject/cancel, cross-task isolation, stale-decision rejection, host confirmation with caller approval off, and capacity recovery. Approval deletes only a task-owned temporary file; rejection and cancellation preserve it.
- **rc.4 MCP flow**: both official Web and official Desktop x64/Rosetta additionally rechecked preset rename/reinstall with backup, legacy budget defaults and invalid/stale-write rejection, actual model/effort selection, explicit reuse and follow-ups, paged public history, directory consent/rejection, three-connection and three-task limits, cancellation recovery, child Agent history, and reconnect.
- All real hosts use local deterministic model responses; **no external model is called**. At most one sidebar section opens, Tasks by default, and all can collapse. Only legacy memory is included; no experimental memory, type switching, or migration.
- rc.4 Desktop uses the official mac-x64 nightly ZIP, with SHA-512 matching its feed and the original app signature verified, on macOS arm64/Rosetta. This is neither a relabeled rc.3 app nor a source-built substitute. The mac-arm64 feed still lists rc.3 and its rc.4 ZIP returns 404; **the native arm64 rc.4 archive is untested**. Native directory picking was not rerun.

## Per-release records

### 0.3.8 · 2026-10-26

- **Baseline**: all 26 targets pass MCP connection checks: settings persistence, real MCP SDK client authentication, native Super Code sessions, duplicate-request coalescing, follow-ups, and live cancellation.
- **Settings and directory consent**: minimum Web `0.1.5-alpha.1`, latest Web `0.2.1-rc.2`, Desktop `0.2.1-rc.2`, and NEXT `2.0.19-next`, one at a time: Home tab, directory checkboxes, autosave, token display, global directory consent with Settings closed (approval enables work in the new directory, rejection grants nothing), session list and disconnect in Connection. No page script errors.
- **Workspace directory fix**: Workspace path getters were not read, so valid directories showed as "unavailable" and MCP could not be enabled. Rechecked on the four hosts above with real workspaces whose names contain Chinese characters and spaces.
- **Session list and explicit reuse**: 253 tests pass. Only an incremental check on NEXT `2.0.19-next` (handshake finds six tools, six past tasks across four directories, the user's saved limit of 10 is kept); the 26 targets were not rerun.
- **Restart**: a cold restart keeps the switch, token, and task IDs. Unfinished tasks are not replayed or reported as succeeded.
- A conversation's online connection count only shows its currently linked connection (0 or 1). It is not a multi-client lease or a session lock.

### 0.3.7 · 2026-10-24

- 229 tests pass.
- Each of the 26 targets passes 25 deletion-protection and task-status engine checks (legacy settings, official-preset isolation, per-call approval, old/new journals, nested PTC, file attribution, and task status leaving model requests unchanged).
- Minimum/latest Web, Desktop `0.2.1-rc.2`, and NEXT `2.0.17-next` also pass 7 task-status page checks (including scrolling and keyboard access across 373/374-row lists) and 6 deletion-settings checks.
- Strict-mode approvals were answered by the test driver through the host approval service, not by manually clicking native dialogs.

### 0.3.6 · 2026-10-20

- Each of the 26 targets passes 6 UI/real-Agent checks and 1 cold-restart check; 195 tests pass.
- Older hosts without `ptcRuntime` receive no unsupported deadline fields.
- The tested candidate was labeled `0.3.5`; the released `0.3.6` only changes the package version and preset version markers. All other runtime files were compared one by one.

### Runtime budgets · 2026-10-19

- Each of the 26 targets passes 11 UI checks, 6 real-conversation checks, and 3 cold-start checks; 192 tests pass.
- All 20 Web versions pass control-boundary, scrolling, and hit-target checks at an 800px window.
- 15 Web versions and NEXT verify the default and an explicit shorter deadline with real Node PTC. The five `0.1.5` versions lack `ptcRuntime`, and their deadline fields are correctly disabled.
- Fixed the plugin reloading before the language preference was saved, which reverted the language.

### 0.3.5 · 2026-10-18

- Added `0.2.1-alpha.3`, `alpha.4`, `alpha.5`, `rc.1`, `rc.2`; all five pass Web/browser and native Skill loading checks.
- Desktop `0.2.1-rc.2` was downloaded from the official URL, SHA-512 verified, installed through the native plugin page, and passed the full UI checks.
- Fixed old task records disappearing after v4 log migration: v4 changes the source from `{kind: "plugin", plugin: "…"}` to `{kind: "plugin:…"}`, which the old reader skipped. Both forms are now recognized, and the task projection version goes from 1 to 2 so old caches replay. Verified with the official migrator and real v3 sessions.
- 173 tests pass.

### 0.3.4 · 2026-10-15

Docs and evaluation snapshot only. After building, all 112 runtime files are byte-identical to 0.3.3, so the 0.3.3 checks still apply. 171 tests pass.

### 0.3.3 · 2026-10-14

- Web `0.1.5-alpha.1`, `0.2.0-rc.2`, `0.2.1-alpha.2` pass installation, main/child Agents, memory, restart, and browser checks (unified sidebar, memory maintenance, animation, 320/400/560px widths and zoom).
- The frontend Skill passes six native loading paths on these three versions.
- Desktop `0.2.0-rc.2` upgraded from 0.3.2 to 0.3.3: the old preset kept its version with a mismatch notice, and updated after confirmed reinstall.
- 171 tests pass.

### 0.3.2 · 2026-10-11

- The same three Web versions and Desktop `0.2.0-rc.2` pass the UI refresh checks.
- The startup language-wait fix was rechecked only on the three Web versions and in unit tests; a native window screenshot was not obtained because the control API timed out.
- 158 tests pass.

### 0.3.1 · 2026-10-10

- All 15 Web versions (`0.1.5-alpha.1` – `0.2.1-alpha.2`) pass.
- Desktop `0.1.7-rc.1`, `rc.2`, `0.2.0-rc.1`, `rc.2` and NEXT `2.0.17-next` pass native-backend preset install, rename/reinstall, language, and version checks.
- Native PTC on `0.1.5-alpha.1`, `0.2.0-rc.2`, `0.2.1-alpha.2` verifies parallel reads, ordered writes, permission denial, and partial failure.
- The two `0.1.7` alpha versions lack the preset document reader, so ownership requires a unique, enabled Loader declaration.
- Desktop installers for earlier versions and `0.2.1-alpha.1/alpha.2` returned 404; their native windows are not verified.

### 0.3.0 · 2026-10-09

`0.1.5-alpha.1`, `0.2.0-rc.2`, `0.2.1-alpha.1` pass native PTC, main/child Agent memory, restart reads, and Playwright web checks. Intermediate versions were not rerun.

### 0.2.1 · 2026-10-08

- `0.2.0-rc.2` and `0.2.1-alpha.1` pass, including Safari checks and plugin disable/re-enable.
- From `0.2.1-alpha.1`, the host reads plugin names and descriptions from `<plugin>/locale/*.json`, and subpaths no longer read their own `package.json`. The plugin exports Chinese/English resources for the root, `/dsh`, and `/super-code`.
- The host split composer `stats` and removed the `invariant` export. The plugin uses neither, so no change was needed.
- `0.2.1-alpha.1` has no Desktop installer; native is not verified.

### 0.2.0 · 2026-09-30

Ten versions from `0.1.5-alpha.1` to `0.2.0-rc.2` pass Web/CLI and browser checks. Desktop `0.2.0-rc.2` passes native window checks, including Chinese/English switching and recovery after restart.

### 0.1.4

`0.1.5-rc.3`, `0.1.6-alpha.1`, `alpha.2`, `0.1.7-alpha.1`, `alpha.2`, `rc.1`, `rc.2` pass Web/CLI smoke checks.
