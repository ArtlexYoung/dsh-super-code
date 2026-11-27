# Compatibility

[中文](../Compatibility.md) · English

## Official Desktop on Windows x64 (2026-11-26)

The frozen `0.4.3` candidate passed 22 native Electron checks on a Windows x64 machine with official Desktop `0.2.2-rc.5`. The checks covered saving from the workbench, Skills, MCP, reopening memory and conversations after a restart, and uninstall recovery. The run used an isolated background session. OS dialogs and NEXT phone takeover still require testing. See the [Chinese acceptance report](../testing/Acceptance-followup-20261126.md#windows-x64-官方-desktop).

## NEXT on Windows x64 (2026-11-26)

The frozen `0.4.3` candidate passed 22 native Electron checks on a Windows x64 machine running NEXT `2.0.24-next` with bundled Harness `0.2.2-rc.5`. This covered installation, saving a file from the workbench, Skills, MCP, memory, and continuing the original conversation after uninstall. The portable ZIP matched the official SHA-256. Windows reported the executable as unsigned. The run used an isolated background session. An interactive Windows x64 desktop later completed OAuth, Android phone takeover, cold-restart continuation and cancellation of a running model request. Tool approval and real file side effects still require testing. The earlier background session returned `0x483`. See the [Chinese acceptance report](../testing/Acceptance-followup-20261126.md#windows-x64-next).

## Go Web shortcuts and Skill updates (2026-11-26)

The Matt Skill update ran on an isolated maintenance branch, passed 2,143 source tests and two distribution checks, and produced no duplicate commit on a second run. Both OpenSpec CLI versions passed six checks on copies of the same existing project and four more checks through the frozen package’s Bash adapter. The bundled upgrade remains gated by the license check, and PStack still requires changes to the local adapter. The overall result remains **partial**. The browser opened the requested Go session and plugin card when supplied with their targets. Both Android native shortcuts still land on the home page, and the iOS simulator runtime is unavailable. See the [Chinese acceptance follow-up](../testing/Acceptance-followup-20261126.md).

## Automated Go SSH phone acceptance (2026-11-26)

The `0.4.3` candidate for main `1b39707` passed five automated Go SSH phone scenarios: native settings round-trip, tool approval and rejection, long-command cancellation, and saving memory from the embedded Web UI with server readback. The queue received `SIGTERM` after the allow-once scenario. The same command resumed with completed results intact, and a later run started no environment and repeated no writes.

The dsh-Go reconnect path was also diagnosed against the `v1.4.0` source tag. `network_watch.dart` notifies the local connection controller, SSH links and relay links when the app resumes, but `ChatController` does not subscribe to the same `networkKicksProvider`. The chat controller reopens its follow only after its mux state stream reports `connected` while `_watchEnded` is true. After backgrounding, that state transition may not reach the existing controller, leaving the chat at `Disconnected` and manual sync at `Chat sync interrupted`; a full app restart creates a new controller and recovers the history. The minimal fix is to subscribe `ChatController.build` to `networkKicksProvider`, guard the current client and generation, reconnect the mux and reopen or resync the follow. This is source diagnosis only and is not applied to main without an APK retest. Evidence is in `mobile-followup-20261126/reconnect-diagnosis-20261127/Verification.json`.

The overall result remains **partial**. A local model adapter generated requests for this run. Live-model, Agents Anywhere and relay results retain the scope of earlier tests. dsh-Go automatic recovery, statistics for the same session ID across hosts, Web shortcuts and the relay Web tunnel still have open items. See the [Chinese automation report](../testing/Automatic-acceptance-20261126.md) for the environment, results and remaining conditions.

## Phone entry points and update workflow (2026-11-26)

After official CLI installation, dsh-Go 1.4.0 shows the plugin and its native configuration form. The SSH embedded Web UI can change Super Code settings, open the task panel and save memory. With compact history enabled, phone allow-once, rejection, command cancellation and absence of delayed writes pass. An isolated update branch upgraded `@types/node` to 22.20.7, passed 2,143 source tests and two distribution checks, and made no duplicate commit on a second run. That dependency change remains outside main.

The overall result remains **partial**. Web shortcuts did not land on their requested page; Remote 0.6.8 returned `TUNNEL_UNAVAILABLE` with the tested self-hosted server. Earlier recovery, same-ID statistics and device gaps remain, and the complete automatic phone queue is unfinished. See the [Chinese follow-up](../testing/Remaining-acceptance-20261126.md) for conditions. Earlier entries retain their dated scope.

## Simulated-device follow-up (2026-11-26)

Twenty checks passed on a complete x64 Web host under Rosetta, and eight checks passed for an isolated SSH server interruption and recovery. On an Android emulator, dsh-Go 1.4.0 completed real SSH and relay conversations; Agents Anywhere 2.2.0 with its original bridge completed phone takeover, tool execution and conversation continuation after a host restart. Files, tasks and memory were checked against server state, with no repeated relay or AA writes.

This run clarified the error and help text for global memory entries containing `sourceVersion`. Twenty relevant regression tests, type checking, compilation and two distribution checks passed; a real model corrected its request using the new error and saved the preference. A further phone run passed approval, rejection and long-command cancellation on all three channels, AA global-preference reads after a cold host restart, and actual compact-history response checks. The overall result remains **partial**: dsh-Go automatic recovery was unreliable, and switching hosts with the same session ID displayed the other host's turn statistics; reopening the app restored the correct state. Phone Web panels, iOS, physical devices and other gaps remain. See the [Chinese simulated-device report](../testing/Simulated-devices-20261126.md) and [phone interaction follow-up](../testing/Mobile-followup-20261126.md) for the exact scope and limitations.

## Main acceptance update (2026-11-25)

The tested revision is `1c13a2f`, still version `0.4.3`. All 2,143 source tests passed. The fixed archive also passed the three workflow checks, live-model workbench and SSH checks, 44 Windows ARM64 Desktop/NEXT checks, and 46 checks on a physical Windows x64 machine using the oldest and newest supported Web hosts. Existing build, type, three-platform version matrix and performance results are reused only where the tested behavior is unchanged.

The full result is **partial**: the 117 regression conditions comprise 28 passed, 84 partially covered, 3 unverified and 2 not applicable. Mobile devices, Intel Mac, macFUSE, Windows x64 native apps and SFTP, physical network interruption, and some detailed scenarios remain unverified. License changes blocked automatic updates; dependencies were not upgraded. See the [Chinese acceptance report](../testing/Main-acceptance-20261125.md) for scope and retry results. Earlier dated entries retain their original scope.

## 0.4.3 integration acceptance (2026-11-19)

Tool profiles and the Code Workbench are integrated with the modular architecture, with checks for the integration changes completed on three systems. Tool profiles and the original workbench package each completed the 15-version, three-system matrix below. Integration checks cover changed entry points, service isolation, Windows shell selection, client controls, and distribution resources; the original matrix results remain tied to their packages.

| Environment | Integration checks |
|---|---|
| macOS ARM64 | Oldest and newest Web hosts, Settings and workbench conversations, Chinese/English and light/dark themes; first Git request and directory selection/cancellation in official Desktop; directory selection/cancellation in NEXT |
| Debian 12 ARM64 container | Oldest and newest Web hosts, file conflicts and recovery, service isolation, switching between two SSH sources and disconnection |
| Windows 11 ARM64 VM | Oldest and newest Web hosts, tools and shell, file links and conversation reads; Node.js 24.18.1 |

The oldest version is `0.1.5-rc.3`; the newest is `0.2.2-rc.5`. This integration fixed a missing host-interface declaration that blocked workbench conversation reads. Checks also covered dependency removal and restoration, model failures and cancellation, invalid directories, a broken Git index, and isolation between sources. The SSH scenario used two separate users and real backends; responses arriving after a source switch did not mix into the other source's conversations, tasks, or memory.

### Workbench performance

On macOS ARM64 with official Web `0.2.2-rc.5`, ten alternating pairs compared the integrated package with the earlier workbench package. Twenty initial baseline samples had a maximum variation of 6.40%. Values below are medians and include browser-automation overhead.

| Operation | Before integration | After integration | Change |
|---|---:|---:|---:|
| Reload with the workbench closed until the conversation, file link, and shared services are ready | 641.48 ms | 547.30 ms | -14.68% |
| First file open | 241.71 ms | 238.36 ms | -1.38% |
| Reopen the same file | 173.95 ms | 154.31 ms | -11.29% |

These results cover the listed page operations. Two broader performance comparisons did not reach candidate measurement because of baseline variation and a cold-start timeout in an older reference package; no end-to-end improvement is estimated from them.

### Known limits and untested environments

- The stock Windows host retains limits in long-working-directory search, search cancellation error classification, and Bash under `workspace-write`. Search fixes were tested in isolation and have not been applied to the official host.
- Plugin hot upgrades on the stock Windows host retain a resolution-cache issue. An isolated fix can request a restart and recover settings and history after a cold start; restart when prompted after updating.
- Linux NEXT encounters native sandbox restrictions in the tested container. Web-host coverage is listed above.
- Physical Android/iOS devices, physical Windows x64 hardware, real driver mounts with the integrated package, and physical network outages remain untested. Native Desktop and NEXT records cover their tested features.
- Earlier runs recorded a Linux file conflict and a Windows Node.js 22 test-bridge connection failure. The same file-check sequence and follow-up checks with Node.js 24 passed; the original causes remain undetermined.

### Permissions and model workflows

Harness enforces permissions. A request for a child Agent to work read-only is an instruction; use the host's corresponding permissions when writes must be prohibited. Model behavior in bundled Skills is recorded separately from plugin compatibility, including failures in historical workflow checks.

## Current support and acceptance scope (2026-11-19)

The matrix below covers fresh installation, upgrades, enable/disable, cold restarts, uninstall recovery, and conversation history using a controlled model. It contains 45 combinations across macOS ARM64, a Linux ARM64 container, and a Windows 11 ARM64 VM. The relationship between the original package matrices and integration checks is described above.

| Series | Included versions | Count |
|---|---|---:|
| 0.1.5 | `0.1.5-rc.3` | 1 |
| 0.1.7 | `0.1.7-rc.2` | 1 |
| 0.2.0 | `0.2.0-rc.2` | 1 |
| 0.2.1 | `0.2.1-rc.1` through `0.2.1-rc.5` | 5 |
| 0.2.2 | `0.2.2-alpha.2`, `0.2.2-alpha.3`, `0.2.2-rc.1` through `0.2.2-rc.5` | 7 |

Historical series retain only the final rc listed above; the latest `0.2.2` series retains all published alphas, currently `alpha.2` and `alpha.3`. All 18 DSH peers supplied by Harness explicitly list these 15 versions in `package.json` and the lockfile. Earlier alphas, `0.1.6`, and other unlisted releases are no longer declared. Peers remain optional to avoid installing host components during offline installation. Cordis and Schemastery retain their own component-version ranges, which differ from Harness version numbers. Historical evidence remains; current platform and feature scope is described above.

## Historical acceptance records

Version 0.4.0 was checked against 27 complete Web hosts from `0.1.5-alpha.1` through `0.2.2-rc.2`, official macOS arm64 Desktop `0.2.2-rc.2`, and NEXT `2.0.22-next` (bundled `0.2.2-rc.1`). These results apply to their recorded batches.

Historical Windows full-process coverage includes official Desktop `0.2.1-rc.5` and NEXT `2.0.21-next` (embedded `0.2.1-rc.4`). A November 14, 2026 supplemental check covers offline installation, sessions, and models on official Desktop `0.2.2-rc.2`; see the environment and limits below.

The records below distinguish each code baseline and test layer. Component checks, static-frontend fixtures, and earlier development-package results do not establish a complete rerun of every version and platform.

The new PStack workflow adaptation starts at `0.2.1-alpha.1`; earlier hosts are outside its scope. Older-version records below describe historical coverage of other plugin features.

## 2026-11-19 · Tool-profile branch (unreleased)

The daily NEXT installation exposed a nested `inject` failure in `2.0.19-next` (Harness `0.2.1-rc.2`): image and schedule tools could not inherit the isolated tool service. Providers now declare that dependency for child plugins in the same tool scope, without changing other tool scopes. A regression reproduces the original failure. Installation and graphical results are recorded separately in this run's `next-install-ou9DKA`, preserving the earlier candidate evidence below.

`feat/tool-profiles` adds five built-ins, up to 25 custom profiles, independent persistence and per-conversation switching at idle boundaries. New configurations use Super Code default (the original tools plus user questions, with PTC execution); existing selections remain unchanged. Custom profiles can disable other tools for Super Code conversations without affecting other presets. The host supplies user questions; enabling a Skill does not enable that tool. Older presets require reinstallation; the unchanged package version 0.4.2 alone does not identify this feature.

Complete isolated Web hosts on macOS ARM64, versions `0.1.5-alpha.1`, `0.2.2-rc.2` and `0.2.2-rc.3`, cover settings saves, changed tool declarations in the next actual Super Code turn and persistence through a cold restart. The old directory preset was installed using the packaged copy helper; automatic installation and its Remote were not validated. These runs use a deterministic model fixture, without graphical or real-model acceptance.

Official `0.2.2-rc.2` Agent/tool integration additionally covers independent pending conversations, two concurrent multi-question calls in one Agent, disabled native/PTC execution and persistent-shell state across switching. Real-model native and PTC runs each enabled, disabled and re-enabled questions, consumed random answer receipts, and used seven requests and two questions. All 1,261 automated tests, type checking, build and two distribution checks passed.

Graphical Chinese/English, light/dark, narrow-screen and question-card acceptance remains unverified; built-component tests cover the settings logic. Windows, Linux, Desktop, NEXT, remote devices and the complete 28-version host matrix were not rerun for this feature. Historical results do not fill those gaps. Evidence is in the outer `source/validation/dsh-super-code/tool-profiles-20261119/Report.md`.

## 2026-11-16 · 0.4.2 release scope

Version 0.4.2 includes the implemented remote-project, task-recovery, offline-dependency, and BusyBox fixes documented below, plus Zed-compatible README images. Historical candidate versions, hashes, failures, and limits remain unchanged below; those targeted checks are not represented as reruns of the final package. Read each result with its own code baseline and environment.

Use explicit `--offline` for offline installation. Cloud models require network access; local or LAN model services must be reachable. Physical Windows x64 hardware, all mobile devices, and every Skill workflow have not been fully validated. BusyBox long-working-directory and some UNC-rename limits remain. The earlier 0.4.2 acceptance did not include the workbench; see the integration candidate scope above for this merge.

## 2026-11-16 · BusyBox long paths (unreleased)

The candidate remains `0.4.1`, unpublished. Only BusyBox changes to the local `FRP-6354-sc-longpaths1` build based on `FRP-6354-g5f09fb446`. DSH, Bash, MSYS, grep and npm dependencies are unchanged. Complete modified source, pinned MSVCRT toolchain instructions and both actual configurations ship with the binaries; installation does not download or compile them.

- In an isolated Windows 11 ARM64 VM, x64 under Windows emulation and native ARM64 each pass 132 actual-file checks: lengths 100, 259, 260, 261, 520, 1024 and 4096, Unicode, spaces, long Unicode filenames, relative paths, exact bytes and denied reads. No physical x64 machine was tested.
- With matching toolchain, configurations and data, the 14 affected upstream command groups produce 217 passes/9 failures per baseline architecture and 218 passes/8 failures per candidate. The new regression changes from failure to success, with no added failures. Eight baseline failures remain.
- Each architecture passes 90 real-UNC checks against native Windows behavior, with 10 native rename/replacement limitations recorded separately. Successful reads, creation and copying do not guarantee that a share permits renaming. Failure preserves the source without bypassing permissions or replaying writes. Long process-working-directory and shell `cd` limits remain, as does the authorized native-tool strategy.
- All 1,185 plugin tests, type checks, build and PE DLL checks pass. Both architecture build/regression workflows are prepared; GitHub Actions has not run. Installation and DSH model checks are in the [batch report](../testing/BusyBox-long-paths-20261116.md). This does not revalidate every DSH version, phone or remote scenario.

## 2026-11-15 · Default peer offline-install fix (unreleased)

The root manifest and lockfile now mark the 15 existing DSH-provided peers as optional while retaining every version range. This prevents automatic downloads when the installer cannot find them; running the plugin still requires DSH to provide the modules. DSH is not bundled and dependencies are not upgraded. The candidate remains version `0.4.1`; the published package has not been replaced.

- A new real npm regression installs a tgz offline into an empty directory with an empty cache, default peer resolution and install scripts enabled. Before the fix it fails with `ENOTCACHED` for a DSH peer; afterward it passes. All 1,174 tests, type checks, build and distribution checks pass.
- The tgz is built from a clean `fec1199` export with only this root-configuration change applied: SHA-256 `8419dbfeca57495e368d8dd401a47d15bebd7a008452d5d9508e5c16c86df22c`. Comparing both actual packages finds unchanged runtime code, DSH version ranges and third-party versions. Documentation and two dependency CHANGELOG packaging differences are recorded separately.
- On macOS ARM64, pnpm `11.28.5` passes normal and `--offline` installs with system-level external-network denial for the test Node process, separate empty stores/caches, and automatic peer handling left enabled. Official NEXT `2.0.23-next` also installs and activates through its actual manager with pnpm offline mode, an empty plugin directory and empty store/cache, reporting zero downloads. NEXT itself is not network-blocked in this manager test.
- In an isolated Windows 11 ARM64 VM with external networking blocked at system level, official x64 Desktop `0.2.2-rc.2`'s plugin CLI and pnpm `11.28.5` install the same tgz normally and with `--offline`, both exiting 0 and enabling the plugin. Each uses a new profile/store/cache, reports zero downloads, leaves automatic peer handling enabled and installs no DSH modules. This verifies installation, not x64 physical hardware or a new Windows desktop-model/local-inference run.
- A real model in NEXT's bundled DSH `0.2.2-rc.3` creates a task and project memory. After a full application restart, two actual tool calls read them back in the same session and the model answers 42. The first turn incorrectly supplied `expectedRevision` to focus; validation rejected it and the model corrected the call. That turn is not reported as error-free. The cold-recovery turn has no tool errors.

Evidence is in the outer `source/validation/dsh-super-code/optional-peers-20261115-7sIrfj/Report.md`. This batch fixes the default installation path; it does not complete every earlier platform, phone or small-model gap. Earlier failed evidence is preserved.

## 2026-11-15 · Full test-skill coverage follow-up (partial)

This batch uses the same r3 candidate associated with `ba4e579`, without runtime or dependency changes. The 98-item checklist records 48 passes at their stated source/component or integration level, 41 partial passes, two failures caused by one default offline-install defect, and seven inapplicable items. Partial items still contain untested scenarios; this is not complete acceptance of every platform and workflow.

- **Complete programs:** all 27 complete Web versions from DSH `0.1.5-alpha.1` through `0.2.2-rc.2` pass 12 checks each for Skill directory/menu changes, independent settings, memory boundaries and concurrency, original tools, and cold recovery. DSH `0.1.5-alpha.1` and `0.2.2-rc.2` also pass 16 checks each including MCP and actual package removal followed by cold restarts. These use deterministic model endpoints, not real-model acceptance across 27 versions.
- **Actual NEXT mobile path:** signed official macOS ARM64 NEXT `2.0.23-next`, bundled DSH `0.2.2-rc.3`, and its original bridge `2.2.0-desktop.caa12e7a2c181.r6c2a8ac0` pass the normal remote-control onboarding and virtual-account authorization. Agents Anywhere `2.2.0` on an Android 15 ARM64 emulator initiates real-model task updates, method calls, project/global memory, file writes and reads, allow-once/deny decisions, and long-command cancellation. After complete NEXT exit and restart, the phone resumes the original session without restarting the app and reads the task, project memory and file before answering 42. The first desktop method call omitted a required argument; the model corrected it and continued, so this is not a zero-tool-error result.
- **New offline defect:** with an empty plugin directory and store/cache, NEXT's actual manager using pnpm `11.28.5` in offline mode fails with `ERR_PNPM_NO_OFFLINE_META` while automatically installing DSH peers. Earlier successful runs disabling automatic peer installation or using `--legacy-peer-deps` do not cover the default entry point. An experimental package changing only 15 DSH-provided peers to optional, retaining their version ranges, passes manager installation, activation, and real-model/tool calls. Product root configuration remains unchanged pending confirmation. This tests package-manager offline mode, not whole-system network disconnection.
- **Components and skill:** all 145 actually bundled npm packages and Windows, Skill, and frontend resources match official 0.4.1 in version and content hash. Upstream updates exist; none were applied. The test skill now covers default peer installation, effective cache configuration, bridge state locations, and Android password XML handling; its format validator passes.
- **Remaining gaps:** physical Android/iOS, Windows x64 hardware, SSHFS, identical session IDs and late messages across two machines, transport interruption during execution/physical disconnection, all platform/channel combinations, all 58 complete PStack workflows, and every native UI. Prior dsh-Go relay recovery requiring an app restart and Windows small-model multi-turn failures remain. This batch did not restart the Windows VM or rerun the 1,173 source tests.

Evidence and explicit gaps are in the outer `source/validation/dsh-super-code/full-remote-20261115-ddkyLa/Report.md` and `Coverage-supplement.md`. Test processes are stopped and data retained; daily NEXT processes and other sessions' changes are preserved. No push or release was performed.

## 2026-11-14 · Offline task recovery and local-model follow-up

This batch continues testing the r3 candidate associated with local commit `ba4e579`, using the same package hash recorded in the task-storage batch below. No runtime code or dependencies changed.

- On Linux ARM64, a local tgz installs without `--offline` under Docker `--network none`, with DSH `0.2.2-rc.1` preinstalled in an independent dependency tree, no plugin directory, and an empty npm cache. Complete DSH uses a local deterministic model endpoint and its original `run_code` executor to save, focus and update a task and project memory. After full process exit and restart, the same session retains revision 2, task focus and project constraints. No user message is inserted between the call and result. This verifies the complete program and tools, not a real model; some install hooks remain unexecuted.
- Complete macOS ARM64 DSH `0.2.2-rc.2`, restricted to loopback connections, calls the same 379.38 MiB model on the local CPU. Both `minimal` and `super-code` presets answer capital, addition and greeting questions correctly across three consecutive turns in one session each: six correct turns. The actual candidate and complete prompts are used without shortening product instructions.
- Replaying the earlier Windows request that answered addition with “Paris” directly to the same model, outside DSH, returns “Paris” twice. A short request retaining the same question-and-answer history returns “4” twice. The Windows failure is retained; endpoint availability and this macOS success do not establish general model reliability. This diagnostic changes only test requests, not product prompts or outputs.

Evidence is in the outer workspace at `source/validation/dsh-super-code/offline-followup-20261114-U4BGRe/Report.md`. Windows, phones and the complete baseline suite were not rerun in this batch. These results do not replace earlier records; real small-model answers inside the network-disabled Linux container remain unverified.

## 2026-11-14 · Independent task-storage fix (unreleased)

This batch fixes task saves separating model tool calls from their results on main `96476cdb`. The tested candidate still carries version `0.4.1`, SHA-256 `a11beee3e1adf7a9cd293dbc9d8684ad909c88ee566ee8043c06f9cb766c3320`; it is distinct from the published 0.4.1 package.

- Tasks use the independent `super_code_tasks` domain after source messages are durable. History uses `recordId`; source and tool evidence retain `eventSeq`. Existing task records remain readable. Damaged model history is not automatically rewritten.
- All 1173 tests, type checks, build and actual-package dependency-closure checks pass. Real interfaces and package-root entry tests pass on all 28 DSH versions from `0.1.5-alpha.1` through `0.2.2-rc.3`, covering history, archives, restore, fork isolation and durable cold recovery. These are not 28 complete DSH model runs.
- Complete Linux DSH `0.2.2-rc.1` / `0.2.2-rc.3` pass real-model task and project-memory workflows. An Android 15 ARM64 emulator passes phone-initiated updates, project-memory reads and answers through dsh-Go `1.0.16` SSH, DSH Remote `0.6.4` relay, and Agents Anywhere `2.2.0` with NEXT's original `2.2.0` bridge. The NEXT desktop remote-activation entry point remains unverified.
- Windows 11 ARM64 VM runs official x64 Desktop `0.2.2-rc.2` through Windows emulation. Both normal and `--offline` current-package installs pass with empty caches and external networking blocked. Real cloud-model task save, next turn, cold restart, and same-session recovery after cloud disconnection pass through a temporary Mac relay. Bundled Bash `5.3.15` and OpenSpec `1.17.0` after enabling it in isolated settings execute successfully.
- With external networking blocked, Qwen2.5-0.5B Q4_K_M (379.38 MiB, Mac CPU, LAN service, 32K context, temperature=0) answers capital, addition and greeting questions correctly in three fresh Windows Super Code sessions. A second-turn addition question in one earlier session returned “Paris”; this failure is retained. Multi-turn reliability and coding/tool ability are not established.
- Current-package Linux `--offline` install and full cold startup pass under Docker `--network none` with an independent preinstalled DSH dependency tree and empty cache. Not all install hooks ran; local-model answers were not tested inside that container.

Emulator/self-hosted results do not establish physical-phone, iOS or every remote-machine combination. No third-party components were upgraded; upstream inventory and upgrade handling retain the prior batch's scope and the test skill. Evidence is in the outer workspace at `source/validation/dsh-super-code/task-records-20261114-JgLoKw/Report.md`.

In this batch, dsh-Go relay displayed interrupted synchronization after a DSH cold restart. Reopening the session did not immediately recover; restarting the App reconnected it. Automatic recovery is not counted as passed.

## 2026-11-14 · main remote emulator acceptance (partial)

The candidate was exported from main `684fa85`, still carries package version `0.4.1`, and has SHA-256 `fccb0d6e5a83c57e39081bdf8638c07b7b9efa06275b4c2dc4f1b85d7807fd46`. Remote adaptation is unreleased and is recorded separately from the published 0.4.1 package.

The client was an Android 15 / API 35 ARM64 emulator. DSH ran in isolated Linux ARM64 containers with real model calls and local self-hosted relay services. No physical phones or production accounts were used.

| Client and connection | DSH version | Checks passed in this batch |
|---|---|---|
| dsh-Go `1.0.16`, SSH | `0.2.2-rc.1` | Super Code selection, real-model file write/readback, actual SSH connection interruption and same-session continuation; idle reconnect did not replay tools or duplicate the appended line |
| dsh-Go `1.0.16`, DSH Remote `0.6.4` relay | `0.2.2-rc.1` | Real-model file operations, phone allow-once and deny approvals, foreground-command cancellation, method tool, global-memory write/readback, App restart and history reopening, relay-service restart recovery |
| Agents Anywhere `2.2.0`, NEXT `2.0.23-next` original `2.2.0` bridge | `0.2.2-rc.3` | Real-model file operations, phone allow-once and deny approvals, cancellation, method tool, global-memory write/readback, original-session continuation after DSH cold restart and App restart |

- **Unfixed defect:** saving a task appends a model message between a tool call and its result. Tencent Responses returns HTTP 400 / `400001`, including on the next turn. Real-API controls pass with adjacent calls/results and fail with an intervening message; changing that message's role also fails. The full task and dependent project-memory workflow has not passed. Global-memory success does not establish project-memory success.
- **Client and recovery limits:** Agents Anywhere `2.1.0` could view history but could not send with this server/bridge combination; the website's `2.2.0` download could send. After a DSH cold restart, reopening the session from the list was needed once to restore input. A background return also retained a cancelled request's running bubble until an App restart; the server did not rerun the command. Ownership of these display symptoms has not been established. With dsh-Go compact history enabled, history and new requests worked, but wire-level compaction was not inspected, so this is partial coverage.
- **Offline check:** the same candidate installed from a local tgz with an empty npm cache and Docker `--network none`, using an independent dependency copy with DSH `0.2.2-rc.1` preinstalled. Full DSH cold startup passed. Not all install hooks ran. Windows and offline inference were not rerun with this candidate; historical results retain their original scope.
- **Third-party inventory:** runtime dependencies are unchanged from published 0.4.1; no dependencies were upgraded. Upstream npm, Bash/MSYS/BusyBox, PortableGit sources, oil-ui, Matt, PStack, OpenSpec, and remote bridges were checked. Available updates do not imply candidate changes. The earlier main acceptance did not include workbench Git or CodeMirror; this integration candidate includes them. PortableGit provenance does not establish that a Git executable is bundled.
- **Unverified:** physical Android/iOS devices, the NEXT desktop remote-activation entry point, current-candidate channels with macOS/Windows remote machines, SSHFS, all Skill menus/workflows, interruption during execution, and cross-machine late messages with identical session IDs. Idle SSH/service interruption does not establish physical-network outage coverage.

Evidence is in the outer workspace at `source/validation/dsh-super-code/remote-acceptance-20261114-OGn6pT/Report.md`. All 1165 tests, type checks, build, and actual-package dependency-closure checks passed; these do not override the real-model failure above.

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

The original 0.4.0 release omitted npm runtime dependencies, so installing even a local tgz with an empty cache required network access. The current fix bundles OpenSpec, the MCP SDK, `js-yaml`, `zod`, and their transitive dependencies from `dependencies`. DSH itself must already be installed. Use a local tgz for offline installation; installation by package name still requires cached npm metadata and the plugin tarball. Remote models and network tools still require connectivity.

The Windows shell also packages separately licensed programs that run as subprocesses; see [runtime notes](../../builtin/windows/README.md) for sources, licenses, and corresponding source.

## November 14, 2026 · 0.4.1 fix validation

- Runtime ownership and offline packaging fixes were validated on macOS arm64 Web `0.2.2-rc.2` and official x64 Desktop `0.2.2-rc.2` in a Windows 11 ARM64 VM. Windows runs the desktop through its compatibility layer; this is not x64 physical-hardware acceptance. Full-host checks used the frozen fixed candidate whose internal version was still `0.4.0`; 0.4.1 release preparation changes version metadata and documentation only.
- With the tested host denied external network access by the OS and using isolated empty dependency caches, the original release failed both ordinary and `--offline` installation, while the fixed package passed both. Harness and the local tgz were prepared beforehand.
- Windows checks passed for real sessions, Bash 5.3.15, OpenSpec 1.17.0, parent/child/grandchild shell inheritance, PowerShell for a new root, tasks, Skills, project memory, local MCP, and cold-start recovery. A deterministic adapter triggered tool workflows; the tools themselves actually executed.
- Real Tencent DeepSeek Responses answers, disconnected transport errors, and continued answers after restoring the route passed. Windows cloud calls went through a temporary Mac relay, not direct guest internet. Qwen2.5-0.5B Q4_K_M ran on the Mac CPU over localhost/LAN and produced normal answers in full Windows Super Code sessions and the desktop UI without external network access. Tests used a 32K context and temperature=0 and establish simple answers only. Failures with 135M/360M models, default sampling, and an 8K context remain recorded.
- This round does not cover a native Windows inference engine, a complete native Linux host, all models, every feature on every version, or a new coding-effectiveness evaluation. It does not extend older batches beyond their recorded scope.

## November 12, 2026 · 0.4.0 compatibility rerun

The existing peer dependency ranges and minimum `0.1.5-alpha.1` remain unchanged. Every version uses the same 0.4.0 candidate; no plugin runtime changes were needed for these checks.

| Layer | Scope | Result |
|---|---|---|
| Complete Web hosts | All 27 exact published versions, `0.1.5-alpha.1` through `0.2.2-rc.2` | 12 groups per version; 324 pass |
| Actual SDK and disk storage | The same 27 versions | Six groups per version; 162 pass |
| Native Skill loading | The same 27 versions | 24 checks and 98 body loads per version pass; duplicate names follow provider precedence |
| Native menu contract | The same 27 versions | Pass; `0.1.5` lacks package-query expansion, but individual Skill names remain selectable |
| Browser interactions | Official React, controls and themes from all 27 versions, with fixture Remote services | 15 groups per version; 405 pass without page errors |
| Official macOS arm64 Desktop | `0.2.2-rc.2` | 13 complete-host groups and four actual UI checks pass |
| DSH NEXT · macOS arm64 | `2.0.22-next`, bundled `0.2.2-rc.1` | 13 complete-host groups and four actual UI checks pass |

- **Complete-host checks**: install the candidate, verify preset versions, independent budget/protection saves, five default-off Skill packages enabling and disabling in existing conversations, default MCP settings, manual memory CRUD and concurrency conflicts, native/PTC task and memory calls, complete process restarts, original-conversation continuation and memory recovery.
- **UI checks**: six settings tabs, Skill versions and switches, failed saves, budget validation, connection settings, Chinese/English, light/dark themes, narrow layouts, 10,000-row task virtualization, execution-tree animation and legacy memory maintenance. Both actual desktops additionally verify settings loading, matching versions, five default-off packages, switch autosave and disabled Windows command-environment controls on macOS.
- **Provenance and baseline**: the official archive matches the feed SHA-512 and passes deep signature verification; all 333 DSH components are rc.2. NEXT has a valid signature and all 330 DSH components are rc.1. All 1154 unit tests, type checking and build/pack pass. Acceptance scripts were corrected for concurrent completion order, upstream theme packaging and actual page structure; original failed records remain preserved.
- **Limits**: complete hosts use a local deterministic model adapter with zero external-model calls. This does not establish model effectiveness, acceptance of all 58 PStack workflows or every feature branch. This round does not repeat Windows, Linux, every historical native desktop, native directory pickers or physical-uninstall recovery; those retain their historical evidence identities. Full PStack workflow adaptation still starts at `0.2.1-alpha.1`.

## November 11, 2026 · PStack DSH adaptation

- Batch six removes adapter-added command bans, mandatory API checks and repeated snapshot audits. Four role templates now match upstream exactly, and delegation translation preserves the upstream read-only requirement. Read-only roles may use commands without side effects, but may not write files or change external state. Command capture also fixes sparse-argv validation and post-submission argument mutation. All 925 regression tests and 143 resource checks across 13 versions pass; real minimum/latest Web capture scenarios each pass nine independent checks. Live workflow children still redirect output into temporary files, so read-only scope adherence remains unresolved.
- The scope contains all 13 npm releases from `0.2.1-alpha.1` through the current latest `0.2.2-rc.1`, including `0.2.2-alpha.3`. Native catalogs, all 58 bodies, slash injection, invocation permissions and same-name precedence pass, with batch five adding command-capture resources for 143 checks; task enum diagnostics pass another 39 checks. Native subagent contracts pass 65 checks; live switches in existing browser conversations pass 169. Browser checks use real frontend modules with fixtures at service boundaries, not 13 complete desktop processes.
- On November 11, 2026, all 58 entrypoints ran through native slash injection and real model calls in isolated macOS arm64 Web `0.2.2-rc.1`, using `tokenhub/deepseek/Evaluation model A`. Each entrypoint had an independent scenario. Twelve scenarios were rerun, and two received clarifications; repeats are not added to the 58-entry denominator.
- First-round acceptance: 36 pass, 17 pass with qualifications, four fail and one partial. Read-only children in `how`, `teach` and `create-formal-verification-skill` still wrote global temporary files. `principle-outcome-oriented-execution` retained `add` twice and passed after the target was clarified as `sum({left,right})`; ambiguity between the original wording and the acceptance contract needs separate review. `ketchup-video` encoded and decoded a real video, but the test route omitted the image-input declaration and the workflow did not complete its visual review. Execution completion is not acceptance.
- Image diagnosis corrected: the model does support images. With `input: ["text", "image"]` declared in the isolated route, direct image attachments and native `read_image` on both `0.2.1-alpha.1` and `0.2.2-rc.1` let the live model read a random code and count shapes present only in the pixels. Provider requests contained image content. A text-only configuration rejected images before sending. The Chinese rc.1 Web UI also passed native selection, preview, removal, paste, drop and history display; this round did not exercise native desktop image interactions across platforms.
- All 22 entries without full acceptance were rerun. The video workflow completed 14 actual image reads, including decoded frames from every slide; eight CLI samples and four decoded images were independently checked. The complete `statechart` workflow also passed real TLC and code replay. Independent baseline checks passed 56/57; the remaining check compares an ambiguously worded API task against a fixed contract and needs separate interpretation. Five additional checks passed. Read-only children still wrote global temporary files, and cleanup used `rm` and process-name matching to stop encoders. Image transport and baseline checks do not erase these defects, so all 58 workflows cannot be reported as fully accepted.
- Three read-only/audit workflows were tested again, passing seven baseline checks. An independent copy of the formal-verification artifact passed three additional normal, invalid-argument and mutation/restoration checks. The audit reviewer made no writes this time, and its independent review passed with the snapshot coverage limits disclosed. The `teach` investigator and synthesizer still wrote global temporary files. Prompt rules therefore do not provide a hard read-only boundary, and these issues are not all resolved.
- This round corrected three global temporary-path examples and child-scope propagation guidance. It also fixed the installed `statechart` helper: Node refuses TypeScript stripping under `node_modules`, so packaging now emits JavaScript while retaining upstream sources. The actual installed wrapper passed TLC, a concrete authorization counterexample and code replay under a Unicode path with spaces. The MCP bot UI exercised real new/reused conversations, stable request IDs, restart, rejection branches, paged history and session termination; live approval waiting and remote deployment were not exercised.
- The distribution retains 58 entrypoints, 23 playbooks and 558 originals, with 592 generated files, including audit snapshots, stable submission admission and project-local command capture. Original hashes, generated bytes and helper permissions are checked. All 919 batch-five tests, type checking and build pass; the earlier 909-test batch and 19 focused follow-up checks remain recorded. The initial 58-scenario independent checks total 155: 154 pass and the API migration assertion fails. These checks do not replace phase and scope review.
- A third batch reruns eight priority entrypoints with 20 passing baseline assertions. The converter now preserves why's code-anchor step, and source-only contracts are inside the actual role templates. Three video slides and two transitions were independently decoded and viewed; 16 checks pass, without permanent shell cleanup or shared-name process termination. Eight snapshot-helper checks cover append/tamper/CRLF/Unicode behavior; the complete 23-row trail receives 12 provenance/behavior checks plus per-row semantic review. Structural validity is not claim verification.
- Live MCP approval and cancellation now pass six checks; the browser observes `waiting_confirmation → cancelling → cancelled`, and the pending probe never executes. Acceptance found a changed-content cache bug in the generated example backend. After a manual repair, 13 checks pass; the product workflow now specifies fingerprints, serialized admission and original-input retries. This is neither a newly found core-service defect nor an autonomous first-pass success. Remote deployment and live injection of every error status remain untested.
- Minimum `0.2.1-alpha.1` reruns a seven-file how scenario with the final runtime candidate: 14 independent checks pass, native command results are used directly, the source/tree stays unchanged, and two children use only read/glob/grep/send_message. Model adherence limits remain: teach/show use read-only cat/ls, and the minimum run repeats an explainer and attempts a capture write that fails with ENOENT; its handoff also undercounts children. The final package then reruns managed and synchronous return branches on the minimum host: 15 checks pass, with one delegate per case, no capture/write attempt or redispatch, and same-call final-text extraction for the synchronous result. Earlier duplicate/undercount evidence remains; the synchronous reply still exceeds its requested length. Neither hard isolation nor universal prompt compliance is established.
- Batch four adds a dependency-free stable submission helper to make-bot-ui, covering concurrent IDs, content conflicts, restarts, persistence failures and independent return values. The generated example completes 92 self-checks. Acceptance then finds interrupted incorrectly treated as settled and failed transports closed without DELETE. After diagnostic continuation in the original model session, 91 deterministic fixture checks, 13 independent UI checks and two recovery checks pass. The session then reaches the acceptance harness's cumulative 100-request limit without its final handoff, so this is not an autonomous full-pass claim. The final packaged helper separately passes 18 independent checks with real MCP/model calls: new and explicitly reused conversations, per-request prior/current results, refusals and session release. Fixture states are not real network-failure injection.
- The fourth audit covers all work/correction rows 1–28; final rows 29–30 contain review metadata only. Twenty-five snapshot, actual CLI and provenance checks pass. Replaced evidence, incorrect counts and causal descriptions remain disclosed; the reviewer verdict is PASS WITH FLAGS. Teach's four children make no writes but one still uses ls under a narrower no-shell contract. Bot development writes four global temporary responses and issues a cleanup command containing an rm fallback whose actual branch is unknown. A narrow live scenario after project-local evidence guidance gets all three HTTP refusals right but still writes a global status-probe file; its scope check remains failed. Functional checks do not establish universal scope adherence.
- Batch five retains unique project-local capture directories: all 34 audit captures re-verify and 14 independent provenance/CLI checks pass. The original session appends corrections for mistyped hashes and row counts; its reviewer still executes a read-only shell command, so the existing no-shell contract remains failed. The repaired MCP example checkpoint completes 96 real integration checks, 91 explicitly simulated fault checks and its final handoff, without global temporary responses or overwritten command evidence. Nineteen of 20 independent checks pass; the sole failure is that role contract. A separate real minimum-host how/capture scenario passes 16 checks for Unicode paths with spaces, literal argv, exit 0/7, exact streams, byte verification, unchanged source and a read/search-only child. These targeted checks do not establish full acceptance of all 58 workflows.
- The 58-scenario run covers only that macOS Web host and model, not Windows/Linux, every desktop release, all 23 playbook branches, cross-model evaluation, GitHub publication or the optional Bun watcher. Earlier minimum-host configuration/delegation evidence is retained separately; the new how run does not cover every minimum-host workflow. No effectiveness or performance improvement is established.

- The completeness review restores setup’s eight stages and 17 role categories, independent reflect synthesis, incremental history, simulator/cache branches, and cause-based retries/late-result handling. Reasoning budget, candidate count and concurrency remain distinct. Missing public model discovery means inheritance, not scanning private configuration. Long runs assume neither a scheduler nor a private agent store.

- Follow-up live-model checks: latest-host setup preserves the full role map and public capability-discovery boundary; reflect runs three independent reviews plus a fourth synthesizer, routes structural proposals to Backlog and makes no Skill edits before approval. Minimum `0.2.1-alpha.1` rechecks the new setup’s 17 roles, separate budget/panel/concurrency values and existing notes. Initial discovery/classification failures and acceptance-script format assumptions remain recorded; a completion marker alone is not acceptance evidence.

## November 9, 2026 · Latest-host rerun

This run uses `main@8d28e47`, including the oil-ui `0.32.0` replacement. The fixed test package has SHA-256 `3b19a6c04b960202d87e13bb17e59085f7378503aaf8316a9c0d78220f6c50d5`. It is not the original v0.3.11 Release archive; no version bump or republication was performed.

At checking time, official [npm](https://www.npmjs.com/package/@deepseek-ai/dsh) `latest`/`next` and the [most recent GitHub Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1) are all `0.2.2-rc.1`, released November 4, 2026. The alpha tag is `0.2.2-alpha.3`; no later release was found. rc.1 changes Loader, tool execution, and session projections but retains the legacy projection registration used by the plugin. No plugin runtime change is required within the tested scope below.

| Complete host | Actual version | Result |
|---|---|---|
| Official Web | `0.2.2-rc.1` | Pass |
| Official Web · alpha channel | `0.2.2-alpha.3` | Pass |
| Official Desktop · macOS arm64 | `0.2.2-rc.1` | Pass |
| DSH NEXT · macOS universal archive | `2.0.22-next`, bundled `0.2.2-rc.1` | Pass |

- **Complete flow**: the same package runs through actual Loader, Agent, tools, PTC, and session storage. Checks cover standard/PTC/minimal/Super Code/renamed-copy presets, installation and reinstall backups, budgets and deletion settings, parent/child histories, compaction, legacy memory CRUD/conflicts/scoping, cold restarts, plugin disable/re-enable, and physical removal followed by preserved history and official-standard continuation. Super Code shows one recovery notice; minimal excludes revoked plugin rules. The real deferred Skill tool loads oil-ui, verifying its body, provider, relative resources, and installed version.
- **MCP boundaries**: each passing full host additionally checks port conflicts, token rotation, and directory consent, plus 39 checks across admission, persistence failures, approval lifecycle, directory changes, and storage locks. Coverage includes cancellation, disconnect, revocation, idempotency, and no replay after restart.
- **Frontend and baseline**: official React, controls, and themes from `0.1.5-alpha.1`, `0.2.2-rc.1`, and `0.2.2-alpha.3` each pass 14 interaction groups with fixture services. These cover five settings tabs, autosave/failures, custom dropdowns, Chinese/English, themes, 440px settings layouts, 10,000-row virtualization, circle animation, exactly one open section, and legacy memory CRUD, without page errors. These are not three complete hosts. All 560 unit tests, type checking, and build pass.
- **Provenance and versions**: the official arm64 ZIP matches its nightly feed SHA-512 and the original application passes deep signature verification; all 321 DSH components are rc.1. The NEXT download channel points to `2.0.22-next`, all 330 DSH components are rc.1, and the original application passes deep signature verification. Its API supplies no public digest; local SHA-256 only pins the tested sample. Both Web graphs contain 320 DSH components, all at their target version.
- **Limits**: full hosts use a local deterministic model adapter, without external-model calls or effectiveness evaluation. This run does not repeat every historical complete host, latest native Windows/Linux processes, or native directory picking. The rc.1 host requires Node `>=24.9` when upgrading Web; the plugin retains its Node range for older hosts.

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
