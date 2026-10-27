# Usage Guide

[中文](../UsageGuide.md) · English

New here? Read the Install and Use sections of the [README](../../README.en.md) first. This page covers the details.

- [Model](#model)
- [Can't find the preset](#cant-find-the-preset)
- [Settings](#settings)
- [Preset version and reinstall](#preset-version-and-reinstall)
- [Sidebar](#sidebar)
- [Batched tool calls](#batched-tool-calls)
- [Runtime budgets](#runtime-budgets)
- [Deletion protection](#deletion-protection)
- [MCP connection](#mcp-connection)
- [Frontend Skill](#frontend-skill)

## Model

The plugin has no model settings of its own. If you already have a working model, just use it. Otherwise add a provider under Harness **Settings → Models**, then pick a model and reasoning effort below the message input.

Child Agents use the parent's model by default. Harness manages permissions and tools.

## Can't find the preset

First make sure the plugin is enabled, then check your host version against [Compatibility](Compatibility.md). Then:

**Harness 0.1.7 and later (declarative presets)**: the plugin declares the preset and the host loads it. Go to **Settings → Super Code** and click **Install preset**. If the host doesn't expose management APIs, the page says so.

**Harness 0.1.5 / 0.1.6 (directory presets)**: the plugin installs a user copy on first load. If it's missing, install it manually from **Settings → Super Code**.

- If the default identifier `super-code` is taken, pick another one. Existing presets are never overwritten.
- If you delete this copy yourself, a restart won't bring it back. Install it again manually.

Before plugin 0.2.0, the settings page lives under **Plugins → Plugin configuration**.

## Settings

**Settings → Super Code** has five tabs:

| Tab | Contents |
|---|---|
| Home | Preset status and versions, deletion-protection level, MCP switch, connected/past conversation counts |
| Preset configuration | Install, reinstall, rename |
| Context settings | [Runtime budgets](#runtime-budgets) |
| Deletion protection | [Deletion protection](#deletion-protection) |
| Connection | [MCP connection](#mcp-connection) |

Switching tabs keeps unsaved input.

### Names and language

- The identifier selects the preset; the display name can be changed separately. Chinese characters and spaces are fine, up to 120 characters.
- Default names and descriptions follow Harness's Chinese/English setting. Fields you've edited are left alone.
- Changing the language only updates display fields, not preset content or version.
- Older Harness versions cache the preset list, so the page reloads once when the wording changes.
- Preset files on one host share one language; different clients can't show different languages at the same time.
- A read-only install directory or YAML the plugin can't safely parse may block syncing. Refresh and retry from Settings.

## Preset version and reinstall

Settings shows the **plugin version** and the **preset version** separately.

- Same version: the preset matches the installed plugin. It doesn't mean there's no newer release on npm.
- Old preset without a version: shows "Version not recorded" and isn't treated as current.
- Updating the plugin doesn't update an installed preset. To get the new preset, reinstall.

**Reinstall**: click **Reinstall preset** → the dialog lists the presets to be replaced plus the new name and identifier → check and confirm.

- You can remove entries, but not confirm an empty list. Cancel or Esc changes nothing.
- Reinstalling overwrites the old preset. Save your customizations first.
- Existing sessions keep the old preset; new sessions use the new one.

**Safety**:

- Only presets verifiably installed by this plugin are replaced (directory: install record, UUID, path, directory identity; declarative: source marker or install record). Unmarked old copies and same-name declarations are left alone.
- The old content is backed up in `.super-code-backup-*`: under the user preset root for directory hosts, under the current profile for declarative hosts (ownership records in `.super-code-presets.json`).
- A failed install restores automatically. After an unexpected crash, restore manually from the backup.

## Sidebar

In the right sidebar choose **Super Code**. Three sections, one open at a time, Task status by default. Switching keeps reading position, filters, and drafts. The UI follows Harness's Chinese/English setting.

### Task status

Read-only. Shows what's already recorded in the session:

- **Goal**: the recorded task goal, or the user's original message if there is none.
- **Steps**: todos the model wrote down, shown as done/total. No steps means no invented plan or progress.
- **Actions**: tool calls and results.
- **Files**: successful file changes that can be confirmed from tool arguments or diffs, including nested PTC calls.

Notes:

- A stopped run doesn't mean the task is done.
- The file list isn't a full Git diff: indirect changes from the terminal or external scripts may be missing, and a past change doesn't mean the file still differs. Failed, pending, read-only, and inherited child-Agent operations don't count.
- Everything is expanded in a virtual list, so long histories stay smooth. There is a display limit; you'll see a notice when it's hit, and full content is in the details.
- It doesn't change prompts, model requests, or tool definitions, and writes nothing into model context.

### Agent execution

The Agent tree, with status, usage, and cache rate for each Agent.

- Drag empty space to pan; zoom with the wheel or buttons.
- Click a node to open its details in a new sidebar tab. The main conversation stays put.
- Details are shown as a chat: user task, Agent replies, expandable tool calls and results. The header shows status, tokens, and cache; open **Details** for more usage, task records, and memory activity.
- Running animations respect the system's reduced-motion setting.

The [tree screenshot](../images/agent-tree.png) comes from an isolated Harness web host with model responses from a local test fixture. It shows the UI only, not model quality.

### Memory library

Pick **This project** or **Global preferences**, then browse by topic or search (topic, summary, identifier). Click an entry for details and source. You can add, edit, and delete (with confirmation). Manually edited entries are marked as manual, with current content only and no version history.

Memory has three layers:

| Layer | What it keeps | Scope |
|---|---|---|
| Task state | Current goal, constraints, progress, checks | Current conversation |
| Project memory | Sourced project facts, lessons, agreements | Same workspace path, by topic |
| Global preferences | Preferences you explicitly want across projects | Same Harness storage root |

- To keep an agreement long-term, just tell the Agent. It's saved when the tool reports success and it shows up in the library.
- Project memory saved by an Agent must link to a real tool result; global preferences need your own words and a clear cross-project intent.
- Projects at different paths, including Git worktrees, don't share project memory.
- Memory lives in local host storage, not in project files, and the whole library is never sent to the model. At most 4 summaries from the current topic (≤2 KiB) and 4 from global preferences (≤1 KiB) are included automatically; details require an explicit read.
- Memory can't override the current request, grant permissions, or prove code is unchanged since it was recorded.
- You can browse memory from past sessions without resuming an Agent or calling the model.

### Which memory each Agent used

Click a node in the tree → open **Details** → expand **Memory activity**. It distinguishes context inclusion, summary reads, detail reads, saves, and deletions. Click a record to jump to that entry in the library.

- These are actions recorded by the host, not proof that the model understood or followed them.
- History a child Agent inherits from its parent doesn't count as its own read; failed calls don't count as reads.
- Up to the latest 100 are shown; the full record is in the session log.
- If an entry is later edited or deleted, the record stays, but the library only shows current content.

## Batched tool calls

Super Code uses Harness-native PTC: one model call can combine several tool operations, such as reading a few unrelated files at once, then decide what to do next. No separate mode needed.

- Independent reads run in parallel; writes, tests, state changes, and dependent steps run in order.
- On partial failure, successful results are kept and only failed or stale reads are retried.
- The plugin declares which of its task and memory actions can run in parallel; unknown actions run alone. Other tools follow their own Harness declarations.
- The host handles permissions, cancellation, and result storage.

Batching cuts round trips between the model and tools. It doesn't make every operation faster.

## Runtime budgets

Under the **Context settings** tab. The plugin already uses the better-performing legacy budgets, so you usually don't need to touch this. Values in parentheses are the host's own defaults, for comparison.

| Type | Includes | Applies to |
|---|---|---|
| Common budgets | Compression ratios, summary cap, PTC deadlines, retries | Super Code by default; also Standard, PTC, Minimal, and Create when "Also apply to official presets" is on |
| Super Code only | Active task record limit, task-memory capacity | Super Code only |

- "Also apply to official presets" is off by default. It only changes budgets, not official tools or prompts, and never touches custom presets.
- Saved changes apply to new Agents. Running Agents keep their settings and aren't restarted.
- Leave a field blank to use the plugin default; **Reset to defaults** clears UI overrides.
- A failed save keeps your input. If it says budgets were changed elsewhere, reload first.
- On older hosts without `ptcRuntime`, PTC deadline fields are disabled; other budgets still work.

Plugin defaults (no need to add them to your config; only write the fields you want to change):

```yaml
budgets:
  pressureBasis: window      # use the full context window; "host" follows the host policy
  thresholdRatio: 0.8        # start compressing at 80%
  retainRatio: 0.16          # keep the latest 16% verbatim; must be below thresholdRatio
  summaryMaxTokens: 8192     # summary cap
  compactionRetries: 1       # extra compression attempts
  maxOverflowRetries: 1      # overflow retries
  ptcTimeoutMs: 600000       # default PTC deadline (ms, including tool waits)
  ptcMaxTimeoutMs: 600000    # PTC deadline cap, never above the host cap
applyToOfficialPresets: false
maxTasks: 32                 # Super Code: active task records
maxContextBytes: 32768       # Super Code: task-memory context bytes
```

- A shorter deadline set explicitly on a call still applies.
- Older hosts time PTC by busy CPU time; newer hosts by elapsed time. The two aren't comparable.
- Raising `maxTasks` or `maxContextBytes` uses more context. The defaults are usually fine.

## Deletion protection

Under the **Deletion protection** tab. Default is **Relaxed**.

| Mode | Behavior |
|---|---|
| Off | No instructions, no blocking |
| Relaxed (default) | Tells Agents to delete with recoverable `trash`, in scripts too. If you explicitly ask for `rm`, it's used without extra plugin confirmation |
| Strict | No direct `rm`, even in scripts. Recognized permanent deletions need your approval each time, and only temp-file or build-artifact cleanup is allowed |

The exact Relaxed instruction: **Delete files or directories with `trash <path>` (recoverable) by default; use `rm` only for temp files or build artifacts after I've confirmed.**

- Only Super Code is protected by default. "Also apply to official presets" is off by default (independent of the budget switch with the same name).
- Saved changes apply to later commands.
- Legacy `true` means Strict, `false` means Off.

Strict mode checks terminal commands before they run for `rm`, common wrappers, inline shell scripts, and PowerShell deletion commands such as `Remove-Item`, including terminal calls inside PTC.

- Only a one-time host approval that you accept lets it through; rejection, cancellation, and errors all block. Each approval covers that one call.
- If `trash` isn't available, the Agent should use another recoverable method or stop.
- It isn't an OS sandbox: it doesn't inspect external script files, obfuscated programs, or every language's delete API. Use the host sandbox for process-level isolation.

Relaxed mode relies on instructions only and blocks nothing. Host permission checks still apply.

## MCP connection

Lets external MCP clients (such as other AI coding tools) hand tasks to DSH. Off by default, listens on `127.0.0.1` only, uses Streamable HTTP with token auth.

### Turn it on

Under the **Connection** tab:

1. Check the working directories to allow (subdirectories included).
2. Adjust the port and maximum connections if needed.
3. Turn the switch on. Changes save automatically.

Directories:

- The DSH workspace list is reread every time you open the tab. On first setup, existing workspaces are preselected; workspaces added later are **not** granted access automatically.
- Add directories with the directory picker. Uncheck to revoke; unchecking the last one also turns MCP off.

Connections:

- Maximum connections defaults to 3, up to 32, and is also the task concurrency limit.
- Disconnect clients from the Connection tab; idle connections drop after 10 minutes. Disconnecting doesn't cancel accepted tasks.
- "Connected conversations" on Home means the linked MCP connection is still online, regardless of whether the task finished. After disconnect they count as past conversations.

Port conflicts are reported directly. Use the URL shown on the page.

### Configure the client

1. Copy **Connection Prompt** from the Connection tab and give it to a client that supports Streamable HTTP MCP. It includes the URL, auth method, and tool notes, but **not** the real token.
2. Copy the token separately and configure it in the client as `Authorization: Bearer <token>`. Don't put the token in a repository or a shared prompt.
3. Keep DSH running. Rotating the token invalidates the old one immediately; update the client.

Whether a client can set up MCP from the prompt by itself depends on the client. You can also enter the URL and auth manually. The token is shown by default on the Connection tab and hidden when you leave.

### Tools

| Tool | Purpose |
|---|---|
| `dsh_sessions` | Call first after connecting: lists recent conversations per directory with status, whether they can be reused, connection capacity, and task concurrency |
| `dsh_run` | Start a task. Pass `taskId` to reuse a specific conversation, or `newConversation: true` for a new one (passing neither also creates new). It **never** picks the latest conversation on its own. Same `requestId` + same input won't dispatch twice; different input is a conflict |
| `dsh_wait` | Read task status, output, workspace changes, and new events, waiting up to 30 seconds. Without a task ID, lists all tasks page by page |
| `dsh_send` | Add a follow-up or continue in the same conversation, with a new `requestId`. Never approves permissions for you |
| `dsh_request_directory` | Ask for a new working directory; you approve it in DSH |
| `dsh_cancel` | Request cancellation of the conversation and its child tasks. Keep checking status to confirm it actually stopped |

### Requesting a new directory

The client calls `dsh_request_directory` with a `requestId`, an existing absolute `path`, and a `reason`. DSH shows a global dialog (Settings doesn't need to be open) with the client name, directory, and reason.

- Access is granted only when you click **Allow access**. A model's auto-approval can't do it for you.
- Repeat the same call to check status: `pending` / `approved` / `rejected` / `expired`.
- Tasks can't run in that directory until it's approved.
- At most 8 pending requests, expiring after 5 minutes. Rejection, stopping the service, or restarting never grants access.
- Client name and reason are filled in by the client; treat them as hints only.

### Task status and recovery

- Tasks use the host's default model, the Super Code preset, and your permission settings. Permissions are never auto-approved.
- The client's sandbox doesn't carry over to DSH. Allowed directories only control where tasks can start; they aren't a file sandbox.
- Tasks in the same workspace don't run in parallel. For parallel work, prepare separate worktrees yourself; the plugin doesn't create, delete, or merge worktrees.
- `waiting_confirmation`: go to DSH and handle the permission prompt.
- `finished`: execution ended, but `acceptance` is always `not-verified`. The caller must check the result.
- Returned file info is an observation of the Git workspace, including changes that existed before the task, so it doesn't prove the task made them. Non-Git directories or exceeded limits are marked unavailable.
- Wait timeouts and client disconnects don't cancel tasks. Turning off the connection just stops new requests.
- After a restart, prompts are never resent automatically. Find the ID via `dsh_sessions` or the task list, check the state, then continue explicitly. If the state can't be confirmed, it shows `interrupted` or `unavailable`; tasks not confirmed as stopped keep their concurrency slot.

### Storage and limits

- Task records, settings, and the token are stored in the profile's `super-code-connection` directory (directory 0700, files 0600). One service instance per profile.
- Limits: 200 task records, 128 follow-ups per task, the latest 200 events, the last 12,000 output characters. Directory-request history keeps up to 100 entries, in memory only.
- When task records are full, new tasks are rejected explicitly; old records are never dropped silently.

## Frontend Skill

The plugin ships `super-code-frontend`, used for pages, components, visual tweaks, responsive layout, interaction states, and browser checks. It focuses on:

- whether elements line up on the same edges
- whether what you see matches what you can click
- whether controls stay put, are easy to reach, and need little input

It keeps the project's own visual style, needs no particular framework, and adds no tools. Normally only its name and short description go to the model; the body and relevant references load when a task matches. You can also ask for it directly: "use super-code-frontend".

- Only presets installed or reinstalled from 0.3.3 onward include it. For existing presets, back up your customizations, then reinstall.
- A project or user skill with the same name overrides the bundled one, following host precedence.
- The browser-check part is guidance only: no enforced loop detection, no automatic long-term memory writes.
- Whether it improves frontend quality needs a separate real-task evaluation; install tests and SWE scores can't show that.
