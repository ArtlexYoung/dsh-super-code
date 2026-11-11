---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

Read [DSH host operations](../../DSH.md) once before executing this workflow.


# Arena

Open a todolist with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Read the arena runners panel in project preferences. Its list length is the candidate count, including a single explicit seat or repeated inherited aliases. Without a configured panel, use two independent candidates; honor an explicit user count. Resolve each confirmed route through DSH.md; preserve seats with inherited-model runs when a route is unavailable only after disclosing the change. Keep candidate count separate from concurrency: queue within available capacity. Use DSH delegation as specified in DSH.md: role-specific self-contained briefs, inherited host model by default, and only actual allowed model routes when the current tool exposes them. The root schedules every dependent phase; children return findings rather than spawning grandchildren. Keep the role count and review purpose below; queue within host capacity. A no-write brief does not strip MCP access.
4. Give each candidate its own output location (a git worktree where possible, otherwise `scratch/arena-<slug>/candidate-<n>/`), per the **separate-before-serializing-shared-state** principle skill.

## Phase B: Fan out

Run the N independent DSH candidates with the task, shared grounding path, unique output path and a short rationale naming alternatives considered and rejected. Follow the actual synchronous or managed result contract in DSH.md, queuing within capacity. The root starts later phases only after the required results exist.

If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates finish, ask an independent no-write DSH judge to score them against the rubric by path label. Read the arena cross-judge pool in project preferences in order and select one confirmed allowed route from another family when the actual tool supports it; inherited aliases are not cross-family choices. Otherwise use an inherited-model judge and disclose that it is not cross-model. If delegation is unavailable, perform the rubric review directly and report that independent judging did not run. The judge runs alongside your reading in Phase D, after candidates stop writing.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge when Phase C ran one. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Don't paste mechanically.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the **prove-it-works** principle skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict or that Phase C skipped the judge, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.
