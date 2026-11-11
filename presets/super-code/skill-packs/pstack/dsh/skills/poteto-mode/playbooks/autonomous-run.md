### Autonomous run

Own the exit condition. Define done, then drive the authorized work to it.

1. State a checkable finish predicate before the first iteration. Keep the scope, approval gates and stop condition in the task plan.
2. Choose a real continuation mechanism. For local work, continue the work/verify cycle in the current turn. For a DSH child, use its actual result and completion-notification contract in DSH.md. For external CI, merge or ref changes, use an exposed event subscription or a task-owned watcher only when the host can report its completion. Use an exposed scheduler only when one actually exists and the user authorized it. Otherwise save the last observation and exact next check; report that unattended timed resumption is unavailable. A checkpoint does not run a heartbeat. Do not start a sleeping shell loop, another DSH or an invented built-in command.
3. Each iteration makes the smallest justified change and tests the predicate. Retain verified advances, revert only this run's failed experiment, and commit only under the repository rules and authorization. Verify each unit before starting the next.
4. Address discoveries that block the goal. Keep unrelated improvements separate. A PR, publication, external message, installation or deletion still requires its own authorization; a request to continue is not that authorization. Continue independent work while a specific decision is pending.
5. Record each iteration through the show-me-your-work workflow, including the change, evidence, predicate state and pending continuation. When only waiting remains, yield for actual host notifications. If no continuation facility exists, hand back the checkpoint rather than claiming the task is still running.
6. Stop when the predicate is met, on an explicit stop, or at a concrete blocker after examining alternatives. A plateau calls for another hypothesis, not a relaxed finish condition. Account for every child and task-owned watcher on exit.

Reply with the finish predicate, iterations, verified advances, discarded attempts, final state and any precise resume point.
