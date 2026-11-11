---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

Read [DSH host operations](../../DSH.md) once before executing this workflow.


# Reflect

Review this conversation for recurring lessons and propose concrete improvements. One-offs and already-covered behavior do not need another rule.

1. Use the current conversation and task evidence. When essential details were compacted, use DSH history tools or a user-provided export as described in DSH.md. Mark unavailable evidence; do not mine private host storage.
2. Schedule three distinct review lenses: judgment (`references/judgment-reviewer.md`), tooling (`references/tooling-reviewer.md`), and divergent review (`references/divergent-reviewer.md`). Tooling uses the reflect tooling preference; the other lenses and synthesis use reflect judgment, divergent, synthesizer. Pass each complete template with the same scoped digest and evidence references to each DSH child. Children may read relevant exposed MCP sources but may not edit files. The root runs every phase; use sequential lenses when independent agents are unavailable and disclose it.
3. After all three reviews finish, the root starts a separate synthesis delegate with `references/synthesizer.md` and every reviewer's full findings. It spot-verifies citations through exposed sources and returns Accepted / Rejected / Backlog with routing. Children do not spawn this phase. When independent delegation is unavailable, perform it in the root and disclose the limitation. Preserve the findings and verify accepted sources before applying anything.
4. Reclassify every Accepted item before presenting the final lists. If a test, lint, metadata flag, script, type or runtime invariant can enforce it more reliably, move that entire item to Backlog with the proposed mechanism and remove it from Accepted. Do not keep the same structural proposal in both lists. Accepted is ready only when every remaining row needs a prose change that a mechanism cannot enforce.
5. Show each proposed edit, its destination and evidence. Apply only edits within the user's explicit approval. Use an existing project/user Skill override or `.dsh/skills/<name>/`; treat bundled files as read-only. A new or substantive Skill uses the bundled authoring guide. Do not persist personal preferences or file external tickets merely because this review found them.
6. Validate the touched frontmatter, relative references and affected procedure. Report applied paths, rejected items and the local backlog. Commit/push/PR follow the user's authorization and repository rules, not this Skill's existence.
