import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import LocalFS from '@deepseek-ai/dsh-fs-local'
import { SuperCodeWorkbench } from '../../src/dsh/workbench.js'
import { validationRoot } from '../validation-root.js'
import { library } from '../../src/workbench/git/library.js'
import * as fs from 'node:fs/promises'

test('工作台文件、模型与只读 Git 查询适用于官方和任意扩展预设，不改变会话或模型', async t => {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'workbench-presets-')), ctx = new Context()
  new SessionStore(ctx)
  await ctx.plugin(LocalFS, { cwd: root, diffBasisMaxBytes: 1024 })
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const text = 'function compute(value) {\n  return value + 1\n}\n'
  await writeFile(join(root, 'main.ts'), text)
  await writeFile(join(root, 'notes.txt'), 'compute')
  await writeFile(join(root, 'Dockerfile'), 'compute')
  await library.git.init({ fs, dir: root, defaultBranch: 'main' })
  await library.git.add({ fs, dir: root, filepath: 'main.ts' })
  await library.git.commit({ fs, dir: root, message: 'base', author: { name: 'Developer', email: 'developer@example.invalid' } })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only', workspaceRoot: root }) })
  ctx.provide('sandbox', { confine: (argv: string[]) => ({ argv }) })
  ctx.provide('llm', { listProviders: () => [], stream: () => assert.fail('只读查询不得调用模型') })
  const api = new SuperCodeWorkbench(ctx), signal = new AbortController().signal
  for (const agentPreset of [undefined, 'minimal', 'standard', 'super-code', 'third-party/custom-preset']) {
    const session = ctx.sessions.create(SessionId('preset-' + (agentPreset || 'unset')), { meta: { cwd: root, agentPreset } })
    const events = session.snapshotEvents()
    assert.equal((await api.read(session.id, 'main.ts', signal)).text, text)
    assert.equal((await api.list(session.id, '', signal)).entries.some(file => file.name === 'main.ts'), true)
    assert.deepEqual(await api.models(session.id, signal), [])
    const positions = await Array.fromAsync(api.searchProject(session.id, JSON.stringify({ search: 'compute', replace: '', caseSensitive: true, locations: true }), signal))
    assert.deepEqual(positions.filter(event => event.kind === 'matches').map(event => event.path).sort(), ['Dockerfile', 'main.ts', 'notes.txt'])
    assert.deepEqual(positions.at(-1), { kind: 'done', scanned: 3, skipped: 0 })
    const [status] = await Array.fromAsync(api.git(session.id, JSON.stringify({ action: 'status' }), signal))
    if (status.kind !== 'state') throw new Error('state')
    assert.deepEqual(status.sources, [])
    assert.equal(status.state.writable, false)
    const [history] = await Array.fromAsync(api.git(session.id, JSON.stringify({ action: 'lineHistory', target: { path: 'main.ts', start: 1, end: 3 }, text, version: status.state.version }), signal))
    assert.equal(history.kind === 'lineHistory' && history.history.entries.length, 1)
    for (const edit of [{ action: 'restoreHunk', path: 'main.ts', side: 'total', hunk: 0 }, { action: 'resolveConflict', path: 'main.ts', text: 'blocked\n' }]) {
      await assert.rejects(Array.fromAsync(api.git(session.id, JSON.stringify({ ...edit, version: status.state.version }), signal)), /WORKBENCH_GIT_READONLY/)
    }
    assert.equal(await readFile(join(root, 'main.ts'), 'utf8'), text)
    assert.equal(session.header.agentPreset, agentPreset)
    assert.deepEqual(session.snapshotEvents(), events)
    await assert.rejects(api.fileOperation(session.id, JSON.stringify({ action: 'createFile', path: 'blocked' }), signal), /WORKBENCH_FILES_READONLY/)
  }
  assert.equal(ctx.sessions.list().length, 5)
})

