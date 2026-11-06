# Compatibility

[中文](../Compatibility.md) · English

Web is verified from Harness `0.1.5-alpha.1` through `0.2.1-rc.4`, with incremental rc.4 coverage detailed below. Official Desktop is verified through `0.2.1-rc.4` (x64 archive under Rosetta), and NEXT at `2.0.19-next` (bundled `0.2.1-rc.2`).

The bundled Windows Bash in 0.3.10 also passes full-process Windows acceptance on official Desktop `0.2.1-rc.5` and NEXT `2.0.21-next` (bundled `0.2.1-rc.4`), within the scope below.

The 0.3.11 fixes add staged version-contract and official-frontend checks through `0.2.2-alpha.3`. Full-host coverage is recorded separately in the 0.3.11 section below.

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
- Web uses Chromium; historical native tests run on macOS arm64, with the official rc.4 x64 archive additionally tested under Rosetta. Windows Bash checks also run actual x64 desktop releases in a Windows 11 ARM64 VM, not Intel hardware.
- Every release also runs the full unit tests, type checking, build, and client syntax checks.

## Not covered

- Native Linux clients, Intel hardware, Safari-specific behavior; Windows desktop coverage is limited to the Bash checks below, without rerunning every plugin feature on each version
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

`zod`, `js-yaml`, and `@modelcontextprotocol/sdk` are runtime dependencies and are not bundled. The Windows shell also packages separately licensed programs that run as subprocesses; see [runtime notes](../../runtime/windows/README.md) for sources, licenses, and corresponding source.

## 0.3.11 · 2026-11-06

This release includes successive fixes from November 4–6. Results below apply to the code tested at each stage; full-host results from an earlier development package are not presented as a complete platform rerun of the final release package.

- **Release candidate**: all 560 tests, type checking, build, and client syntax checks pass. The package, lockfile, directory preset, and declarative preset all use 0.3.11.
- **Version contracts and frontends**: 26 exact published Harness versions, from `0.1.5-alpha.1` through `0.2.2-alpha.3`, cover the listed 0.1.5, 0.1.6, 0.1.7, 0.2.0, and 0.2.1 alpha/rc releases, plus `0.2.2-alpha.2`, `0.2.2-rc.1`, and `0.2.2-alpha.3`. Change-specific checks cover Session/LLM recovery, task projections, usage, compaction cancellation, and legacy memory. Frontend checks use actual official React and plugin components with fixture Remote boundaries; they are not 26 complete hosts.
- **Recent targeted evidence**: PTC history has 26-version contract and frontend checks; fork usage has 157 contract checks across 26 versions; compaction cancellation has 170 checks; directory aliases have 156 frontend checks; memory capacity has 156 storage-contract checks plus frontend interactions on the earliest/latest versions; settings reset has 182 frontend checks across 26 versions. All pass. Counts from separate batches are not added up as distinct hosts.
- **Full Web and macOS hosts**: uninstall-recovery and MCP lifecycle fixes were checked on Web `0.1.5-alpha.1`, `0.2.1-rc.5`, `0.2.2-rc.1`, and `0.2.2-alpha.3`, official macOS Desktop `0.2.1-rc.5`, and NEXT `2.0.19-next` (bundled `0.2.1-rc.2`). Later task-history/rendering fixes additionally checked real tools, three turns, and cold restart on the earliest/latest Web hosts and official macOS rc.5. Subsequent usage, compaction, directory, memory-capacity, and reset fixes did not rerun the full desktop matrix.
- **Windows and Linux**: an earlier stage ran actual official x64 Desktop rc.5 and NEXT `2.0.21-next` (bundled rc.4) in a Windows 11 ARM64 VM, with 37 passing groups each for MCP, Bash, PowerShell, deletion protection, physical uninstall, cold restart, and history continuation. All 118 Windows regression tests pass, with three POSIX-specific skips, plus 22 PowerShell 5/7 comparisons. A staged non-root Linux ARM64 full suite passes 527 tests. Later fixes did not rerun those complete operating-system suites.
- **Preservation and limits**: within the accepted scenarios, parent/child history remains readable; Super Code continues with official Standard after uninstall and shows one notice, while Minimal revokes stale plugin rules. Public memory remains legacy CRUD. Host models use deterministic adapters, with no external-model calls, new 100-task evaluation, Safari-specific acceptance, or per-version historical native Windows desktop acceptance.

