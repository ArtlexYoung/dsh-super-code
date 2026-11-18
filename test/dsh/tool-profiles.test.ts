import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { activeToolProfile, builtinToolProfiles, defaultToolConfiguration, validateToolConfiguration } from '../../src/dsh/tool-profiles.js'

const custom = () => ({ ...structuredClone(builtinToolProfiles[1]!), id: 'custom:' + randomUUID(), name: '我的工具集' })
test('five builtin modes include original Super Code with questions and preserve official persistent shell', () => {
  assert.equal(builtinToolProfiles.length, 5)
  for (const profile of builtinToolProfiles) assert.equal(profile.tools.includes('ask_user_question'), profile.name !== 'minimal')
  assert.equal(builtinToolProfiles[2]!.shell, 'persistent')
  assert.deepEqual(builtinToolProfiles[2]!.tools, ['bash', 'pwsh', 'read_image'])
  assert.equal(activeToolProfile(defaultToolConfiguration).execution, 'ptc')
  const original = activeToolProfile(defaultToolConfiguration)
  assert.equal(original.id, 'builtin:super-code')
  assert.deepEqual([...original.tools].sort(), ['bash', 'pwsh', 'read', 'read_image', 'write', 'edit', 'glob', 'grep',
    'job_list', 'job_output', 'job_kill', 'web_search', 'web_fetch', 'subagent', 'list_agents', 'wait_agent',
    'send_message', 'interrupt_agent', 'skill', 'super_code_method', 'super_code_task', 'super_code_memory', 'ask_user_question'].sort())
})
test('at most 25 custom profiles leave five builtin slots, with stable unique ids', () => {
  const profiles = Array.from({ length: 25 }, custom)
  assert.equal(validateToolConfiguration({ ...defaultToolConfiguration, custom: profiles }).custom.length, 25)
  assert.throws(() => validateToolConfiguration({ ...defaultToolConfiguration, custom: [...profiles, custom()] }))
  assert.throws(() => validateToolConfiguration({ ...defaultToolConfiguration, custom: [profiles[0], profiles[0]] }))
})
test('external exclusions preserve missing tools and reject invalid names, duplicates and managed tools', () => {
  const profile = { ...custom(), disabledExternalTools: ['third_party', 'mcp.remote:search'] }
  assert.deepEqual(activeToolProfile(validateToolConfiguration({ version: 1, activeId: profile.id, custom: [profile] })).disabledExternalTools, profile.disabledExternalTools)
  for (const disabledExternalTools of [[''], ['  '], ['a', 'a'], ['read'], ['run_code'], ['x'.repeat(201)], ['bad\nname'], Array.from({ length: 1025 }, (_, index) => `tool_${index}`)])
    assert.throws(() => validateToolConfiguration({ ...defaultToolConfiguration, custom: [{ ...profile, disabledExternalTools }] }))
  assert.equal(validateToolConfiguration({ ...defaultToolConfiguration, custom: [custom()] }).custom.length, 1)
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
