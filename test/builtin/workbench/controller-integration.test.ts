import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInThisContext, constants } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { WorkbenchFiles } from '../../../src/workbench/files.js'
import { FileHistory } from '../../../src/workbench/file-history.js'
import { GitRepository } from '../../../src/workbench/git/repository.js'
import { searchProject } from '../../../src/workbench/search.js'
import { validationRoot } from '../../validation-root.js'

let factory: Promise<any>
function loadController() {
  return factory ||= (async () => {
    const result = await build({ entryPoints: [new URL('../../../builtin/workbench/controller.js', import.meta.url).pathname],
      bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
      plugins: [{ name: 'headless-editor', setup(build) {
        build.onResolve({ filter: /editor\/view\.js$/ }, () => ({ path: 'editor', namespace: 'headless' }))
        build.onLoad({ filter: /.*/, namespace: 'headless' }, () => ({ contents: `
          import {EditorState} from '@codemirror/state';
          export function createEditor({changed,assistant,receiving}) {
            let view;
            return {get view(){return view},capture:()=>view.state,state:async (_file,source)=>{const{text,saved}=source();return saved||EditorState.create({doc:text})},
              show(state){view={state,focus(){},dispatch(spec){const tr=this.state.update(spec);this.state=tr.state;const update={startState:tr.startState,state:this.state,docChanged:tr.docChanged,selectionSet:tr.selection!==undefined,changes:tr.changes,transactions:[tr]};if(!receiving())assistant.update(update);changed(update)}}},
              dispose(){view=undefined},preferences(){},readonly(){}};
          }`, resolveDir: new URL('../../../', import.meta.url).pathname }))
      } }],
    })
    const module = { exports: {} as any }
    runInThisContext(`(function(require,module,exports){${result.outputFiles[0].text}\n})`, {
      filename: new URL('../../../index-fixture.cjs', import.meta.url).pathname,
      importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    })(createRequire(import.meta.url), module, module.exports)
    return module.exports.createWorkbench
  })()
}

async function fixture(t: any, initial: Record<string, string> = { 'main.ts': 'const value = 1;\nconst tail = 2;\n' }, executable = 'git') {
  await mkdir(validationRoot, { recursive: true })
  const directory = await mkdtemp(join(validationRoot, 'controller-integration-')), root = join(directory, 'project')
  await mkdir(root)
  for (const [path, text] of Object.entries(initial)) { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), text) }
  const ctx = new Context(); await ctx.plugin(LocalFileSystem, { cwd: root, diffBasisMaxBytes: 1024 })
  const files = new WorkbenchFiles(ctx.fs, async () => ({ cwd: root })), projects = new Map(), controllers: any[] = []
  const history = new FileHistory(ctx.fs, directory, async path => { const to = join(directory, 'trash-' + crypto.randomUUID()); await rename(path, to); return to })
  const signal = new AbortController().signal, settings = new Map<string, string>()
  let repository: GitRepository | undefined
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => settings.get(key), setItem: (key: string, value: string) => settings.set(key, value) } })
  const api = {
    read: (path: string, signal?: AbortSignal) => files.read('demo', path, signal),
    save: (input: any) => files.save('demo', input),
    list: (path: string, signal?: AbortSignal) => files.list('demo', path, signal),
    project: (signal?: AbortSignal) => files.project('demo', signal),
    searchProject: (query: unknown, abort = signal) => searchProject(ctx.fs, files, { cwd: root }, 'demo', query, abort),
    fileOperation: (input: any, abort = signal) => history.run({ cwd: root }, input, abort),
    git: (input: any, abort = signal) => (repository ||= new GitRepository(root, executable)).execute(input, undefined, abort),
  }
  t.after(async () => {
    for (const controller of controllers) controller.dispose()
    for (const project of projects.values()) project.dispose()
    await history.dispose(); await ctx.fiber.dispose()
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage')
    await rm(directory, { recursive: true, force: true })
  })
  const create = async (extraApi = {}, sharedProjects = projects) => {
    const controller = (await loadController())(Object.keys(extraApi).length ? { ...api, ...extraApi } : api, (key: string) => key, { projects: sharedProjects }); controllers.push(controller)
    await controller.attach({}, {})
    while (controller.snapshot().indexing) await new Promise(resolve => setImmediate(resolve))
    return controller
  }
  return { create, root, read: (path = 'main.ts') => readFile(join(root, path), 'utf8'), write: (path: string, text: string) => writeFile(join(root, path), text), files, api }
}
const edit = (workbench: any, from: number, to: number, insert: string) => workbench.view().dispatch({ changes: { from, to, insert } })
const text = (workbench: any) => workbench.view()?.state.doc.toString()

async function waitFor(check: () => boolean, description: string) {
  const deadline = Date.now() + 1500
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(check(), description)
}

for (const action of ['createFile', 'createDirectory', 'copy'] as const) test(`同项目另一视图同步${action}后的目录树与文件名搜索`, async t => {
  const { create, read } = await fixture(t, { 'folder/main.ts': 'original' }), first = await create(), second = await create()
  await second.list('folder'); await second.visit({ file: 'folder/main.ts' })
  edit(second, 0, 0, 'draft ')
  second.files.activate(true)
  await waitFor(() => !second.files.snapshot().searching, '原文件名扫描结束')
  const path = `folder/${action === 'createDirectory' ? 'new-folder' : 'new.ts'}`
  await first.fileOperation(action === 'copy' ? { action, path: 'folder/main.ts', destination: path } : { action, path })
  await waitFor(() => second.snapshot().directories.get('folder').entries.some((entry: any) => entry.path === path), '另一视图应显示新文件或目录')
  if (action !== 'createDirectory') await waitFor(() => second.files.snapshot().files.includes(path), '另一视图的文件名搜索应显示新文件')
  assert.equal(text(second), 'draft original'); assert.equal(second.documents.get('folder/main.ts').dirty, true)
  assert.equal(await read('folder/main.ts'), 'original')
})

test('同项目另一视图在回收目录的撤销和重做后恢复目录树及文件名搜索', async t => {
  const { create } = await fixture(t, { 'folder/main.ts': 'original' }), first = await create(), second = await create()
  await second.list('folder'); second.files.activate(true)
  await waitFor(() => !second.files.snapshot().searching, '原文件名扫描结束')
  await first.fileOperation({ action: 'trash', path: 'folder' })
  await waitFor(() => !second.snapshot().directories.get('').entries.some((entry: any) => entry.path === 'folder'), '另一视图应移除回收目录')
  await first.undo()
  await waitFor(() => second.snapshot().directories.get('').entries.some((entry: any) => entry.path === 'folder'), '另一视图应显示撤销恢复的目录')
  await waitFor(() => second.files.snapshot().files.includes('folder/main.ts'), '文件名搜索应显示恢复的文件')
  await first.undo('redo')
  await waitFor(() => !second.snapshot().directories.get('').entries.some((entry: any) => entry.path === 'folder'), '重做后另一视图应移除目录')
  await waitFor(() => !second.files.snapshot().files.includes('folder/main.ts') && !second.files.snapshot().searching, '文件名搜索不保留再次回收的文件')
})

test('另一视图的首次目录读取尚未结束时，新建文件使该读取失效，晚到清单不能覆盖新结果', async t => {
  const { create, api } = await fixture(t, { 'folder/main.ts': 'original' }), first = await create(), second = await create()
  const list = api.list, pending = Promise.withResolvers<void>(), started = Promise.withResolvers<void>()
  let delayed = false
  api.list = async (path: string, signal?: AbortSignal) => {
    const result = await list(path, signal)
    if (path === 'folder' && !delayed) { delayed = true; started.resolve(); await pending.promise }
    return result
  }
  const reading = second.list('folder')
  try {
    await started.promise
    await first.fileOperation({ action: 'createFile', path: 'folder/new.ts' })
  } finally { pending.resolve(); await reading }
  await waitFor(() => second.snapshot().directories.get('folder')?.entries.some((entry: any) => entry.path === 'folder/new.ts'), '较早开始的首次读取不应留下旧目录清单')
})

test('文件变动不让其他视图提前遍历尚未打开的目录，首次打开时仍读取新内容', async t => {
  const { create, api } = await fixture(t, { 'folder/main.ts': 'original' }), first = await create(), second = await create()
  const list = api.list, paths: string[] = []
  api.list = async (path: string, signal?: AbortSignal) => { paths.push(path); return list(path, signal) }
  await first.fileOperation({ action: 'createFile', path: 'folder/new.ts' })
  assert.deepEqual(paths, ['folder'])
  assert.equal(second.snapshot().directories.has('folder'), false)
  await second.list('folder')
  assert.equal(second.snapshot().directories.get('folder').entries.some((entry: any) => entry.path === 'folder/new.ts'), true)
})

test('项目搜索共用替换扫描范围，读取另一会话关闭标签后的未保存文本且不写磁盘', async t => {
  const { create, read } = await fixture(t, { 'main.ts': 'needle', 'notes.txt': 'needle', Dockerfile: 'needle', 'node_modules/hidden.txt': 'needle' })
  const first = await create(), second = await create(), query = { search: 'needle', replace: '', caseSensitive: true }
  const collect = async (locations: boolean) => { const events: any[] = []; for await (const event of first.searchProject({ ...query, locations }, new AbortController().signal)) events.push(event); return events }
  const located = await collect(true), preview = await collect(false)
  assert.deepEqual([...new Set(located.filter(event => event.kind === 'matches').map(event => event.path))].sort(), preview.filter(event => event.kind === 'file').map(event => event.path).sort())
  await second.visit({ file: 'notes.txt' }); edit(second, 0, 6, 'unsaved needle\n'); await second.closeFile('notes.txt', 'keep')
  await second.visit({ file: 'node_modules/hidden.txt' }); edit(second, 0, 6, 'unsaved needle\n')
  const results = await collect(true), note = results.find(event => event.path === 'notes.txt')
  assert.deepEqual(note.matches, [{ line: 0, character: 8, length: 6, lineText: 'unsaved needle' }])
  assert.equal(results.some(event => event.path === 'node_modules/hidden.txt'), false)
  assert.equal(await read('notes.txt'), 'needle'); assert.equal(await read('node_modules/hidden.txt'), 'needle')
})

