import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, ChangeSet, EditorSelection, Compartment } from '@codemirror/state'
import { createEditHost, createEditPeer } from '../../../../builtin/workbench/windows/edits.js'

function pair(text = 'abcdef') {
  let source = EditorState.create({ doc: text }), child = source
  const downstream: any[] = [], upstream: any[] = []
  const host = createEditHost(() => ({ state: source, dispatch(spec: any) {
    const transaction = source.update(spec); source = transaction.state
    host.changed({ file: 'demo.ts', update: { state: source, docChanged: transaction.docChanged, changes: transaction.changes } })
  } }), (message: any) => downstream.push(message))
  const peer = createEditPeer((value: any) => { upstream.push(value) }, (spec: any) => { child = child.update(spec).state })
  peer.initial(host.initial('demo.ts'))
  const local = (changes: any, selection?: any) => {
    const tr = child.update({ changes, ...(selection ? { selection } : {}) }); child = tr.state
    peer.local({ changes: tr.changes, state: child, docChanged: tr.docChanged, selectionSet: !!selection, transactions: [] })
  }
  const deliver = () => { while (downstream.length) peer.accept(downstream.shift()) }
  const submit = () => { const input = upstream.shift(); assert.ok(input); host.apply(input) }
  return { local, deliver, submit, peer, host, upstream, downstream,
    source: () => source.doc.toString(), child: () => child.doc.toString(),
    external(changes: any) {
      const tr = source.update({ changes }); source = tr.state
      host.changed({ file: 'demo.ts', update: { state: source, docChanged: tr.docChanged, changes: tr.changes } })
    },
  }
}

test('窗口连续输入只提交一项在途事务，确认后原控制器与窗口完全一致', async () => {
  const p = pair(); p.local({ from: 1, insert: '甲' }); p.local({ from: 2, insert: '乙' }); p.local({ from: 3, insert: '丙' })
  assert.equal(p.upstream.length, 1); p.submit(); p.deliver(); p.submit(); p.deliver(); await p.peer.flush()
  assert.equal(p.source(), 'a甲乙丙bcdef'); assert.equal(p.child(), p.source())
})
test('窗口输入与原控制器非重叠修改同时发生时正确映射', async () => {
  const p = pair(); p.local({ from: 1, insert: '甲' }); p.external({ from: 5, to: 6, insert: '尾' }); p.deliver(); p.submit(); p.deliver(); await p.peer.flush()
  assert.equal(p.source(), 'a甲bcde尾'); assert.equal(p.child(), p.source())
})
test('多项未确认输入遇到外部修改仍保持选区与内容一致', async () => {
  const p = pair(); p.local({ from: 1, insert: '甲' }); p.local({ from: 2, insert: '乙' }); p.external({ from: 0, insert: '头' })
  p.deliver(); p.submit(); p.deliver(); p.submit(); p.deliver(); await p.peer.flush()
  assert.equal(p.source(), '头a甲乙bcdef'); assert.equal(p.child(), p.source())
})
test('重叠修改拒绝覆盖，窗口本地内容和原控制器修改分别保留', () => {
  const p = pair(); p.local({ from: 1, to: 3, insert: '甲' }); p.external({ from: 1, to: 2, insert: '乙' })
  assert.throws(p.submit, /WORKBENCH_UNDO_CONFLICT/)
  assert.equal(p.source(), 'a乙cdef'); assert.equal(p.child(), 'a甲def')
})
test('非法版本、文件与事务不能修改原控制器', () => {
  const p = pair(); const valid = { id: 1, file: 'demo.ts', version: 0, changes: ChangeSet.empty(6).toJSON(), selection: EditorSelection.single(0).toJSON() }
  for (const patch of [{ version: -1 }, { version: 1 }, { version: NaN }, { file: '../other' }, { changes: [] }]) assert.throws(() => p.host.apply({ ...valid, ...patch }))
  assert.equal(p.source(), 'abcdef')
})
test('纯选区事务同样确认，不留下等待中的编辑或多余文本', async () => {
  const p = pair(); p.local([], { anchor: 1, head: 4 }); p.submit(); p.deliver(); await p.peer.flush(); assert.equal(p.child(), 'abcdef')
})

test('宿主在Git或文件操作期间只读时拒绝外窗文本修改，仍允许选择并在解锁后继续编辑', () => {
  const access = new Compartment()
  let state = EditorState.create({ doc: 'original', extensions: access.of(EditorState.readOnly.of(true)) })
  const host = createEditHost(() => ({ state, dispatch(spec: any) { state = state.update(spec).state } }), () => {})
  host.initial('demo.ts')
  const input = { id: 1, file: 'demo.ts', version: 0, changes: ChangeSet.of({ from: 8, insert: ' changed' }, 8).toJSON(), selection: EditorSelection.single(16).toJSON() }
  assert.throws(() => host.apply(input), /WORKBENCH_FILE_BUSY/)
  assert.equal(state.doc.toString(), 'original')
  assert.doesNotThrow(() => host.apply({ ...input, changes: ChangeSet.empty(8).toJSON(), selection: EditorSelection.single(3).toJSON() }))
  assert.equal(state.selection.main.head, 3)
  state = state.update({ effects: access.reconfigure(EditorState.readOnly.of(false)) }).state
  assert.doesNotThrow(() => host.apply(input))
  assert.equal(state.doc.toString(), 'original changed')
})

test('宿主切换文件时不能抹掉尚未确认的外窗事务，原文本仍可恢复', async () => {
  const p = pair(); p.local({ from: 1, insert: '未确认' })
  assert.throws(() => p.peer.initial({ file: 'other.ts', version: 0, text: 'other' }), /WORKBENCH_WINDOW_CONFLICT/)
  assert.equal(p.child(), 'a未确认bcdef')
  p.submit(); p.deliver(); await p.peer.flush()
  assert.equal(p.source(), 'a未确认bcdef')
  assert.doesNotThrow(() => p.peer.initial({ file: 'other.ts', version: 0, text: 'other' }))
})

test('固定种子的不同收发时序下连续输入与非重叠宿主修改均收敛，不丢字符', async () => {
  let seed = 20261116
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000 }
  for (let sample = 0; sample < 120; sample++) {
    const p = pair('正文🧪\nend'), local: string[] = [], remote: string[] = []
    for (let step = 0; step < 40; step++) {
      const choice = random()
      if (choice < 0.4) {
        const value = `[L${local.length}]`; local.push(value)
        p.local({ from: p.child().length, insert: value })
      } else if (choice < 0.7) {
        const value = `[R${remote.length}]`; remote.unshift(value)
        p.external({ from: 0, insert: value })
      } else if (choice < 0.85 && p.upstream.length) p.submit()
      else p.deliver()
    }
    while (p.upstream.length || p.downstream.length) { if (p.upstream.length) p.submit(); p.deliver() }
    await p.peer.flush()
    const expected = remote.join('') + '正文🧪\nend' + local.join('')
    assert.equal(p.child(), expected, `外窗样本 ${sample}`)
    assert.equal(p.source(), expected, `宿主样本 ${sample}`)
  }
})
