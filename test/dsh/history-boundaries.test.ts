import test from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { connectionHistoryPage } from '../../src/dsh/connection-history.js'
import { ConnectionHost } from '../../src/dsh/connection-host.js'
import type { ConnectionHostServices } from '../../src/dsh/connection-host.js'

const message = (seq: number, text: string): SessionEvent => ({ seq, time: seq, type: 'user/message',
  data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] },
}) as SessionEvent

test('history seeks a late cursor without reading the preceding journal', () => {
  let reads = 0
  const events = new Proxy(Array.from({ length: 100000 }, (_, i) => message(i * 2, String(i))), {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++
      return Reflect.get(target, key, receiver)
    },
  })
  const page = connectionHistoryPage(events, { seq: 199997, offset: 0 }, 1)
  assert.equal(page.entries[0]?.text, '99999')
  assert.equal(page.hasMore, false)
  assert.ok(reads < 64, `Late cursor read ${reads} journal entries`)
})

test('history skips inherited events without copying the journal or changing sequence identities', () => {
  const events = [message(0, 'inherited'), message(1, 'own'), message(4, 'last')]
  const first = connectionHistoryPage(events, { seq: 0, offset: 0 }, 1, 1)
  assert.deepEqual(first.entries.map(row => [row.seq, row.text]), [[1, 'own']])
  assert.deepEqual(first.nextCursor, { seq: 2, offset: 0 })
  const second = connectionHistoryPage(events, first.nextCursor, 1, 1)
  assert.deepEqual(second.entries.map(row => [row.seq, row.text]), [[4, 'last']])
  assert.equal(second.hasMore, false)
  assert.deepEqual(connectionHistoryPage(events, { seq: 0, offset: 0 }, 1, 3).entries, [])
  assert.throws(() => connectionHistoryPage(events, { seq: 0, offset: 1 }, 1, 1), /invalid-history-cursor/)
})

test('history handles empty journals, holes and exact end offsets', () => {
  assert.equal(connectionHistoryPage([], { seq: 0, offset: 0 }, 1).hasMore, false)
  const events = [message(5, 'abc'), message(9, 'next')]
  assert.equal(connectionHistoryPage(events, { seq: 1, offset: 0 }, 1).entries[0]?.seq, 5)
  assert.throws(() => connectionHistoryPage(events, { seq: 8, offset: 1 }, 1), /invalid-history-cursor/)
  assert.equal(connectionHistoryPage(events, { seq: 5, offset: 3 }, 1).entries[0]?.seq, 9)
  assert.equal(connectionHistoryPage(events, { seq: 10, offset: 0 }, 1).hasMore, false)
})

test('history continues past bounded private-only pages and preserves Unicode at the page budget', () => {
  const events = Array.from({ length: 2001 }, (_, seq) => ({ seq, time: seq, type: 'request/header', data: {} }) as SessionEvent)
  events.push(message(2001, 'x'.repeat(3999) + '🧪尾部'))
  const first = connectionHistoryPage(events, { seq: 0, offset: 0 }, 20)
  assert.deepEqual(first.entries, [])
  assert.deepEqual(first.nextCursor, { seq: 2000, offset: 0 })
  assert.equal(first.hasMore, true)
  const second = connectionHistoryPage(events, first.nextCursor, 20)
  const third = connectionHistoryPage(events, second.nextCursor, 20)
  assert.equal([...second.entries, ...third.entries].map(row => row.text).join(''), 'x'.repeat(3999) + '🧪尾部')
  assert.equal(third.hasMore, false)
})

test('history rejects noncanonical cursors and invalid limits before reading events', () => {
  const events = new Proxy([] as SessionEvent[], { get() { assert.fail('Invalid input read the journal') } })
  for (const seq of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => connectionHistoryPage(events, { seq, offset: 0 }, 1), /invalid-history-cursor/)
  }
  for (const offset of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => connectionHistoryPage(events, { seq: 0, offset }, 1), /invalid-history-cursor/)
  }
  for (const limit of [0, 21, 1.5, NaN, Infinity]) {
    assert.throws(() => connectionHistoryPage(events, { seq: 0, offset: 0 }, limit), /invalid-history-cursor/)
  }
})

