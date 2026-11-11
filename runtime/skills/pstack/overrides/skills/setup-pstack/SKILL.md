---
name: setup-pstack
description: "Configure project-local PStack role models and reasoning budgets for DSH, using only the host's available routes."
---

# Set up PStack for DSH

Record optional workflow preferences in `<workspace>/.dsh/pstack.md`. DSH owns model availability, permissions and capacity. Setup does not change host settings or global instructions.

## 1. Discover available routes

Use only tool descriptions/schemas already supplied in this conversation or a documented model-discovery tool actually exposed here. Record confirmed provider/model IDs, families and supported reasoning efforts. If that metadata is absent, stop discovery and use inheritance; filesystem investigation is not an alternative discovery interface. Do not inspect host source/install directories, profiles, configuration files, process environments or credentials to find models or hidden tool options. An MCP `dsh_models` route belongs to MCP task submission; it does not enable fields on a local `subagent` tool. When no per-call selection exists, offer `inherit-parent` and explain that the host's current model and effort apply. `auto` is an alias for inheritance, not a request for an undocumented automatic model. Never guess a route or a fast/standard field.

## 2. Read current choices

Read the project file if present. Keep custom model families, aliases, panel lists and unrelated notes. Show obsolete role keys separately before retiring them; do not remove unrelated settings. An earlier DSH file may contain generic code/judgment/exploration/verification/review keys or use budget for agent count. Show their values and resolve their intended role mappings rather than silently treating the old count as a reasoning budget. Missing preferences use inherited models and host-bounded scheduling.

## 3. Choose reasoning budget and every role

Offer the upstream budget choices, naming the recorded choice when known:

| Budget | Target reasoning effort |
|---|---|
| unlimited | max |
| large | xhigh |
| medium | high |
| small | medium |

This budget controls reasoning effort, not candidate count or concurrency. With no previous choice, large is the upstream target; it is effective only if the actual route supports it. Preserve customized families, aliases and list lengths. For an explicit model route, select the same family's highest confirmed effort at or below the target; if none is confirmed, mark the role unresolved and ask for a supported choice. Keep inherited aliases unchanged. If effort is not selectable in this preset, report the target as unsupported and the effective effort as inherited; never substitute more agents to imitate a reasoning budget.

Show all roles in the example below with their effective model/effort and any unsupported choice. For explicit routes, write a mapping with the exact confirmed provider/model IDs and an effort only when the current tool accepts it. Single-role values are aliases or confirmed route mappings. Panel values are lists of those same entries.

One entry in arena runners, architect runners or interrogate reviewers means one independent participant, including duplicate inherited aliases. Preserve the list length and queue within host capacity. The arena cross-judge pool is ordered preference: pick one confirmed route from a different family than the parent, never an inherited alias. If none is usable, run an independent inherited-model judge and disclose the missing model diversity. Swarm workers supplies the default for each worker, unless a race explicitly chooses its arms. Parallelism is a separate scheduling limit, not a panel length.

## 4. Validate and confirm

Validate each explicit route and effort against the current tool's discovery and schema. A saved route that is no longer available needs a supported choice; do not silently claim it ran. Show every role, list length, requested versus effective effort, retired keys and the complete proposed file. Confirm only choices not already authorized. Aliases always mean omit model/effort fields and inherit the host.

## 5. Write project preferences

Write the owned preference block idempotently while preserving unrelated project notes. Use this complete default role map; customized explicit routes replace aliases only after validation:

```yaml
budget: large
target-effort: xhigh
parallelism: host
roles:
  feature, refactoring: inherit-parent
  bug-fix: inherit-parent
  perf-issue: inherit-parent
  hillclimb: inherit-parent
  judgment and prose: inherit-parent
  hardest tasks: inherit-parent
  how explorer: inherit-parent
  how explainer: inherit-parent
  why investigators: inherit-parent
  why synthesizer: inherit-parent
  reflect tooling: inherit-parent
  reflect judgment, divergent, synthesizer: inherit-parent
  arena runners: [inherit-parent, inherit-parent]
  arena cross-judge pool: []
  swarm workers: inherit-parent
  architect runners: [inherit-parent, inherit-parent]
  interrogate reviewers: [inherit-parent, inherit-parent]
```

## 6. Read back and report scope

Read the saved file back and report requested and effective choices separately. PStack workflows explicitly read it at their next workflow/phase start, including in an existing conversation. It is not automatically loaded as a system rule, and it does not change an already-running child. Re-running setup updates the same project preferences.

## 7. Offer real-app verification once

Check for an existing verify-* Skill or real-app harness. If absent, offer the sibling [create-verification-skill](../create-verification-skill/SKILL.md) once. Run that workflow only on acceptance; otherwise continue.

## 8. Offer formal verification once

Check for an existing model-checking/proof Skill. If absent, offer the sibling [create-formal-verification-skill](../create-formal-verification-skill/SKILL.md) once. Run it only on acceptance. Missing external tools are reported with their setup requirements, not replaced with a simulated proof.
