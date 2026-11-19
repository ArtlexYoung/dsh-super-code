import test from 'node:test'
import assert from 'node:assert/strict'
import { ConnectionHost } from '../../src/dsh/connection-host.js'
import type { ConnectionHostServices } from '../../src/dsh/connection-host.js'

function fixture(source: string | undefined) {
  let scans = 0, observations = 0, disposals = 0, status = 'idle', inheritedEventCount = 0
  const journal = (output: string) => [
    { seq: 0, time: 1, type: 'user/message', get data() { scans++; return { source: { rpcId: 'request' } } } },
    { seq: 1, time: 2, type: 'assistant/message', get data() { scans++; return { message: { content: [{ type: 'text', text: output }] } } } },
    { seq: 2, time: 3, type: 'turn/end', get data() { scans++; return { reason: { kind: 'completed' } } } },
  ]
  let events = Object.freeze(journal('原结果'))
  const host = new ConnectionHost({
    agents: { get: () => ({ status }) }, subagents: { listDescendants: async () => [] },
    query: { observeSession: async () => {
      observations++
      return { ...(source ? { source } : {}), events, inheritedEventCount, [Symbol.dispose]() { disposals++ } }
    } },
  } as unknown as ConnectionHostServices)
  return { host, counts: () => ({ scans, observations, disposals }),
    status: (value: string) => { status = value }, inherited: (value: number) => { inheritedEventCount = value },
    replace: (output: string) => { events = Object.freeze(journal(output)) },
  }
}

test('只复用同一个不可变冷快照的解析，每次仍向宿主观察并释放切片', async () => {
  const f = fixture('prepared')
  const observed = await f.host.observe('root', 'request')
  assert.equal(observed.output, '原结果')
  observed.observation!.lastEventSeq = 999
  const first = f.counts()
  assert.ok(first.scans > 0)
  const repeated = await f.host.observe('root', 'request')
  assert.equal(repeated.output, '原结果')
  assert.equal(repeated.observation!.lastEventSeq, 2, '调用方修改旧响应不影响后续观察')
  repeated.observation!.lastEventSeq = 888
  assert.equal((await f.host.observe('root', 'request')).observation!.lastEventSeq, 2)
  assert.equal(f.counts().scans, first.scans)
  assert.deepEqual(f.counts(), { scans: first.scans, observations: 3, disposals: 3 })
  f.replace('相同序号的新结果')
  assert.equal((await f.host.observe('root', 'request')).output, '相同序号的新结果')
  assert.ok(f.counts().scans > first.scans, '不能只按会话标识或日志长度复用')
  assert.equal((await f.host.observe('root', 'queued')).status, 'running')
  f.status('running')
  assert.equal((await f.host.observe('root', 'request')).status, 'running')
  f.status('idle')
  assert.equal((await f.host.observe('root', 'request', true)).status, 'interrupted')
  f.inherited(3)
  assert.equal((await f.host.observe('root', 'request')).status, 'running')
  assert.equal(f.counts().observations, f.counts().disposals)
})

for (const source of ['live', undefined]) test(`不缓存${source ? '实时' : '未声明来源的'}日志解析`, async () => {
  const f = fixture(source)
  await f.host.observe('root', 'request')
  const first = f.counts().scans
  await f.host.observe('root', 'request')
  assert.equal(f.counts().scans, first * 2)
  assert.equal(f.counts().observations, f.counts().disposals)
})