test('未保存缓冲的分批搜索保留取消语义，磁盘上的旧匹配不会混入结果', async t => {
  const { create, read } = await fixture(t, { 'main.ts': 'disk needle' }), controller = await create()
  await controller.visit({ file: 'main.ts' }); edit(controller, 0, 11, 'draft\n'.repeat(650))
  const signal = new AbortController().signal, old: any[] = []
  for await (const event of controller.searchProject({ search: 'needle', replace: '', caseSensitive: true, locations: true }, signal)) old.push(event)
  assert.equal(old.filter(event => event.kind === 'matches').length, 0)
  const abort = new AbortController(), stream = controller.searchProject({ search: 'draft', replace: '', caseSensitive: true, locations: true }, abort.signal)
  const first = await stream.next(); assert.equal(first.value.matches.length, 256); abort.abort(); await assert.rejects(stream.next(), { name: 'AbortError' })
  assert.equal(await read(), 'disk needle')
})

test('全局搜索在指定目录内使用最新草稿和相同正则全词选项，替换预览拒绝范围外文件', async t => {
  const { create, read, files } = await fixture(t, { 'src/main.ts': 'disk 123', 'src/skip.ts': 'disk 123', 'outside.ts': 'disk 123' })
  const first = await create(), second = await create()
  await second.visit({ file: 'src/main.ts' }); edit(second, 0, 8, 'draft abc12 abc123tail')
  first.setSearchQuery({ search: 'abc\\d+', regexp: true, wholeWord: true, directory: 'src', exclude: 'skip.ts' })
  first.panel({ kind: 'search' }); const query = first.snapshot().searchQuery
  const rows = []
  for await (const event of first.searchProject({ ...query, locations: true }, new AbortController().signal)) if (event.kind === 'matches') rows.push(event)
  assert.equal(rows.length, 1); assert.equal(rows[0].path, 'src/main.ts')
  assert.deepEqual(rows[0].matches.map((item: { character: number; length: number }) => [item.character, item.length]), [[6, 5]])
  first.panel({ kind: 'projectReplace' }); assert.deepEqual(first.snapshot().searchQuery, query)
  const outside = await files.read('demo', 'outside.ts')
  await assert.rejects(first.previewReplacement({ path: outside.path, version: outside.version }, query, new AbortController().signal), /WORKBENCH_SEARCH_SCOPE/)
  assert.equal(await read('src/main.ts'), 'disk 123')
})

test('真实磁盘：正则替换预览与写入相同捕获组结果，撤销恢复原文', async t => {
  const { create, files, read } = await fixture(t, { 'main.ts': 'const count = 12;\r\nconst other = 34;\r\n' }), controller = await create()
  const source = await files.read('demo', 'main.ts'), query = { search: '(\\d+)', replace: 'Number($1)', caseSensitive: true, regexp: true }
  const match = { path: 'main.ts', version: source.version }
  const preview = await controller.previewReplacement(match, query, new AbortController().signal)
  assert.match(preview.after, /Number\(12\)/)
  await controller.replaceProject([match], query, () => {}, new AbortController().signal)
  assert.equal(await read(), preview.after.replace(/\n/g, '\r\n'))
  await controller.undo(); await controller.save()
  assert.equal(await read(), source.text)
})

test('切回已有干净标签读取最新磁盘内容，未保存标签保持草稿', async t => {
  const { create, write } = await fixture(t, { 'main.ts': 'original', 'other.ts': 'other' }), controller = await create()
  await controller.visit({ file: 'main.ts' }); controller.keepTab('main.ts')
  await controller.visit({ file: 'other.ts' }); await write('main.ts', 'external')
  await controller.visit({ file: 'main.ts' })
  assert.equal(text(controller), 'external'); assert.equal(controller.documents.get('main.ts').dirty, false)
  edit(controller, 0, 0, 'draft ')
  await controller.visit({ file: 'other.ts' }); await write('main.ts', 'new external')
  await controller.visit({ file: 'main.ts' })
  assert.equal(text(controller), 'draft external')
  await assert.rejects(controller.save(), /WORKBENCH_CONFLICT/)
})

test('同项目两个视图独立保留光标，非当前文件修改映射选区且重挂载不串用', async t => {
  const { create } = await fixture(t, { 'main.ts': '0123456789', 'other.ts': 'other' }), first = await create(), second = await create()
  for (const controller of [first, second]) { await controller.visit({ file: 'main.ts' }); controller.keepTab('main.ts') }
  first.view().dispatch({ selection: { anchor: 2 } }); second.view().dispatch({ selection: { anchor: 7 } })
  await first.visit({ file: 'other.ts' }); await second.visit({ file: 'other.ts' })
  await first.visit({ file: 'main.ts' }); assert.equal(first.view().state.selection.main.head, 2)
  edit(first, 0, 0, '++')
  await second.visit({ file: 'main.ts' }); assert.equal(second.view().state.selection.main.head, 9)
  assert.equal(text(second), '++0123456789')
  await second.closeFile('main.ts', 'keep'); await second.visit({ file: 'main.ts' })
  assert.equal(second.view().state.selection.main.head, 9)
  first.detach(); await first.attach({}, {})
  assert.equal(first.view().state.selection.main.head, 4)
  assert.equal(text(first), '++0123456789')
})

for (const action of ['refresh', 'open']) {
  test(`真实磁盘与两个控制器：${action}同步外部修改后所有会话显示已保存`, async t => {
    const { create, write } = await fixture(t), first = await create(), second = await create()
    await first.visit({ file: 'main.ts' })
    if (action === 'refresh') await second.visit({ file: 'main.ts' })
    const updated = '// externally changed\n' + text(first)
    await write('main.ts', updated)
    if (action === 'refresh') await first.refresh()
    else await second.visit({ file: 'main.ts' })
    for (const controller of [first, second]) {
      assert.equal(text(controller), updated)
      assert.equal(controller.documents.get('main.ts').dirty, false)
      assert.equal(controller.snapshot().tabs.find((tab: any) => tab.path === 'main.ts').dirty, false)
    }
    assert.equal((action === 'refresh' ? second : first).snapshot().status, 'saved')
  })
}

test('真实磁盘与两个控制器：索引读取晚到不能覆盖其他会话刚打开并编辑的共享缓冲', { timeout: 10000 }, async t => {
  const { create, api } = await fixture(t, { 'main.ts': 'export function original() {}' }), first = await create(), second = await create()
  const read = api.read, started = Promise.withResolvers<void>(), pending = Promise.withResolvers<void>()
  let delayed = false
  api.read = async (path: string, signal?: AbortSignal) => {
    const result = await read(path, signal)
    if (path === 'main.ts' && !delayed) { delayed = true; started.resolve(); await pending.promise }
    return result
  }
  const refreshing = second.refresh()
  try {
    await started.promise
    await first.visit({ file: 'main.ts' })
    edit(first, 0, text(first).length, 'export function updated() {}')
    while (!second.index.candidates('main.ts', 'updated').length) await new Promise(resolve => setImmediate(resolve))
  } finally { pending.resolve() }
  await refreshing
  assert.equal(second.index.candidates('main.ts', 'updated').length, 1)
  assert.equal(second.index.candidates('main.ts', 'original').length, 0)
})

test('真实磁盘：目录旧读取晚到不能覆盖新建文件后的目录列表', async t => {
  const { create, api } = await fixture(t, { 'folder/main.ts': 'original' }), controller = await create()
  const list = api.list
  let release!: () => void, started!: () => void, delayed = false
  const waiting = new Promise<void>(resolve => { release = resolve }), reading = new Promise<void>(resolve => { started = resolve })
  api.list = async (path: string, signal?: AbortSignal) => {
    const result = await list(path, signal)
    if (path === 'folder' && !delayed) { delayed = true; started(); await waiting }
    return result
  }
  const previous = controller.list('folder')
  try {
    await reading
    await controller.fileOperation({ action: 'createFile', path: 'folder/new.ts' })
    assert.equal(controller.snapshot().directories.get('folder').entries.some((entry: any) => entry.path === 'folder/new.ts'), true)
  } finally { release() }
  await previous
  assert.equal(controller.snapshot().directories.get('folder').entries.some((entry: any) => entry.path === 'folder/new.ts'), true)
})

for (const action of ['trash', 'detach']) {
  test(`真实磁盘：${action}后晚到的目录读取不能恢复已移除的目录状态`, async t => {
    const { create, api } = await fixture(t, { 'folder/main.ts': 'original' }), controller = await create()
    const list = api.list, started = Promise.withResolvers<void>(), pending = Promise.withResolvers<void>()
    api.list = async (path: string, signal?: AbortSignal) => {
      const result = await list(path, signal)
      if (path === 'folder') { started.resolve(); await pending.promise }
      return result
    }
    const reading = controller.list('folder')
    try {
      await started.promise
      if (action === 'trash') await controller.fileOperation({ action, path: 'folder' })
      else controller.detach()
    } finally { pending.resolve() }
    await reading
    assert.equal(controller.snapshot().directories.has('folder'), false)
  })
}

