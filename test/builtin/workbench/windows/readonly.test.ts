import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInThisContext } from 'node:vm'
import { Compartment, EditorState } from '@codemirror/state'
import { createWindowHost } from '../../../../builtin/workbench/windows/host.js'
import { createMessageReader, encode } from '../../../../builtin/workbench/windows/protocol.js'
import { defaults } from '../../../../builtin/workbench/editor/preferences.js'

let factory: Promise<any>
function loadProxy() {
  return factory ||= (async () => {
    const result = await build({
      entryPoints: [new URL('../../../../builtin/workbench/windows/proxy.js', import.meta.url).pathname],
      bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
      plugins: [{ name: 'headless-editor', setup(build) {
        build.onResolve({ filter: /editor\/view\.js$/ }, () => ({ path: 'editor', namespace: 'headless' }))
        build.onLoad({ filter: /.*/, namespace: 'headless' }, () => ({ contents: `
          import {Compartment,EditorState} from '@codemirror/state';
          export function createEditor({changed}) {
            const access=new Compartment(); let view;
            return {get view(){return view},capture:()=>view.state,state:async (_file,source)=>EditorState.create({doc:source().text,extensions:access.of(EditorState.readOnly.of(false))}),
              show(state){view={state,dispatch(spec){const tr=this.state.update(spec);this.state=tr.state;changed({state:this.state,docChanged:tr.docChanged,selectionSet:tr.selection!==undefined,changes:tr.changes,transactions:[tr]})}}},
              readonly(value){view?.dispatch({effects:access.reconfigure(EditorState.readOnly.of(value))})},preferences(){},dispose(){view=undefined}};
          }`, resolveDir: new URL('../../../../', import.meta.url).pathname }))
      } }],
    })
    const module = { exports: {} as any }
    runInThisContext(`(function(require,module,exports){${result.outputFiles[0].text}\n})`)(createRequire(import.meta.url), module, module.exports)
    return module.exports.createWindowProxy
  })()
}
const settled = () => new Promise(resolve => setImmediate(resolve))

async function fixture(t: any, locked = false) {
  const access = new Compartment(), listeners = new Set<() => void>(), editorListeners = new Set<(event: any) => void>(), errors: Error[] = []
  let state = EditorState.create({ doc: 'original', extensions: access.of(EditorState.readOnly.of(locked)) })
  let snapshot = { file: 'main.ts', preferences: defaults(), panel: null, window: null as any }
  const empty = () => ({ snapshot: () => ({}), subscribe: () => () => {} })
  const view = { get state() { return state }, dispatch(spec: any) {
    const transaction = state.update(spec); state = transaction.state
    for (const listener of editorListeners) listener({ file: 'main.ts', update: { state, docChanged: transaction.docChanged, changes: transaction.changes } })
  } }
  const workbench = {
    snapshot: () => snapshot, subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
    view: () => view, index: { files: new Map() }, documents: new Map(),
    subscribeEditor(listener: (event: any) => void) { editorListeners.add(listener); return () => editorListeners.delete(listener) },
    changes: empty(), files: empty(), reading: empty(), layout: empty(), assistant: { threads: () => [] },
    windowState(value: any) { snapshot = { ...snapshot, window: value }; for (const listener of listeners) listener() },
    fail(message: Error) { errors.push(message) },
  }
  const read = createMessageReader()
  const proxy = (await loadProxy())((message: unknown) => host.accept(encode(message)), (key: string) => key)
  const host = createWindowHost(workbench, async (content: string) => {
    const message = read(content); if (message && message.kind !== 'init') await proxy.accept(message)
  }, (error: Error) => errors.push(error), {})
  t.after(() => { host.dispose(); proxy.dispose() })
  await host.accept(encode({ kind: 'hello' })); await settled(); await proxy.attach({}, {})
  return { proxy, errors, view, lock: async (value: boolean) => { view.dispatch({ effects: access.reconfigure(EditorState.readOnly.of(value)) }); await settled() } }
}

test('宿主已锁定时打开独立窗口，初始编辑器也只读，解锁后可继续编辑', async t => {
  const { proxy, lock, view, errors } = await fixture(t, true)
  assert.equal(proxy.view().state.readOnly, true)
  await lock(false)
  assert.equal(proxy.view().state.readOnly, false)
  proxy.view().dispatch({ changes: { from: 8, insert: ' changed' } }); await settled()
  assert.equal(view.state.doc.toString(), 'original changed')
  assert.deepEqual(errors, [])
})

test('独立窗口打开后跟随宿主锁定和解锁，选择代码不留下未确认事务', async t => {
  const { proxy, lock, view, errors } = await fixture(t)
  assert.equal(proxy.view().state.readOnly, false)
  await lock(true)
  assert.equal(proxy.view().state.readOnly, true)
  proxy.view().dispatch({ selection: { anchor: 1, head: 4 } }); await settled()
  assert.equal(view.state.selection.main.from, 1)
  assert.equal(view.state.selection.main.to, 4)
  await lock(false)
  assert.equal(proxy.view().state.readOnly, false)
  assert.deepEqual(errors, [])
})

test('在途编辑被宿主拒绝后，后续解锁不能解除冲突保护或丢弃本地文本', async t => {
  const { proxy, lock, view, errors } = await fixture(t)
  await lock(true)
  // 模拟锁定消息抵达前已经产生的事务；程序分发不受编辑器只读限制。
  proxy.view().dispatch({ changes: { from: 0, insert: 'unconfirmed ' } }); await settled()
  assert.equal(proxy.view().state.readOnly, true)
  await lock(false)
  assert.equal(proxy.view().state.readOnly, true)
  assert.equal(proxy.view().state.doc.toString(), 'unconfirmed original')
  assert.equal(view.state.doc.toString(), 'original')
  await assert.rejects(proxy.save(), /WORKBENCH_WINDOW_CONFLICT/)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].message, 'WORKBENCH_FILE_BUSY')
})
