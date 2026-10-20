/** Observe only request metadata; never record prompts, credentials or headers. */
import { appendFileSync } from 'node:fs'

const originalFetch = globalThis.fetch
const destination = new URL(process.env.DSH_BASE_URL + '/responses')
const recordPath = process.env.DSH_EVAL_WIRE_RECORD
const expectedEffort = process.env.DSH_REASONING_EFFORT
const expectedModel = process.env.DSH_MODEL
let sequence = 0

globalThis.fetch = async function observedFetch(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.origin !== destination.origin || url.pathname !== destination.pathname) {
    return originalFetch.call(this, input, init)
  }
  const body = typeof init?.body === 'string' ? init.body
    : input instanceof Request ? await input.clone().text() : ''
  const payload = JSON.parse(body)
  const startedMs = Date.now()
  const record = { event: 'request', sequence: ++sequence, at: new Date().toISOString(),
    model: payload.model, reasoning_effort: payload.reasoning?.effort,
    max_output_tokens: payload.max_output_tokens }
  appendFileSync(recordPath, JSON.stringify(record) + '\n', { mode: 0o600 })
  if (record.reasoning_effort !== expectedEffort || record.model !== expectedModel) {
    throw new Error('Official evaluation wire model or reasoning effort differs from frozen configuration')
  }
  const response = await originalFetch.call(this, input, init)
  appendFileSync(recordPath, JSON.stringify({ event: 'response', sequence: record.sequence,
    status: response.status, at: new Date().toISOString() }) + '\n', { mode: 0o600 })
  const clone = response.clone()
  void (async () => {
    let buffer = ''
    const reader = clone.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()
    try {
      while (true) {
        const {done, value} = await reader.read()
        if (done) break
        buffer += decoder.decode(value, {stream:true})
        let end
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0,end).trim(); buffer = buffer.slice(end+1)
          if (!line.startsWith('data:')) continue
          try {
            const event = JSON.parse(line.slice(5))
            if (['response.completed','response.incomplete','response.failed'].includes(event.type)) {
              appendFileSync(recordPath, JSON.stringify({event:'finished',sequence:record.sequence,at:new Date().toISOString(),duration_ms:Date.now()-startedMs,type:event.type,model:event.response?.model,status:event.response?.status,usage:event.response?.usage,error:event.response?.error})+'\n',{mode:0o600})
            }
          } catch {}
        }
      }
    } catch(error) { appendFileSync(recordPath,JSON.stringify({event:'stream-error',sequence:record.sequence,at:new Date().toISOString(),duration_ms:Date.now()-startedMs,message:String(error)})+'\n',{mode:0o600}) }
  })()
  return response
}
