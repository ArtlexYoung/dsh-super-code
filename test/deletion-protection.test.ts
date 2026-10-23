import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import { deletionCommand } from '../src/core/deletion-command.js'
import { applyDeletionProtection, DELETION_INSTRUCTION, RELAXED_DELETION_INSTRUCTION } from '../src/dsh/deletion-protection.js'
import { deletionProtectionMode, settingsConfigurationSchema } from '../src/dsh/budgets.js'
import type { Configuration } from '../src/dsh/budgets.js'

test('host configuration schemas accept all modes and preserve legacy choices', () => {
  assert.equal(deletionProtectionMode(settingsConfigurationSchema({})), 'relaxed')
  for (const value of ['off', 'relaxed', 'strict', true, false] as const) {
    const config = settingsConfigurationSchema({ deletionProtection: value })
    assert.equal(config.deletionProtection, value)
    assert.equal(deletionProtectionMode(config), value === true ? 'strict' : value === false ? 'off' : value)
  }
  assert.throws(() => settingsConfigurationSchema({ deletionProtection: 'unknown' }))
})

test('deletion recognizer covers direct, wrapped, compound and inline-script commands', () => {
  for (const command of [
    'rm -rf build', '/bin/rm -- ./a', '\\rm a', 'r""m a', "'rm' a", 'rmdir empty',
    'sudo -n rm a', 'sudo -u root /bin/rm a', 'command -- rm a', 'env A=x rm a', 'env -u A rm a',
    'env -S "rm -f a"', 'nice -n 5 rm a', 'nohup rm a', 'xargs -0 -r rm', 'xargs -I {} rm {}',
    'time rm a', 'timeout -s KILL 5s rm a', 'busybox rm a', 'doas -u root rm a', 'command rm -- -v', 'unlink a', 'shred a',
    '2>/dev/null rm a', '>log rm a', '2> log rm a', '2>&1 rm a', 'time -o timing.txt rm a', 'env -S "-- rm a"',
    'find . -type f -delete', 'find . -exec rm {} \\;', 'true && rm a', 'printf hi; rm a',
    'if true; then rm a; fi', 'for f in a; do rm "$f"; done',
    "bash -lc 'rm a'", "sh -c 'true; /bin/rm a'", 'eval "rm a"',
    'echo "$(rm a)"', 'echo `rm a`', "bash -c 'echo $(rm a)'", 'echo hi\nrm a',
  ]) assert.equal(deletionCommand(command), true, command)
  for (const command of ['rm a', 'Remove-Item a', 'Microsoft.PowerShell.Management\\Remove-Item a',
    'del a', 'ri a', "& 'Remove-Item' a", 'pwsh -Command "Remove-Item a"', 'cmd /c "del a"',
    'Invoke-Expression "rm a"', 'Write-Output "$(Remove-Item a)"']) assert.equal(deletionCommand(command, true), true, command)
})

test('deletion recognizer leaves quoted prose, comments, paths and recoverable commands alone', () => {
  for (const command of ["echo 'rm -rf a'", 'printf "%s" rm', 'cat rm', 'ls ./rm', 'grep rm file',
    'trash -- ./a', 'gio trash a', '# rm -rf a\nprintf ok', 'command -v rm', '> rm echo hi',
    'bash -c \'printf "%s" rm\'', 'echo "literal \\$(rm a)"']) assert.equal(deletionCommand(command), false, command)
  for (const command of ["'Remove-Item a'", 'Write-Output "rm a"', 'Get-Command rm']) assert.equal(deletionCommand(command, true), false, command)
})

async function fixture(t: test.TestContext) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  let configuration: Configuration = { deletionProtection: 'strict' }, preset = 'standard', bodies = 0, call = 0
  ctx.provide('superCodeConfiguration', { get: () => configuration })
  ctx.provide('agentPresets', { composedPreset: () => preset })
  for (const name of ['bash', 'pwsh']) ctx.tools.register(defineTool({ name, description: 'No process is spawned',
    parameters: { command: { type: 'string', required: true }, workdir: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { bodies++; return args.command },
  }))
  const agent = { session: Session.create(SessionId('delete-test')) } as Agent
  agent.session.append('turn/start', { turn: 1 })
  const scope = createScope(ctx, agent)
  Object.assign(agent, { ctx: scope.ctx })
  await scope.ctx.plugin({ inject: ['tools'], apply(owner: Context) {
    owner.tools.register(defineTool({ name: 'super_code_task', description: 'Super Code identity', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { return 'ok' } }))
  } })
  const officialAgent = { ctx, session: Session.create(SessionId('delete-official')) } as Agent
  officialAgent.session.append('turn/start', { turn: 1 })
  const plugin = ctx.plugin({ apply: applyDeletionProtection }); await plugin
  const execute = (command: string, who = agent, name = 'bash', extra = {}) => ctx.tools.execute({ name,
    agent: who, callId: ToolCallId(`delete-${++call}`), arguments: { command, ...extra }, signal: new AbortController().signal })
  const prompt = async (who = agent) => (await ctx.systemPrompt.assemble({ agent: who, scope: who })).sections.map(s => s.text).join('\n')
  return { ctx, agent, officialAgent, execute, prompt, bodies: () => bodies, plugin,
    configure(value: Configuration) { configuration = value }, preset(value: string) { preset = value } }
}

