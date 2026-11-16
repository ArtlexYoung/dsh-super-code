import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

test('会话图保留父子与无关拓扑，返回摘要不共享输入顶层对象', () => {
  let build: (state: object) => any
  runInNewContext(readFileSync(new URL('../../dist/client.js', import.meta.url), 'utf8'), {
    URL,
    __ModuleLoader__: { load: ({ factory }: any) => {
      build = factory((id: string) => id === 'react' ? { forwardRef: () => 'button' } : {}).buildAgentView
    } },
  })
  for (const overlay of [false, true]) {
    const root = { id: 'root', title: '根会话' }
    const child = { id: 'child', title: '子会话', parentId: 'root' }
    const sibling = { id: 'sibling', title: '兄弟会话', parentId: 'root' }
    const byId = { root, child, sibling, other: { id: 'other' }, unrelated: { id: 'unrelated', parentId: 'other' } }
    const state = { current: 'child', byId, subagentsByParent: overlay ? {
      root: { entries: [{ id: 'child', label: '目录标题', kind: 'child', mode: 'continuable' }] },
    } : {} }
    const original = structuredClone(state)
    const view = build!(state)
    assert.equal(view.root, 'root')
    assert.deepEqual([...view.nodes.keys()].sort(), ['child', 'root', 'sibling'])
    assert.deepEqual(Array.from(view.children.get('other')), ['unrelated'])
    for (const [id, node] of view.nodes) {
      assert.notEqual(node, byId[id as keyof typeof byId])
      node.title = '显示侧修改'
    }
    assert.deepEqual(state, original)
    child.title = '当前新摘要'
    const next = build!(state)
    assert.equal(next.nodes.get('child').title, overlay ? '目录标题' : '当前新摘要')
    assert.notEqual(next.nodes.get('child'), view.nodes.get('child'))
  }
})