test('文件 Remote 使用所选会话目录及访问策略，拒绝坏请求和已取消请求', async t => {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'workbench-remote-')), ctx = new Context()
  new SessionStore(ctx)
  await ctx.plugin(LocalFS, { cwd: root, diffBasisMaxBytes: 1024 })
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  let readonly = false
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: readonly ? 'read-only' : 'workspace-write', workspaceRoot: root }) })
  const session = ctx.sessions.create(SessionId('files'), { meta: { cwd: root } })
  const api = new SuperCodeWorkbench(ctx), signal = new AbortController().signal
  const input = JSON.stringify({ action: 'createFile', path: '中文 文件.ts' })
  const created = await api.fileOperation(session.id, input, signal)
  assert.equal(created.path, '中文 文件.ts'); assert.match(created.token!, /^[0-9a-f-]{36}$/)
  assert.deepEqual(Object.keys(created).sort(), ['path', 'token'])
  assert.equal(await readFile(join(root, '中文 文件.ts'), 'utf8'), '')
  readonly = true
  await assert.rejects(api.fileOperation(session.id, JSON.stringify({ action: 'createDirectory', path: 'blocked' }), signal), /WORKBENCH_FILES_READONLY/)
  await assert.rejects(stat(join(root, 'blocked')), { code: 'ENOENT' })
  await assert.rejects(api.fileOperation('missing', input, signal), /WORKBENCH_SESSION/)
  await assert.rejects(api.fileOperation(session.id, '{}', signal))
  await assert.rejects(api.fileOperation(session.id, 'invalid json', signal))
  const abort = new AbortController(); abort.abort()
  await assert.rejects(api.fileOperation(session.id, input, abort.signal))
  const search = JSON.stringify({ search: 'needle', replace: '', caseSensitive: false, locations: true })
  await assert.rejects(Array.fromAsync(api.searchProject(session.id, search, abort.signal)), { name: 'AbortError' })
  await assert.rejects(Array.fromAsync(api.searchProject('missing', search, signal)), /WORKBENCH_SESSION/)
  await assert.rejects(Array.fromAsync(api.searchProject(session.id, '{invalid', signal)))
})

test('冷启动工作台通过宿主加载原会话，文件和模型设置使用原身份且不生成对话', async t => {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'workbench-cold-')), ctx = new Context()
  new SessionStore(ctx)
  await ctx.plugin(LocalFS, { cwd: root, diffBasisMaxBytes: 1024 })
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await writeFile(join(root, 'main.ts'), 'const value = 1\n')
  const stored = ctx.sessions.prepare(SessionId('stored'), { meta: { cwd: root } })
  stored.append('sandbox/mode', { mode: 'read-only' })
  const original = stored.snapshotEvents()
  let loads = 0
  ctx.provide('sessionController', { async resolveAgent(id: string) {
    assert.equal(id, stored.id); loads++
    ctx.effect(() => ctx.sessions.enter(stored))
    ctx.sessions.announce(stored)
    return { agent: { session: stored } }
  } })
  ctx.provide('sandboxPolicy', { resolve: ({ session }: { session: typeof stored }) => {
    assert.equal(session, stored)
    return { mode: 'read-only', workspaceRoot: root }
  } })
  ctx.provide('llm', { listProviders: () => [], stream: () => { throw new Error('不得触发模型') } })
  const api = new SuperCodeWorkbench(ctx), signal = new AbortController().signal
  assert.equal(ctx.sessions.get(stored.id), undefined)
  assert.deepEqual((await api.list(stored.id, '', signal)).entries.map(entry => entry.name), ['main.ts'])
  assert.equal((await api.read(stored.id, 'main.ts', signal)).text, 'const value = 1\n')
  assert.deepEqual(await api.models(stored.id, signal), [])
  await assert.rejects(api.fileOperation(stored.id, JSON.stringify({ action: 'createFile', path: 'blocked' }), signal), /WORKBENCH_FILES_READONLY/)
  assert.equal(loads, 1)
  assert.deepEqual(ctx.sessions.list(), [stored])
  assert.deepEqual(stored.snapshotEvents(), original)
  await assert.rejects(stat(join(root, 'blocked')), { code: 'ENOENT' })
})