test('strict protection injects the script rule in Super Code and blocks without approval', async t => {
  const f = await fixture(t)
  assert.ok((await f.prompt()).includes(DELETION_INSTRUCTION))
  assert.match(await f.prompt(), /脚本、内联脚本和间接调用也不允许直接使用 rm/)
  const result = await f.execute('rm -rf build')
  assert.equal(result.isError, true)
  assert.match(JSON.stringify(result.content), /SUPER_CODE_DELETE_PROTECTED.*trash/)
  assert.equal(f.bodies(), 0)
  assert.equal((await f.execute('trash build')).isError, false)
  assert.equal(f.bodies(), 1)
  const child = { session: Session.create(SessionId('delete-child')) } as Agent
  const childScope = createScope(f.ctx, child, { parent: f.agent })
  Object.assign(child, { ctx: childScope.ctx })
  assert.match(await f.prompt(child), /trash <path>/)
  assert.equal((await f.execute('rm child-build', child)).isError, true)
  assert.equal(f.bodies(), 1, 'inheriting a parent composition also inherits its deletion policy')
})

test('official opt-in is independent of budgets and toggles apply to subsequent calls immediately', async t => {
  const f = await fixture(t)
  assert.doesNotMatch(await f.prompt(f.officialAgent), /trash <path>/)
  assert.equal((await f.execute('rm build', f.officialAgent)).isError, false)
  f.configure({ applyToOfficialPresets: true })
  assert.equal((await f.execute('rm build', f.officialAgent)).isError, false)
  f.configure({ deletionProtection: 'strict', applyToOfficialPresets: false, deletionProtectionForOfficialPresets: true })
  for (const id of ['standard', 'ptc', 'minimal', 'cordis']) {
    f.preset(id)
    assert.match(await f.prompt(f.officialAgent), /trash <path>/)
    assert.equal((await f.execute('rm build', f.officialAgent)).isError, true)
  }
  f.preset('custom')
  assert.equal((await f.execute('rm build', f.officialAgent)).isError, false)
  f.configure({ deletionProtection: false, deletionProtectionForOfficialPresets: true })
  assert.doesNotMatch(await f.prompt(), /trash <path>/)
  assert.equal((await f.execute('rm build')).isError, false)
  f.configure({ deletionProtection: 'strict' })
  assert.equal((await f.execute('rm build')).isError, true)
})

