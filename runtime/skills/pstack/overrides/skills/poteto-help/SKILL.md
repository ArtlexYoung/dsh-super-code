---
name: poteto-help
description: Guides users through pstack setup, /poteto-mode, and picking the skill, playbook, or principle for a task. Type /poteto-help with a question.
disable-model-invocation: true
---

# PStack for DSH

For a help question, answer it and provide at most one suggested prompt; do not start a workflow. Read the linked adapted Skill before recommending it. For a direct request to do the work, route to that Skill. When the need is unclear, ask once whether it is setup, starting a task, choosing a workflow, fixing a run or personalizing conventions. If a Skill is absent from the short table below, read its native catalog entry and route by its actual description.

PStack is an optional workflow package under Settings → Super Code preset → Preset Skills. The package switch updates existing conversations' catalog, subsequent loads and native slash menus after saving. It does not retract instructions already in context.

Start with `/poteto-mode` plus your task. It routes to the included playbooks and reads their sibling Skills as references. You can also invoke any of the 58 Skills through the native `/` menu. Names shared with a project/user Skill use native priority; when Matt and PStack both supply tdd or teach, the earlier registered Matt entry wins.

| Need | Workflow |
|---|---|
| Optional project budget and delegation preferences | [setup-pstack](../setup-pstack/SKILL.md) |
| Types and architecture before implementation | [architect](../architect/SKILL.md) |
| Independent candidate designs and synthesis | [arena](../arena/SKILL.md) |
| Partitioned coverage or experiments | [swarm](../swarm/SKILL.md) |
| Explain runtime behavior or decision history | [how](../how/SKILL.md), [why](../why/SKILL.md) |
| Review existing work or risk beyond the diff | [interrogate](../interrogate/SKILL.md), [blast-radius](../blast-radius/SKILL.md) |
| Recover prior context or summarize this chat | [recall](../recall/SKILL.md), [ketchup](../ketchup/SKILL.md) |
| Create or maintain real feature verification | [create-verification-skill](../create-verification-skill/SKILL.md), [maintain-verification-skill](../maintain-verification-skill/SKILL.md) |
| Review lessons or draft personal conventions | [reflect](../reflect/SKILL.md), [automate-me](../automate-me/SKILL.md) |
| Build a UI that submits work to DSH | [make-bot-ui](../make-bot-ui/SKILL.md) |
| Keep a sourced decision trail | [show-me-your-work](../show-me-your-work/SKILL.md) |
| Generate or maintain a formal property check | [create-formal-verification-skill](../create-formal-verification-skill/SKILL.md), [maintain-formal-verification-skill](../maintain-formal-verification-skill/SKILL.md) |
| Explain a model-checker's result | [statechart](../statechart/SKILL.md) |

All 23 poteto-mode playbooks remain available: feature, bug fix, refactoring, perf, prototype, visual parity, runtime/trace forensics, investigation, eval, hillclimb, multi-phase planning, autonomous run, orchestrate, session pickup, pause, PR opening/babysitting/shipping, both autopilot modes, worktree cleanup and Skill authoring. Read the mode's routing table; playbooks are not extra slash commands.

DSH.md defines portable delegation, models, history, tool discovery, permissions and optional dependencies. In particular, role names are prompt templates; the host owns actual model selection, delegation depth and approvals. A different-model review is labeled only when it actually used another allowed route. Missing history tools use an explicit handoff/export rather than private journals. External authoring/control/cleanup Skills are replaced with bundled DSH procedures.

For a long run, name the finish predicate and keep a resume plan. DSH background completions resume the root; no extra host instance or fabricated loop command is needed. For a planning-only request, deliver the plan and stop before implementation. Remote publication, deletion and service exposure continue to follow the user's scope and host approvals.

If setup preferences are absent and the answer concerns cost or role selection, offer setup once; otherwise use inherited host models. Reasoning budget requests an effort only where the actual route supports it; smaller panels reduce independent attempts, and concurrency only changes scheduling. When a verification harness or formal check is missing and relevant to the question, point to the corresponding creation Skill. Preserve the one-time optional offers; don't start either as part of answering help.

Troubleshooting: if the package is missing from `/`, check its switch and preset composition; instructions already loaded cannot be removed by switching it off. If a role choice has no effect, confirm the preference was read and the actual tool exposes that route/effort. If writers collide, isolate output paths/worktrees. If an unattended task stops, inspect the checkpoint and actual notification/scheduler capability rather than inventing a custom mode or timer. Keep the user's finish predicate in the next prompt.
