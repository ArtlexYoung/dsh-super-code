import test from 'node:test'
import assert from 'node:assert/strict'
import { locateMarkdownTarget, markdownTargets } from '../../../../builtin/workbench/editor/markdown-links.js'

test('Markdown 相对路径优先文档目录，显式相对路径和遍历不能转到根目录', () => {
  const guide = 'docs/nested/guide.md'
  assert.deepEqual(markdownTargets('验证记录/示例%20结果.json?view=1#L22-L25', guide, '/demo'), [
    { file: 'docs/nested/验证记录/示例 结果.json', line: 21 }, { file: '验证记录/示例 结果.json', line: 21 },
  ])
  assert.deepEqual(markdownTargets('../结果%23一.json', guide, '/demo'), [{ file: 'docs/结果#一.json' }])
  assert.deepEqual(markdownTargets('./nested/example', guide, '/demo'), [{ file: 'docs/nested/nested/example' }])
  assert.deepEqual(markdownTargets('../../..%2foutside.txt', guide, '/demo'), [])
  assert.deepEqual(markdownTargets('%E4%00broken', guide, '/demo'), [])
  assert.deepEqual(markdownTargets('/outside.txt', guide, '/demo'), [])
  assert.deepEqual(markdownTargets('/demo/验证记录/', guide, '/demo'), [{ file: '验证记录' }])
  assert.deepEqual(markdownTargets('C:/Workspace/记录/file.json#L2', guide, 'c:\\workspace'), [{ file: '记录/file.json', line: 1 }])
  assert.deepEqual(markdownTargets('../../', guide, '/demo'), [{ file: '' }])
  for (const href of ['https://example.invalid/doc', '//example.invalid/doc', 'mailto:user@example.invalid', 'javascript:void(0)', '#注释']) {
    assert.equal(markdownTargets(href, guide, '/demo'), null)
  }
})

test('Markdown 路径确认目录和缺失状态，保留读取失败，不重复处理取消的请求', async () => {
  const abort = new AbortController(), signal = abort.signal, calls: string[] = []
  const list = async (path: string) => {
    calls.push(path)
    if (path === 'docs/记录') throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    if (path === 'denied') throw new Error('permission denied')
    return { entries: [{ path: '记录/目录', type: 'directory' }] }
  }
  assert.deepEqual(await locateMarkdownTarget([{ file: 'docs/记录/目录' }, { file: '记录/目录' }], list, signal), { file: '记录/目录', type: 'directory' })
  assert.deepEqual(calls, ['docs/记录', '记录'])
  assert.deepEqual(await locateMarkdownTarget([{ file: '' }], list, signal), { file: '', type: 'directory' })
  await assert.rejects(locateMarkdownTarget([{ file: 'missing' }], list, signal), /WORKBENCH_LINK_NOT_FOUND/)
  await assert.rejects(locateMarkdownTarget([{ file: 'denied/file' }, { file: '记录/目录' }], list, signal), /permission denied/)
  abort.abort()
  await assert.rejects(locateMarkdownTarget([{ file: 'unreachable' }], list, signal), { name: 'AbortError' })
  assert.equal(calls.at(-1), 'denied')
})
