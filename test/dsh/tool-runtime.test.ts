import test from 'node:test'
import assert from 'node:assert/strict'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolSelections } from '../../src/dsh/tool-runtime.js'
import { builtinToolProfiles } from '../../src/dsh/tool-profiles.js'

function waitingAgent(id: string) {
  let finish!: () => void, idle = false
  const done = new Promise<void>(resolve => { finish = () => { idle = true; resolve() } })
  const agent = { id, whenIdle: () => idle ? Promise.resolve() : done,
    runMaintenance: async (task: () => Promise<void>) => { assert(idle); await task() },
  } as unknown as Agent
  return { agent, finish }
}
test('two pending conversations apply independently after each finishes and only apply the latest saved target', async () => {
  let selected = structuredClone(builtinToolProfiles[1]!)
  const changes: string[] = []
  const runtime = new ToolSelections(() => selected, (agent, profile) => { changes.push(`${agent.id}:${profile.id}`) })
  const a = waitingAgent('A'), b = waitingAgent('B')
  runtime.add(a.agent); runtime.add(b.agent)
  selected = structuredClone(builtinToolProfiles[2]!); runtime.refresh()
  assert(runtime.allows(a.agent, 'ask_user_question'))
  assert(runtime.allows(b.agent, 'ask_user_question'))
  selected = structuredClone(builtinToolProfiles[0]!); runtime.refresh()
  a.finish(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.profile(a.agent).id, 'builtin:standard')
  assert.equal(runtime.profile(b.agent).id, 'builtin:ptc')
  assert.equal(runtime.status().find(value => value.sessionId === 'B')!.state, 'pending')
  b.finish(); await runtime.settled()
  assert.equal(runtime.profile(b.agent).id, 'builtin:standard')
  assert(!changes.some(value => value.endsWith('builtin:minimal')))
})
test('failed selection retains the old callable tools; disposal prevents late application and other agents still apply', async () => {
  let selected = structuredClone(builtinToolProfiles[1]!)
  const runtime = new ToolSelections(() => selected, (agent, profile) => {
    if (agent.id === 'failed' && profile.id === 'builtin:minimal') throw new Error('missing executor')
  })
  const failed = waitingAgent('failed'), disposed = waitingAgent('disposed'), good = waitingAgent('good')
  for (const agent of [failed, disposed, good]) runtime.add(agent.agent)
  selected = structuredClone(builtinToolProfiles[2]!); runtime.refresh(); runtime.remove(disposed.agent)
  failed.finish(); disposed.finish(); good.finish(); await runtime.settled()
  assert.equal(runtime.profile(failed.agent).id, 'builtin:ptc')
  assert(runtime.allows(failed.agent, 'ask_user_question'))
  assert.equal(runtime.status().find(value => value.sessionId === 'failed')!.state, 'error')
  assert(!runtime.status().some(value => value.sessionId === 'disposed'))
  assert.equal(runtime.profile(good.agent).id, 'builtin:minimal')
  assert(!runtime.allows(good.agent, 'ask_user_question'))
})

test('an inherited child keeps its parent profile and unsupported hosts report inability to switch', async () => {
  let selected = structuredClone(builtinToolProfiles[2]!)
  const runtime = new ToolSelections(() => selected, () => {})
  const child = { id: 'child', whenIdle: async () => {} } as unknown as Agent
  runtime.add(child, structuredClone(builtinToolProfiles[1]!))
  assert.equal(runtime.profile(child).id, 'builtin:ptc')
  assert(runtime.allows(child, 'ask_user_question'))
  runtime.refresh(); await runtime.settled()
  assert.equal(runtime.status()[0]!.state, 'error')
  assert.equal(runtime.profile(child).id, 'builtin:ptc')
})
test('a failed initial selection can recover on a later save without changing the profile', async () => {
  let broken = true
  const runtime = new ToolSelections(() => builtinToolProfiles[0]!, () => { if (broken) throw new Error('temporarily unavailable') })
  const agent = waitingAgent('recover'); agent.finish(); runtime.add(agent.agent)
  assert.equal(runtime.status()[0]!.state, 'error')
  broken = false; runtime.refresh(); await runtime.settled()
  assert.equal(runtime.status()[0]!.state, 'applied')
  assert.equal(runtime.status()[0]!.error, undefined)
})
test('another maintenance task winning the idle boundary does not lose the pending change', async () => {
  let selected = structuredClone(builtinToolProfiles[1]!), tries = 0
  const agent = { id: 'race', status: 'idle', whenIdle: async () => {}, runMaintenance: (task: () => Promise<void>) => {
    if (++tries === 1) throw new Error('already has active work')
    return task()
  } } as unknown as Agent
  const runtime = new ToolSelections(() => selected, () => {})
  runtime.add(agent); selected = structuredClone(builtinToolProfiles[2]!); runtime.refresh(); await runtime.settled()
  assert.equal(tries, 2)
  assert.equal(runtime.profile(agent).id, 'builtin:minimal')
})
test('an unexpected maintenance failure is reported without an unbounded retry', async () => {
  let selected = structuredClone(builtinToolProfiles[1]!), tries = 0
  const agent = { id: 'failure', whenIdle: async () => {}, runMaintenance: () => {
    tries++; throw new Error('maintenance is unavailable')
  } } as unknown as Agent
  const runtime = new ToolSelections(() => selected, () => {})
  runtime.add(agent); selected = structuredClone(builtinToolProfiles[2]!); runtime.refresh(); await runtime.settled()
  assert.equal(tries, 1)
  assert.equal(runtime.status()[0]!.error, 'maintenance is unavailable')
  assert.equal(runtime.profile(agent).id, 'builtin:ptc')
})
test('external exclusions wait for each turn, preserve unknown tools and never restrict unrelated agents', async () => {
  let selected = { ...structuredClone(builtinToolProfiles[1]!), disabledExternalTools: [] as string[] }
  const runtime = new ToolSelections(() => selected, () => {})
  const a = waitingAgent('external-a'), b = waitingAgent('external-b')
  runtime.add(a.agent); runtime.add(b.agent)
  selected = { ...selected, disabledExternalTools: ['third_party'] }; runtime.refresh()
  assert(runtime.allows(a.agent, 'third_party'))
  a.finish(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.allows(a.agent, 'third_party'), false)
  assert(runtime.allows(b.agent, 'third_party'))
  assert(runtime.allows(a.agent, 'new_plugin'))
  assert(runtime.allows({ id: 'unrelated' } as Agent, 'third_party'))
  b.finish(); await runtime.settled()
  assert.equal(runtime.allows(b.agent, 'third_party'), false)
  selected = { ...selected, disabledExternalTools: [] }; runtime.refresh(); await runtime.settled()
  assert(runtime.allows(a.agent, 'third_party'))
})
