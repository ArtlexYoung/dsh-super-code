import test from 'node:test'
import assert from 'node:assert/strict'
import { createGuidanceSelector, GUIDED_INSTRUCTIONS } from '../src/core/guidance.js'
import { METHODS, TEAMS, SUPER_CODE_INSTRUCTIONS, readTeamMethod } from '../src/core/teams.js'

test('guidance uses exact configured routes and never guesses model capability', () => {
  const select = createGuidanceSelector([{ provider: 'local', model: 'small' }])
  assert.equal(select('local', 'small'), 'guided')
  for (const [provider, model] of [['other', 'small'], ['local', 'SMALL'], ['local', 'small-v2'], ['local', 'weak-model'], [undefined, 'small'], ['local', undefined]]) {
    assert.equal(select(provider, model), 'standard')
  }
  assert.equal(createGuidanceSelector()('local', 'small'), 'standard')
  assert.throws(() => createGuidanceSelector([{ provider: 'p', model: 'm' }, { provider: 'p', model: 'm' }]), /Duplicate/)
  assert.throws(() => createGuidanceSelector([{ provider: '', model: 'm' }]))
  assert.ok(GUIDED_INSTRUCTIONS.length < 800)
})

test('professional expertise stays on demand and focused on the selected method', () => {
  assert.ok(SUPER_CODE_INSTRUCTIONS.length <= 2212)
  for (const method of Object.values(METHODS)) assert.ok(!SUPER_CODE_INSTRUCTIONS.includes(method))
  const investigation = readTeamMethod('research', 'investigation')
  assert.match(investigation, /discriminating check/)
  assert.ok(!investigation.includes(METHODS.bugfix))
  assert.match(readTeamMethod('develop', 'bugfix'), /late results and resource release/)
  assert.match(readTeamMethod('develop', 'integration'), /installed artifact/)
  assert.match(readTeamMethod('design', 'algorithm'), /independent of the candidate/)
  assert.ok(!readTeamMethod('develop').includes(METHODS.bugfix))
})

test('direct method reads include complete expertise without a directory round trip or unrelated material', () => {
  for (const team of Object.keys(TEAMS) as (keyof typeof TEAMS)[]) {
    for (const method of Object.keys(METHODS) as (keyof typeof METHODS)[]) {
      const direct = readTeamMethod(team, method)
      assert.equal(direct, `${team}: ${TEAMS[team].outcome}\n${method}: ${METHODS[method]}`)
      assert.ok(!direct.includes('Methods:'))
      assert.ok(direct.length < readTeamMethod(team).length + METHODS[method].length)
    }
    assert.match(readTeamMethod(team), /Methods:/)
  }
  assert.throws(() => readTeamMethod('develop', 'invented' as never), /Unknown method/)
})
