import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import { mountToolProviders, projectToolSchemas } from '../../src/dsh/tool-providers.js'
import { renderToolsSdk } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolRuntime } from '../../src/dsh/tool-access.js'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

test('isolated provider services activate before mounting tools and all release with their owner', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'super-code-providers-'))
  const ctx = new Context(), registered = new Map<string, ToolDefinition>()
  t.after(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  ctx.baseUrl = pathToFileURL(directory + '/').href
  for (const [module, name] of [['dsh-tool-bash', 'bash'], ['dsh-tool-bash-persistent', 'bash'], ['dsh-tool-fs', 'read'], ['dsh-tool-ask-user', 'ask_user_question'], ['dsh-terminal', ''], ['dsh-terminal-bash', '']]) {
    const location = join(directory, 'node_modules', '@deepseek-ai', module!)
    await mkdir(location, { recursive: true })
    await writeFile(join(location, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }))
    await writeFile(join(location, 'index.js'), `export const inject = ['tools'${module.startsWith('dsh-tool-bash') ? ", 'shell'" : ''}];
      export function apply(ctx) { ${module === 'dsh-tool-fs' ? `ctx.inject(['attachments'], nested => nested.tools.register({ name: 'read_image', parameters: {}, output: { schema: {} } }));` : ''}
        ${name ? `ctx.effect(() => ctx.tools.register({ name: ${JSON.stringify(name)},
        parameters: { type: 'object', properties: { command: { type: 'string' }, ${module === 'dsh-tool-bash' ? "description: { type: 'string' }" : ''} },
          required: ['command'${module === 'dsh-tool-bash' ? ", 'description'" : ''}], additionalProperties: true },
        output: { schema: {} } }))` : ''} }`)
  }
  class Tools extends Service {
    constructor(ctx: Context) { super(ctx, 'tools') }
    register(definition: ToolDefinition) {
      return this.ctx.effect(() => { registered.set(definition.name, definition); return () => { registered.delete(definition.name) } })
    }
    get(name: string) { return registered.get(name) } schemas() { return [{ name: 'third_party', description: 'Search project notes.' }, { name: 'run_code' }, { name: 'bash' }] } guard() {} restrict() {} execute() {}
  }
  new Tools(ctx)
  ctx.provide('systemPrompt', {} as any)
  const shellOwner = await ctx.plugin({ apply(scope: Context) { scope.provide('shell', {} as any) } })
  ctx.provide('attachments', {} as any)
  let providers!: Awaited<ReturnType<typeof mountToolProviders>>
  const standard = { id: 'standard' } as Agent, persistent = { id: 'persistent' } as Agent
  const runtime = { profile: (agent?: Agent) => ({ shell: agent === persistent ? 'persistent' : 'standard' }) } as ToolRuntime
  const owner = await ctx.plugin({ async apply(scope: Context) { providers = await mountToolProviders(scope, runtime) } })
  assert.equal(providers.shellAvailable('standard'), true)
  assert.equal(providers.shellAvailable('persistent'), true)
  const parameters = registered.get('bash')!.parameters
  assert.equal(parameters.type, 'object')
  assert.deepEqual(parameters.required, ['command', 'description'])
  assert.deepEqual(parameters.properties, { command: { type: 'string' }, description: { type: 'string' } })
  assert.equal(parameters.oneOf, undefined, 'overlapping host shell parameters cannot use an exclusive union')
  const shells = [registered.get('bash')!]
  const standardSchema = projectToolSchemas(ctx, shells, standard)[0]!
  const persistentSchema = projectToolSchemas(ctx, shells, persistent)[0]!
  assert.deepEqual(standardSchema.parameters.required, ['command', 'description'])
  assert.deepEqual(persistentSchema.parameters.required, ['command'])
  assert.deepEqual(persistentSchema.parameters.properties, { command: { type: 'string' } })
  assert.match(renderToolsSdk([standardSchema]), /command: 'pwd', description: 'Show current directory'/)
  assert.match(renderToolsSdk([persistentSchema]), /command: 'pwd' \}/)
  assert.deepEqual(projectToolSchemas(ctx, shells, standard)[0]!.parameters, standardSchema.parameters, 'another conversation must not change this schema')
  assert.deepEqual(providers.catalog().filter(tool => tool.group === 'external'), [{ name: 'third_party', group: 'external', available: true, description: 'Search project notes.' }])
  for (const name of ['bash', 'read', 'read_image', 'ask_user_question']) {
    assert(registered.has(name), `${name} must already be registered when mounting finishes: ${ctx.logger.buffer.flatMap(message => message.args.map(String)).join('\n')}`)
    assert(providers.catalog().find(tool => tool.name === name)!.available)
  }
  const unrelated = await ctx.plugin({ apply() {} })
  assert.equal('tools' in unrelated.inject, false, 'provider dependencies must stay inside their own tool scope')
  assert.equal(ctx.logger.buffer.some(message => message.type === 'error'), false)
  await shellOwner.dispose()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(providers.shellAvailable('standard'), false)
  assert.equal(providers.shellAvailable('persistent'), false)
  assert.equal(providers.catalog().find(tool => tool.name === 'bash')!.available, false)
  assert.deepEqual(projectToolSchemas(ctx, shells, standard), [], 'losing a shell must not abort the entire prompt')
  assert.deepEqual(projectToolSchemas(ctx, shells, persistent), [])
  await ctx.plugin({ apply(scope: Context) { scope.provide('shell', {} as any) } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(providers.shellAvailable('standard'), true)
  assert.equal(providers.shellAvailable('persistent'), true)
  assert.equal(providers.catalog().find(tool => tool.name === 'bash')!.available, true)
  await owner.dispose()
  assert.equal(registered.size, 0)
})
