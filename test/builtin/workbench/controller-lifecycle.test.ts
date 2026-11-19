import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInThisContext, constants } from 'node:vm'

let factory: Promise<any>
const preparations = new Map<string, Promise<void>>()
function loadController() {
  return factory ||= (async () => {
    const result = await build({ entryPoints: [new URL('../../../builtin/workbench/controller.js', import.meta.url).pathname],
      bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
      plugins: [{ name: 'headless-editor', setup(build) {
        build.onResolve({ filter: /editor\/view\.js$/ }, () => ({ path: 'editor', namespace: 'headless' }))
        build.onLoad({ filter: /.*/, namespace: 'headless' }, () => ({ contents: `
          import {EditorState} from '@codemirror/state';
          export function createEditor({changed}) {
            let view;
            return {get view(){return view}, capture:()=>view.state, state:async (file,source)=>{await prepareState(file);const{text,saved}=source();return saved||EditorState.create({doc:text})},
              show(state){view={state,focus(){},dispatch(spec){const tr=this.state.update(spec);this.state=tr.state;changed({startState:tr.startState,state:this.state,docChanged:tr.docChanged,selectionSet:tr.selection!==undefined,changes:tr.changes,transactions:[tr]})}}},
              dispose(){view=undefined}, preferences(){},readonly(){}};
          }`, resolveDir: new URL('../../../', import.meta.url).pathname }))
      } }],
    })
    const module = { exports: {} as any }
    runInThisContext(`(function(require,module,exports,prepareState){${result.outputFiles[0].text}\n})`, {
      filename: new URL('../../../lifecycle-fixture.cjs', import.meta.url).pathname,
      importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    })(createRequire(import.meta.url), module, module.exports, (file: string) => preparations.get(file))
    return module.exports.createWorkbench
  })()
}
async function fixture(t: any, overrides: any = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value),
  } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage') })
  const written: any[] = [], projects = new Map()
  const api = {
    fileOperation: async (input: any) => {
      if (input.action === 'absolutePath') return { path: '/project' }
      written.push(input); return { path: input.path, token: 'created-file' }
    },
    list: async () => ({ entries: [], truncated: false }), project: async () => ({ files: [], truncated: false }),
    read: async (path: string) => ({ path, text: 'old', version: 'v1' }),
    save: async (input: any) => { written.push(input); return { ...input, version: 'v2' } },
    ...overrides,
  }
  const workbench = (await loadController())(api, (key: string) => key, { projects })
  t.after(() => { workbench.dispose(); for (const project of projects.values()) project.dispose() })
  await workbench.attach({}, {})
  await new Promise(resolve => setImmediate(resolve))
  return { workbench, written, projects, api }
}
function newFile(workbench: any) { workbench.panel({ kind: 'fileAction', id: 'new-file', action: 'createFile', name: '新文件.ts', parent: '' }) }

for (const stage of ['read', 'language']) for (const removed of ['other.ts', 'folder', 'folder/slow.ts']) {
  test(`另一窗口回收${removed}时，仅取消受影响文件的${stage === 'read' ? '读取' : '语言准备'}`, async t => {
    const pending = Promise.withResolvers<void>(), started = Promise.withResolvers<void>(), file = 'folder/slow.ts'
    const { workbench, api, projects } = await fixture(t, {
      read: async (path: string) => {
        if (path === file && stage === 'read') { started.resolve(); await pending.promise }
        return { path, text: 'old', version: 'v1' }
      },
    })
    const peer = (await loadController())(api, (key: string) => key, { projects }); t.after(() => peer.dispose())
    await peer.attach({}, {}); await workbench.visit({ file: 'initial.ts' }); workbench.keepTab('initial.ts')
    if (stage === 'language') { preparations.set(file, pending.promise); t.after(() => preparations.delete(file)) }
    const opening = workbench.visit({ file })
    try {
      if (stage === 'read') await started.promise
      else while (!workbench.documents.has(file)) await new Promise(resolve => setImmediate(resolve))
      await peer.fileOperation({ action: 'trash', path: removed })
    } finally { pending.resolve(); await opening }
    assert.equal(workbench.snapshot().file, removed === 'other.ts' ? file : 'initial.ts')
    assert.equal(workbench.snapshot().status, 'saved', '取消受影响读取后也不能停留在加载状态')
    assert.equal(workbench.snapshot().error, '')
    assert.equal(workbench.documents.has(file), removed === 'other.ts')
  })
}

for (const removed of ['a.ts', 'c.ts']) test(`另一窗口回收导航历史中的${removed}后，前进后退按钮立即更新`, async t => {
  const { workbench, api, projects } = await fixture(t)
  const peer = (await loadController())(api, (key: string) => key, { projects }); t.after(() => peer.dispose())
  await peer.attach({}, {})
  for (const file of ['a.ts', 'b.ts', 'c.ts']) { await workbench.visit({ file }); workbench.keepTab(file) }
  await workbench.move(-1)
  assert.equal(workbench.snapshot().back, true); assert.equal(workbench.snapshot().forward, true)
  await peer.fileOperation({ action: 'trash', path: removed })
  assert.equal(workbench.snapshot().file, 'b.ts')
  assert.equal(workbench.snapshot().back, removed !== 'a.ts'); assert.equal(workbench.snapshot().forward, removed !== 'c.ts')
  await workbench.move(removed === 'a.ts' ? 1 : -1)
  assert.equal(workbench.snapshot().file, removed === 'a.ts' ? 'c.ts' : 'a.ts')
})

test('项目Git通知只刷新同项目已订阅视图，查询不通知，写入成功或失败后均不会形成刷新循环', async t => {
  let root = '/project'
  const status = { kind: 'state', state: { version: 'v1', exists: true, changes: [] } }, calls: any[] = []
  const { workbench, api, projects } = await fixture(t, {
    fileOperation: async () => ({ path: root }),
    git: async (input: any) => { calls.push(input); if (input.action === 'stage') throw new Error('write rejected'); return status },
  })
  const peer = (await loadController())(api, (key: string) => key, { projects }), other = (await loadController())(api, (key: string) => key, { projects })
  t.after(() => { peer.dispose(); other.dispose() })
  await peer.attach({}, {}); root = '/other'; await other.attach({}, {})
  const offPeer = peer.changes.subscribe(() => {}), offOther = other.changes.subscribe(() => {})
  t.after(() => { offPeer(); offOther() })
  await peer.changes.refresh(); await other.changes.refresh(); calls.length = 0
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await workbench.git({ action: 'status' })
  t.mock.timers.tick(500); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls.map(call => call.action), ['status'], '查询不触发额外刷新')
  calls.length = 0
  await assert.rejects(workbench.git({ action: 'stage', paths: ['a.ts'] }), /write rejected/)
  t.mock.timers.tick(500); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls.map(call => call.action), ['stage', 'status'], '失败可能已部分写入，仍补读同项目状态')
  t.mock.timers.tick(500); await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 2)
  calls.length = 0
  await workbench.git({ action: 'branch', branch: 'next' })
  t.mock.timers.tick(500); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls.map(call => call.action), ['branch', 'status'], '只刷新同项目视图')
  t.mock.timers.tick(500); await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 2, '读取完成后不再次通知项目')
})

