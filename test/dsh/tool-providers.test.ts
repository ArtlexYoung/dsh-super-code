import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import { mountToolProviders } from '../../src/dsh/tool-providers.js'
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
    await writeFile(join(location, 'index.js'), `export const inject = ['tools'];
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
    get() {} schemas() { return [{ name: 'third_party', description: 'Search project notes.' }, { name: 'run_code' }, { name: 'bash' }] } guard() {} restrict() {} execute() {}
  }
  new Tools(ctx)
  ctx.provide('systemPrompt', {} as any)
  ctx.provide('shell', {} as any)
  ctx.provide('attachments', {} as any)
  let providers!: Awaited<ReturnType<typeof mountToolProviders>>
  const owner = await ctx.plugin({ async apply(scope: Context) { providers = await mountToolProviders(scope, {} as ToolRuntime) } })
  assert.equal(providers.shellAvailable('standard'), true)
  assert.equal(providers.shellAvailable('persistent'), true)
  const parameters = registered.get('bash')!.parameters
  assert.equal(parameters.type, 'object')
  assert.deepEqual(parameters.required, ['command'])
  assert.deepEqual(parameters.properties, { command: { type: 'string' }, description: { type: 'string' } })
  assert.equal(parameters.oneOf, undefined, 'overlapping host shell parameters cannot use an exclusive union')
  assert.deepEqual(providers.catalog().filter(tool => tool.group === 'external'), [{ name: 'third_party', group: 'external', available: true, description: 'Search project notes.' }])
  for (const name of ['bash', 'read', 'read_image', 'ask_user_question']) {
    assert(registered.has(name), `${name} must already be registered when mounting finishes: ${ctx.logger.buffer.flatMap(message => message.args.map(String)).join('\n')}`)
    assert(providers.catalog().find(tool => tool.name === name)!.available)
  }
  const unrelated = await ctx.plugin({ apply() {} })
  assert.equal('tools' in unrelated.inject, false, 'provider dependencies must stay inside their own tool scope')
  assert.equal(ctx.logger.buffer.some(message => message.type === 'error'), false)
  await owner.dispose()
  assert.equal(registered.size, 0)
})