test('真实磁盘：目录读取失败或取消后仍能重试并显示新文件', async t => {
  const { create, api, write } = await fixture(t, { 'folder/main.ts': 'original' }), controller = await create()
  const list = api.list
  let failed = false
  api.list = async (path: string, signal?: AbortSignal) => {
    if (!failed) { failed = true; throw new Error('list unavailable') }
    return list(path, signal)
  }
  await assert.rejects(controller.list('folder'), /list unavailable/)
  const abort = new AbortController()
  api.list = async (path: string) => { const result = await list(path); abort.abort(); return result }
  await assert.rejects(controller.list('folder', abort.signal), { name: 'AbortError' })
  assert.equal(controller.snapshot().directories.has('folder'), false)
  api.list = list
  await write('folder/new.ts', 'new')
  await controller.list('folder')
  assert.equal(controller.snapshot().directories.get('folder').entries.some((entry: any) => entry.path === 'folder/new.ts'), true)
})

test('真实磁盘与两个控制器：删除目录后其他会话的目录树也移除该目录和缓存', async t => {
  const { create } = await fixture(t, { 'folder/main.ts': 'original', 'folder2/other.ts': 'retained' }), first = await create(), second = await create()
  await second.list('folder')
  await first.fileOperation({ action: 'trash', path: 'folder' })
  assert.equal(second.snapshot().directories.get('').entries.some((entry: any) => entry.path === 'folder'), false)
  assert.equal(second.snapshot().directories.has('folder'), false)
  assert.equal(second.snapshot().directories.get('').entries.some((entry: any) => entry.path === 'folder2'), true)
})

test('真实磁盘与两个控制器：删除通知后旧的父目录读取不能重新显示已删除目录', async t => {
  const { create, api } = await fixture(t, { 'folder/main.ts': 'original' }), first = await create(), second = await create()
  const list = api.list, started = Promise.withResolvers<void>(), pending = Promise.withResolvers<void>()
  let delayed = false
  api.list = async (path: string, signal?: AbortSignal) => {
    const result = await list(path, signal)
    if (path === '' && !delayed) { delayed = true; started.resolve(); await pending.promise }
    return result
  }
  const reading = second.list('')
  try { await started.promise; await first.fileOperation({ action: 'trash', path: 'folder' }) }
  finally { pending.resolve() }
  await reading
  assert.equal(second.snapshot().directories.get('').entries.some((entry: any) => entry.path === 'folder'), false)
})

test('真实磁盘与两个控制器：学习请求读取同项目另一会话关闭标签后保留的未保存内容', async t => {
  const { create, api } = await fixture(t), first = await create(), second = await create(), requests: any[] = []
  await first.visit({ file: 'main.ts' }); edit(first, 0, 0, '// shared draft\n')
  await first.closeFile('main.ts', 'keep')
  Object.assign(api, { async *reading(input: any) { requests.push(input); yield { kind: 'done' } } })
  second.reading.goal('理解项目'); await second.reading.plan()
  assert.equal(second.documents.has('main.ts'), false)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].buffers.find((buffer: any) => buffer.path === 'main.ts')?.text, '// shared draft\nconst value = 1;\nconst tail = 2;\n')
})

test('真实磁盘：替换部分失败后撤销保存失败仍保留草稿，可重试保存并重做', async t => {
  const { create, api, files, read } = await fixture(t, { 'first.ts': 'old', 'second.ts': 'old' }), first = await create(), second = await create()
  await first.visit({ file: 'first.ts' }); await second.visit({ file: 'first.ts' })
  const save = api.save
  let rejected = 'second.ts'
  api.save = async input => { if (input.path === rejected) throw new Error('write rejected'); return save(input) }
  const matches = await Promise.all(['first.ts', 'second.ts'].map(async path => ({ path, version: (await files.read('demo', path)).version })))
  const result = await first.replaceProject(matches, { search: 'old', replace: 'new', caseSensitive: true }, () => {}, new AbortController().signal)
  assert.deepEqual(result.changed, ['first.ts']); assert.deepEqual(result.failed.map((item: any) => item.path), ['second.ts'])
  assert.equal(await read('first.ts'), 'new'); assert.equal(await read('second.ts'), 'old')
  rejected = 'first.ts'
  await assert.rejects(first.undo(), /write rejected/)
  assert.equal(await read('first.ts'), 'new')
  for (const view of [first, second]) { assert.equal(text(view), 'old'); assert.equal(view.documents.get('first.ts').dirty, true) }
  rejected = ''
  await first.save(); assert.equal(await read('first.ts'), 'old')
  await first.undo('redo'); assert.equal(await read('first.ts'), 'new')
  for (const view of [first, second]) { assert.equal(text(view), 'new'); assert.equal(view.documents.get('first.ts').dirty, false) }
})

test('真实磁盘与两个控制器：超过旧内存预算仍完整索引，同步全部共享缓冲和已移除文件', async t => {
  const large = ' '.repeat(2 * 1024 * 1024), initial: Record<string, string> = {}
  for (let i = 0; i < 5; i++) initial[`large-${i}.ts`] = large
  Object.assign(initial, { 'z-shared.ts': 'before\n', 'z-removed.ts': 'removed\n' })
  const { create, write, root } = await fixture(t, initial), first = await create(), second = await create()
  await first.visit({ file: 'z-removed.ts' }); await first.visit({ file: 'z-shared.ts' })
  await write('z-shared.ts', 'after\n'); await rm(join(root, 'z-removed.ts')); await second.refresh()
  assert.equal(text(first), 'after\n')
  assert.equal(first.documents.has('z-removed.ts'), false)
  assert.equal(first.documents.get('z-shared.ts').dirty, false)
  assert.equal(second.snapshot().status, 'indexed', '已移除文件已同步清理，其余文件完整索引')
  assert.equal(second.index.files.size, 6, '超过16MiB仍覆盖全部剩余文件')
})

for (const action of ['branch', 'restoreHunk']) test(`本机Git${action}后补读快照被取消，两视图仍同步磁盘状态`, async t => {
  const { create, root, api, write, read } = await fixture(t), abort = new AbortController()
  let written = false
  const repository = new GitRepository(root, 'git', async (argv, _policy, signal) => {
    if (signal === abort.signal) {
      if (argv.includes(action === 'branch' ? 'branch' : 'apply')) written = true
      else if (written && argv.includes('rev-parse')) abort.abort()
    }
    return argv
  })
  api.git = (input: any, signal = new AbortController().signal) => repository.execute(input, { mode: 'workspace-write', workspaceRoot: root }, signal)
  const first = await create(), second = await create()
  await first.git({ action: 'init', branch: 'main' })
  let state = (await first.git({ action: 'status' })).state
  state = (await first.git({ action: 'stage', paths: ['main.ts'], version: state.version })).state
  await first.git({ action: 'commit', version: state.version, message: 'base', author: { name: 'Demo', email: 'demo@example.invalid' } })
  const before = await read()
  if (action === 'restoreHunk') {
    await write('main.ts', '// changed\n')
    await first.visit({ file: 'main.ts' }); await second.visit({ file: 'main.ts' })
  }
  const offFirst = first.changes.subscribe(() => {}), offSecond = second.changes.subscribe(() => {})
  t.after(() => { offFirst(); offSecond() })
  await first.changes.refresh(); await second.changes.refresh()
  const input = action === 'branch' ? { action, branch: 'written-before-cancel' } : { action, path: 'main.ts', side: 'total', hunk: 0 }
  await assert.rejects(first.git({ ...input, version: first.changes.snapshot().state.version }, abort.signal), { name: 'AbortError' })
  const actual = (await api.git({ action: 'status' })) as any
  assert.equal(action === 'branch' ? actual.state.branches.includes('written-before-cancel') : actual.state.changes.length === 0, true, '确认已写入磁盘，失败发生在补读阶段')
  await waitFor(() => [first, second].every(controller => controller.changes.snapshot().state.version === actual.state.version), '取消补读不应让已订阅视图继续显示旧状态')
  if (action === 'restoreHunk') {
    assert.equal(await read(), before)
    for (const controller of [first, second]) { assert.equal(text(controller), before); assert.equal(controller.documents.get('main.ts').dirty, false) }
  }
})