for (const action of ['restoreHunk', 'checkout', 'pull', 'merge', 'abortMerge']) for (const failed of [false, true]) test(`Git ${action}后的补读${failed ? '失败' : '返回'}时已切换项目，不修改新项目的文本和错误状态`, async t => {
  let root = '/first', syncing = false
  const pending = Promise.withResolvers<void>(), started = Promise.withResolvers<void>()
  const { workbench, api, projects } = await fixture(t, {
    fileOperation: async () => ({ path: root }),
    git: async () => { syncing = true; return { kind: 'state', state: { version: 'v2' } } },
    read: async (path: string) => {
      const loaded = { path, text: root === '/first' ? 'old' : 'new project', version: 'v1' }
      if (syncing) {
        syncing = false; started.resolve(); await pending.promise
        if (failed) throw new Error('old project unavailable')
        return { path, text: 'restored', version: 'v2' }
      }
      return loaded
    },
  })
  const peer = (await loadController())(api, (key: string) => key, { projects }); t.after(() => peer.dispose())
  await peer.attach({}, {}); await peer.visit({ file: 'main.ts' }); await workbench.visit({ file: 'main.ts' })
  const restoring = workbench.git({ action, path: 'main.ts', side: 'total', hunk: 0 })
  await started.promise
  try { root = '/second'; workbench.detach(); await workbench.attach({}, {}); await workbench.visit({ file: 'main.ts' }) }
  finally { pending.resolve() }
  await restoring
  assert.equal(workbench.view().state.doc.toString(), 'new project')
  assert.equal(workbench.snapshot().error, '')
  assert.equal(projects.get('/second').documents.get('main.ts').dirty, false)
  assert.equal(peer.view().state.doc.toString(), failed ? 'old' : 'restored')
})

test('Git写入已经完成后收到取消，仍通知另一视图更新实际仓库状态', async t => {
  const pending = Promise.withResolvers<any>(), started = Promise.withResolvers<void>(), calls: string[] = []
  const state = { kind: 'state', state: { version: 'v1', exists: true, changes: [] } }
  const { workbench, api, projects } = await fixture(t, {
    git: async (input: any) => { calls.push(input.action); if (input.action === 'branch') { started.resolve(); return pending.promise } return state },
  })
  const peer = (await loadController())(api, (key: string) => key, { projects }); t.after(() => peer.dispose())
  await peer.attach({}, {})
  const off = peer.changes.subscribe(() => {}); t.after(off); await peer.changes.refresh(); calls.length = 0
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const abort = new AbortController(), writing = workbench.git({ action: 'branch', branch: 'next' }, abort.signal)
  await started.promise; abort.abort(); pending.resolve(state); await writing
  t.mock.timers.tick(500); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['branch', 'status'])
})

for (const fails of [false, true]) test(`文件操作${fails ? '失败' : '完成'}后继续保存此前排队的自动保存，不丢失自动保存计划`, async t => {
  const pending = Promise.withResolvers<void>(), started = Promise.withResolvers<void>(), saves: string[] = []
  const { workbench } = await fixture(t, {
    fileOperation: async (input: any) => {
      if (input.action === 'absolutePath') return { path: '/project' }
      if (input.action === 'releaseHistory') return {}
      started.resolve(); await pending.promise
      if (fails) throw new Error('directory unavailable')
      return { path: input.path, token: 'new-directory' }
    },
    save: async (input: any) => { saves.push(input.text); return { ...input, version: 'v2' } },
  })
  await workbench.visit({ file: 'main.ts' })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  workbench.settings({ ...workbench.snapshot().preferences, autoSave: 'immediate' })
  workbench.view().dispatch({ changes: { from: 3, insert: ' edited' } })
  const operation = workbench.fileOperation({ action: 'createDirectory', path: 'folder' }).then(() => null, (error: Error) => error)
  await started.promise
  let failure: unknown
  try {
    t.mock.timers.tick(0); await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(saves, [], '文件操作期间等待，不并发写入')
    assert.equal(workbench.snapshot().error, '', '自动保存不能因临时忙碌报错并丢失计划')
  } finally { pending.resolve(); failure = await operation }
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(failure instanceof Error, fails)
  assert.deepEqual(saves, ['old edited'])
  assert.equal(workbench.documents.get('main.ts').dirty, false)
})

for (const action of ['manual', 'dispose', 'detach']) test(`自动保存等待文件操作时${action}，不误写或遗留忙碌错误`, async t => {
  const pending = Promise.withResolvers<void>(), started = Promise.withResolvers<void>(), saves: string[] = []
  const { workbench, api } = await fixture(t)
  api.fileOperation = async (input: any) => {
    if (input.action === 'absolutePath') return { path: '/project' }
    if (input.action === 'releaseHistory') return {}
    started.resolve(); await pending.promise; return { path: input.path, token: 'new-directory' }
  }
  api.save = async (input: any) => { saves.push(input.text); return { ...input, version: 'v2' } }
  await workbench.visit({ file: 'main.ts' })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  workbench.settings({ ...workbench.snapshot().preferences, autoSave: 'immediate' })
  workbench.view().dispatch({ changes: { from: 3, insert: ' edited' } })
  const operation = workbench.fileOperation({ action: 'createDirectory', path: 'folder' })
  await started.promise
  try {
    t.mock.timers.tick(0); await new Promise(resolve => setImmediate(resolve))
    if (action === 'manual') workbench.settings({ ...workbench.snapshot().preferences, autoSave: 'manual' })
    else if (action === 'dispose') workbench.dispose()
    else workbench.detach()
  } finally { pending.resolve(); await operation }
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(saves, action === 'detach' ? ['old edited'] : [])
  assert.equal(workbench.snapshot().error, '')
})