test('冷会话加载失败不冒充空目录，取消不启动加载，失败后可以恢复', async t => {
  const ctx = new Context(); new SessionStore(ctx)
  ctx.provide('fs', {})
  t.after(() => ctx.fiber.dispose())
  const blocked = Object.assign(new Error('writer held'), { code: 'session/writer-held' })
  let loads = 0, fail = true
  ctx.provide('sessionController', { async resolveAgent(id: string) {
    loads++
    if (id === 'missing') return { error: Object.assign(new Error('not found'), { code: 'session/not-found' }) }
    if (fail) return { error: blocked }
    return { agent: { session: ctx.sessions.create(SessionId(id)) } }
  } })
  ctx.provide('llm', { listProviders: () => [] })
  const api = new SuperCodeWorkbench(ctx), signal = new AbortController().signal
  const abort = new AbortController(); abort.abort()
  await assert.rejects(api.models('stored', abort.signal), { name: 'AbortError' })
  await assert.rejects(api.openWindow('stored', 'false', abort.signal), { name: 'AbortError' })
  await assert.rejects(api.list('stored', '', abort.signal), { name: 'AbortError' })
  await assert.rejects(api.fileOperation('stored', '{}', abort.signal), { name: 'AbortError' })
  assert.equal(loads, 0)
  await assert.rejects(api.models('missing', signal), /WORKBENCH_SESSION/)
  await assert.rejects(api.models('stored', signal), error => error === blocked)
  assert.equal(ctx.sessions.list().length, 0)
  fail = false
  assert.deepEqual(await api.models('stored', signal), [])
  assert.equal(loads, 3)
})

test('会话加载期间取消或卸载不继续查询模型，也不接管宿主持有的会话', async () => {
  for (const unload of [false, true]) {
    const ctx = new Context(); new SessionStore(ctx)
    ctx.provide('fs', {})
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    const stored = ctx.sessions.prepare(SessionId('loading'))
    let catalogCalls = 0
    ctx.provide('sessionController', { async resolveAgent() {
      entered.resolve(); await release.promise
      return { agent: { session: stored } }
    } })
    ctx.provide('llm', { listProviders: () => { catalogCalls++; return [] } })
    const api = new SuperCodeWorkbench(ctx), abort = new AbortController()
    const waiting = api.models(stored.id, abort.signal)
    await entered.promise
    if (unload) await ctx.fiber.dispose()
    else abort.abort()
    release.resolve()
    await assert.rejects(waiting, { name: 'AbortError' })
    assert.equal(catalogCalls, 0)
    assert.equal(stored.seq, 0)
    if (!unload) await ctx.fiber.dispose()
  }
})

test('语言环境接口跟随会话目录并保持预设和记录不变，卸载取消查询',async t=>{
 await mkdir(validationRoot,{recursive:true});const cwd=await mkdtemp(join(validationRoot,'workbench-environment-')),ctx=new Context();new SessionStore(ctx);await ctx.plugin(LocalFS,{cwd});
 t.after(async()=>{await ctx.fiber.dispose();await rm(cwd,{recursive:true,force:true})})
 await mkdir(join(cwd,'venv/Lib'),{recursive:true});await writeFile(join(cwd,'venv/Lib/demo.py'),'def run(value: int): return value\n')
 ctx.provide('sandboxPolicy',{resolve:()=>({mode:'read-only',workspaceRoot:cwd})});ctx.provide('sessionProjections',{stateOf:()=>null});ctx.provide('llm',{stream(){assert.fail('环境接口不能调用模型')}})
 const api=new SuperCodeWorkbench(ctx),signal=new AbortController().signal
 for(const agentPreset of ['minimal','standard','super-code','third-party/custom-preset']){
  const session=ctx.sessions.create(SessionId('language-'+agentPreset),{meta:{cwd,agentPreset}}),events=session.snapshotEvents()
  const result=await api.environments(session.id,'{}',signal);assert.ok(result.environments.find(item=>item.language==='python')?.roots.length)
  const source=await Array.fromAsync(api.languageSources(session.id,JSON.stringify({language:'python',module:'demo',paths:{}}),signal));assert.ok(source.some(item=>item.kind==='source'&&item.text.startsWith('def run')));assert.deepEqual(session.snapshotEvents(),events)
 }
 const id=ctx.sessions.list()[0]!.id
 await assert.rejects(api.environments(id,'{"unknown":"path"}',signal));await assert.rejects(async()=>Array.fromAsync(api.languageSources(id,JSON.stringify({language:'python',module:'../private',paths:{}}),signal)))
 await ctx.fiber.dispose();await assert.rejects(api.environments(id,'{}',signal))
})