for (const backend of ['native', 'builtin']) {
  const prepare = async (t: any) => {
    const setup = await fixture(t, { 'main.ts': 'const branch = "main";\n', 'other.ts': '// other\n' }, backend === 'native' ? 'git' : '__missing_git__')
    const status = await setup.api.git({ action: 'status' })
    assert.equal(status.kind === 'state' && status.state.backend, backend)
    const run = async (input: any) => {
      const state = await setup.api.git({ action: 'status' })
      return setup.api.git({ ...input, ...(['status', 'init'].includes(input.action) ? {} : { version: (state as any).state.version }) })
    }
    const author = { name: '测试', email: 'test@example.invalid' }
    await run({ action: 'init', branch: 'main' }); await run({ action: 'stage', paths: ['main.ts', 'other.ts'] })
    await run({ action: 'commit', message: '基线', author }); await run({ action: 'branch', branch: 'alternate' })
    await run({ action: 'checkout', branch: 'alternate' }); await setup.write('main.ts', 'const branch = "alternate";\n')
    await run({ action: 'stage', paths: ['main.ts'] }); await run({ action: 'commit', message: '分支修改', author })
    await run({ action: 'checkout', branch: 'main' })
    return { ...setup, run }
  }
  for (const action of ['branch', 'restoreHunk']) test(`${backend}真实Git：${action}写入后响应失败，两视图均刷新实际状态`, async t => {
    const { create, api, write, read } = await prepare(t), execute = api.git, before = await read()
    api.git = async (input: any, signal?: AbortSignal) => {
      const result = await execute(input, signal)
      if (input.action === action) throw new Error('response unavailable')
      return result
    }
    const first = await create(), second = await create()
    if (action === 'restoreHunk') {
      await write('main.ts', '// changed\n')
      await first.visit({ file: 'main.ts' }); await second.visit({ file: 'main.ts' })
    }
    const offFirst = first.changes.subscribe(() => {}), offSecond = second.changes.subscribe(() => {})
    t.after(() => { offFirst(); offSecond() })
    await first.changes.refresh(); await second.changes.refresh()
    const input = action === 'branch' ? { action, branch: 'written-before-error' } : { action, path: 'main.ts', side: 'total', hunk: 0 }
    await assert.rejects(first.git({ ...input, version: first.changes.snapshot().state.version }), /response unavailable/)
    const actual = (await execute({ action: 'status' })) as any
    assert.equal(action === 'branch' ? actual.state.branches.includes('written-before-error') : actual.state.changes.length === 0, true)
    await waitFor(() => [first, second].every(controller => controller.changes.snapshot().state.version === actual.state.version), '响应失败不应掩盖已写入结果')
    if (action === 'restoreHunk') {
      assert.equal(await read(), before)
      for (const controller of [first, second]) { assert.equal(text(controller), before); assert.equal(controller.documents.get('main.ts').dirty, false) }
    }
  })
  for (const outcome of ['success', 'error', 'cancel']) test(`${backend}真实Git整仓写入：checkout ${outcome}后不依赖面板刷新共享文件`, async t => {
    const { create, api, read } = await prepare(t), execute = api.git, abort = new AbortController()
    const first = await create(), second = await create()
    await first.visit({ file: 'main.ts' }); await second.visit({ file: 'main.ts' })
    api.git = async (input: any, signal?: AbortSignal) => {
      const result = await execute(input, signal)
      if (input.action === 'checkout' && outcome === 'error') throw new Error('response unavailable')
      if (input.action === 'checkout' && outcome === 'cancel') { abort.abort(); signal?.throwIfAborted() }
      return result
    }
    const state = await second.git({ action: 'status' })
    const checkout = second.git({ action: 'checkout', branch: 'alternate', version: state.state.version }, abort.signal)
    if (outcome === 'success') await checkout
    else await assert.rejects(checkout, outcome === 'cancel' ? { name: 'AbortError' } : /response unavailable/)
    assert.equal(await read(), 'const branch = "alternate";\n', '确认Git已经写入磁盘')
    for (const controller of [first, second]) {
      assert.equal(text(controller), await read(), '操作收尾必须同步已打开文件，取消和响应错误不等于没有写入')
      assert.equal(controller.documents.get('main.ts').dirty, false)
    }
    edit(first, 0, 0, '// after checkout\n'); await first.save()
    assert.equal(await read(), '// after checkout\nconst branch = "alternate";\n')
  })
  for (const action of ['merge', 'abortMerge']) test(`${backend}真实Git整仓写入：${action}响应失败仍同步冲突文件`, async t => {
    const { create, api, run, write, read } = await prepare(t), execute = api.git
    const author = { name: '测试', email: 'test@example.invalid' }
    await write('main.ts', 'const branch = "current";\n'); await run({ action: 'stage', paths: ['main.ts'] })
    await run({ action: 'commit', message: '当前分支修改', author })
    if (action === 'abortMerge') await run({ action: 'merge', branch: 'alternate', author })
    const first = await create(), second = await create()
    await first.visit({ file: 'main.ts' }); await second.visit({ file: 'main.ts' })
    api.git = async (input: any, signal?: AbortSignal) => {
      const result = await execute(input, signal)
      if (input.action === action) throw new Error('response unavailable')
      return result
    }
    const state = await second.git({ action: 'status' })
    const input = action === 'merge' ? { action, branch: 'alternate', author } : { action }
    await assert.rejects(second.git({ ...input, version: state.state.version }), /response unavailable/)
    const disk = await read()
    if (action === 'merge') assert.match(disk, /<<<<<<<[\s\S]*current[\s\S]*=======[\s\S]*alternate[\s\S]*>>>>>>>/)
    else assert.equal(disk, 'const branch = "current";\n')
    for (const controller of [first, second]) { assert.equal(text(controller), disk); assert.equal(controller.documents.get('main.ts').dirty, false) }
  })
  test(`${backend}真实Git与两个控制器：另一会话关闭的未保存缓冲仍阻止切换分支`, async t => {
    const { create, read } = await prepare(t), first = await create(), second = await create()
    await first.visit({ file: 'main.ts' }); edit(first, 0, 0, '// unsaved\n'); await first.closeFile('main.ts', 'keep')
    await second.visit({ file: 'other.ts' })
    assert.equal(second.documents.has('main.ts'), false)
    const state = await second.git({ action: 'status' })
    await assert.rejects(second.git({ action: 'checkout', branch: 'alternate', version: state.state.version }), /WORKBENCH_GIT_UNSAVED/)
    assert.equal(await read(), 'const branch = "main";\n')
    await first.visit({ file: 'main.ts' }); assert.equal(text(first), '// unsaved\nconst branch = "main";\n')
  })
  test(`${backend}真实Git与两个控制器：切换分支后刷新另一会话的干净缓冲并可继续保存`, async t => {
    const { create, read } = await prepare(t), first = await create(), second = await create()
    await first.visit({ file: 'main.ts' }); await second.visit({ file: 'other.ts' })
    const state = await second.git({ action: 'status' })
    await second.git({ action: 'checkout', branch: 'alternate', version: state.state.version }); await second.refresh()
    assert.equal(text(first), 'const branch = "alternate";\n')
    assert.equal(first.documents.get('main.ts').dirty, false)
    edit(first, 0, 0, '// after checkout\n'); await first.save()
    assert.equal(await read(), '// after checkout\nconst branch = "alternate";\n')
  })
  for (const action of ['save', 'replace', 'stage', 'branch']) test(`${backend}真实Git：${action}后更新另一视图已打开的Git状态`, async t => {
    const { create, files, write } = await prepare(t), first = await create(), second = await create()
    if (action === 'stage') await write('main.ts', '// changed\n')
    const unsubscribe = second.changes.subscribe(() => {}); t.after(unsubscribe)
    await second.changes.refresh()
    const before = second.changes.snapshot().state
    if (action === 'save') {
      await first.visit({ file: 'main.ts' }); edit(first, 0, 0, '// saved\n'); await first.save()
    } else if (action === 'replace') {
      const loaded = await files.read('demo', 'main.ts')
      const result = await first.replaceProject([{ path: 'main.ts', version: loaded.version }], { search: 'main', replace: 'updated', caseSensitive: true }, () => {}, new AbortController().signal)
      assert.deepEqual(result.changed, ['main.ts'])
    } else {
      await first.git(action === 'stage' ? { action, paths: ['main.ts'], version: before.version } : { action, branch: 'new-branch', version: before.version })
    }
    await waitFor(() => second.changes.snapshot().state?.version !== before.version, '另一视图应在项目操作后刷新仓库快照')
    const after = second.changes.snapshot().state
    if (action === 'stage') {
      assert.equal(after.changes.find((file: any) => file.path === 'main.ts').stage, 2)
      const result = await first.git({ action: 'commit', version: after.version, message: '保存修改', author: { name: '测试', email: 'test@example.invalid' } })
      await waitFor(() => second.changes.snapshot().state?.head === result.state.head, '另一视图应显示新提交')
      assert.deepEqual(second.changes.snapshot().state.changes, [])
    } else if (action === 'branch') assert.ok(after.branches.includes('new-branch'))
    else assert.equal(after.changes.some((file: any) => file.path === 'main.ts'), true)
  })
}

test('真实磁盘与两个控制器：首次打开共享的干净缓冲时同步外部新内容', async t => {
  const { create, write } = await fixture(t), first = await create(), second = await create()
  await first.visit({ file: 'main.ts' })
  const updated = '// external update\n' + text(first)
  await write('main.ts', updated)
  await second.visit({ file: 'main.ts' })
  assert.equal(text(second), updated)
  assert.equal(text(first), updated)
  assert.equal(first.documents.get('main.ts').dirty, false)
  assert.equal(first.documents.get('main.ts'), second.documents.get('main.ts'))
})

test('真实Git整仓写入同步40个已打开文件时，每个目录只补读一次', async t => {
  const paths = Array.from({ length: 40 }, (_, i) => `folder/file-${i}.ts`)
  const { create, api, write } = await fixture(t, Object.fromEntries(paths.map(path => [path, 'export const value = 1;\n'])))
  const run = async (input: any) => {
    const state = await api.git({ action: 'status' })
    return api.git({ ...input, ...(['status', 'init'].includes(input.action) ? {} : { version: (state as any).state.version }) })
  }
  const author = { name: '测试', email: 'test@example.invalid' }
  await run({ action: 'init', branch: 'main' }); await run({ action: 'stage', paths }); await run({ action: 'commit', message: '基线', author })
  await run({ action: 'branch', branch: 'alternate' }); await run({ action: 'checkout', branch: 'alternate' })
  for (const path of paths) await write(path, 'export const value = 2;\n')
  await run({ action: 'stage', paths }); await run({ action: 'commit', message: '分支修改', author }); await run({ action: 'checkout', branch: 'main' })
  const controller = await create()
  for (const path of paths) { await controller.visit({ file: path }); controller.keepTab(path) }
  const list = api.list, listings: string[] = []
  api.list = (path: string, signal?: AbortSignal) => { listings.push(path); return list(path, signal) }
  const state = await controller.git({ action: 'status' })
  await controller.git({ action: 'checkout', branch: 'alternate', version: state.state.version })
  for (const path of paths) assert.equal(controller.documents.get(path).text, 'export const value = 2;\n')
  assert.deepEqual(listings, ['folder'], '共享文件同步不应按文件数反复读取同一目录')
})