for (const blocked of [false, true]) test(`自动保存${blocked ? '等待文件操作时' : '定时触发时'}切换项目，不把旧缓冲写到新项目的同名文件`, async t => {
  let root = '/first'
  const pending = Promise.withResolvers<void>(), started = Promise.withResolvers<void>(), saves: any[] = []
  const { workbench, projects } = await fixture(t, {
    fileOperation: async (input: any) => {
      if (input.action === 'absolutePath') {
        if (root === '/second') { started.resolve(); await pending.promise }
        return { path: root }
      }
      if (input.action === 'releaseHistory') return {}
      started.resolve(); await pending.promise; return { path: input.path, token: 'new-directory' }
    },
    save: async (input: any) => { saves.push({ root, ...input }); return { ...input, version: 'v2' } },
  })
  await workbench.visit({ file: 'main.ts' })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  workbench.settings({ ...workbench.snapshot().preferences, autoSave: 'immediate' })
  workbench.view().dispatch({ changes: { from: 3, insert: ' edited' } })
  const operation = blocked ? workbench.fileOperation({ action: 'createDirectory', path: 'folder' }) : Promise.resolve()
  if (blocked) { await started.promise; t.mock.timers.tick(0); await new Promise(resolve => setImmediate(resolve)) }
  root = '/second'; workbench.detach(); const attaching = workbench.attach({}, {})
  if (!blocked) { await started.promise; t.mock.timers.tick(0); await new Promise(resolve => setImmediate(resolve)) }
  pending.resolve(); await Promise.all([operation, attaching])
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(saves, [])
  assert.equal(projects.get('/first').documents.get('main.ts').text, 'old edited')
  assert.equal(projects.get('/first').documents.get('main.ts').dirty, true)
})

test('已经进入共享队列但尚未写入的保存，切换项目后不能写入其他同名文件', async t => {
  let root = '/first'
  const pending = Promise.withResolvers<void>(), started = Promise.withResolvers<void>(), saves: any[] = []
  const { workbench, projects } = await fixture(t, {
    fileOperation: async () => ({ path: root }),
    save: async (input: any) => { saves.push({ root, ...input }); return { ...input, version: 'v2' } },
  })
  await workbench.visit({ file: 'main.ts' })
  workbench.view().dispatch({ changes: { from: 3, insert: ' edited' } })
  const lock = projects.get('/first').exclusive(async () => { started.resolve(); await pending.promise })
  await started.promise
  const saving = workbench.save().then(() => null, (error: Error) => error)
  try {
    root = '/second'; workbench.detach(); await workbench.attach({}, {})
    await workbench.visit({ file: 'main.ts' })
    workbench.view().dispatch({ changes: { from: 3, insert: ' second' } })
  } finally { pending.resolve(); await lock }
  const failure = await saving
  assert.deepEqual(saves, [])
  assert.equal(failure instanceof Error && failure.message, 'WORKBENCH_PROJECT_CHANGED')
  assert.equal(projects.get('/first').documents.get('main.ts').text, 'old edited')
  assert.equal(projects.get('/second').documents.get('main.ts').text, 'old second')
})

test('旧项目保存完成时只通知原项目，不能清除新项目的草稿状态及错误', async t => {
  let root = '/first'
  const pending = Promise.withResolvers<any>(), started = Promise.withResolvers<any>()
  const { workbench, projects, api } = await fixture(t, {
    fileOperation: async () => ({ path: root }),
    save: (input: any) => { started.resolve(input); return pending.promise },
  })
  const peer = (await loadController())(api, (key: string) => key, { projects }); t.after(() => peer.dispose())
  await peer.attach({}, {}); await peer.visit({ file: 'main.ts' }); await workbench.visit({ file: 'main.ts' })
  workbench.view().dispatch({ changes: { from: 3, insert: ' edited' } })
  const saving = workbench.save(), input = await started.promise
  try {
    root = '/second'; workbench.detach(); await workbench.attach({}, {}); await workbench.visit({ file: 'main.ts' })
    workbench.view().dispatch({ changes: { from: 3, insert: ' second' } }); workbench.fail(new Error('new project error'))
  } finally { pending.resolve({ ...input, version: 'v2' }); await saving }
  assert.equal(peer.snapshot().status, 'saved')
  assert.equal(peer.snapshot().tabs[0].dirty, false)
  assert.equal(workbench.snapshot().status, 'unsaved')
  assert.equal(workbench.snapshot().error, 'new project error')
  assert.equal(projects.get('/second').documents.get('main.ts').dirty, true)
})

test('撤销在共享队列等待时切换项目，不能撤回新项目的同内容编辑', async t => {
  let root = '/first'
  const pending = Promise.withResolvers<void>(), started = Promise.withResolvers<void>()
  const { workbench, projects } = await fixture(t, { fileOperation: async () => ({ path: root }) })
  await workbench.visit({ file: 'main.ts' })
  workbench.view().dispatch({ changes: { from: 3, insert: ' edited' } })
  const lock = projects.get('/first').exclusive(async () => { started.resolve(); await pending.promise }); await started.promise
  const undoing = workbench.undo().then(() => null, (error: Error) => error)
  await new Promise(resolve => setImmediate(resolve))
  try {
    root = '/second'; workbench.detach(); await workbench.attach({}, {}); await workbench.visit({ file: 'main.ts' })
    workbench.view().dispatch({ changes: { from: 3, insert: ' edited' } })
  } finally { pending.resolve(); await lock }
  const failure = await undoing
  assert.equal(failure instanceof Error && failure.message, 'WORKBENCH_PROJECT_CHANGED')
  assert.equal(projects.get('/second').documents.get('main.ts').text, 'old edited')
  assert.equal(projects.get('/first').documents.get('main.ts').text, 'old edited')
})