test('minimal complete prompts receive a logged policy notice and later setting changes', async t => {
  const f = await fixture(t)
  f.preset('minimal')
  const scope = createScope(f.ctx, f.officialAgent)
  Object.assign(f.officialAgent, { ctx: scope.ctx })
  await scope.ctx.plugin({ inject: ['systemPrompt'], apply(owner: Context) {
    owner.systemPrompt.section({ name: 'fixture:minimal', order: 0, text: 'MINIMAL', complete: true })
  } })
  f.configure({ deletionProtection: 'strict', deletionProtectionForOfficialPresets: true })
  assert.equal(await f.prompt(f.officialAgent), 'MINIMAL', 'the host complete-prompt contract is preserved')
  const step = () => f.ctx.waterfall(scopeTarget({}, f.officialAgent), 'agent/pre-step', {
    agent: f.officialAgent, messages: [], turn: 1, step: 1, signal: new AbortController().signal,
  } as any, async () => ({ kind: 'enter' as const, messages: [] }))
  const initial = await step()
  assert.equal(initial.kind, 'enter')
  if (initial.kind !== 'enter') throw new Error('fixture unexpectedly rejected')
  assert.match(JSON.stringify(initial.messages), /脚本、内联脚本和间接调用也不允许直接使用 rm/)
  assert.match(JSON.stringify(initial.messages), /"kind":"dsh-super-code\/deletion-protection"/)
  const notice = f.officialAgent.session.append('user/message', initial.messages.at(-1) as any, { surfaceOp: 'append' })
  // Matrix hosts with v4 must admit the real emitted message at the durable boundary.
  // Earlier hosts have no v4 codec; their normal Session admission is exercised above.
  const v4Module = '@deepseek-ai/dsh-session-format-v3-to-v4'
  let v4: { releasedV4SessionFormatCodec: { encodeEvent(event: unknown): unknown } } | false = false
  try { v4 = await import(v4Module) }
  catch (error) { if ((error as { code?: string }).code !== 'ERR_MODULE_NOT_FOUND' && (error as { code?: string }).code !== 'MODULE_NOT_FOUND') throw error }
  if (v4) {
    assert.match(JSON.stringify(v4.releasedV4SessionFormatCodec.encodeEvent(notice)), /dsh-super-code\/deletion-protection/)
    assert.throws(() => v4.releasedV4SessionFormatCodec.encodeEvent({ ...notice,
      data: { ...notice.data, source: { kind: 'plugin', plugin: 'dsh-super-code' } } }), /producer-owned source kind/)
  }
  assert.deepEqual((await step()).messages, [])
  f.configure({ deletionProtectionForOfficialPresets: true })
  const relaxed = JSON.stringify((await step()).messages)
  assert.match(relaxed, /以下规则取代先前/)
  assert.match(relaxed, /当前为宽松模式/)
  assert.doesNotMatch(relaxed, /脚本、内联脚本和间接调用也不允许直接使用 rm/)
  assert.deepEqual((await step()).messages, [])
  f.configure({ deletionProtection: 'off', deletionProtectionForOfficialPresets: true })
  assert.match(JSON.stringify((await step()).messages), /删除保护已关闭/)
  assert.deepEqual((await step()).messages, [])
  f.configure({ deletionProtection: 'strict', deletionProtectionForOfficialPresets: true })
  assert.match(JSON.stringify((await step()).messages), /以下规则取代先前.*脚本、内联脚本和间接调用也不允许直接使用 rm/)
  assert.deepEqual((await step()).messages, [])
})

test('only an actual one-time outcome grants execution; repeats and changed commands ask again', async t => {
  const f = await fixture(t)
  const requests: any[] = []
  let answer = 'allowed-once'
  f.ctx.provide('approval', { request: async (request: unknown) => { requests.push(request); return answer } })
  assert.equal((await f.execute('rm build', f.agent, 'bash', { workdir: '/project', confirmed: true })).isError, false)
  assert.match(requests[0].reason, /临时文件或构建产物/)
  assert.match(requests[0].reason, /\/project\nrm build/)
  answer = 'rejected'
  assert.equal((await f.execute('rm build')).isError, true)
  assert.equal((await f.execute('rm other')).isError, true)
  for (answer of ['cancelled', 'unavailable', 'allow', 'yes']) assert.equal((await f.execute('rm build')).isError, true)
  assert.equal(f.bodies(), 1)
  assert.equal(requests.length, 7)
  assert.equal(new Set(requests.map(r => r.callId)).size, 7)
})

test('real host approval audits grants, rejection and never policy without reusing consent', async t => {
  const f = await fixture(t)
  await f.ctx.plugin(ApprovalService)
  let answer = 'allowed-once', prompts = 0
  f.ctx.on('approval/request', async () => { prompts++; return answer as 'allowed-once' })
  assert.equal((await f.execute('rm build')).isError, false)
  answer = 'rejected'
  assert.equal((await f.execute('rm build')).isError, true)
  f.ctx.approval.config.policy = 'never'
  assert.equal((await f.execute('rm build')).isError, true)
  assert.equal(prompts, 2)
  assert.equal(f.bodies(), 1)
  const events = f.agent.session.snapshotEvents()
  assert.equal(events.filter(e => e.type === 'approval/asked').length, 3)
  assert.equal(events.filter(e => e.type === 'approval/decided').length, 3)
})

test('existing host denial is preserved; cancellation and failed approval never execute', async t => {
  const f = await fixture(t)
  let prompts = 0
  const remove = f.ctx.provide('approval', { request: async () => { prompts++; throw new Error('offline') } })
  assert.equal((await f.execute('rm build')).isError, true)
  const stop = f.ctx.on('tools/pre-execute', async () => ({ kind: 'deny' as const, reason: 'Host policy' }))
  assert.equal((await f.execute('rm build')).isError, true)
  assert.equal(prompts, 1)
  stop()
  remove()
  const controller = new AbortController()
  f.ctx.provide('approval', { request: async () => { controller.abort(); return 'allowed-once' } })
  assert.equal((await f.ctx.tools.execute({ name: 'bash', agent: f.agent, callId: ToolCallId('cancel-delete'),
    arguments: { command: 'rm build' }, signal: controller.signal })).isError, true)
  assert.equal(f.bodies(), 0)
})

