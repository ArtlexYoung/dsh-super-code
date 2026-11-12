### Pause safely

An explicit pause stops new work; "keep going" does not request a pause.

1. Stop at a safe atomic boundary, preserving uncommitted work. Interrupt only this run's children through the published host interface when necessary; never terminate unrelated processes.
2. Write a task-local resume note with the goal, decisions, branch/worktree, verified work, current jobs/children, next step and evidence paths. Preserve the decision log instead of duplicating it.
3. Commit only when authorized and the repository rules permit it. Do not commit failing work just to pause, push, create a PR or modify timestamps. If uncommitted, say so and name its location.
4. Report what is on disk, what remains running or was stopped, and the exact first action on resume. A checkpoint is not a claim that work will continue in the background.