for (const action of ['replace', 'checkout']) test(`${action}在共享队列等待时切换项目，不操作新项目`, async t => {
  let root = '/first'
  const pending = Promise.withResolvers<void>(), started = Promise.withResolvers<void>(), writes: any[] = []
  const { workbench, projects } = await fixture(t, {
    fileOperation: async () => ({ path: root }),
    save: async (input: any) => { writes.push({ root, ...input }); return { ...input, version: 'v2' } },
    git: async (input: any) => { writes.push({ root, ...input }); return { kind: 'state', state: { version: 'v2' } } },
  })
  await workbench.visit({ file: 'main.ts' })
  const lock = projects.get('/first').exclusive(async () => { started.resolve(); await pending.promise }); await started.promise
  const mutation = (action === 'replace'
    ? workbench.replaceProject([{ path: 'main.ts', version: 'v1' }], { search: 'old', replace: 'new', caseSensitive: true }, () => {}, new AbortController().signal)
    : workbench.git({ action: 'checkout', branch: 'other' }))
    .then((value: any) => value, (error: Error) => error)
  await new Promise(resolve => setImmediate(resolve))
  try { root = '/second'; workbench.detach(); await workbench.attach({}, {}); await workbench.visit({ file: 'main.ts' }) }
  finally { pending.resolve(); await lock }
  const result = await mutation
  assert.deepEqual(writes, [])
  const failure = action === 'replace' ? result.failed[0].error : result
  assert.equal(failure instanceof Error && failure.message, 'WORKBENCH_PROJECT_CHANGED')
  assert.equal(projects.get('/second').documents.get('main.ts').text, 'old')
})

test('替换已经落盘后切换项目，完成记录和选区只更新原项目', async t => {
  let root = '/first'
  const pending = Promise.withResolvers<any>(), started = Promise.withResolvers<any>()
  const { workbench, projects } = await fixture(t, {
    fileOperation: async () => ({ path: root }),
    save: (input: any) => { started.resolve(input); return pending.promise },
  })
  await workbench.visit({ file: 'main.ts' })
  workbench.view().dispatch({ selection: { anchor: 0, head: 3 } }); workbench.assistant.select(); workbench.assistant.pin()
  const thread = projects.get('/first').conversations.rows()[0]
  const replacing = workbench.replaceProject([{ path: 'main.ts', version: 'v1' }], { search: 'old', replace: 'longer', caseSensitive: true }, () => {}, new AbortController().signal)
  const input = await started.promise
  try { root = '/second'; workbench.detach(); await workbench.attach({}, {}); await workbench.visit({ file: 'main.ts' }) }
  finally { pending.resolve({ ...input, version: 'v2' }) }
  const result = await replacing, original = projects.get('/first')
  assert.deepEqual(result.changed, ['main.ts'])
  assert.equal(original.documents.get('main.ts').text, 'longer')
  assert.equal(original.documents.get('main.ts').dirty, false)
  assert.equal(original.conversations.rows()[0].id, thread.id)
  assert.equal(original.conversations.rows()[0].to, 6)
  assert.equal(original.conversations.rows()[0].stale, true)
  assert.equal(workbench.view().state.doc.toString(), 'old')
  assert.equal(projects.get('/second').documents.get('main.ts').dirty, false)
})

for (const late of [false, true]) test(`项目切换清空旧Git状态，${late ? '晚到查询也不能恢复' : '已加载快照不显示在新项目'}`, async t => {
  let root = '/first'
  const pending = Promise.withResolvers<void>(), started = Promise.withResolvers<void>()
  const { workbench } = await fixture(t, {
    fileOperation: async () => ({ path: root }),
    git: async () => { const branch = root; if (late) { started.resolve(); await pending.promise } return { kind: 'state', state: { exists: true, version: branch, branch } } },
  })
  const loading = workbench.changes.refresh()
  if (late) await started.promise; else await loading
  try { root = '/second'; workbench.detach(); await workbench.attach({}, {}) }
  finally { pending.resolve(); await loading }
  assert.equal(workbench.changes.snapshot().state, null)
  assert.equal(workbench.changes.snapshot().busy, false)
})

test('文件已创建而随后打开失败时关闭创建表单，避免重试重复创建', async t => {
  const { workbench, written } = await fixture(t, { read: async () => { throw new Error('read unavailable') } })
  newFile(workbench); await workbench.submitFileAction()
  assert.equal(workbench.snapshot().panel, null)
  assert.equal(workbench.snapshot().error, 'read unavailable')
  await workbench.submitFileAction()
  assert.equal(written.filter(input => input.action === 'createFile').length, 1)
})

test('文件撤销成功后目录刷新失败仍记为成功，刷新错误可见且不重复执行', async t => {
  let failList = false
  const { workbench, written } = await fixture(t, { list: async () => {
    if (failList) throw new Error('list unavailable')
    return { entries: [], truncated: false }
  } })
  newFile(workbench); await workbench.submitFileAction(); failList = true
  await assert.doesNotReject(workbench.undo())
  assert.equal(workbench.snapshot().status, 'undone')
  assert.equal(workbench.snapshot().error, 'list unavailable')
  assert.equal(workbench.snapshot().file, null)
  await workbench.undo()
  assert.equal(written.filter(input => input.action === 'undo').length, 1)
})

test('保存失败保留未保存内容和版本，重试期间的新编辑仍保留为未保存', async t => {
  let failSave = true
  const waiting = Promise.withResolvers<any>(), started = Promise.withResolvers<any>()
  const { workbench } = await fixture(t, { save: async (input: any) => {
    if (failSave) throw new Error('disk unavailable')
    started.resolve(input); return waiting.promise
  } })
  await workbench.visit({ file: 'main.ts' }); workbench.view().dispatch({ changes: { from: 3, insert: ' edited' } })
  await assert.rejects(workbench.save(), /disk unavailable/)
  assert.equal(workbench.documents.get('main.ts').text, 'old edited')
  assert.equal(workbench.documents.get('main.ts').version, 'v1')
  assert.equal(workbench.documents.get('main.ts').dirty, true)
  failSave = false
  const saving = workbench.save(), input = await started.promise
  workbench.view().dispatch({ changes: { from: 10, insert: ' again' } })
  waiting.resolve({ ...input, version: 'v2' }); await saving
  assert.equal(workbench.documents.get('main.ts').original, 'old edited')
  assert.equal(workbench.documents.get('main.ts').text, 'old edited again')
  assert.equal(workbench.documents.get('main.ts').dirty, true)
})

test('撤销读取期间调整历史上限，先完成本次撤销再清理历史', async t => {
  const started = Promise.withResolvers<void>(), pending = Promise.withResolvers<void>()
  let blocking = false
  const { workbench } = await fixture(t, { read: async (path: string) => {
    if (blocking) { blocking = false; started.resolve(); await pending.promise }
    return { path, text: 'old', version: 'v1' }
  } })
  await workbench.visit({ file: 'first.ts' }); workbench.view().dispatch({ changes: { from: 3, insert: ' first' } })
  await workbench.visit({ file: 'second.ts' }); workbench.view().dispatch({ changes: { from: 3, insert: ' second' } })
  await workbench.visit({ file: 'first.ts' })
  blocking = true
  const undoing = workbench.undo(); await started.promise
  workbench.settings({ ...workbench.snapshot().preferences, undoLimit: 1 })
  pending.resolve(); await assert.doesNotReject(undoing)
  assert.equal(workbench.view().state.doc.toString(), 'old')
  await workbench.undo('redo')
  assert.equal(workbench.view().state.doc.toString(), 'old first')
})

