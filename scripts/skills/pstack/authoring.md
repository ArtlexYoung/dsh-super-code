# Author a Skill for DSH

1. Locate an existing project/user Skill before adding a duplicate. Use `.dsh/skills/<name>/SKILL.md` for a new project Skill; ask before writing a user-wide Skill. Treat the bundled package as read-only.
2. Write YAML frontmatter with a unique `name`, a one-sentence `description`, and an explicit invocation choice. Set `disable-model-invocation: true` for a user-only workflow; omit it when the user wants the model to discover and invoke it. A slash command follows native registration; no command manifest is needed.
3. Write the steps, expected outputs, verification and error/blocked paths. Use the host's actual tools and relative links to packaged resources. Keep shared references separate and load them only on the relevant branch. Don't copy another runtime's tool names or model IDs.
4. Validate frontmatter, names and all relative links. Run the procedure on a task-owned fixture; a deterministic parser check alone doesn't prove the instructions work. Subjective preference drafts need the user's feedback rather than a fake score.
5. Show the changed files, what was actually verified and what remains. Commit, push or open a PR only within the user's authorization and repository rules.