test('真实磁盘与两个控制器：共享未保存缓冲在磁盘文件移除后仍能打开', async t => {
  const { create, root } = await fixture(t), first = await create(), second = await create()
  await first.visit({ file: 'main.ts' }); edit(first, 0, 0, '// retained\n')
  const retained = text(first)
  await rm(join(root, 'main.ts'))
  await second.visit({ file: 'main.ts' })
  assert.equal(text(second), retained)
  assert.equal(second.documents.get('main.ts').dirty, true)
  await assert.rejects(second.save(), /WORKBENCH_CONFLICT/)
  assert.equal(text(second), retained)
})

test('真实磁盘与两个控制器：首次读取晚到不能覆盖共享缓冲的新保存', async t => {
  const { create, api } = await fixture(t), first = await create(), second = await create()
  await first.visit({ file: 'main.ts' })
  const read = api.read
  let release!: () => void, started!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve }), reading = new Promise<void>(resolve => { started = resolve })
  api.read = async (path: string, signal?: AbortSignal) => { const result = await read(path, signal); started(); await waiting; return result }
  const visiting = second.visit({ file: 'main.ts' })
  try {
    await reading
    edit(first, 0, 0, '// saved meanwhile\n'); await first.save()
  } finally { release() }
  await visiting
  assert.equal(text(second), text(first))
  assert.match(text(second), /saved meanwhile/)
  assert.equal(second.documents.get('main.ts').dirty, false)
})

test('真实磁盘与两个控制器：跨会话编辑、非重叠撤销重做和保存保持同一内容', async t => {
  const { create, read } = await fixture(t), first = await create(), second = await create()
  await first.visit({ file: 'main.ts' }); await second.visit({ file: 'main.ts' })
  const original = text(first)
  edit(first, 0, 0, '// first\n'); edit(second, text(second).length, text(second).length, '// second\n')
  assert.equal(text(first), text(second))
  await first.undo(); assert.equal(text(first), original + '// second\n'); assert.equal(text(first), text(second))
  await second.undo(); assert.equal(text(first), original); assert.equal(text(first), text(second))
  await first.undo('redo'); await second.undo('redo')
  assert.equal(text(first), '// first\n' + original + '// second\n'); assert.equal(text(first), text(second))
  await second.save(); assert.equal(await read(), text(first))
  assert.equal(first.documents.get('main.ts').dirty, false); assert.equal(second.documents.get('main.ts').dirty, false)
})

test('真实磁盘：重叠修改拒绝撤销，切换另一文件仍可独立撤销', async t => {
  const { create, read } = await fixture(t, { 'main.ts': 'abcdef', 'other.ts': 'other' }), first = await create(), second = await create()
  await first.visit({ file: 'main.ts' }); await second.visit({ file: 'main.ts' })
  edit(first, 1, 3, '甲乙'); edit(second, 1, 2, '丙')
  const preserved = text(first)
  await assert.rejects(first.undo(), /WORKBENCH_UNDO_CONFLICT/)
  assert.equal(text(first), preserved); assert.equal(text(second), preserved); assert.equal(await read(), 'abcdef')
  await first.visit({ file: 'other.ts' }); edit(first, 0, 0, '// independent\n'); await first.undo()
  assert.equal(text(first), 'other'); assert.equal(first.documents.get('main.ts').text, preserved)
})

test('真实磁盘：撤销合并外部非重叠修改，冲突保存不覆盖外部文件', async t => {
  const { create, read, write } = await fixture(t), controller = await create()
  await controller.visit({ file: 'main.ts' }); const original = text(controller)
  edit(controller, 14, 15, '9'); await write('main.ts', original + '// outside\n')
  await assert.rejects(controller.save(), /WORKBENCH_CONFLICT/)
  assert.equal(await read(), original + '// outside\n'); assert.match(text(controller), /value = 9/)
  await controller.undo()
  assert.equal(text(controller), original + '// outside\n'); assert.equal(controller.documents.get('main.ts').dirty, false)
})

test('真实磁盘：全局替换保留换行风格，已保存修改可跨文件撤销重做', async t => {
  const { create, read, files } = await fixture(t, { 'main.ts': 'old one\r\nold two\r\n', 'other.py': 'old three\n' }), controller = await create()
  await controller.visit({ file: 'main.ts' })
  const matches = await Promise.all(['main.ts', 'other.py'].map(async path => ({ path, version: (await files.read('demo', path)).version })))
  const result = await controller.replaceProject(matches, { search: 'old', replace: 'new', caseSensitive: true }, () => {}, new AbortController().signal)
  assert.deepEqual(result.failed, []); assert.deepEqual(result.changed, ['main.ts', 'other.py'])
  assert.equal(await read(), 'new one\r\nnew two\r\n'); assert.equal(await read('other.py'), 'new three\n')
  await controller.undo(); assert.equal(await read(), 'old one\r\nold two\r\n')
  await controller.visit({ file: 'other.py' }); await controller.undo(); assert.equal(await read('other.py'), 'old three\n')
  await controller.undo('redo'); assert.equal(await read('other.py'), 'new three\n')
})

test('替换审阅只读取文件，完整差异与选定文件保存一致并保留换行', async t => {
  const { create, read, files } = await fixture(t, { 'main.ts': 'Old one\r\nold two\r\n', 'other.ts': 'old three\n' }), controller = await create()
  const match = { path: 'main.ts', version: (await files.read('demo', 'main.ts')).version }
  const query = { search: 'old', replace: 'new\nline', caseSensitive: false }, signal = new AbortController().signal
  const diff = await controller.previewReplacement(match, query, signal)
  assert.equal(diff.before, 'Old one\nold two\n'); assert.equal(diff.after, 'new\nline one\nnew\nline two\n')
  assert.equal(await read(), 'Old one\r\nold two\r\n'); assert.equal(controller.snapshot().file, null)
  const result = await controller.replaceProject([match], query, () => {}, signal)
  assert.deepEqual(result.changed, ['main.ts']); assert.deepEqual(result.failed, [])
  assert.equal((await read()).replaceAll('\r\n', '\n'), diff.after)
  assert.equal(await read('other.ts'), 'old three\n')
  await controller.undo(); assert.equal(await read(), 'Old one\r\nold two\r\n')
})

test('替换审阅拒绝扫描后的磁盘变化和未保存缓冲，旧预览不能写盘', async t => {
  const { create, read, write, files } = await fixture(t, { 'main.ts': 'old one\n' }), controller = await create()
  const match = { path: 'main.ts', version: (await files.read('demo', 'main.ts')).version }
  const query = { search: 'old', replace: '', caseSensitive: true }, signal = new AbortController().signal
  assert.equal((await controller.previewReplacement(match, query, signal)).after, ' one\n')
  await write('main.ts', 'old outside\n')
  await assert.rejects(controller.previewReplacement(match, query, signal), /WORKBENCH_CONFLICT/)
  const result = await controller.replaceProject([match], query, () => {}, signal)
  assert.equal(result.failed.length, 1); assert.equal(await read(), 'old outside\n')
  await controller.visit({ file: 'main.ts' }); edit(controller, 0, 0, '// draft\n')
  await assert.rejects(controller.previewReplacement({ ...match, version: (await files.read('demo', 'main.ts')).version }, query, signal), /WORKBENCH_CONFLICT/)
  assert.equal(text(controller), '// draft\nold outside\n'); assert.equal(await read(), 'old outside\n')
})

for (const newerPreview of [false, true]) test(`真实磁盘：停止替换后${newerPreview ? '晚到结果不改动新预览' : '原控制器记录已完成写入并保留剩余文件'}`, async t => {
  const { create, read, api } = await fixture(t, { 'main.ts': 'old one\n', 'other.ts': 'old two\n' })
  const started = Promise.withResolvers<void>(), pending = Promise.withResolvers<void>()
  const controller = await create({ save: async (input: Parameters<typeof api.save>[0]) => { started.resolve(); await pending.promise; return api.save(input) } })
  const rows = await Promise.all(['main.ts', 'other.ts'].map(async path => ({ path, version: (await api.read(path)).version })))
  const query = { search: 'old', replace: 'old new', caseSensitive: true }
  const preview = { id: 'original', query, rows, selected: rows.map(row => row.path), active: 'main.ts', scanned: 2, skipped: 0 }
  controller.panel({ kind: 'projectReplace', id: 'review', state: { replaceRead: preview.id, replacePreview: preview } })
  const abort = new AbortController(), applying = controller.replaceProject(rows, query, () => {}, abort.signal, preview.id)
  const stopped = assert.rejects(applying, { name: 'AbortError' })
  const next = { replaceRead: 'newer', replacePreview: { ...preview, id: 'newer', selected: ['other.ts'] }, replaceResult: null }
  try {
    await started.promise
    if (newerPreview) controller.panel({ kind: 'projectReplace', id: 'review', state: next })
    abort.abort(); pending.resolve(); await stopped
    assert.equal(await read(), 'old new one\n'); assert.equal(await read('other.ts'), 'old two\n')
    const state = controller.snapshot().panel.state
    if (newerPreview) assert.deepEqual(state, next)
    if (!newerPreview) {
      assert.deepEqual(state.replacePreview.rows.map((row: { path: string }) => row.path), ['other.ts'])
      assert.deepEqual(state.replacePreview.selected, ['other.ts']); assert.equal(state.replacePreview.active, null)
      assert.deepEqual(state.replaceResult, { changed: ['main.ts'], failed: [] })
    }
    await controller.undo(); assert.equal(await read(), 'old one\n')
  } finally { pending.resolve(); await stopped }
})