test('文件撤销期间调整历史上限，不能提前释放正在使用的恢复令牌', async t => {
  const started = Promise.withResolvers<void>(), pending = Promise.withResolvers<void>(), released: string[] = []
  const { workbench } = await fixture(t, { fileOperation: async (input: any) => {
    if (input.action === 'absolutePath') return { path: '/project' }
    if (input.action === 'releaseHistory') { released.push(...input.tokens); return {} }
    if (input.action === 'undo') { started.resolve(); await pending.promise }
    return { path: input.path, token: input.path || input.token }
  } })
  await workbench.fileOperation({ action: 'createFile', path: 'first.ts' })
  await workbench.fileOperation({ action: 'createFile', path: 'second.ts' })
  await workbench.visit({ file: 'first.ts' })
  const undoing = workbench.undo(); await started.promise
  workbench.settings({ ...workbench.snapshot().preferences, undoLimit: 1 })
  const early = [...released]
  pending.resolve(); await assert.doesNotReject(undoing)
  assert.equal(early.includes('first.ts'), false)
  await workbench.undo('redo')
})

test('创建文件失败保留表单输入和重试入口，忙碌时重复提交只执行一次', async t => {
  const pending = Promise.withResolvers<any>(), started = Promise.withResolvers<void>()
  let attempts = 0
  const { workbench } = await fixture(t, { fileOperation: async (input: any) => {
    if (input.action === 'absolutePath') return { path: '/project' }
    if (input.action === 'releaseHistory') return {}
    attempts++; if (attempts === 1) { started.resolve(); return pending.promise }
    return { path: input.path, token: 'created-file' }
  } })
  newFile(workbench)
  const submitting = workbench.submitFileAction(); await started.promise
  await workbench.submitFileAction(); assert.equal(attempts, 1)
  pending.reject(new Error('write unavailable')); await submitting
  assert.equal(workbench.snapshot().panel.busy, false)
  assert.equal(workbench.snapshot().panel.name, '新文件.ts')
  assert.equal(workbench.snapshot().panel.error, 'write unavailable')
  await workbench.submitFileAction()
  assert.equal(attempts, 2); assert.equal(workbench.snapshot().panel, null)
  assert.equal(workbench.snapshot().file, '新文件.ts')
})

test('读取中离开再进入，旧文件晚到不能覆盖之后的导航', async t => {
  const pending = Promise.withResolvers<any>(), started = Promise.withResolvers<void>()
  const { workbench } = await fixture(t, { read: async (path: string) => {
    if (path === 'old.ts') { started.resolve(); return pending.promise }
    return { path, text: 'new content', version: 'v1' }
  } })
  const first = workbench.visit({ file: 'old.ts' }); await started.promise
  workbench.detach(); await workbench.attach({}, {})
  const second = workbench.visit({ file: 'new.ts' })
  pending.resolve({ path: 'old.ts', text: 'late content', version: 'v1' })
  await Promise.all([first, second])
  assert.equal(workbench.snapshot().file, 'new.ts')
  assert.equal(workbench.view().state.doc.toString(), 'new content')
  assert.equal(workbench.documents.has('old.ts'), false)
})

test('工作区切换期间的语言路径保存不能写入新工作区', async t => {
  let root = '/first', blocked = false
  const pending = Promise.withResolvers<void>(), started = Promise.withResolvers<void>()
  const { workbench, projects } = await fixture(t, { fileOperation: async () => {
    const path = root
    if (blocked) { started.resolve(); await pending.promise }
    return { path }
  } })
  await workbench.environmentPaths({ python: '.venv-first' })
  root = '/second'; blocked = true; workbench.detach()
  const attaching = workbench.attach({}, {}); await started.promise
  const saved = workbench.environmentPaths({ python: '.venv-stale' })
  const rejected = assert.rejects(saved, /WORKBENCH_PROJECT_CHANGED/)
  pending.resolve(); await attaching; await rejected
  assert.deepEqual(projects.get('/first').environment.snapshot().paths, { python: '.venv-first' })
  assert.deepEqual(projects.get('/second').environment.snapshot().paths, {})
  await workbench.environmentPaths({ python: '.venv-second' })
  assert.deepEqual(projects.get('/second').environment.snapshot().paths, { python: '.venv-second' })
})

test('切换项目时丢弃旧页面尚未开始的排队导航，不在新项目打开同名文件', async t => {
  let root = '/first'
  const pending = Promise.withResolvers<any>(), started = Promise.withResolvers<void>()
  const { workbench } = await fixture(t, {
    fileOperation: async () => ({ path: root }),
    read: async (path: string) => {
      if (path === 'slow.ts') { started.resolve(); return pending.promise }
      return { path, text: root, version: 'v2' }
    },
  })
  const opening = workbench.visit({ file: 'slow.ts' }); await started.promise
  const queued = workbench.visit({ file: 'queued.ts' })
  root = '/second'; workbench.detach(); await workbench.attach({}, {})
  pending.resolve({ path: 'slow.ts', text: 'old', version: 'v1' }); await Promise.all([opening, queued])
  assert.equal(workbench.snapshot().file, null)
  assert.equal(workbench.documents.has('queued.ts'), false)
  await workbench.visit({ file: 'new.ts' })
  assert.equal(workbench.snapshot().file, 'new.ts')
})

test('刷新被后一次替换后，忽略取消的旧扫描不能恢复旧索引或忙碌状态', async t => {
  const pending = Promise.withResolvers<any>(), started = Promise.withResolvers<void>()
  let block = false
  const { workbench } = await fixture(t, { project: async () => {
    if (block) { block = false; started.resolve(); return pending.promise }
    return { files: [], truncated: false }
  } })
  block = true
  const first = workbench.refresh(); await started.promise
  await workbench.refresh()
  pending.resolve({ files: ['old.ts'], truncated: false }); await first
  assert.equal(workbench.snapshot().indexing, false)
  assert.equal(workbench.snapshot().indexed, 0)
  assert.equal(workbench.index.files.size, 0)
})

