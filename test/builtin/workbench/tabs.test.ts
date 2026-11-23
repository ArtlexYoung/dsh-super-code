import test from 'node:test'
import assert from 'node:assert/strict'
import { createTabs, createClosedTabs, tabDirectories, tabsToClose } from '../../../builtin/workbench/tabs.js'
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

test('预览只替换未修改的预览标签，保留缓冲、普通标签和固定标签', () => {
  const { documents, tabs, paths } = fixture()
  tabs.open('a.ts', true, true); tabs.open('b.ts', true, true)
  assert.deepEqual(paths(), ['b.ts', 'c.ts'])
  assert.equal(tabs.list().find(item => item.path === 'b.ts').preview, true)
  assert.equal(documents.size, 3)
  documents.get('b.ts').text = 'modified'
  tabs.open('c.ts', true, true)
  assert.deepEqual(paths(), ['b.ts', 'c.ts'])
  assert.equal(tabs.list().find(item => item.path === 'b.ts').preview, false)
  tabs.keep('c.ts'); tabs.open('a.ts', true)
  assert.equal(tabs.list().find(item => item.path === 'a.ts').preview, true)
  documents.get('a.ts').pinned = true
  assert.equal(tabs.list()[0].preview, false)
})

test('再次打开预览仍是预览，双击保留或移动标签后不再被替换', () => {
  const { tabs, paths } = fixture()
  tabs.open('a.ts', true, true); tabs.open('a.ts', true)
  assert.equal(tabs.list().find(item => item.path === 'a.ts').preview, true)
  tabs.keep('a.ts'); tabs.open('b.ts', true, true)
  assert.ok(paths().includes('a.ts'))
  tabs.move('b.ts', 'c.ts', true); tabs.open('c.ts', true, true)
  assert.ok(paths().includes('b.ts'))
  assert.equal(tabs.list().find(item => item.path === 'b.ts').preview, false)
})

test('Markdown渲染标签与源码分别关闭和排序，不生成额外文件缓冲', () => {
  const { tabs, documents } = fixture()
  tabs.open('a.ts', true, true); tabs.render('a.ts')
  const rendered = tabs.list().find(item => item.kind === 'markdown')
  assert.equal(tabs.list().find(item => item.path === 'a.ts' && item.kind === 'file').preview, false)
  tabs.move(rendered.id, 'b.ts', true)
  assert.equal(tabs.list()[2].kind, 'markdown')
  tabs.close('a.ts')
  assert.equal(tabs.list().filter(item => item.path === 'a.ts').length, 1)
  tabs.close('a.ts', 'markdown')
  assert.equal(tabs.list().filter(item => item.path === 'a.ts').length, 0)
  assert.equal(documents.size, 3)
  tabs.render('b.ts'); tabs.forget(path => path === 'b.ts'); documents.delete('b.ts')
  assert.ok(tabs.list().every(item => item.path !== 'b.ts'))
})

test('源码路径和标签ID指向同一标签时不改变排序', () => {
  const { tabs } = fixture()
  tabs.move('c.ts', 'a.ts')
  const before = tabs.list(), target = before.find(item => item.path === 'a.ts')
  tabs.move('a.ts', target.id, true)
  assert.deepEqual(tabs.list(), before)
})

test('批量关闭范围依照显示顺序，保留固定项并区分源码和渲染标签', () => {
  const { tabs, documents } = fixture()
  documents.get('a.ts').pinned = true
  documents.get('b.ts').text = 'draft'
  tabs.render('b.ts')
  assert.deepEqual(tabsToClose(tabs.list(), 'others', 'b.ts', 'file').map(item => [item.path, item.kind]), [['b.ts', 'markdown'], ['c.ts', 'file']])
  assert.deepEqual(tabsToClose(tabs.list(), 'right', 'b.ts', 'markdown').map(item => item.path), ['c.ts'])
  assert.deepEqual(tabsToClose(tabs.list(), 'saved').map(item => [item.path, item.kind]), [['b.ts', 'markdown'], ['c.ts', 'file']])
  assert.deepEqual(tabsToClose(tabs.list(), 'right', 'missing.ts', 'file'), [])
})

test('同名标签只显示最短区别目录，根目录、相同尾部和渲染标签均能区分', () => {
  const paths = ['index.ts', 'src/index.ts', 'test/index.ts', 'packages/a/src/index.ts', 'packages/b/src/index.ts', 'only.ts', 'src/index.ts']
  const directories = tabDirectories(paths.map(path => ({ path })))
  assert.deepEqual([...directories], [
    ['index.ts', '.'], ['src/index.ts', 'src'], ['test/index.ts', 'test'],
    ['packages/a/src/index.ts', 'a/src'], ['packages/b/src/index.ts', 'b/src'],
  ])
  assert.equal(tabDirectories([{ path: 'only.ts' }, { path: 'only.ts' }]).size, 0)
})

test('关闭历史限制最近20项，删除文件和切换项目清除记录，失败重开不会提前丢记录', () => {
  const closed = createClosedTabs()
  for (let i = 0; i < 25; i++) closed.record({ file: `${i}.ts`, kind: 'file' })
  const last = closed.peek()
  assert.equal(closed.peek(), last)
  closed.record({ file: '24.ts', kind: 'markdown' })
  closed.forget(path => path === '24.ts')
  const paths = []
  while (closed.peek()) { paths.push(closed.peek().file); closed.remove(closed.peek()) }
  assert.deepEqual(paths, Array.from({ length: 18 }, (_, index) => `${23 - index}.ts`))
  closed.record({ file: 'other.ts', kind: 'file' }); closed.clear()
  assert.equal(closed.peek(), undefined)
})
