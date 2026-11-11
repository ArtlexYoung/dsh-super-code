# Stable submissions

Use the bundled `scripts/submissions.mjs` from the backend instead of writing another request cache. It uses only Node built-ins and leaves host configuration unchanged. Read it and this contract before integrating it. Import it at its actual installed absolute path, or copy it unchanged into the task-owned project if that project must run without this plugin installed; preserve its license provenance.

One backend owns one task-owned JSON file. Do not point two backend processes at that file. The helper provides same-process concurrency and restart recovery, not a distributed lock or a power-loss guarantee. The file and failed atomic-write stages may contain task prompts: keep them private, ignored by Git, and exclude secrets. The helper writes no credentials and never cleans user files.

```js
import path from 'node:path'
import { openSubmissions } from '<PSTACK_ROOT>/skills/make-bot-ui/scripts/submissions.mjs'

const submissions = await openSubmissions(path.join(taskScratch, 'submissions.json'))

// After validating browser fields, authorizing cwd and choosing the conversation:
const payload = {
  action, arguments: validatedArguments,
  cwd: path.resolve(cwd), prompt: fixedPrompt,
  conversation: conversation.mode === 'new'
    ? { mode: 'new' } : { mode: 'existing', taskId: conversation.taskId },
  selection: confirmedModelSelection ?? {},
}
const admission = await submissions.submit(requestId, payload, async (saved, stableId) => {
  // callDshRun parses the MCP result and throws when isError is true.
  const view = await callDshRun({
    requestId: stableId, cwd: saved.cwd, prompt: saved.prompt,
    ...(saved.conversation.mode === 'new'
      ? { newConversation: true } : { taskId: saved.conversation.taskId }),
    ...saved.selection,
  })
  return { taskId: view.taskId }
})
// admission = { requestId, replay, result: { taskId } }
// Recover this backend's accepted task IDs after a restart:
const ownedIds = new Set(submissions.receipts().map(row => row.result.taskId))
```

`submit` accepts a requestId matching `[a-zA-Z0-9_.:-]{1,128}`, a plain JSON object and a dispatch function. Include every field affecting execution in the payload. Object-key order is normalized; array order and actual values matter. Normalize paths, optional fields and conversation choices once at the backend boundary. The helper rejects non-finite numbers, sparse arrays and non-JSON values.

- Identical concurrent submissions join one dispatch, including its rejection. Do not add an automatic retry loop around them.
- Changed content with an existing or in-flight ID throws `error.code === 'request-conflict'`; map this to HTTP 409 before returning any cached receipt.
- Intent is saved before dispatch. After an ambiguous transport error, the request stays unconfirmed. A later explicit retry uses the original payload and same requestId; DSH's own idempotency resolves whether it was accepted.
- A successful dispatch must return a JSON object with `taskId`; save only the receipt fields the backend needs. Accepted receipts survive restart. `receipts()` returns copies, not mutable store data.
- A corrupt/incompatible store fails startup. Initial persistence failure prevents dispatch. Result persistence failure is reported; a same-process retry saves the accepted receipt without dispatching again. After a crash, the original unconfirmed intent still recovers through DSH using its stable ID.

Use `dsh_wait`/`dsh_read` for live state; a cached receipt is neither current status nor acceptance proof. The HTTP handler owns error presentation, transport lifetime, timeouts, allowed actions/directories and per-task authorization. Preserve exact host errors. Keep the helper's failed atomic-write stages for recovery rather than silently discarding state.
