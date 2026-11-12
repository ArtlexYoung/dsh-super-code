---
name: recall
description: "Reconstruct your recent working context from your own chat history, live state, and the shared record (user reports, prior fixes, incidents), then hand back a tight current-state brief. Use for 'recall my work on X', 'catch me up', 'what have I been working on', 'where did I leave off', before starting or resuming work."
disable-model-invocation: true
---

Read [DSH host operations](../../DSH.md) once before executing this workflow.


# Recall

Rebuild the user's recent working context, then verify the current state before continuing.

1. Pin the current workspace, requested topic and time window (default seven days). If the user supplied a complete handoff, use it first. Resuming one named conversation routes to the Session pickup playbook; creating lasting preferences routes to automate-me.
2. Use the DSH history interfaces described in DSH.md. Search before reading full conversations; keep the requested time range and workspace. When history tools are unavailable, use the current conversation, explicit export/handoff, Git history and task-local plans. Record unavailable history separately from an empty search; never inspect private journals or other workspaces to compensate.
3. Search by topic first and order actual history by its recorded timestamps, not opaque session IDs. Exclude the current conversation and known subagent/test noise from a prior-work search unless requested. For a large corpus, delegate disjoint slices with self-contained briefs, bounded by current capacity. Ask for topic, goal, decisions, open threads, struggles/corrections and artifacts with exact session/event citations. Small corpora stay in the parent. The root schedules the later synthesis, not the children.
4. For a named subsystem or bug, follow the sibling why workflow as reference to sweep the available shared sources. Use one source per investigator; unavailable MCP sources are stated gaps. Search only within the authorized scope.
5. Recheck surfaced commits, files, branches, PRs and issues against live state. A previous agent's summary is historical evidence, not current truth.
6. Lead with at most five capsule bullets, then one line per thread tagged `[merged #N]`, `[open PR #N]`, `[in flight <branch>]`, `[verified, uncommitted]`, `[reverted #N]` or `[planned, not started]`, using real IDs only. Follow with at most five recurring problems, including fixes that were reverted, and the single most useful concrete next action. Read and apply the sibling unslop workflow. Stay on topic, cite session/event IDs or the supplied artifact and sanitize private context before public output; do not invent a transcript path.
