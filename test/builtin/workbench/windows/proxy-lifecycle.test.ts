import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInThisContext } from 'node:vm'
import type { EditorState as State } from '@codemirror/state'
import { defaults } from '../../../../builtin/workbench/editor/preferences.js'

// 与打包后的 CJS 代理使用同一实例，CodeMirror 的事务和选区依赖类身份。
const { ChangeSet, EditorState } = createRequire(import.meta.url)('@codemirror/state') as typeof import('@codemirror/state')

async function fixture() {
  const pending: { resolve: (value: State) => void; source: () => { text: string; saved?: State } }[] = [], shown: State[] = [], sent: any[] = [], readonly: boolean[] = []
  const result = await build({
    entryPoints: [new URL('../../../../builtin/workbench/windows/proxy.js', import.meta.url).pathname],
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'delayed-editor', setup(build) {
      build.onResolve({ filter: /editor\/view\.js$/ }, () => ({ path: 'editor', namespace: 'delayed' }))
      build.onLoad({ filter: /.*/, namespace: 'delayed' }, () => ({ contents: `
        export function createEditor({changed}) {
          let view;
          return { get view() { return view }, capture:()=>view.state, state: (_file,source) => new Promise(resolve => fixture.pending.push({resolve,source})),
            show(state) { fixture.shown.push(state); view = {state, dispatch(spec) {const tr=this.state.update(spec);this.state=tr.state;changed({state:this.state,docChanged:tr.docChanged,selectionSet:tr.selection!==undefined,changes:tr.changes,transactions:[tr]})}} },
            readonly(value) {fixture.readonly.push(value)}, preferences() {}, dispose() { view = undefined } };
        }` }))
    } }],
  })
  const module = { exports: {} as any }
  runInThisContext(`(function(require,module,exports,fixture){${result.outputFiles[0].text}\n})`)(createRequire(import.meta.url), module, module.exports, { pending, shown, readonly })
  const proxy = module.exports.createWindowProxy(async (value: any) => { sent.push(value) }, (key: string) => key)
  await proxy.accept({ kind: 'state', patch: { snapshot: { file: 'first.ts', preferences: defaults() }, editor: { file: 'first.ts', text: 'first', version: 0 } } })
  return { proxy, pending, shown, sent, readonly }
}

test('外窗挂载期间关闭最后文件，不重新显示迟到的旧代码', async () => {
  const { proxy, pending, shown } = await fixture()
  const attaching = proxy.attach({}, {})
  try {
    await proxy.accept({ kind: 'state', patch: { snapshot: { file: null, preferences: defaults() }, editor: { file: null, text: '', version: 0 } } })
    pending[0].resolve(EditorState.create({ doc: 'old code' })); await attaching
    assert.equal(proxy.view(), undefined)
    assert.equal(shown.length, 0)
    assert.equal(proxy.snapshot().file, null)
  } finally { proxy.dispose() }
})

test('外窗语言加载期间离开不抛错或发送就绪，重挂载只显示新编辑器', async () => {
  const { proxy, pending, shown, sent } = await fixture()
  const first = proxy.attach({}, {})
  proxy.detach()
  const second = proxy.attach({}, {})
  try {
    pending[1].resolve(EditorState.create({ doc: 'new editor' })); await second
    pending[0].resolve(EditorState.create({ doc: 'old editor' })); await first
    assert.equal(proxy.view().state.doc.toString(), 'new editor')
    assert.deepEqual(shown.map(state => state.doc.toString()), ['new editor'])
    assert.deepEqual(sent, [{ kind: 'ready' }])
  } finally { proxy.dispose() }
})

test('外窗销毁后语言加载晚到不创建视图或发送就绪', async () => {
  const { proxy, pending, shown, sent } = await fixture()
  const attaching = proxy.attach({}, {})
  proxy.dispose()
  pending[0].resolve(EditorState.create({ doc: 'late code' })); await attaching
  assert.equal(proxy.view(), undefined)
  assert.equal(shown.length, 0)
  assert.deepEqual(sent, [])
})