test('同项目重进保留学习计划，切换项目清除旧计划和缓存并保留目标草稿', async t => {
  let root = '/first'
  const plan = { title: '旧项目', summary: '说明', steps: [] }
  const { workbench } = await fixture(t, {
    fileOperation: async () => ({ path: root }),
    async *reading() { yield { kind: 'plan', plan }; yield { kind: 'done' } },
  })
  workbench.reading.goal('下一步目标'); await workbench.reading.plan()
  workbench.detach(); await workbench.attach({}, {})
  assert.equal(workbench.reading.snapshot().plan.title, '旧项目')
  root = '/second'; workbench.detach(); await workbench.attach({}, {})
  const state = workbench.reading.snapshot()
  assert.equal(state.plan, null); assert.deepEqual(state.sections, []); assert.deepEqual(state.sources, [])
  assert.equal(state.target, null); assert.equal(state.status, 'idle'); assert.equal(state.active, -1)
  assert.equal(state.goal, '下一步目标')
})

test('切换项目取消旧学习请求，忽略取消的晚到结果也不能进入新项目', async t => {
  let root = '/first', signal: AbortSignal | undefined
  const started = Promise.withResolvers<void>(), pending = Promise.withResolvers<void>()
  const { workbench } = await fixture(t, {
    fileOperation: async () => ({ path: root }),
    async *reading(_input: any, abort: AbortSignal) {
      signal = abort; started.resolve(); await pending.promise
      yield { kind: 'plan', plan: { title: '旧项目晚到', summary: '', steps: [] } }; yield { kind: 'done' }
    },
  })
  workbench.reading.goal('目标'); const running = workbench.reading.plan(); await started.promise
  root = '/second'; workbench.detach(); await workbench.attach({}, {})
  const aborted = signal!.aborted
  pending.resolve(); await running
  assert.equal(aborted, true)
  assert.equal(workbench.reading.snapshot().plan, null)
  assert.equal(workbench.reading.snapshot().status, 'idle')
})

test('学习引用读取期间切换项目，旧项目的引用不能在新项目打开文件', async t => {
  let root = '/first', firstRead = true
  const pending = Promise.withResolvers<any>(), started = Promise.withResolvers<void>()
  const { workbench } = await fixture(t, {
    fileOperation: async () => ({ path: root }),
    read: async (path: string) => {
      if (firstRead) { firstRead = false; started.resolve(); return pending.promise }
      return { path, text: 'old', version: 'v2' }
    },
  })
  const opening = workbench.reading.open({ file: 'main.ts', fromLine: 1, toLine: 1, quote: 'old' })
  await started.promise
  root = '/second'; workbench.detach(); await workbench.attach({}, {})
  pending.resolve({ path: 'main.ts', text: 'old', version: 'v1' })
  assert.equal(await opening, false)
  assert.equal(workbench.snapshot().file, null)
  assert.equal(workbench.reading.snapshot().error, '')
})

test('切换文件取消旧导航，忽略取消的慢读取也不能阻塞后一次打开', { timeout: 5000 }, async t => {
  const started = Promise.withResolvers<void>(), pending = Promise.withResolvers<any>(), opened = Promise.withResolvers<void>(), reads: string[] = []
  const { workbench } = await fixture(t, { read: async (path: string) => {
    reads.push(path)
    if (path === 'slow.ts') { started.resolve(); return pending.promise }
    opened.resolve(); return { path, text: 'new content', version: 'v2' }
  } })
  const first = workbench.visit({ file: 'slow.ts' }); await started.promise
  const skipped = workbench.visit({ file: 'skipped.ts' }), last = workbench.visit({ file: 'new.ts' })
  try {
    await Promise.race([opened.promise, new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('新导航仍被旧读取阻塞')), 1000); timer.unref() })])
    await last
    assert.equal(workbench.snapshot().file, 'new.ts')
    assert.equal(workbench.view().state.doc.toString(), 'new content')
    assert.deepEqual(reads, ['slow.ts', 'new.ts'])
  } finally { pending.resolve({ path: 'slow.ts', text: 'late content', version: 'v1' }); await Promise.all([first, skipped, last]) }
  assert.equal(workbench.snapshot().file, 'new.ts')
  assert.equal(workbench.documents.has('slow.ts'), false)
})

test('取消慢读取并回到当前文件后，加载状态恢复为该文件的保存状态', async t => {
  const started = Promise.withResolvers<void>(), pending = Promise.withResolvers<any>()
  const { workbench } = await fixture(t, { read: async (path: string) => {
    if (path === 'slow.ts') { started.resolve(); return pending.promise }
    return { path, text: 'original', version: 'v1' }
  } })
  await workbench.visit({ file: 'main.ts' }); workbench.keepTab('main.ts')
  const slow = workbench.visit({ file: 'slow.ts' }); await started.promise
  try {
    assert.equal(workbench.snapshot().status, 'loading')
    await workbench.visit({ file: 'main.ts' })
    assert.equal(workbench.snapshot().file, 'main.ts')
    assert.equal(workbench.snapshot().status, 'saved')
  } finally { pending.resolve({ path: 'slow.ts', text: 'late', version: 'v1' }); await slow }
})

test('连续预览不保留已替换的干净缓冲，刷新不再重读已关闭的纯文本预览', async t => {
  const reads: string[] = [], text = 'x'.repeat(65536)
  const { workbench, projects } = await fixture(t, { read: async (path: string) => { reads.push(path); return { path, text, version: 'v1' } } })
  for (let i = 0; i < 40; i++) await workbench.visit({ file: `preview-${i}.txt` })
  assert.equal(workbench.snapshot().tabs.length, 1)
  assert.equal(workbench.documents.size, 1)
  assert.equal(projects.get('/project').documents.size, 1)
  reads.length = 0; await workbench.refresh()
  assert.deepEqual(reads, ['preview-39.txt'])
  assert.equal(workbench.view().state.doc.length, text.length)
})

test('连续预览中点过提问但未输入，不留下隐藏对话或保留已离开的缓冲', async t => {
  const { workbench, projects } = await fixture(t)
  for (let i = 0; i < 40; i++) {
    await workbench.visit({ file: `preview-${i}.txt` })
    workbench.view().dispatch({ selection: { anchor: 0, head: 2 } })
    workbench.assistant.select()
  }
  await workbench.visit({ file: 'last.txt' })
  const project = projects.get('/project')
  assert.equal([...project.conversations.files.values()].flat().length, 0)
  assert.equal(project.conversations.files.size, 0)
  assert.equal(project.documents.size, 1)
  assert.equal(workbench.documents.size, 1)
  assert.equal(workbench.snapshot().assistant.conversations.length, 0)
})