test('nested dispatch and concurrent Agents keep per-call protection and independent approvals', async t => {
  const f = await fixture(t)
  const requests: any[] = []
  f.ctx.provide('approval', { request: async (req: any) => { requests.push(req); await new Promise<void>(done => setImmediate(done)); return req.agent === f.agent ? 'rejected' : 'allowed-once' } })
  f.configure({ deletionProtection: 'strict', deletionProtectionForOfficialPresets: true })
  f.ctx.tools.register(defineTool({ name: 'nested_fixture', description: 'PTC-style nested pipeline', parameters: {},
    output: { schema: { type: 'boolean' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(_args, exec) {
      const result = await f.ctx.tools.execute({ parent: exec.token, agent: exec.agent, rootCallId: exec.rootCallId,
        name: 'bash', callId: ToolCallId('nested-rm'), arguments: { command: 'bash -c "rm build"' }, signal: exec.signal })
      return result.isError
    },
  }))
  const [nested, other] = await Promise.all([
    f.ctx.tools.execute({ name: 'nested_fixture', agent: f.agent, callId: ToolCallId('outer'), arguments: {}, signal: new AbortController().signal }),
    f.execute('rm other-build', f.officialAgent),
  ])
  assert.equal(nested.isError, false)
  assert.equal(nested.value, true)
  assert.equal(other.isError, false)
  assert.equal(requests.length, 2)
  assert.equal(f.bodies(), 1)
})


test('new installations default to relaxed guidance and require no extra plugin approval', async t => {
  const f = await fixture(t)
  f.configure({})
  assert.ok((await f.prompt()).includes(RELAXED_DELETION_INSTRUCTION))
  assert.match(await f.prompt(), /脚本、内联脚本和间接调用中也建议使用 trash/)
  assert.doesNotMatch(await f.prompt(), /脚本、内联脚本和间接调用也不允许直接使用 rm/)
  let approvals = 0
  f.ctx.provide('approval', { request: async () => { approvals++; return 'rejected' } })
  for (const command of ['rm build', "bash -c 'rm build'", 'trash build']) {
    assert.equal((await f.execute(command)).isError, false)
  }
  assert.equal((await f.execute('Remove-Item build', f.agent, 'pwsh')).isError, false)
  assert.equal(approvals, 0)
  assert.equal(f.bodies(), 4, 'commands reach only the fixture executor, never a real shell')
  f.ctx.on('tools/pre-execute', async () => ({ kind: 'deny' as const, reason: 'Host policy' }))
  assert.equal((await f.execute('rm build')).isError, true)
  assert.equal(f.bodies(), 4, 'relaxed mode preserves host denials')
})

test('mode changes and legacy boolean choices take effect on the next call', async t => {
  const f = await fixture(t)
  for (const value of ['off', false] as const) {
    f.configure({ deletionProtection: value })
    assert.doesNotMatch(await f.prompt(), /trash <path>/)
    assert.equal((await f.execute('rm build')).isError, false)
  }
  for (const value of ['strict', true] as const) {
    f.configure({ deletionProtection: value })
    assert.ok((await f.prompt()).includes(DELETION_INSTRUCTION))
    assert.equal((await f.execute('rm build')).isError, true)
  }
  for (const config of [{}, { deletionProtection: 'relaxed' as const }]) {
    f.configure(config)
    assert.ok((await f.prompt()).includes(RELAXED_DELETION_INSTRUCTION))
    assert.equal((await f.execute('rm build')).isError, false)
  }
})

test('official relaxed opt-in is separate from budgets for every official preset', async t => {
  const f = await fixture(t)
  for (const preset of ['standard', 'ptc', 'minimal', 'cordis']) {
    f.preset(preset)
    f.configure({ applyToOfficialPresets: true })
    assert.doesNotMatch(await f.prompt(f.officialAgent), /trash <path>/)
    f.configure({ applyToOfficialPresets: false, deletionProtectionForOfficialPresets: true })
    assert.ok((await f.prompt(f.officialAgent)).includes(RELAXED_DELETION_INSTRUCTION))
    assert.equal((await f.execute('rm build', f.officialAgent)).isError, false)
    f.configure({ deletionProtection: 'off', deletionProtectionForOfficialPresets: true })
    assert.doesNotMatch(await f.prompt(f.officialAgent), /trash <path>/)
  }
})