## 0.3.10 · 2026-11-03

These Windows Bash checks ran at successive stages on November 2–3, 2026. Each batch retains its code baseline and scope; historical release records below are unchanged.

- **Release checks**: all 326 tests, type checking, build, and client syntax checks pass for 0.3.10. Release preparation changes only version metadata and documentation; execution code retains the tested implementation. The complete host matrix was not repeated for the version change.
- **Official-preset shell settings**: a separate **Also apply to official presets** switch defaults off. When enabled, Standard, PTC and Create use bundled Bash; Minimal keeps its persistent terminal, and custom presets are unchanged. Autosave is independent of budget and deletion-protection scopes, and the main switch retains the saved scope choice when disabled. Running Agents keep their selection; children inherit through actual runtime ownership. Failed parent/child preparation cannot be reactivated by another conversation recovering. All 325 unit tests, type checking, build and client syntax checks pass, together with 15 shell-component checks on each of 24 versions, 360 total. Component checks do not substitute for full Windows-host acceptance.
- **Official-preset host checks**: six Windows Web hosts each pass 13 check groups, 78 total: `0.1.5-alpha.1`, `0.1.6-alpha.1`, `0.1.7-rc.2`, `0.2.0-rc.2`, `0.2.1-alpha.3`, and `0.2.1-rc.5`. After the final failed-parent readiness fix, the final runtime package passes another 13 groups each on minimum-version and rc.5 Web, official rc.5 Desktop, and NEXT `2.0.21-next` (bundled rc.4). Checks cover actual Standard/PTC/Create Bash, default-off PowerShell, Minimal's persistent terminal, both autosave directions, running-Agent selection, confined refusal and single-command host approval, Chinese paths with spaces, file side effects, and complete process cold restart. The final package was not used to rerun the other four Web hosts or every historical desktop suite; the earlier 155/558 groups predate the official-scope setting.
- **Command environment UI follow-up**: switches are editable only on Windows hosts. Other platforms show both switches in gray with a top-side **Only available on Windows** tooltip. Bash defaults on and the official scope defaults off, retaining saved choices. Readiness text aligns with the setting labels and long versions wrap. All 326 unit tests and client syntax checks pass, alongside 192 browser check groups across 32 official static frontend targets (24 Web, 8 Desktop/NEXT). Coverage includes both tooltip languages, no writes while disabled, defaults, existing button tooltips, and narrow layouts. These UI checks use fixture services and do not represent a full Windows-host acceptance rerun.
- **Tooltip themes**: shared tooltips follow the host theme: a white surface with dark text in light mode, and a dark surface with light text in dark mode. Arrows, borders, and shadows follow the same palette. Thirty-two static-frontend check groups across the minimum version, rc.5, alpha.2, and NEXT pass, covering buttons, disabled switches, modal dialogs, and theme changes while a tooltip is visible. Full hosts were not rerun for this styling change.
- **Full Windows Web**: `0.2.1-rc.4` and `rc.5` pass checks with the real Loader, preset, Agent, PTC, and Windows ACL sandbox. `run_code → bash` passes approval, rejection, and cancellation through the actual DSH UI, plus disabled approvals, subsequent refusal, and background preflight refusal. The approved command exits 0 and writes exactly once; six unapproved paths leave no files, with the session remaining in workspace-write. Actual critical component versions are checked for both hosts.
- **Minimum-version Windows Web follow-up**: `0.1.5-alpha.1`, `alpha.2`, `rc.1`, `rc.2`, and `rc.3` each pass 31 full-process check groups, 155 total, covering presets, settings autosave, legacy codeRuntime, Bash, actual UI approvals, deletion protection, nonzero exit, cancellation, file side effects, and CLI cold restart. Legacy 120ms timeouts terminate rather than promote the command, with no cancellation/timeout writes after their delay windows. All 229/230 resolvable DSH components in each actual profile match its target version, including 12 individually checked execution-critical packages. These hosts use official Node `24.18.1` ARM64 with the original Cordis `4.0.2` combination.
- **Intermediate Windows Web versions**: all 16 hosts pass full-process acceptance: `0.1.6-alpha.1/alpha.2`, `0.1.7-alpha.1/alpha.2/rc.1/rc.2`, `0.2.0-rc.1/rc.2`, and `0.2.1-alpha.1`–`alpha.5` plus `rc.1`–`rc.3`. The two 0.1.6 hosts each pass 34 check groups, and the other 14 each pass 35, totaling 558. Coverage includes preset availability, settings autosave, PTC → Bash, actual UI approvals, all three deletion modes, nonzero exit, timeout, cancellation, file side effects, and complete CLI cold restart. Disabling Bash preserves the running Agent's choice; a new Agent successfully uses official PowerShell.
- **Intermediate graph and timeout checks**: each host runs in a Windows 11 ARM64 VM with official Node `24.18.1` ARM64, Cordis/Schemastery dependencies pinned from that release's official declarations, and an isolated profile. All 236–296 installed DSH components match the target version; 18 critical modules are checked individually, and loaded development-package runtime hashes match. A 120ms timeout kills the command on 0.1.6; the other versions promote it to one background job that completes successfully. From `0.2.1-alpha.3`, v4 job registration and settlement events are also checked. Cancellation waits for an actual Bash process and start-marker file before cancelling, then verifies process exit and no delayed write after more than 12 seconds. These are Windows Web results; historical native desktop scope remains separate below.
- **Legacy module-resolution fix**: directory presets without `profileContext` could fail to create a session when host shell modules were nested by npm. Resolution now uses the actual root profile, retaining precedence for explicit installation anchors on newer hosts. The new regression reproduces the failure before the fix; all 317 unit tests and 216 shell checks across 24 versions pass afterward. The five 0.1.5 hosts and 16 intermediate hosts above all pass Windows Web acceptance with the fixed package.
- **0.1.5 desktop limit**: the five checked Windows installer URLs and corresponding `dsh-desktop` npm metadata return 404, leaving native legacy desktop acceptance incomplete. Full Web results do not substitute for desktop results. The full Desktop/NEXT, deletion-protection, and timeout records below use the package before the module-resolution fix. This follow-up's final-package official-preset checks are listed separately above, rather than presenting both batches as a complete suite rerun.
- **Full Windows Desktop / NEXT**: official Desktop `0.2.1-rc.5` and NEXT `2.0.21-next` run serially from actual release installers; NEXT bundles Harness `0.2.1-rc.4`. Both actual Hosts use x64, Node `24.21.0`, and Electron `44.7.0`, with 11 critical host packages audited. Both pass native plugin-page installation and activation of the development tgz tested at that time, preset availability, both Bash autosave directions, budget preservation, tab switching, and complete application cold restart. No page script errors during the checks.
- **Desktop execution and approval**: both actual `run_code → bash` paths pass arrays, Chinese filenames with spaces, GNU grep, BusyBox, nonzero exit, running cancellation, and timeout promotion to a successfully completed background job. Confined calls refuse explicitly; a host-approved call runs exactly once. Rejection, cancellation, never, subsequent ordinary calls, and background preflight refusal leave no files, with the session remaining in workspace-write. Disabling Bash preserves the existing Agent's choice; a new Agent uses host PowerShell.
- **Desktop deletion protection**: both pass rejection, cancellation, and approval of MSYS `cmd.exe //c` deletion in strict mode. Under Workspace write + ask, the deletion confirmation and that Bash call's sandbox escalation require separate approvals before deleting the task-owned temporary file. Rejection and cancellation preserve it; relaxed/off add no plugin confirmation. Host Full access also sets approval=never by default, so strict deletion requests are rejected automatically; the plugin does not change that policy.
- **Desktop installer provenance**: the official installer comes from the [DeepSeek Windows nightly feed](https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml), matches its SHA-512, and has valid Windows Authenticode. NEXT comes from the [NEXT Windows download API](https://www.dshdesktop.cn/api/downloads/windows), with next-channel and target-version headers. Its installer is unsigned and the API supplies no public digest; only HTTPS provenance, product version, and matching SHA-256 before/after transfer are verified, not a valid signature.
- **Confined-mode boundary**: MSYS cannot create its internal named pipes in the official Windows confined sandbox. The plugin keeps Bash and rejects confined calls explicitly before process launch. Only the host-approved per-call `danger-full-access` policy is accepted; later commands still require approval, without changing session permissions or switching shells. Arrays, Chinese file I/O, and GNU grep are also verified in an explicitly full-access test session.
- **Environment comparison**: earlier Node 22.23.4 ARM64 produced fs.mkdir/ACL-lock EPERM even without loading the plugin. Those failures are retained. The complete approval and settings checks above use official Node 24.18.1 on the same VM, without ACL changes or disabling protection.
- **Windows scope**: a dedicated Windows 11 ARM64 VM; each payload passes seven execution checks. Desktop releases and Bash/MSYS/grep use x64 compatibility execution, not native ARM64 Bash builds or native x64 hardware. Full desktop acceptance covers only the two releases above, without rerunning all historical Windows desktop versions or external-model evaluations.
- **Actual tool components**: 12 rc.4 checks pass for root/child restrictions, conversation-frozen shell choice, PowerShell selection, single execution, timeout/cancellation, deletion protection and per-call approval, host denial, background jobs, and disposal isolation. Real tools and Windows processes are used, without proving that Bash works in the complete confined host.
- **Fixed command suite**: 97/100 pass, including all original 45. Three remaining cases concern `.cmd` quoting and MSYS conversion of native `/` arguments. Fixtures and expectations are unchanged. No global path-conversion disable or failed-command replay.
- **Every published version**: all 24 npm releases from `0.1.5-alpha.1` through `0.2.2-alpha.2` pass 591 shell-scope, deletion-protection, and settings checks. Older versions use the actual SettingsProvider; newer ones use the actual Loader and SettingsForms with a temporary-file ConfigEditor fixture. Alpha uses its actual native executor, batch API, and session projections, and passes the full deletion suite. The 24 actual providers also pass 240 execution checks on macOS with stubbed sandbox denial. This is not acceptance of 24 complete Windows hosts.
- **Windows execution for every version**: all 24 versions also have separately installed and audited provider graphs on the Windows VM, passing 288 checks for actual Bash processes, Unicode, stdin/stderr, nonzero exit, timeout/cancellation, single side effects, truncation/full spill files, tool isolation, confined-mode preflight refusal, and environment masking. Each version runs in a fresh Node process. Approval-policy checks use component services, not a complete ACL host. The 13 runtime tests for corruption, concurrency, hard links/symlinks, and environment boundaries also pass on Windows.
- **Installation**: npm latest/next is `0.2.1-rc.5` and alpha is `0.2.2-alpha.2` at the time of checking. All 360 peer-range checks across 24 versions pass; the new alpha series and its Cordis/Schemastery prereleases are explicitly covered. The development package installs into an isolated alpha dependency graph; its package-root plugin activates through the published Loader and SettingsForms and supports settings reads/writes, with fixture ConfigEditor persistence.
- **Frontend and units**: 32 official static frontend targets (24 Web, eight Desktop/NEXT) pass 128 switch, autosave, error, and non-Windows disabling checks without page errors. RPC is a fixture, not live desktop acceptance. All 316 unit tests, type checking, build, and client syntax checks pass. Live Windows Web settings also pass both autosave directions, budget/platform preservation, tab switching, and cold restart.
- **Concurrency follow-up**: another 192 shell checks pass across all 24 versions, adding pending parent/child preparation, duplicate lifecycle events, parent/child failure followed by sibling recovery, and the actual offline preparation service's shared Promise, retry, and detached status snapshots. These checks run on macOS without executing Windows binaries or starting complete hosts.
- **Environment and deletion follow-up**: fixed `PATH`/`Path` ordering that could remove the final PATH, and aliases that could override fixed BusyBox options. The 24 actual environment functions pass 240 checks; another 168 actual-process checks pass on the Windows VM. Strict deletion protection now recognizes MSYS `cmd.exe //c` and `//k` forms, with 360 deletion-protection component checks passing across all 24 versions; echoed command text remains allowed. These checks are not complete-host or external-model acceptance.
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