test('外窗提交编辑被拒绝时立即提示并转为只读，保留尚未确认的本地文本', async () => {
  const { proxy, pending, sent, readonly } = await fixture()
  const attaching = proxy.attach({}, {})
  pending[0].resolve(EditorState.create({ doc: 'first' })); await attaching
  try {
    proxy.view().dispatch({ changes: { from: 0, to: 5, insert: 'local text retained' } })
    const edit = sent.find(message => message.method === 'edit')
    assert.ok(edit)
    await proxy.accept({ kind: 'error', id: edit.id, error: 'WORKBENCH_WINDOW_CONFLICT' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(readonly.at(-1), true)
    assert.equal(proxy.view().state.doc.toString(), 'local text retained')
    assert.ok(sent.some(message => message.method === 'fail' && message.args[0] === 'WORKBENCH_WINDOW_CONFLICT'))
    await assert.rejects(proxy.save(), /WORKBENCH_WINDOW_CONFLICT/)
  } finally { proxy.dispose() }
})

test('宿主导航先于外窗编辑确认时保留旧视图并报告冲突，不丢弃用户输入', async () => {
  const { proxy, pending } = await fixture()
  const attaching = proxy.attach({}, {})
  pending[0].resolve(EditorState.create({ doc: 'first' })); await attaching
  try {
    proxy.view().dispatch({ changes: { from: 0, insert: '未确认的输入' } })
    const switching = proxy.accept({ kind: 'state', patch: {
      snapshot: { file: 'other.ts', preferences: defaults() }, editor: { file: 'other.ts', text: 'other', version: 0 },
    } })
    pending[1]?.resolve(EditorState.create({ doc: 'other' }))
    await assert.rejects(switching, /WORKBENCH_WINDOW_CONFLICT/)
    assert.equal(proxy.view().state.doc.toString(), '未确认的输入first')
    assert.equal(pending.length, 1, '冲突不能启动新文件的异步替换')
  } finally { proxy.dispose() }
})

for (const locked of [true, false]) {
  test(`外窗语言加载期间收到${locked ? '锁定' : '解锁'}，显示后保留最后状态`, async () => {
    const { proxy, pending, readonly } = await fixture()
    const attaching = proxy.attach({}, {})
    try {
      await proxy.accept({ kind: 'edit', file: 'first.ts', version: 0, changes: null, ack: null, readOnly: locked })
      pending[0].resolve(EditorState.create({ doc: 'first' })); await attaching
      assert.equal(readonly.at(-1), locked)
    } finally { proxy.dispose() }
  })
}

for (const beforeAttach of [true, false]) test(`宿主在${beforeAttach ? '外窗挂载前' : '外窗语言加载期间'}的文本更新不会丢失，后续编辑使用最新版本`, async () => {
  const { proxy, pending, sent } = await fixture()
  const attaching = beforeAttach ? null : proxy.attach({}, {})
  await proxy.accept({ kind: 'edit', file: 'first.ts', version: 1, changes: ChangeSet.of({ from: 5, insert: ' from host' }, 5).toJSON(),
    selection: { ranges: [{ anchor: 10, head: 10 }], main: 0 }, ack: null, readOnly: false })
  const ready = attaching || proxy.attach({}, {})
  try {
    const value = pending[0].source()
    pending[0].resolve(EditorState.create({ doc: value.text, selection: value.saved?.selection })); await ready
    assert.equal(proxy.view().state.doc.toString(), 'first from host')
    assert.equal(proxy.view().state.selection.main.head, 10)
    proxy.view().dispatch({ changes: { from: 0, insert: 'local ' } })
    await new Promise(resolve => setImmediate(resolve))
    const message = sent.find(value => value.method === 'edit')
    assert.equal(message.args[0].version, 1)
    assert.equal(proxy.view().state.doc.toString(), 'local first from host')
  } finally { proxy.dispose() }
})

test('外窗重新挂载保留已确认文本，并接收离开期间宿主后续的修改', async () => {
  const { proxy, pending } = await fixture()
  const first = proxy.attach({}, {})
  pending[0].resolve(EditorState.create({ doc: 'first' })); await first
  await proxy.accept({ kind: 'edit', file: 'first.ts', version: 1, changes: ChangeSet.of({ from: 5, insert: ' one' }, 5).toJSON(), ack: null })
  proxy.detach()
  await proxy.accept({ kind: 'edit', file: 'first.ts', version: 2, changes: ChangeSet.of({ from: 9, insert: ' two' }, 9).toJSON(), ack: null })
  const second = proxy.attach({}, {})
  try {
    const value = pending[1].source()
    pending[1].resolve(EditorState.create({ doc: value.text, selection: value.saved?.selection })); await second
    assert.equal(proxy.view().state.doc.toString(), 'first one two')
  } finally { proxy.dispose() }
})