test('真实磁盘：新建、编辑、保存后按步骤撤销并重做，文件记录和文本记录一致', async t => {
  const { create, root, read } = await fixture(t), controller = await create()
  controller.panel({ kind: 'fileAction', id: 'new', action: 'createFile', parent: '', name: '中文 文件.ts' })
  await controller.submitFileAction(); edit(controller, 0, 0, 'const created = 1;\n'); await controller.save()
  await controller.undo(); assert.equal(text(controller), '')
  await controller.undo(); await assert.rejects(stat(join(root, '中文 文件.ts')), { code: 'ENOENT' })
  await controller.undo('redo'); assert.equal(await read('中文 文件.ts'), '')
  await controller.undo('redo'); assert.equal(text(controller), 'const created = 1;\n')
  await controller.save(); assert.equal(await read('中文 文件.ts'), 'const created = 1;\n')
})

test('真实磁盘与两个控制器：未保存文件不能回收，保存后回收和恢复同步清除旧视图', async t => {
  const { create, root, read } = await fixture(t), first = await create(), second = await create()
  await first.visit({ file: 'main.ts' }); await second.visit({ file: 'main.ts' })
  edit(second, 0, 0, '// shared\n')
  await assert.rejects(first.fileOperation({ action: 'trash', path: 'main.ts' }), /WORKBENCH_FILE_UNSAVED/)
  await second.save(); const saved = await read()
  await first.fileOperation({ action: 'trash', path: 'main.ts' })
  assert.equal(first.snapshot().file, null); assert.equal(second.snapshot().file, null)
  await assert.rejects(stat(join(root, 'main.ts')), { code: 'ENOENT' })
  await first.undo(); assert.equal(await read(), saved)
  await second.visit({ file: 'main.ts' }); assert.equal(text(second), saved)
  await first.undo('redo'); assert.equal(second.snapshot().file, null)
})

test('真实磁盘：关闭未保存标签不丢缓冲与历史，重开后仍可保存和撤销', async t => {
  const { create, read } = await fixture(t), controller = await create()
  await controller.visit({ file: 'main.ts' }); const original = text(controller)
  edit(controller, 0, 0, '// retained\n')
  await controller.closeFile('main.ts'); assert.equal(controller.snapshot().closingFile, 'main.ts')
  await controller.closeFile('main.ts', 'keep'); assert.equal(controller.snapshot().file, null)
  await controller.visit({ file: 'main.ts' }); assert.equal(text(controller), '// retained\n' + original)
  await controller.save(); assert.equal(await read(), text(controller))
  await controller.undo(); assert.equal(text(controller), original)
  await controller.save(); assert.equal(await read(), original)
})

test('批量关闭遇到草稿逐个确认，取消停止后续关闭，固定标签保留', async t => {
  const { create, read } = await fixture(t, { 'pin.ts': 'p', 'a.ts': 'a', 'b.ts': 'b', 'c.ts': 'c' }), controller = await create()
  await controller.settings({ ...controller.snapshot().preferences, previewTabs: false })
  await controller.pinFile('pin.ts')
  await controller.visit({ file: 'a.ts' }); edit(controller, 0, 0, 'draft ')
  await controller.visit({ file: 'b.ts' }); edit(controller, 0, 0, 'draft ')
  await controller.visit({ file: 'c.ts' })
  await controller.closeTabs('others', 'c.ts', 'file')
  assert.equal(controller.snapshot().closingFile, 'a.ts')
  await controller.closeFile('a.ts', 'keep')
  assert.equal(controller.snapshot().closingFile, 'b.ts')
  controller.cancelCloseFile()
  assert.equal(controller.snapshot().closingFile, null)
  assert.deepEqual(controller.snapshot().tabs.map(({ path }: { path: string }) => path), ['pin.ts', 'b.ts', 'c.ts'])
  assert.equal(await read('a.ts'), 'a')
  await controller.reopenTab()
  assert.equal(controller.snapshot().file, 'a.ts'); assert.equal(text(controller), 'draft a')
  assert.equal(controller.snapshot().tabs.find(({ path }: { path: string }) => path === 'a.ts').preview, false)
  await controller.undo(); assert.equal(text(controller), 'a')
})

test('批量保存并关闭失败时保留确认和后续标签，处理冲突前不继续', async t => {
  const { create, write, read } = await fixture(t, { 'a.ts': 'a', 'b.ts': 'b', 'c.ts': 'c' }), controller = await create()
  await controller.settings({ ...controller.snapshot().preferences, previewTabs: false })
  await controller.visit({ file: 'a.ts' })
  await controller.visit({ file: 'b.ts' }); edit(controller, 0, 0, 'draft ')
  await controller.visit({ file: 'c.ts' })
  await write('b.ts', 'external b')
  await controller.closeTabs('right', 'a.ts', 'file')
  await assert.rejects(controller.closeFile('b.ts', 'save'), /WORKBENCH_CONFLICT/)
  assert.equal(controller.snapshot().closingFile, 'b.ts')
  assert.deepEqual(controller.snapshot().tabs.map(({ path }: { path: string }) => path), ['a.ts', 'b.ts', 'c.ts'])
  await controller.closeFile('b.ts', 'keep')
  assert.deepEqual(controller.snapshot().tabs.map(({ path }: { path: string }) => path), ['a.ts'])
  assert.equal(await read('b.ts'), 'external b')
  await controller.reopenTab(); assert.equal(controller.snapshot().file, 'c.ts')
  await controller.reopenTab(); assert.equal(text(controller), 'draft b')
})

test('关闭历史不记录预览替换和标签搬移，保存项关闭后可恢复 Markdown 和光标', async t => {
  const { create } = await fixture(t, { 'a.ts': 'line 1\nline 2\n', 'b.ts': 'b', 'doc.md': '# title' }), controller = await create()
  await controller.visit({ file: 'a.ts' }); await controller.visit({ file: 'b.ts' })
  assert.equal(controller.snapshot().canReopenTab, false)
  await controller.closeFile('b.ts', 'move')
  assert.equal(controller.snapshot().canReopenTab, false)
  await controller.visit({ file: 'a.ts', line: 1, character: 2 }); controller.keepTab('a.ts')
  await controller.visit({ file: 'doc.md', kind: 'markdown' })
  await controller.closeTabs('saved')
  assert.equal(controller.snapshot().tabs.length, 0)
  await controller.reopenTab(); assert.equal(controller.snapshot().editorKind, 'markdown')
  await controller.reopenTab(); assert.equal(controller.snapshot().editorKind, 'file')
  await controller.reopenTab()
  assert.equal(controller.snapshot().file, 'a.ts')
  assert.equal(controller.snapshot().cursor.line, 1); assert.equal(controller.snapshot().cursor.character, 2)
})

test('关闭分栏后仍可从主栏恢复刚关闭的草稿', async t => {
  const { create } = await fixture(t), controller = await create(), pane = controller.createPane()
  try {
    await pane.attach({}, {}); await pane.visit({ file: 'main.ts' }); edit(pane, 0, 0, '// pane draft\n')
    await pane.closeFile('main.ts', 'keep')
  } finally { pane.dispose() }
  assert.equal(controller.snapshot().canReopenTab, true)
  await controller.reopenTab()
  assert.ok(text(controller).startsWith('// pane draft\n'))
  assert.equal(controller.snapshot().canReopenTab, false)
})

test('恢复关闭标签使用已跟随其他视图修改的光标，不跳回旧的行号', async t => {
  const { create } = await fixture(t), first = await create(), second = await create()
  await first.visit({ file: 'main.ts', line: 1, character: 3 })
  await first.closeFile('main.ts')
  await second.visit({ file: 'main.ts' }); edit(second, 0, 0, '// inserted\n')
  await first.reopenTab()
  assert.equal(first.snapshot().cursor.line, 2); assert.equal(first.snapshot().cursor.character, 3)
})

for (const closed of [false, true]) {
  test(`真实磁盘：全局替换${closed ? '已关闭' : '非当前'}文件时快速对话标记跟随原选区，撤销后还原`, async t => {
    const original = '// old\nconst selected = 1;\n'
    const { create, files } = await fixture(t, { 'main.ts': original, 'other.py': 'other\n' }), controller = await create()
    await controller.visit({ file: 'main.ts' })
    const from = original.indexOf('const'), to = original.length - 1
    controller.view().dispatch({ selection: { anchor: from, head: to } })
    controller.assistant.select(); controller.assistant.pin(); controller.assistant.close()
    const id = controller.snapshot().assistant.conversations[0].id
    if (closed) await controller.closeFile('main.ts')
    await controller.visit({ file: 'other.py' })
    const version = (await files.read('demo', 'main.ts')).version
    await controller.replaceProject([{ path: 'main.ts', version }], { search: 'old', replace: 'longer\ncomment', caseSensitive: true }, () => {}, new AbortController().signal)
    const row = controller.snapshot().assistant.conversations.find((row: any) => row.id === id)
    assert.equal(row.from, from + 'longer\ncomment'.length - 3)
    assert.equal(row.to, to + 'longer\ncomment'.length - 3)
    assert.equal(row.line, 2)
    assert.equal(row.stale, false)
    await controller.visit({ file: 'main.ts' }); controller.assistant.open(id)
    assert.equal(controller.snapshot().assistant.thread.original, original.slice(from, to))
    await controller.undo()
    const restored = controller.snapshot().assistant.conversations.find((row: any) => row.id === id)
    assert.equal(restored.from, from); assert.equal(restored.to, to); assert.equal(restored.line, 1)
  })
}

