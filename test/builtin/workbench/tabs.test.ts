import test from 'node:test'
import assert from 'node:assert/strict'
import { createTabs } from '../../../builtin/workbench/tabs.js'
import { createBuffer } from '../../../builtin/workbench/buffer.js'

function fixture() {
  const documents = new Map(['a.ts', 'b.ts', 'c.ts'].map(path => [path, createBuffer({ path, text: path, version: 'v1' })]))
  const tabs = createTabs(documents), paths = () => tabs.list().map(item => item.path)
  return { documents, tabs, paths }
}

test('标签可向前和向后移动，保留缓冲对象、固定和未保存状态', () => {
  const { documents, tabs, paths } = fixture(), before = new Map(documents)
  documents.get('b.ts').text = 'edited'
  tabs.move('c.ts', 'a.ts')
  assert.deepEqual(paths(), ['c.ts', 'a.ts', 'b.ts'])
  tabs.move('a.ts', 'b.ts', true)
  assert.deepEqual(paths(), ['c.ts', 'b.ts', 'a.ts'])
  for (const [path, doc] of before) assert.equal(documents.get(path), doc)
  assert.equal(tabs.list().find(item => item.path === 'b.ts').dirty, true)
})

test('固定标签位于最前方，可在固定组内排序但不跨组改变固定状态', () => {
  const { documents, tabs, paths } = fixture()
  documents.get('b.ts').pinned = true; documents.get('c.ts').pinned = true
  assert.deepEqual(paths(), ['b.ts', 'c.ts', 'a.ts'])
  tabs.move('c.ts', 'b.ts')
  assert.deepEqual(paths(), ['c.ts', 'b.ts', 'a.ts'])
  tabs.move('a.ts', 'c.ts'); tabs.move('b.ts', 'a.ts', true)
  assert.deepEqual(paths(), ['c.ts', 'b.ts', 'a.ts'])
  assert.equal(documents.get('a.ts').pinned, undefined)
})

test('关闭全部标签仍保留未保存缓冲，重新打开时追加到标签栏', () => {
  const { documents, tabs, paths } = fixture(), doc = documents.get('b.ts')
  doc.text = 'unsaved'
  for (const path of paths()) tabs.close(path)
  assert.deepEqual(paths(), [])
  assert.equal(documents.size, 3)
  tabs.open('a.ts'); tabs.open('b.ts')
  assert.deepEqual(paths(), ['a.ts', 'b.ts'])
  assert.equal(documents.get('b.ts'), doc)
  assert.equal(doc.text, 'unsaved')
  assert.equal(tabs.list()[1].dirty, true)
})

test('排序不重新打开关闭的标签，也不丢失其缓冲', () => {
  const { documents, tabs, paths } = fixture(), hidden = documents.get('b.ts')
  tabs.close('b.ts'); tabs.move('c.ts', 'a.ts')
  assert.deepEqual(paths(), ['c.ts', 'a.ts'])
  assert.equal(documents.get('b.ts'), hidden)
  tabs.open('b.ts')
  assert.deepEqual(paths(), ['c.ts', 'a.ts', 'b.ts'])
})

test('自身、缺失和已关闭标签不会参与排序', () => {
  const { tabs, paths } = fixture()
  tabs.close('b.ts')
  for (const [source, target] of [['a.ts', 'a.ts'], ['missing.ts', 'a.ts'], ['a.ts', 'missing.ts'], ['b.ts', 'a.ts'], ['a.ts', 'b.ts']]) tabs.move(source, target)
  assert.deepEqual(paths(), ['a.ts', 'c.ts'])
  tabs.close('missing.ts')
  assert.deepEqual(paths(), ['a.ts', 'c.ts'])
})

test('删除后重建同名文件不继承旧标签的关闭状态，切项目可清除状态', () => {
  const { documents, tabs, paths } = fixture()
  tabs.close('b.ts'); documents.delete('b.ts'); tabs.forget(path => path === 'b.ts')
  documents.set('b.ts', createBuffer({ path: 'b.ts', text: 'new file', version: 'v2' }))
  assert.deepEqual(paths(), ['a.ts', 'c.ts', 'b.ts'])
  tabs.close('a.ts'); tabs.clear()
  assert.deepEqual(paths(), ['a.ts', 'c.ts', 'b.ts'])
})
