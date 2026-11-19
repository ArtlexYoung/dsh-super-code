import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import LocalFS from '@deepseek-ai/dsh-fs-local'
import { applyWorkbench, SuperCodeWorkbench } from '../../src/dsh/workbench.js'
import { validationRoot } from '../validation-root.js'
import { waitFor } from '../wait-for.js'

async function fixture(t: TestContext) {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'workbench-isolation-')), ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  new SessionStore(ctx)
  await ctx.plugin(LocalFS, { cwd: root, diffBasisMaxBytes: 1024 })
  await writeFile(join(root, 'main.ts'), 'const value = 1\n')
  const session = ctx.sessions.create(SessionId('isolated'), { meta: { cwd: root } })
  const feature = ctx.plugin(applyWorkbench)
  await feature
  const current = () => ctx.get('superCodeWorkbench' as never) as SuperCodeWorkbench | undefined
  const policy = () => ctx.plugin({ apply(owner: Context) {
    owner.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) })
  } })
  return { ctx, root, session, feature, current, policy, signal: new AbortController().signal }
}

test('工作台只等待基础服务，缺少安全策略不提供入口，策略恢复后重新注册', async t => {
  const f = await fixture(t)
  assert.equal(f.current(), undefined)
  const first = f.policy(); await first
  await waitFor(() => !!f.current())
  const api = f.current()!
  assert.equal((await api.read(f.session.id, 'main.ts', f.signal)).text, 'const value = 1\n')
  await first.dispose()
  await waitFor(() => !f.current())
  await assert.rejects(api.read(f.session.id, 'main.ts', f.signal), { name: 'AbortError' })
  await f.policy()
  await waitFor(() => !!f.current())
  assert.equal((await f.current()!.list(f.session.id, '', f.signal)).entries.length, 1)
})

test('模型服务缺失、失败、撤销及恢复均不卸载文件功能，不缓存能力失败', async t => {
  const f = await fixture(t); await f.policy(); await waitFor(() => !!f.current())
  const api = f.current()!, id = f.session.id
  const translate = () => Array.fromAsync(api.translate(id, JSON.stringify({ instruction: '翻译', history: [] }), f.signal))
  const assist = () => Array.fromAsync(api.assist(id, JSON.stringify({ file: 'main.ts', text: 'const value = 1\n', from: 0, to: 5, mode: 'ask', instruction: '解释', history: [] }), f.signal))
  const reading = () => Array.fromAsync(api.reading(id, JSON.stringify({ kind: 'plan', goal: '理解项目', locale: 'zh', buffers: [] }), f.signal))
  for (const request of [() => api.models('', f.signal), translate, assist, reading]) await assert.rejects(request(), /WORKBENCH_MODEL_UNAVAILABLE/)
  const llm = f.ctx.plugin({ apply(owner: Context) { owner.provide('llm', { listProviders: () => [] }) } }); await llm
  assert.deepEqual(await api.models('', f.signal), [])
  f.ctx.llm.listProviders = () => { throw new Error('catalog unavailable') }
  await assert.rejects(api.models('', f.signal), /catalog unavailable/)
  f.ctx.llm.listProviders = () => []
  assert.deepEqual(await api.models('', f.signal), [])
  await llm.dispose()
  await assert.rejects(api.models('', f.signal), /WORKBENCH_MODEL_UNAVAILABLE/)
  const file = await api.read(id, 'main.ts', f.signal)
  await api.save(id, JSON.stringify({ ...file, text: 'const value = 2\n' }), f.signal)
  assert.equal((await api.read(id, 'main.ts', f.signal)).text, 'const value = 2\n')
  assert.equal((await api.list(id, '', f.signal)).entries.length, 1)
  assert.equal(f.session.seq, 0)
})

