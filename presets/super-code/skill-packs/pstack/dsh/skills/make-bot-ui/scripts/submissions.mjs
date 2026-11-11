import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const identity = /^[a-zA-Z0-9_.:-]{1,128}$/
function json(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('Expected finite, acyclic JSON data')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) throw new TypeError('Expected dense JSON array')
      return Array.from(value, item => json(item, ancestors))
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Expected plain JSON object')
    const result = Object.create(null)
    for (const key of Object.keys(value).sort()) result[key] = json(value[key], ancestors)
    return result
  } finally { ancestors.delete(value) }
}
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected JSON object')
  return json(value)
}
function receipt(value) {
  const result = object(value)
  if (typeof result.taskId !== 'string' || !identity.test(result.taskId)) throw new TypeError('Dispatch must return a taskId receipt')
  return result
}

/** One backend owns this file. Dispatch owns transport/timeouts; this store never retries it. */
export async function openSubmissions(file) {
  const entries = new Map(), inflight = new Map()
  let saved
  try { saved = JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (saved !== undefined) {
    if (saved?.version !== 1 || !Array.isArray(saved.entries)) throw new Error('Invalid submission store')
    for (const row of saved.entries) {
      if (!row || typeof row.requestId !== 'string' || !identity.test(row.requestId) || entries.has(row.requestId)) throw new Error('Invalid or duplicate stored requestId')
      const payload = object(row.payload)
      entries.set(row.requestId, { requestId: row.requestId, payload, ...(Object.hasOwn(row, 'result') ? { result: receipt(row.result) } : {}) })
    }
  }
  let saving = Promise.resolve()
  function save() {
    const pending = saving.then(async () => {
      await mkdir(dirname(file), { recursive: true })
      const stage = file + '.' + randomUUID() + '.tmp'
      // A failed rename retains this task-owned stage for recovery; never wipe the store.
      await writeFile(stage, JSON.stringify({ version: 1, entries: [...entries.values()] }) + '\n', { mode: 0o600, flag: 'wx' })
      await rename(stage, file)
    })
    saving = pending.catch(() => {})
    return pending
  }
  return {
    receipts() {
      return [...entries.values()].filter(row => row.result).map(row => ({ requestId: row.requestId, result: structuredClone(row.result) }))
    },
    async submit(requestId, input, dispatch) {
      if (typeof requestId !== 'string' || !identity.test(requestId)) throw new TypeError('Invalid requestId')
      const payload = object(input), key = JSON.stringify(payload)
      const pending = inflight.get(requestId)
      if (pending) {
        if (pending.key !== key) throw Object.assign(new Error('requestId already used for different content'), { code: 'request-conflict' })
        return { ...structuredClone(await pending.result), replay: true }
      }
      const result = (async () => {
        let row = entries.get(requestId)
        if (row && JSON.stringify(row.payload) !== key) throw Object.assign(new Error('requestId already used for different content'), { code: 'request-conflict' })
        if (!row) { row = { requestId, payload }; entries.set(requestId, row) }
        await save()
        if (row.result) return { requestId, replay: true, result: structuredClone(row.result) }
        const accepted = receipt(await dispatch(structuredClone(row.payload), requestId))
        row.result = accepted
        await save()
        return { requestId, replay: false, result: structuredClone(accepted) }
      })()
      inflight.set(requestId, { key, result })
      try { return await result }
      finally { if (inflight.get(requestId)?.result === result) inflight.delete(requestId) }
    },
  }
}