test('替换预览保留其他会话正在使用的缓冲，最后一个预览退出时才释放', async t => {
  const { workbench, projects, api } = await fixture(t)
  const peer = (await loadController())(api, (key: string) => key, { projects })
  t.after(() => peer.dispose()); await peer.attach({}, {})
  await workbench.visit({ file: 'shared.txt' }); await peer.visit({ file: 'shared.txt' })
  const doc = peer.documents.get('shared.txt')
  await workbench.visit({ file: 'first.txt' })
  assert.equal(workbench.documents.has('shared.txt'), false)
  assert.equal(projects.get('/project').documents.get('shared.txt'), doc)
  assert.equal(peer.view().state.doc.toString(), 'old')
  await peer.visit({ file: 'second.txt' })
  assert.equal(projects.get('/project').documents.has('shared.txt'), false)
})

test('预览回收保留未保存、固定、普通标签、Markdown和快速对话，不影响已保存修改的撤销', async t => {
  let text = 'old', version = 'v1'
  const { workbench, projects } = await fixture(t, {
    read: async (path: string) => ({ path, text: path === 'saved.txt' ? text : 'old', version }),
    save: async (input: any) => { text = input.text; version = 'v2'; return { ...input, version } },
  })
  await workbench.visit({ file: 'ordinary.txt' }); workbench.keepTab('ordinary.txt')
  await workbench.visit({ file: 'dirty.txt' }); workbench.view().dispatch({ changes: { from: 3, insert: ' dirty' } })
  await workbench.pinFile('pinned.txt')
  await workbench.visit({ file: 'README.md', kind: 'markdown' })
  await workbench.visit({ file: 'conversation.txt' }); workbench.view().dispatch({ selection: { anchor: 0, head: 3 } })
  workbench.assistant.select(); workbench.assistant.draft('保留的问题')
  await workbench.visit({ file: 'saved.txt' }); workbench.view().dispatch({ changes: { from: 3, insert: ' changed' } }); await workbench.save()
  await workbench.closeFile('saved.txt'); await workbench.visit({ file: 'saved.txt' })
  await workbench.visit({ file: 'latest.txt' })
  const docs = projects.get('/project').documents
  for (const path of ['ordinary.txt', 'dirty.txt', 'pinned.txt', 'README.md', 'conversation.txt']) assert.ok(docs.has(path), path)
  assert.equal(workbench.documents.get('dirty.txt').text, 'old dirty')
  assert.equal(workbench.assistant.threads('conversation.txt')[0].draft, '保留的问题')
  assert.equal(docs.has('saved.txt'), false, '已保存的预览可以释放，撤销历史独立保留')
  await workbench.undo()
  assert.equal(workbench.snapshot().file, 'saved.txt')
  assert.equal(workbench.view().state.doc.toString(), 'old')
})

test('新预览读取失败不释放原预览，关闭其他视图后不保留无引用的干净缓冲', async t => {
  const { workbench, projects, api } = await fixture(t, { read: async (path: string) => {
    if (path === 'broken.txt') throw new Error('read failed')
    return { path, text: 'old', version: 'v1' }
  } })
  await workbench.visit({ file: 'original.txt' }); const original = workbench.documents.get('original.txt')
  await assert.rejects(workbench.visit({ file: 'broken.txt' }), /read failed/)
  assert.equal(workbench.documents.get('original.txt'), original)
  assert.equal(workbench.snapshot().file, 'original.txt')
  const peer = (await loadController())(api, (key: string) => key, { projects })
  t.after(() => peer.dispose()); await peer.attach({}, {}); await peer.visit({ file: 'original.txt' })
  await workbench.visit({ file: 'new.txt' }); peer.dispose()
  assert.equal(projects.get('/project').documents.has('original.txt'), false)
  assert.equal(workbench.view().state.doc.toString(), 'old')
})

test('连续历史导航保留每次按键的步数，回到释放的预览时重读文件并恢复光标', async t => {
  const { workbench } = await fixture(t, { read: async (path: string) => ({ path, text: 'first\nsecond\n', version: 'v1' }) })
  for (const file of ['first.txt', 'second.txt', 'third.txt']) await workbench.visit({ file, line: 1, character: 2 })
  assert.equal(workbench.documents.has('first.txt'), false)
  await Promise.all([workbench.move(-1), workbench.move(-1)])
  assert.equal(workbench.snapshot().file, 'first.txt'); assert.equal(workbench.snapshot().cursor.character, 2)
  await Promise.all([workbench.move(1), workbench.move(1)])
  assert.equal(workbench.snapshot().file, 'third.txt'); assert.equal(workbench.snapshot().cursor.character, 2)
})

for (const direction of [-1, 1]) test(`读取未完成时${direction < 0 ? '后退' : '前进'}立即取消旧读取并恢复目标位置`, { timeout: 5000 }, async t => {
  const started = Promise.withResolvers<void>(), pending = Promise.withResolvers<any>()
  const { workbench } = await fixture(t, { read: async (path: string) => {
    if (path === 'slow.txt') { started.resolve(); return pending.promise }
    return { path, text: 'first\nsecond\n', version: 'v1' }
  } })
  await workbench.visit({ file: 'first.txt', line: 1, character: 2 }); await workbench.visit({ file: 'second.txt' })
  if (direction > 0) await workbench.move(-1)
  const slow = workbench.visit({ file: 'slow.txt' }); await started.promise
  const moving = workbench.move(direction)
  try {
    await Promise.race([moving, new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('历史导航被旧读取阻塞')), 1000); timer.unref() })])
    assert.equal(workbench.snapshot().file, direction < 0 ? 'first.txt' : 'second.txt')
    if (direction < 0) assert.equal(workbench.view().state.selection.main.head, 8)
  } finally { pending.resolve({ path: 'slow.txt', text: 'late', version: 'v1' }); await Promise.all([slow, moving]) }
  assert.notEqual(workbench.snapshot().file, 'slow.txt')
})