for (const method of ['assist', 'translate', 'reading', 'models'] as const) {
  test(`撤销模型服务会取消进行中的 ${method}，文件仍可用且恢复后不重放旧请求`, async t => {
    const f = await fixture(t); await f.policy(); await waitFor(() => !!f.current())
    f.ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'fixture', model: 'fixture' }) })
    const api = f.current()!, entered = Promise.withResolvers<void>()
    let calls = 0, cancelled = 0
    const wait = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      calls++; entered.resolve()
      const cancel = () => { cancelled++; reject(signal.reason) }
      if (signal.aborted) cancel()
      else signal.addEventListener('abort', cancel, { once: true })
    })
    const llm = f.ctx.plugin({ apply(owner: Context) {
      owner.provide('llm', {
        listProviders: () => [{ id: 'fixture', name: 'Fixture' }],
        listModels: async () => [{ id: 'fixture', name: 'Fixture' }],
        resolveModelInfo: async (_provider: string, _model: string, signal: AbortSignal) => method === 'models' ? wait(signal) : { provider: 'fixture', id: 'fixture', name: 'Fixture' },
        async *stream(options: { signal: AbortSignal }) { await wait(options.signal) },
      })
    } }); await llm
    const id = f.session.id, content = method === 'assist'
      ? { file: 'main.ts', text: 'const value = 1\n', from: 0, to: 5, mode: 'ask', instruction: '解释', history: [] }
      : method === 'reading' ? { kind: 'plan', goal: '理解项目', locale: 'zh', buffers: [] }
      : { instruction: '翻译', history: [] }
    const running = method === 'models' ? api.models('', f.signal) : Array.fromAsync(api[method](id, JSON.stringify(content), f.signal))
    const outcome = running.then(value => ({ value }), error => ({ error }))
    await entered.promise; await llm.dispose()
    const result = await outcome
    assert.ok('error' in result && result.error.name === 'AbortError')
    assert.equal(cancelled, 1)
    assert.equal((await api.read(id, 'main.ts', f.signal)).text, 'const value = 1\n')
    await assert.rejects(api.models('', f.signal), /WORKBENCH_MODEL_UNAVAILABLE/)
    await f.ctx.plugin({ apply(owner: Context) { owner.provide('llm', { listProviders: () => [] }) } })
    assert.deepEqual(await api.models('', f.signal), [])
    assert.equal(calls, 1)
    assert.equal(f.session.seq, 0)
  })
}

test('目录恢复服务独立撤销与恢复，文件服务保持同一实例', async t => {
  const f = await fixture(t); await f.policy(); await waitFor(() => !!f.current())
  const api = f.current()!
  await assert.rejects(api.directory(f.session.id, f.signal), /WORKBENCH_DIRECTORY_UNSUPPORTED/)
  const enable = () => f.ctx.plugin({ apply(owner: Context) {
    owner.provide('agents', {}); owner.provide('agentPresets', {}); owner.provide('sessionController', {})
    owner.provide('sessionQuery', { async observeSession() {
      return { header: f.session.header, events: f.session.snapshotEvents(), [Symbol.dispose]() {} }
    } })
  } })
  const first = enable(); await first
  await waitFor(() => !!(api as unknown as { directories?: unknown }).directories)
  assert.equal((await api.directory(f.session.id, f.signal)).state, 'available')
  await first.dispose()
  await assert.rejects(api.directory(f.session.id, f.signal), /WORKBENCH_DIRECTORY_UNSUPPORTED/)
  assert.equal((await api.read(f.session.id, 'main.ts', f.signal)).text, 'const value = 1\n')
  await enable()
  await waitFor(() => !!(api as unknown as { directories?: unknown }).directories)
  assert.equal((await api.directory(f.session.id, f.signal)).state, 'available')
  assert.equal((await api.read(f.session.id, 'main.ts', f.signal)).text, 'const value = 1\n')
})

test('目录子服务撤销取消进行中的查询并释放观察记录，不取消文件能力', async t => {
  const f = await fixture(t); await f.policy(); await waitFor(() => !!f.current())
  const api = f.current()!, entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  t.after(() => release.resolve())
  let disposed = 0
  const directory = f.ctx.plugin({ apply(owner: Context) {
    owner.provide('agents', {}); owner.provide('agentPresets', {}); owner.provide('sessionController', {})
    owner.provide('sessionQuery', { async observeSession() {
      entered.resolve(); await release.promise
      return { header: f.session.header, events: [], [Symbol.dispose]() { disposed++ } }
    } })
  } }); await directory
  await waitFor(() => !!(api as unknown as { directories?: unknown }).directories)
  const running = api.directory(f.session.id, f.signal)
  const outcome = running.then(value => ({ value }), error => ({ error }))
  await entered.promise; await directory.dispose(); release.resolve()
  const result = await outcome
  assert.ok('error' in result && result.error.name === 'AbortError')
  assert.equal(disposed, 1)
  assert.equal((await api.read(f.session.id, 'main.ts', f.signal)).text, 'const value = 1\n')
})

