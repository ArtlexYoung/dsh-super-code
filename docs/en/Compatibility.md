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

`zod`, `js-yaml`, and `@modelcontextprotocol/sdk` are runtime dependencies and are not bundled. The Windows shell under development also packages separately licensed programs that run as subprocesses; see [runtime notes](../../runtime/windows/README.md) for sources, licenses, and corresponding source.

## Bundled Windows Bash: development checks

2026-11-02. Unreleased work; the historical release records below are unchanged.

- **Full Windows Web**: `0.2.1-rc.4` and `rc.5` pass checks with the real Loader, preset, Agent, PTC, and Windows ACL sandbox. `run_code → bash` passes approval, rejection, and cancellation through the actual DSH UI, plus disabled approvals, subsequent refusal, and background preflight refusal. The approved command exits 0 and writes exactly once; six unapproved paths leave no files, with the session remaining in workspace-write. Actual critical component versions are checked for both hosts.
- **Confined-mode boundary**: MSYS cannot create its internal named pipes in the official Windows confined sandbox. The plugin keeps Bash and rejects confined calls explicitly before process launch. Only the host-approved per-call `danger-full-access` policy is accepted; later commands still require approval, without changing session permissions or switching shells. Arrays, Chinese file I/O, and GNU grep are also verified in an explicitly full-access test session.
- **Environment comparison**: earlier Node 22.23.4 ARM64 produced fs.mkdir/ACL-lock EPERM even without loading the plugin. Those failures are retained. The complete approval and settings checks above use official Node 24.18.1 on the same VM, without ACL changes or disabling protection.
- **Windows scope**: a dedicated Windows 11 ARM64 VM; each payload passes seven execution checks. Bash/MSYS/grep use x64 emulation, not native ARM64 builds or native x64 hardware. Windows official Desktop and NEXT are untested.
- **Actual tool components**: 12 rc.4 checks pass for root/child restrictions, conversation-frozen shell choice, PowerShell selection, single execution, timeout/cancellation, deletion protection and per-call approval, host denial, background jobs, and disposal isolation. Real tools and Windows processes are used, without proving that Bash works in the complete confined host.
- **Fixed command suite**: 97/100 pass, including all original 45. Three remaining cases concern `.cmd` quoting and MSYS conversion of native `/` arguments. Fixtures and expectations are unchanged. No global path-conversion disable or failed-command replay.
- **Every published version**: all 24 npm releases from `0.1.5-alpha.1` through `0.2.2-alpha.2` pass 591 shell-scope, deletion-protection, and settings checks. Older versions use the actual SettingsProvider; newer ones use the actual Loader and SettingsForms with a temporary-file ConfigEditor fixture. Alpha uses its actual native executor, batch API, and session projections, and passes the full deletion suite. The 24 actual providers also pass 240 execution checks on macOS with stubbed sandbox denial. This is not acceptance of 24 complete Windows hosts.
- **Windows execution for every version**: all 24 versions also have separately installed and audited provider graphs on the Windows VM, passing 288 checks for actual Bash processes, Unicode, stdin/stderr, nonzero exit, timeout/cancellation, single side effects, truncation/full spill files, tool isolation, confined-mode preflight refusal, and environment masking. Each version runs in a fresh Node process. Approval-policy checks use component services, not a complete ACL host. The 11 runtime tests for corruption, concurrency, hard links/symlinks, and environment boundaries also pass on Windows.
- **Installation**: npm latest/next is `0.2.1-rc.5` and alpha is `0.2.2-alpha.2` at the time of checking. All 360 peer-range checks across 24 versions pass; the new alpha series and its Cordis/Schemastery prereleases are explicitly covered. The development package installs into an isolated alpha dependency graph; its package-root plugin activates through the published Loader and SettingsForms and supports settings reads/writes, with fixture ConfigEditor persistence.
- **Frontend and units**: 32 official static frontend targets (24 Web, eight Desktop/NEXT) pass 128 switch, autosave, error, and non-Windows disabling checks without page errors. RPC is a fixture, not live desktop acceptance. All 312 unit tests, type checking, build, and client syntax checks pass. Live Windows Web settings also pass both autosave directions, budget/platform preservation, tab switching, and cold restart.
- **Concurrency follow-up**: another 192 shell checks pass across all 24 versions, adding pending parent/child preparation, duplicate lifecycle events, parent/child failure followed by sibling recovery, and the actual offline preparation service's shared Promise, retry, and detached status snapshots. These checks run on macOS without executing Windows binaries or starting complete hosts.
- **Review fixes**: an Agent that fails preparation exposes neither shell and cannot be reactivated by a sibling's successful preparation. Children preserve a disabled parent choice with nonstandard providers. Malformed manifests fail before preparation; Windows PATH aliases follow Node precedence, and startup-script/exported-function environment variables are masked.
- **Size and model**: compressed payload assets total about 4.50 MB; the latest development package is about 9.1 MB including BusyBox corresponding source. Tests use fixed commands or local deterministic model responses, without external model calls or effectiveness evaluation.

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
