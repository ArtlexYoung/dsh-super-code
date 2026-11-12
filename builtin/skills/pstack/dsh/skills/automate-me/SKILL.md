---
name: automate-me
description: "Use for \"automate me\", \"create/update/refresh my -mode skill\", \"turn/capture my preferences or working style into a skill\", or wanting agents to follow how the user works. Drafts or revises a personal -mode skill with the bundled DSH authoring guide + unslop, optionally pulling fresh evidence from recent transcripts."
disable-model-invocation: true
---

Read [DSH host operations](../../DSH.md) once before executing this workflow.


# Automate me

Turn the user's explicit working preferences into a project-local `-mode` Skill, without writing global instructions.

1. Look for an existing matching mode under the current project's `.dsh/skills/` and other Skill roots the host actually advertises. Preserve its category and path. If the intent to replace it is unclear, ask update versus a fresh mode.
2. If the user wants history mining, scope it to this workspace and a stated time window. For an existing mode, inspect its last edit and mine only later history unless the user asks for a wider review. Use the DSH history interfaces in DSH.md; absent history, work from the supplied conversation/export and ask about the missing preferences. Never treat tool availability as permission to inspect unrelated chats. Partition large authorized corpora across DSH children and cross-check patterns across slices; repeated observations support a convention, a lone incidental instruction does not.
3. Separate recurring preferences from isolated task instructions. Cross-check apparent patterns against explicit corrections. Ask one or two concise questions about the missing choices; do not dump a long questionnaire.
4. Cluster only supported conventions into the sections they need: response style, autonomy, investigation, delegation, code/prose, verification and process. Draft with the bundled authoring guide, then read and apply the sibling unslop workflow to the prose. For a new mode, use `.dsh/skills/<handle>-mode/SKILL.md`, or the existing project category. Default to user-only invocation. Use the chosen handle in the trigger, keep every preference grounded, and reference supporting workflows by relative path rather than copying them.
5. Show the draft for feedback. Retain existing preferences the user has not contradicted. Validate YAML, relative links and supported tool names; subjective preferences need the user's review rather than a fake benchmark.
6. Save only within the authorized destination and read it back. Report the path, scope and invocation. Local commit, push and PR require their respective authorization; a personal Skill request does not create a PR automatically.