test('Git 库加载失败仅使 Git 请求失败，工作台注册与文件请求继续工作', async t => {
  const f = await fixture(t)
  const hook = join(f.root, 'missing-git.mjs')
  await writeFile(hook, `export async function resolve(specifier, context, next) {
    const resolved = await next(specifier, context)
    const path = new URL(resolved.url).pathname
    if (['/workbench/git/library.ts', '/workbench/git/library.js'].some(suffix => path.endsWith(suffix))) return { url: 'data:text/javascript,export const library = (() => { throw new Error("missing dist/git.cjs") })()', shortCircuit: true }
    return resolved
  }`)
  const script = `
    import assert from 'node:assert/strict'
    import { register } from 'node:module'
    import { Context } from '@deepseek-ai/cordis'
    import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
    import LocalFS from '@deepseek-ai/dsh-fs-local'
    register(process.env.WORKBENCH_TEST_HOOK, import.meta.url)
    const { applyWorkbench } = await import('./src/dsh/workbench.ts')
    const ctx = new Context(), root = process.env.WORKBENCH_TEST_DIRECTORY
    try {
      new SessionStore(ctx); await ctx.plugin(LocalFS, { cwd: root })
      ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only', workspaceRoot: root }) })
      const session = ctx.sessions.create(SessionId('missing-git'), { meta: { cwd: root } })
      await ctx.plugin(applyWorkbench)
      const api = ctx.get('superCodeWorkbench'), signal = new AbortController().signal
      assert.ok(api)
      for (let i = 0; i < 2; i++) await assert.rejects(Array.fromAsync(api.git(session.id, '{"action":"status"}', signal)), error => error.message === 'WORKBENCH_GIT_UNAVAILABLE' && error.cause.message === 'missing dist/git.cjs')
      assert.equal((await api.read(session.id, 'main.ts', signal)).text, 'const value = 1\\n')
      assert.ok((await api.list(session.id, '', signal)).entries.some(entry => entry.name === 'main.ts'))
    } finally { await ctx.fiber.dispose() }
  `
  await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, WORKBENCH_TEST_DIRECTORY: f.root, WORKBENCH_TEST_HOOK: hook }, timeout: 15000,
  })
})

test('工作台模块导入失败不移除父配置、任务存储及其他会话投影', async t => {
  const f = await fixture(t), hook = join(f.root, 'failed-workbench.mjs')
  await writeFile(hook, `export async function resolve(specifier, context, next) {
    const resolved = await next(specifier, context)
    if (new URL(resolved.url).pathname.endsWith('/src/dsh/workbench.ts')) return {
      url: 'data:text/javascript,globalThis.workbenchImportFailed = true; throw new Error("broken workbench module"); export function applyWorkbench() {}', shortCircuit: true,
    }
    return resolved
  }`)
  const script = `
    import assert from 'node:assert/strict'
    import { register } from 'node:module'
    import { setTimeout } from 'node:timers/promises'
    import { Context } from '@deepseek-ai/cordis'
    import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
    import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
    register(process.env.WORKBENCH_TEST_HOOK, import.meta.url)
    const { default: harness } = await import('./src/index.ts')
    const ctx = new Context()
    try {
      new SessionStore(ctx); const projections = new SessionProjectionRegistry(ctx)
      ctx.provide('fs', {}); ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only' }) })
      ctx.provide('storageDomain', { open: async () => ({ table: () => new Map(), close: async () => {} }) })
      await ctx.plugin(harness)
      const session = ctx.sessions.create(SessionId('other-features'))
      const keys = ['superCodeTasks', 'superCodeFeedback', 'superCodeMemoryUsage']
      for (let i = 0; i < 200 && !(globalThis.workbenchImportFailed && ctx.get('superCodeTaskMemory') && keys.every(key => projections.stateOf(session, key))); i++) await setTimeout(5)
      assert.equal(globalThis.workbenchImportFailed, true)
      assert.ok(ctx.get('superCodeConfiguration'))
      assert.ok(ctx.get('superCodeTaskMemory'))
      for (const key of keys) assert.ok(projections.stateOf(session, key))
      assert.equal(ctx.get('superCodeWorkbench'), undefined)
    } finally { await ctx.fiber.dispose() }
  `
  const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: new URL('../../', import.meta.url), env: { ...process.env, WORKBENCH_TEST_HOOK: hook }, timeout: 15000,
  })
  if (result.stderr) t.diagnostic(result.stderr)
})
