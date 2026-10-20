/** Observed request ledger. Missing usage is never treated as zero cost. */
const rateLimited = failure => failure?.code === 'RATE_LIMIT'
  || /(?:request rate exceeds|\bTPM limit\b|rate.?limit|too many requests)/iu.test(String(failure?.message ?? ''))

export function requestsFromEvents(events) {
  const slots = new Map(), epochs = new Map(), failed = new Set()
  const auxiliary = new Map(), auxiliaryResults = new Map()
  let route = {}, start
  for (const raw of events) {
    const source = raw.data?.source
    const record = raw.type === 'user/message' && source?.kind === 'plugin' && source.plugin === 'dsh-super-code/reflection-record/v1'
      && source.form === 'snapshot' && source.sections?.length === 1 ? source.sections[0] : undefined
    const e = record ? { ...raw, type: record.name, data: JSON.parse(record.text) } : raw
    const d = e.data ?? {}, coord = `${d.turn}/${d.step}`
    if (e.type === 'super-code/reflection-start') auxiliary.set(e.seq, e)
    if (e.type === 'super-code/reflection-result') {
      const attempt = auxiliary.get(d.startSeq)
      if (attempt && (!['error', 'aborted'].includes(d.outcome) || d.usage !== undefined)) {
        auxiliaryResults.set(d.startSeq, { id: `reflection/${d.startSeq}`, event: e, start: attempt.time,
          route: { provider: d.provider, model: d.model }, usage: d.usage, sources: [e.type], purpose: 'reflection' })
      }
    }
    if (e.type === 'request/context') route = { provider: d.provider, model: d.model }
    if (e.type === 'step/start') start = e.time
    if (e.type === 'llm/retry-started') {
      epochs.set(coord, (epochs.get(coord) ?? 0) + 1)
      start = e.time
    }
    if (e.type === 'llm/retry' && rateLimited(d.failure)) {
      const key = `${coord}/${epochs.get(coord) ?? 0}`
      failed.add(key)
      slots.delete(key)
    }
    if (!['assistant/message', 'assistant/attempt'].includes(e.type)) continue
    const key = `${coord}/${epochs.get(coord) ?? 0}`
    if (failed.has(key)) continue
    const streamed = (d.stream ?? []).map(r => r.chunk ?? r).filter(r => r.type === 'usage').at(-1)?.usage
    const usage = d.usage ?? streamed
    const previous = slots.get(key)
    slots.set(key, { id: key, event: e, start, route,
      usage: usage ?? previous?.usage, sources: [...(previous?.sources ?? []), e.type] })
  }
  return [...slots.values(), ...auxiliaryResults.values()].sort((a, b) => a.event.seq - b.event.seq)
}
