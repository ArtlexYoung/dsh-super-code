import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { activeToolProfile, builtinToolProfiles, defaultToolConfiguration, validateToolConfiguration } from '../../src/dsh/tool-profiles.js'

const custom = () => ({ ...structuredClone(builtinToolProfiles[1]!), id: 'custom:' + randomUUID(), name: '我的工具集' })
test('four builtin modes include questions except minimal and preserve official persistent shell', () => {
  assert.equal(builtinToolProfiles.length, 4)
  for (const profile of builtinToolProfiles) assert.equal(profile.tools.includes('ask_user_question'), profile.name !== 'minimal')
  assert.equal(builtinToolProfiles[2]!.shell, 'persistent')
  assert.deepEqual(builtinToolProfiles[2]!.tools, ['bash', 'pwsh', 'read_image'])
  assert.equal(activeToolProfile(defaultToolConfiguration).execution, 'ptc')
})
test('at most 26 custom profiles leave four builtin slots, with stable unique ids', () => {
  const profiles = Array.from({ length: 26 }, custom)
  assert.equal(validateToolConfiguration({ ...defaultToolConfiguration, custom: profiles }).custom.length, 26)
  assert.throws(() => validateToolConfiguration({ ...defaultToolConfiguration, custom: [...profiles, custom()] }))
  assert.throws(() => validateToolConfiguration({ ...defaultToolConfiguration, custom: [profiles[0], profiles[0]] }))
})
test('boundary rejects unknown fields, tools, ids, duplicates and empty names but accepts a pure conversation profile', () => {
  for (const changes of [{ tools: ['run_code'] }, { tools: ['read', 'read'] }, { name: ' ' }, { id: 'builtin:standard' }, { shell: 'other' }]) {
    assert.throws(() => validateToolConfiguration({ ...defaultToolConfiguration, custom: [{ ...custom(), ...changes }] }))
  }
  assert.throws(() => validateToolConfiguration({ ...defaultToolConfiguration, extra: true }))
  assert.throws(() => validateToolConfiguration({ ...defaultToolConfiguration, activeId: 'missing' }))
  const profile = { ...custom(), tools: [], name: '  对话  ' }
  const result = validateToolConfiguration({ version: 1, activeId: profile.id, custom: [profile] })
  assert.equal(activeToolProfile(result).name, '对话')
  assert.deepEqual(activeToolProfile(result).tools, [])
})