test('host history skips inheritance without a full journal copy and always releases the snapshot', async () => {
  let disposed = 0, observed = 0
  const events = new Proxy([message(0, 'inherited'), message(4, 'own')], {
    get(target, key, receiver) {
      assert.notEqual(key, 'slice', 'History copied the whole snapshot')
      return Reflect.get(target, key, receiver)
    },
  })
  const host = new ConnectionHost({
    subagents: { listDescendants: async () => [{ id: 'child', parentId: 'root', kind: 'managed' }] },
    query: { observeSession: async () => {
      observed++
      return { events, inheritedEventCount: 1, [Symbol.dispose]() { disposed++ } }
    } },
  } as unknown as ConnectionHostServices)
  const page = await host.history('root', { seq: 0, offset: 0 }, 1, 'child')
  assert.equal(page.sessionId, 'child')
  assert.deepEqual(page.entries.map(row => row.text), ['own'])
  assert.equal(disposed, 1)
  await assert.rejects(host.history('root', { seq: 4, offset: 99 }, 1), /invalid-history-cursor/)
  assert.equal(disposed, 2)
  await assert.rejects(host.history('root', { seq: 0, offset: 0 }, 1, 'unrelated'), /history-session-not-owned/)
  assert.equal(observed, 2, 'An unrelated session snapshot must never be opened')
})

test('task observation scans each own event once without copying or reading inherited history', async () => {
  const inherited = 80000, count = 100000
  let reads = 0, disposed = 0
  const events = new Proxy(Array.from({ length: count }, (_, seq) => message(seq, 'history')), {
    get(target, key, receiver) {
      assert.notEqual(key, 'slice', 'Observation copied the journal')
      if (typeof key === 'string' && /^\d+$/.test(key)) {
        assert.ok(Number(key) >= inherited, 'Observation read inherited history')
        reads++
      }
      return Reflect.get(target, key, receiver)
    },
  })
  events[inherited] = { seq: inherited, time: 100, type: 'user/message',
    data: { source: { kind: 'user', rpcId: 'current' }, content: [{ type: 'text', text: 'current request' }] } } as SessionEvent
  events[count - 2] = { seq: count - 2, time: 101, type: 'assistant/message',
    data: { content: [{ type: 'text', text: '完整结果 😀' }] } } as SessionEvent
  events[count - 1] = { seq: count - 1, time: 102, type: 'turn/end', data: { reason: { kind: 'completed' } } } as SessionEvent
  const host = new ConnectionHost({
    agents: { get: () => ({ status: 'idle' }) },
    query: { observeSession: async () => ({ events, inheritedEventCount: inherited, [Symbol.dispose]() { disposed++ } }) },
    subagents: { listDescendants: async () => [] },
  } as unknown as ConnectionHostServices)
  const observed = await host.observe('root', 'current')
  assert.equal(observed.status, 'finished')
  assert.equal(observed.output, '完整结果 😀')
  assert.equal(observed.latestRequestId, 'current')
  assert.equal(reads, count - inherited)
  assert.equal(disposed, 1)
})