test('切换项目后清空旧目录、文件剪贴板、面板及关闭提示，忽略旧目录晚到结果', async t => {
  let root = '/first'
  const pending = Promise.withResolvers<any>(), started = Promise.withResolvers<void>()
  const { workbench } = await fixture(t, {
    fileOperation: async () => ({ path: root }),
    list: async (path: string) => {
      if (path === 'late') { started.resolve(); return pending.promise }
      return { entries: path ? [{ name: 'old.txt', path: `${path}/old.txt`, type: 'file' }] : [], truncated: false }
    },
  })
  await workbench.list('old'); workbench.copyFile({ path: 'old/old.txt', type: 'file' }); workbench.menu({ path: 'old/old.txt', type: 'file' })
  workbench.panel({ kind: 'fileCompare', path: 'old/old.txt', state: { compareTarget: 'old/other.txt' } })
  const listing = workbench.list('late'); await started.promise
  root = '/second'; workbench.detach(); await workbench.attach({}, {})
  pending.resolve({ entries: [{ name: 'late.txt', path: 'late/late.txt', type: 'file' }], truncated: false }); await listing
  assert.deepEqual([...workbench.snapshot().directories.keys()].filter(Boolean), [])
  assert.equal(workbench.snapshot().fileClipboard, null)
  assert.equal(workbench.snapshot().fileMenu, null)
  assert.equal(workbench.snapshot().panel, null)
  assert.equal(workbench.snapshot().closingFile, null)
})

test('语言加载未完成时也可取消导航，新文件无需等待旧语言完成', { timeout: 5000 }, async t => {
  const pending = Promise.withResolvers<void>()
  const { workbench } = await fixture(t)
  preparations.set('slow-language.txt', pending.promise)
  t.after(() => preparations.clear())
  const first = workbench.visit({ file: 'slow-language.txt' })
  await new Promise(resolve => setImmediate(resolve))
  const next = workbench.visit({ file: 'current.txt' })
  try {
    await Promise.race([next, new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('新导航被语言加载阻塞')), 1000); timer.unref() })])
    assert.equal(workbench.snapshot().file, 'current.txt')
    assert.equal(workbench.documents.has('slow-language.txt'), false)
  } finally { preparations.clear(); pending.resolve(); await Promise.all([first, next]) }
  assert.equal(workbench.snapshot().file, 'current.txt')
})

test('语言加载失败不产生未打开的文件标签，之后仍可打开其他文件', async t => {
  const { workbench } = await fixture(t)
  const failed = Promise.reject(new Error('language unavailable')); void failed.catch(() => {})
  preparations.set('broken-language.txt', failed); t.after(() => preparations.clear())
  await workbench.visit({ file: 'original.txt' })
  await assert.rejects(workbench.visit({ file: 'broken-language.txt' }), /language unavailable/)
  assert.equal(workbench.documents.has('broken-language.txt'), false)
  await workbench.visit({ file: 'current.txt' }); workbench.keepTab('current.txt')
  assert.ok(workbench.snapshot().tabs.every((tab: any) => tab.path !== 'broken-language.txt'))
})

test('视图语言加载期间另一会话的新编辑不会被初始文档覆盖', async t => {
  const pending = Promise.withResolvers<void>(), { workbench, projects, api } = await fixture(t)
  const peer = (await loadController())(api, (key: string) => key, { projects })
  t.after(() => { preparations.clear(); peer.dispose() }); await peer.attach({}, {}); await peer.visit({ file: 'shared.txt' })
  preparations.set('shared.txt', pending.promise)
  const opening = workbench.visit({ file: 'shared.txt' }); await new Promise(resolve => setImmediate(resolve))
  peer.view().dispatch({ changes: { from: 3, insert: ' from peer' } })
  pending.resolve(); await opening
  assert.equal(workbench.view().state.doc.toString(), 'old from peer')
  assert.equal(peer.documents.get('shared.txt').text, 'old from peer')
  assert.equal(peer.documents.get('shared.txt').dirty, true)
  assert.equal(peer.view().state.doc.toString(), 'old from peer')
})

test('两个视图同时加载同一新文件时，取消其中一个不会回收另一视图的在途缓冲', async t => {
  const pending = Promise.withResolvers<void>(), { workbench, projects, api, written } = await fixture(t)
  const peer = (await loadController())(api, (key: string) => key, { projects })
  t.after(() => { preparations.clear(); peer.dispose() }); await peer.attach({}, {})
  preparations.set('shared.txt', pending.promise)
  const first = workbench.visit({ file: 'shared.txt' }), second = peer.visit({ file: 'shared.txt' })
  await new Promise(resolve => setImmediate(resolve))
  await workbench.visit({ file: 'other.txt' }); pending.resolve(); await Promise.all([first, second])
  assert.equal(peer.documents.get('shared.txt'), projects.get('/project').documents.get('shared.txt'))
  peer.view().dispatch({ changes: { from: 3, insert: ' edited' } }); await peer.save()
  assert.ok(written.some((input: any) => input.path === 'shared.txt' && input.text === 'old edited'))
})

test('反复访问当前文件后，定义查询各自使用有效信号，不复用已经取消的导航', async t => {
  const { workbench } = await fixture(t), signals: AbortSignal[] = []
  await workbench.visit({ file: 'current.txt' }); workbench.keepTab('current.txt')
  workbench.index.navigate = async (_file: string, _word: string, _offset: number, signal: AbortSignal) => {
    signal.throwIfAborted(); signals.push(signal); return { kind: 'usages', matches: [] }
  }
  for (let i = 0; i < 2; i++) {
    await workbench.visit({ file: 'current.txt' }); workbench.view().dispatch({ selection: { anchor: 1 } })
    await workbench.definition(); assert.equal(workbench.snapshot().panel.kind, 'usages'); assert.deepEqual(workbench.snapshot().panel.matches, []); workbench.panel(null)
  }
  assert.equal(signals.length, 2); assert.notEqual(signals[0], signals[1])
  assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false)
})

test('定义查询尚未完成时重新导航到当前文件，也取消旧查询且不打开迟到结果', async t => {
  const { workbench } = await fixture(t), started = Promise.withResolvers<void>(), pending = Promise.withResolvers<void>()
  await workbench.visit({ file: 'current.txt' }); workbench.keepTab('current.txt')
  workbench.index.navigate = async (_file: string, _word: string, _offset: number, signal: AbortSignal) => {
    started.resolve(); await pending.promise; signal.throwIfAborted(); return { kind: 'usages', matches: [] }
  }
  workbench.view().dispatch({ selection: { anchor: 1 } })
  const locating = workbench.definition(), completed = assert.doesNotReject(locating)
  try { await started.promise; await workbench.visit({ file: 'current.txt' }) }
  finally { pending.resolve(); await completed }
  assert.equal(workbench.snapshot().panel, null); assert.equal(workbench.snapshot().error, '')
  assert.equal(workbench.snapshot().file, 'current.txt')
})