test('真实磁盘：外部非重叠修改后刷新，快速对话标记跟随原代码而不误报过期', async t => {
  const original = 'const selected = 1;\n'
  const { create, write } = await fixture(t, { 'main.ts': original }), controller = await create()
  await controller.visit({ file: 'main.ts' })
  controller.view().dispatch({ selection: { anchor: 0, head: original.length - 1 } })
  controller.assistant.select(); controller.assistant.pin(); controller.assistant.close()
  await write('main.ts', '// added outside\n' + original)
  await controller.refresh()
  const row = controller.snapshot().assistant.conversations[0]
  assert.equal(row.from, '// added outside\n'.length)
  assert.equal(row.to, '// added outside\n'.length + original.length - 1)
  assert.equal(row.line, 1); assert.equal(row.stale, false)
  await write('main.ts', '// added outside\nconst selected = 2;\n')
  await controller.refresh()
  assert.equal(controller.snapshot().assistant.conversations[0].stale, true)
})

test('真实磁盘与两个控制器：非当前文件全局替换只映射一次共享对话标记', async t => {
  const original = '// old\nconst selected = 1;\n'
  const { create, files } = await fixture(t, { 'main.ts': original, 'other.py': 'other\n' }), first = await create(), second = await create()
  await first.visit({ file: 'main.ts' }); await second.visit({ file: 'main.ts' })
  const from = original.indexOf('const'), to = original.length - 1
  first.view().dispatch({ selection: { anchor: from, head: to } })
  first.assistant.select(); first.assistant.pin(); first.assistant.close()
  await first.visit({ file: 'other.py' })
  await first.replaceProject([{ path: 'main.ts', version: (await files.read('demo', 'main.ts')).version }], { search: 'old', replace: 'longer', caseSensitive: true }, () => {}, new AbortController().signal)
  for (const controller of [first, second]) {
    const row = controller.snapshot().assistant.conversations[0]
    assert.equal(row.from, from + 3); assert.equal(row.to, to + 3); assert.equal(row.stale, false)
  }
})

test('真实磁盘：外部整体重写大文件后仍可刷新，原选区明确标为过期', async t => {
  const original = 'a'.repeat(250000), replacement = 'b'.repeat(250000)
  const { create, write } = await fixture(t, { 'large.txt': original }), controller = await create()
  await controller.visit({ file: 'large.txt' })
  controller.view().dispatch({ selection: { anchor: 10, head: 20 } })
  controller.assistant.select(); controller.assistant.pin(); controller.assistant.close()
  await write('large.txt', replacement); await controller.refresh()
  assert.equal(text(controller), replacement)
  assert.equal(controller.snapshot().assistant.conversations[0].stale, true)
  assert.equal(controller.documents.get('large.txt').dirty, false)
  assert.equal(controller.snapshot().error, '')
})

test('文件对比允许不同后缀并优先使用其他会话未保存的共享内容，不改变当前文件', async t => {
  const { create, read } = await fixture(t, { 'main.ts': 'line one\nline two\n', 'notes.txt': 'line one\nline three\n' })
  const first = await create(), second = await create()
  await first.visit({ file: 'main.ts' }); await second.visit({ file: 'notes.txt' })
  edit(second, 9, 19, 'unsaved')
  const difference = await first.compareFiles('main.ts', 'notes.txt', new AbortController().signal)
  assert.equal(difference.before, 'line one\nline two\n')
  assert.equal(difference.after, 'line one\nunsaved\n')
  assert.equal(difference.lines.some((line: any) => line.kind === 'added' && line.text === 'unsaved'), true)
  assert.equal(first.snapshot().file, 'main.ts')
  assert.equal(await read('notes.txt'), 'line one\nline three\n')
  await assert.rejects(first.compareFiles('main.ts', 'main.ts'), /WORKBENCH_COMPARE_SAME/)
  await assert.rejects(first.compareFiles('main.ts', '../outside'), /WORKBENCH_PATH/)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(first.compareFiles('main.ts', 'notes.txt', abort.signal), { name: 'AbortError' })
})

test('文件对比保留特殊文件名、BOM与换行，空文本可比，拒绝二进制和超限而不写文件', async t => {
  const content = '\ufeff中文\r\nlast line'
  const { create, read, root } = await fixture(t, { 'main.ts': content, ' 名称 ': content, 'empty': '', 'binary.dat': 'a\0b' })
  const controller = await create()
  const equal = await controller.compareFiles('main.ts', ' 名称 ')
  assert.equal(equal.before, content); assert.equal(equal.after, content)
  assert.equal(equal.lines.every((line: any) => line.kind === 'context'), true)
  const empty = await controller.compareFiles('empty', 'main.ts')
  assert.equal(empty.before, ''); assert.equal(empty.after, content)
  await assert.rejects(controller.compareFiles('main.ts', 'binary.dat'), /WORKBENCH_NOT_TEXT/)
  await assert.rejects(controller.compareFiles('main.ts', 'absent'), /WORKBENCH_NOT_FILE/)
  await fsWrite('invalid.dat', Buffer.from([0xff, 0xfe]))
  await assert.rejects(controller.compareFiles('main.ts', 'invalid.dat'), /WORKBENCH_NOT_TEXT/)
  await fsWrite('oversize.txt', Buffer.alloc(2 * 1024 * 1024 + 1, 'x'))
  await assert.rejects(controller.compareFiles('main.ts', 'oversize.txt'), /WORKBENCH_FILE_SIZE/)
  await fsWrite('too-many-lines', Buffer.from('row\n'.repeat(20001)))
  await assert.rejects(controller.compareFiles('empty', 'too-many-lines'), /WORKBENCH_GIT_DIFF_LIMIT/)
  assert.equal(await read('main.ts'), content); assert.equal(await read(' 名称 '), content)
  assert.equal(controller.snapshot().file, null)
  function fsWrite(path: string, value: Buffer) { return writeFile(join(root, path), value) }
})

for (const backend of ['native', 'builtin']) {
  test(`${backend}：还原已成功后读取或目录刷新失败，保留成功结果并单独报告同步错误`, async t => {
    const { create, write, read, api } = await fixture(t, { 'main.ts': 'base\n' }, backend === 'native' ? 'git' : '/missing-git')
    const controller = await create(), signal = new AbortController().signal
    const act = async (input: object) => controller.git({ ...input, version: (await controller.git({ action: 'status' }, signal)).state.version }, signal)
    await controller.git({ action: 'init', branch: 'main' }, signal)
    await act({ action: 'stage', paths: ['main.ts'] }); await act({ action: 'commit', message: 'base', author: { name: 'Demo', email: 'demo@example.invalid' } })
    await controller.visit({ file: 'main.ts' })
    for (const method of ['read', 'list'] as const) {
      await write('main.ts', 'changed\n'); await controller.refresh()
      const original = api[method]
      api[method] = async () => { throw new Error('sync failed') }
      try {
        const result = await act({ action: 'restoreHunk', path: 'main.ts', side: 'total', hunk: 0 })
        assert.equal(result.kind, 'state')
        assert.equal(result.state.changes.length, 0)
        assert.equal(await read(), 'base\n')
        assert.equal(controller.snapshot().error, 'gitSyncFailed')
      } finally { api[method] = original }
      await controller.refresh()
      assert.equal(text(controller), 'base\n')
      assert.equal(controller.snapshot().error, '')
    }
  })

  test(`${backend}：按段还原同步其他会话的干净缓冲，保护目标未保存编辑且不阻止无关文件草稿`, async t => {
    const { create, root, write, read } = await fixture(t, { 'main.ts': 'base\nkeep\nlast\n', 'other.txt': 'other\n' }, backend === 'native' ? 'git' : '/missing-git')
    const first = await create(), second = await create(), signal = new AbortController().signal
    const state = async () => (await first.git({ action: 'status' }, signal)).state
    const act = async (input: object) => first.git({ ...input, version: (await state()).version }, signal)
    await first.git({ action: 'init', branch: 'main' }, signal)
    await act({ action: 'stage', paths: ['main.ts', 'other.txt'] }); await act({ action: 'commit', message: 'base', author: { name: 'Demo', email: 'demo@example.invalid' } })
    await first.visit({ file: 'main.ts' }); await second.visit({ file: 'main.ts' })
    await write('main.ts', 'changed\nkeep\nchanged last\n'); await first.refresh()
    edit(second, 0, 0, '// unsaved\n')
    await assert.rejects(act({ action: 'restoreHunk', path: 'main.ts', side: 'total', hunk: 0 }), /WORKBENCH_GIT_UNSAVED/)
    assert.equal(await read(), 'changed\nkeep\nchanged last\n')
    await second.save()
    await second.visit({ file: 'other.txt' }); edit(second, 0, 0, '// unrelated\n')
    await act({ action: 'restoreHunk', path: 'main.ts', side: 'total', hunk: 0 })
    assert.equal(await read(), 'base\nkeep\nchanged last\n')
    assert.equal(text(first), 'base\nkeep\nchanged last\n')
    assert.equal(first.documents.get('main.ts').dirty, false)
    assert.equal(second.documents.get('main.ts').dirty, false)
    assert.equal(text(second), '// unrelated\nother\n')
    assert.equal(await read('other.txt'), 'other\n')
    await act({ action: 'stage', paths: ['main.ts'] })
    edit(first, 0, 0, '// retain local\n')
    await act({ action: 'restoreHunk', path: 'main.ts', side: 'staged', hunk: 0 })
    assert.equal(text(first), '// retain local\nbase\nkeep\nchanged last\n')
    assert.equal(await read(), 'base\nkeep\nchanged last\n')
    assert.equal((await stat(join(root, '.git/index'))).isFile(), true)
  })
}