test('one observation retains the requested result, latest admission and own child failure time independently', async () => {
  const root = [
    { seq: 0, time: 99999, type: 'user/message', data: { source: { rpcId: 'current' } } },
    { seq: 1, time: 100, type: 'user/message', data: { source: { rpcId: 'current' } } },
    { seq: 2, time: 101, type: 'assistant/message', data: { content: [{ type: 'text', text: 'Requested result' }] } },
    { seq: 3, time: 102, type: 'turn/end', data: { reason: { kind: 'completed' } } },
    { seq: 4, time: 200, type: 'turn/start', data: { turn: 2 } },
    { seq: 5, time: 201, type: 'user/message', data: { source: { rpcId: 'newer' } } },
    { seq: 6, time: 202, type: 'assistant/message', data: { content: [{ type: 'text', text: 'Later result' }] } },
    { seq: 7, time: 203, type: 'turn/end', data: { reason: { kind: 'error' } } },
  ] as SessionEvent[]
  let endedAt = 99, disposed = 0
  const host = new ConnectionHost({
    agents: { get: () => ({ status: 'idle' }) },
    query: { observeSession: async (id: string) => ({
      events: id === 'root' ? root : [
        { seq: 0, time: 99999, type: 'turn/end', data: { reason: { kind: 'error' } } },
        { seq: 1, time: endedAt, type: 'turn/end', data: { reason: { kind: 'error' } } },
      ], inheritedEventCount: 1, [Symbol.dispose]() { disposed++ },
    }) },
    subagents: { listDescendants: async () => [{ id: 'child', parentId: 'root', kind: 'managed' }] },
  } as unknown as ConnectionHostServices)
  const previousChild = await host.observe('root', 'current')
  assert.equal(previousChild.status, 'finished')
  assert.equal(previousChild.output, 'Requested result')
  assert.equal(previousChild.latestRequestId, 'newer')
  assert.equal(previousChild.observation?.lastEventSeq, 3)
  endedAt = 100
  const currentChild = await host.observe('root', 'current')
  assert.equal(currentChild.status, 'failed')
  assert.equal(currentChild.output, 'Requested result')
  assert.equal(currentChild.latestRequestId, 'newer')
  assert.equal(disposed, 4)
})

test('observation remains conservative with no own events and releases a snapshot when scanning fails', async () => {
  let fail = false, disposed = 0
  const events = new Proxy([message(0, 'inherited')], {
    get(target, key, receiver) {
      if (fail && key === '0') throw new Error('Snapshot access failed')
      return Reflect.get(target, key, receiver)
    },
  })
  const host = new ConnectionHost({
    agents: { get: () => ({ status: 'idle' }) },
    query: { observeSession: async () => ({ events, inheritedEventCount: fail ? 0 : 1, [Symbol.dispose]() { disposed++ } }) },
    subagents: { listDescendants: async () => [] },
  } as unknown as ConnectionHostServices)
  const empty = await host.observe('root', 'not-admitted')
  assert.equal(empty.status, 'running')
  assert.equal(empty.output, '')
  assert.equal(empty.latestRequestId, '')
  fail = true
  assert.equal((await host.observe('root', 'not-admitted')).status, 'unavailable')
  assert.equal(disposed, 2)
})

test('complete pagination preserves sparse Unicode journals without duplicates or omitted public text', () => {
  let seed = 0x5c0de
  const random = (max: number): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed % max
  }
  for (let trial = 0; trial < 16; trial++) {
    let seq = 0
    const events = Array.from({ length: 80 }, () => {
      seq += 1 + random(4)
      return random(4) === 0
        ? { seq, time: 0, type: 'request/header', data: {} } as SessionEvent
        : message(seq, 'a中文🧪'.repeat(random(1500)))
    })
    const inherited = random(12), expected = events.slice(inherited).filter(event => event.type === 'user/message')
      .map(event => ({ seq: event.seq, text: (event.data as any).content[0].text as string })).filter(row => row.text)
    const actual: { seq: number; text: string }[] = []
    let cursor = { seq: 0, offset: 0 }, done = false
    for (let pageNumber = 0; pageNumber < 500; pageNumber++) {
      const page = connectionHistoryPage(events, cursor, 1 + random(20), inherited)
      for (const row of page.entries) {
        assert.equal(row.text.isWellFormed(), true)
        const prior = actual.at(-1)
        if (prior?.seq === row.seq) prior.text += row.text
        else actual.push({ seq: row.seq, text: row.text })
      }
      if (!page.hasMore) { done = true; break }
      assert.ok(page.nextCursor.seq > cursor.seq || page.nextCursor.seq === cursor.seq && page.nextCursor.offset > cursor.offset)
      cursor = page.nextCursor
    }
    assert.equal(done, true, 'Pagination did not terminate')
    assert.deepEqual(actual, expected)
  }
})