test('语言环境按工作区隔离，同目录会话共享并在重新打开后保留', async t => {
  const { create, api } = await fixture(t)
  ;(api as any).environments = async (paths: unknown) => ({ environments: [], warnings: [], paths })
  const first = await create(), second = await create()
  await first.environmentPaths({ python: '.venv' })
  assert.deepEqual(second.snapshot().environmentPaths, { python: '.venv' })
  const other = await create({ fileOperation: async (input: any, signal: AbortSignal) => input.action === 'absolutePath' ? { path: '/other-project' } : api.fileOperation(input, signal) })
  assert.deepEqual(other.snapshot().environmentPaths, {})
  await other.environmentPaths({ python: '/other-runtime' })
  assert.deepEqual(first.snapshot().environmentPaths, { python: '.venv' })
  const reopened = await create({}, new Map())
  assert.deepEqual(reopened.snapshot().environmentPaths, { python: '.venv' })
  first.settings({ ...first.snapshot().preferences, palette: 'vscode' })
  assert.equal(Object.hasOwn(first.snapshot().preferences, 'environmentPaths'), false)
  assert.deepEqual((await first.environments()).paths, { python: '.venv' })
  assert.deepEqual((await other.environments()).paths, { python: '/other-runtime' })
  assert.deepEqual(reopened.snapshot().environmentPaths, { python: '.venv' })
})

test('切换工作区不继承语言路径，旧环境识别结果不得写入新工作区', async t => {
  const { create, api } = await fixture(t)
  let root = '/workspace-a', finish: (value: any) => void = () => {}, started: () => void = () => {}
  const pending = new Promise(resolve => { finish = resolve }), ready = new Promise<void>(resolve => { started = resolve })
  const controller = await create({
    fileOperation: async (input: any, signal: AbortSignal) => input.action === 'absolutePath' ? { path: root } : api.fileOperation(input, signal),
    environments: async () => { started(); return pending },
  })
  await controller.environmentPaths({ python: '/runtime-a' })
  const query = controller.environments(); const rejected = assert.rejects(query, { name: 'AbortError' }); await ready
  root = '/workspace-b'; await controller.attach({}, {})
  assert.deepEqual(controller.snapshot().environmentPaths, {})
  finish({ environments: [], warnings: [] }); await rejected
  await controller.environmentPaths({ python: '/runtime-b' })
  root = '/workspace-a'; await controller.attach({}, {})
  assert.deepEqual(controller.snapshot().environmentPaths, { python: '/runtime-a' })
})


test('保存冲突恢复：从另一视图应用合并结果，同步草稿、撤销和保存但不提前写盘', async t => {
  const { create, read, write } = await fixture(t, { 'main.ts': 'one\r\ntwo\r\n' })
  const first = await create(), second = await create()
  for (const view of [first, second]) await view.visit({ file: 'main.ts' })
  edit(first, 0, 3, 'ONE')
  await write('main.ts', 'one\r\nTWO\r\n')
  await assert.rejects(first.save(), /WORKBENCH_CONFLICT/)
  assert.equal(first.snapshot().saveConflict, 'main.ts')
  const entry = await first.readSaveConflict('main.ts')
  assert.equal(entry.merged, 'ONE\r\nTWO\r\n')
  await second.applySaveConflict(entry, entry.merged)
  assert.equal(first.snapshot().saveConflict, null)
  for (const view of [first, second]) assert.equal(text(view), 'ONE\nTWO\n')
  assert.equal(await read(), 'one\r\nTWO\r\n')
  await second.undo()
  assert.equal(text(first), 'ONE\ntwo\n')
  await second.undo('redo')
  assert.equal(text(first), 'ONE\nTWO\n')
  await second.save()
  assert.equal(await read(), 'ONE\r\nTWO\r\n')
  for (const view of [first, second]) assert.equal(view.documents.get('main.ts').dirty, false)
})

test('保存冲突恢复：比较期间再次编辑或改盘均拒绝旧结果，应用后再次改盘仍拒绝保存', async t => {
  const { create, read, write } = await fixture(t, { 'main.ts': 'one\ntwo\n' })
  const first = await create(), second = await create()
  for (const view of [first, second]) await view.visit({ file: 'main.ts' })
  edit(first, 0, 3, 'ONE'); await write('main.ts', 'one\nTWO\n')
  const entry = await first.readSaveConflict('main.ts')
  edit(second, 0, 0, '// more\n')
  await assert.rejects(first.applySaveConflict(entry, entry.merged), /WORKBENCH_DRAFT_CHANGED/)
  const latest = await first.readSaveConflict('main.ts')
  await write('main.ts', 'one\nTHREE\n')
  await assert.rejects(first.applySaveConflict(latest, latest.merged), /WORKBENCH_CONFLICT_STALE/)
  const next = await first.readSaveConflict('main.ts')
  await first.applySaveConflict(next, next.merged)
  await write('main.ts', 'one\nFOUR\n')
  await assert.rejects(first.save(), /WORKBENCH_CONFLICT/)
  assert.equal(await read(), 'one\nFOUR\n')
  assert.equal(text(second), '// more\nONE\nTHREE\n')
})

test('保存冲突恢复：自动保存失败后应用结果等待用户核对，不立即覆盖磁盘', async t => {
  const { create, read, write } = await fixture(t, { 'main.ts': 'one\ntwo\n' })
  const view = await create(); await view.visit({ file: 'main.ts' })
  view.settings({ ...view.snapshot().preferences, autoSave: 'immediate' })
  await write('main.ts', 'one\nTWO\n'); edit(view, 0, 3, 'ONE')
  await waitFor(() => view.snapshot().saveConflict === 'main.ts', '自动保存冲突提供恢复入口')
  const entry = await view.readSaveConflict('main.ts'); await view.applySaveConflict(entry, entry.merged)
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(await read(), 'one\nTWO\n')
  assert.equal(text(view), 'ONE\nTWO\n')
  await view.save(); assert.equal(await read(), 'ONE\nTWO\n')
})

test('工作状态恢复读取当前磁盘，保留固定项与位置，缺失文件不阻止其他标签', async t => {
  const { create, read, write } = await fixture(t, { 'main.ts': 'one\ntwo\n', 'other.ts': 'another' })
  const original = await create()
  await original.visit({ file: 'main.ts', line: 1 }); await original.pinFile('main.ts')
  await original.visit({ file: 'other.ts' }); original.keepTab('other.ts')
  const record = original.captureSession()
  edit(original, 0, 0, '// private draft\n')
  await write('main.ts', 'latest\ncontent\n')
  const restored = await create({}, new Map())
  const failures = await restored.restoreSession({ ...record, tabs: [...record.tabs, { path: 'missing.ts', kind: 'file', pinned: false, dirty: false }] }, new AbortController().signal)
  assert.equal(failures.length, 1); assert.equal(failures[0].path, 'missing.ts')
  assert.deepEqual(restored.snapshot().tabs.map((item: { path: string; pinned: boolean }) => [item.path, item.pinned]), [['main.ts', true], ['other.ts', false]])
  await restored.visit({ file: 'main.ts' })
  assert.equal(text(restored), 'latest\ncontent\n')
  assert.equal(restored.snapshot().cursor.line, 1)
  assert.equal(await read('other.ts'), 'another')
  assert.equal(restored.documents.get('other.ts').dirty, false)
})

test('恢复过程中主动打开文件会取消剩余恢复，不覆盖新导航或写盘', async t => {
  const { create, read, api } = await fixture(t, { 'main.ts': 'main', 'other.ts': 'other', 'chosen.ts': 'chosen' })
  let blocked = false, release = () => {}, requested = false
  const view = await create({ read: async (path: string, signal: AbortSignal) => {
    if (blocked && path === 'main.ts') { requested = true; await new Promise<void>(resolve => { release = resolve }) }
    return api.read(path, signal)
  } })
  blocked = true
  const record = { tabs: ['main.ts', 'other.ts'].map(path => ({ path, kind: 'file', pinned: false, dirty: false })), current: { file: 'other.ts', kind: 'file' }, recent: ['other.ts', 'main.ts'] }
  const restoring = assert.rejects(view.restoreSession(record, new AbortController().signal), { name: 'AbortError' })
  await waitFor(() => requested, '恢复已开始读取文件')
  const chosen = view.visit({ file: 'chosen.ts' }); release()
  await Promise.all([restoring, chosen])
  assert.equal(view.snapshot().file, 'chosen.ts')
  assert.equal(view.snapshot().tabs.some((tab: { path: string }) => tab.path === 'other.ts'), false)
  assert.equal(await read(), 'main')
})

test('保存全部覆盖共享项目的关闭标签，保存期间新输入继续标为未保存', async t => {
  const { create, read } = await fixture(t, { 'main.ts': 'one', 'other.ts': 'two' })
  const controller = await create(), peer = await create()
  await controller.visit({ file: 'main.ts' }); edit(controller, 0, 0, 'draft ')
  await controller.closeFile('main.ts', 'keep')
  await peer.visit({ file: 'other.ts' }); edit(peer, 0, 0, 'peer ')
  assert.equal(controller.snapshot().unsaved.length, 2)
  await controller.saveAll()
  assert.equal(await read('main.ts'), 'draft one'); assert.equal(await read('other.ts'), 'peer two')
  assert.equal(controller.snapshot().unsaved.length, 0); assert.equal(peer.snapshot().unsaved.length, 0)
})
