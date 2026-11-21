import test from 'node:test'
import assert from 'node:assert/strict'
import { createFileSearch, matchFiles } from '../../../builtin/workbench/file-search.js'

function finished(search: ReturnType<typeof createFileSearch>): Promise<void> {
  if (!search.snapshot().searching) return Promise.resolve()
  return new Promise(resolve => {
    const release = search.subscribe(() => { if (!search.snapshot().searching) { release(); resolve() } })
  })
}
const file = (path: string) => ({ type: 'file', path, name: path.split('/').at(-1)! })
const directory = (path: string) => ({ type: 'directory', path, name: path.split('/').at(-1)! })
const listing = (entries: ReturnType<typeof file>[], truncated = false) => ({ entries, truncated })

test('关闭快速导航不会取消文件侧栏仍在使用的搜索，两处关闭后才取消', async () => {
  const pending = Promise.withResolvers<ReturnType<typeof listing>>()
  let signal: AbortSignal | undefined
  const search = createFileSearch(async (_path: string, abort: AbortSignal) => { signal = abort; return pending.promise })
  search.activate(true)
  search.activate(true, 'navigator')
  search.activate(false, 'navigator')
  assert.equal(signal?.aborted, false)
  search.activate(false)
  assert.equal(signal?.aborted, true)
  pending.resolve(listing([])); search.dispose()
})

test('文件名和路径搜索支持中文、空格、大小写及 Windows 分隔符，空查询不列结果', () => {
  const files = ['src/中文 目录/测试 File.ts', 'images/logo.svg', 'Makefile', 'a/[literal].dat']
  for (const query of ['测试 file', ' SRC\\中文 目录\\测试 ', '中文 目录']) assert.deepEqual(matchFiles(files, query), [files[0]])
  assert.deepEqual(matchFiles(files, 'LOGO.SVG'), [files[1]])
  assert.deepEqual(matchFiles(files, '[literal]'), [files[3]])
  assert.deepEqual(matchFiles(files, 'missing'), [])
  for (const query of ['', '   ', '\t\n']) assert.deepEqual(matchFiles(files, query), [])
  assert.deepEqual(files, ['src/中文 目录/测试 File.ts', 'images/logo.svg', 'Makefile', 'a/[literal].dat'])
})

test('完整文件名、文件名前缀和文件名包含优先于目录匹配，同级保留原序', () => {
  const files = ['account/config.ts', 'src/my-account.ts', 'src/accounting.ts', 'tests/account.ts', 'src/account.ts', 'account/README.md', 'src/account-extra.ts']
  assert.deepEqual(matchFiles(files, 'account.ts'), ['tests/account.ts', 'src/account.ts', 'src/my-account.ts'])
  assert.deepEqual(matchFiles(files, 'ACCOUNT'), ['src/accounting.ts', 'tests/account.ts', 'src/account.ts', 'src/account-extra.ts', 'src/my-account.ts', 'account/config.ts', 'account/README.md'])
  assert.deepEqual(matchFiles(files, 'account/config.ts'), ['account/config.ts'])
  assert.deepEqual(files, ['account/config.ts', 'src/my-account.ts', 'src/accounting.ts', 'tests/account.ts', 'src/account.ts', 'account/README.md', 'src/account-extra.ts'])
})

test('多个词可分别限定目录和文件名，仍按普通文字处理空格与正则符号', () => {
  const files = ['src/account/controller.ts', 'tests/account/controller.test.ts', 'src/中文 目录/测试 File.ts', 'src/[literal]/a+b.ts', 'src/ac/controller.ts']
  assert.deepEqual(matchFiles(files, 'controller src account'), [files[0]])
  assert.deepEqual(matchFiles(files, 'SRC\\ACCOUNT controller'), [files[0]])
  assert.deepEqual(matchFiles(files, 'file 中文\t测试'), [files[2]])
  assert.deepEqual(matchFiles(files, '[literal] a+b'), [files[3]])
  assert.deepEqual(matchFiles(files, 'account missing'), [])
})

test('十万匹配不截断，完整文件名在首位，重复查询不更改输入清单', () => {
  const files = [...Array.from({ length: 100000 }, (_, i) => `items/path-${i}/data.txt`), 'src/items.txt']
  const found = matchFiles(files, 'items')
  assert.equal(found.length, files.length)
  assert.equal(found[0], 'src/items.txt')
  assert.deepEqual(found.slice(1), files.slice(0, -1))
  assert.deepEqual(matchFiles(files, 'items'), found)
})

test('独立遍历未展开目录，只读名称，包含非源码、依赖目录与超过索引数量的文件', async () => {
  const calls: string[] = []
  const tree = new Map([
    ['', listing([directory('src'), directory('images'), directory('node_modules'), file('Makefile')])],
    ['src', listing([directory('src/中文 目录')])],
    ['src/中文 目录', listing([file('src/中文 目录/测试 File.ts')])],
    ['images', listing([file('images/logo.svg')])],
    ['node_modules', listing(Array.from({ length: 10 }, (_, i) => directory(`node_modules/group-${i}`)))],
    ...Array.from({ length: 10 }, (_, group): [string, ReturnType<typeof listing>] => [`node_modules/group-${group}`, listing(Array.from({ length: 1000 }, (_, i) => file(`node_modules/group-${group}/${i}.dat`)))]),
  ])
  const search = createFileSearch(async (path: string) => { calls.push(path); return tree.get(path)! })
  assert.deepEqual(calls, [])
  search.activate(true); await finished(search)
  assert.equal(search.snapshot().files.length, 10003)
  assert.ok(search.snapshot().files.includes('src/中文 目录/测试 File.ts'))
  assert.ok(search.snapshot().files.includes('images/logo.svg'))
  assert.equal(calls.length, tree.size)
  search.activate(false); search.activate(true); await finished(search)
  assert.equal(calls.length, tree.size, '完成的目录清单复用，查询变化不重复扫描')
  search.dispose()
})

test('目录扫描小批并发，不重复遍历相同路径，结果去重', async () => {
  let running = 0, peak = 0
  const calls: string[] = []
  const search = createFileSearch(async (path: string) => {
    calls.push(path); peak = Math.max(peak, ++running)
    await new Promise(resolve => setImmediate(resolve)); running--
    return listing(path ? [file(`${path}/a.txt`), file(`${path}/a.txt`)] : [...Array.from({ length: 12 }, (_, i) => directory(`dir-${i}`)), directory('dir-0')])
  })
  search.activate(true); await finished(search)
  assert.equal(peak, 4)
  assert.equal(calls.length, 13)
  assert.equal(search.snapshot().files.length, 12)
  search.dispose()
})

test('取消后忽略晚到结果，重新打开时继续未完成批次', async () => {
  const pending = Promise.withResolvers<ReturnType<typeof listing>>()
  let signal: AbortSignal | undefined, calls = 0
  const search = createFileSearch(async (_path: string, value: AbortSignal) => {
    signal = value
    return ++calls === 1 ? pending.promise : listing([file('current.txt')])
  })
  search.activate(true); search.activate(false)
  assert.ok(signal!.aborted)
  assert.equal(search.snapshot().searching, false)
  search.activate(true); await finished(search)
  pending.resolve(listing([file('stale.txt')]))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(search.snapshot().files, ['current.txt'])
  search.dispose()
})

test('刷新丢弃旧结果、取消旧请求，活动搜索重新扫描', async () => {
  let version = 'old'
  const pending = Promise.withResolvers<ReturnType<typeof listing>>()
  let signal: AbortSignal | undefined
  const search = createFileSearch(async (_path: string, value: AbortSignal) => {
    signal = value
    return version === 'pending' ? pending.promise : listing([file(`${version}.txt`)])
  })
  search.activate(true); await finished(search)
  assert.deepEqual(search.snapshot().files, ['old.txt'])
  version = 'pending'; search.reset()
  const previous = signal!
  version = 'new'; search.reset(); await finished(search)
  assert.equal(previous.aborted, true)
  pending.resolve(listing([file('stale.txt')]))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(search.snapshot().files, ['new.txt'])
  search.activate(false); search.reset()
  assert.deepEqual(search.snapshot().files, [])
  assert.equal(search.snapshot().searching, false)
  search.dispose()
})

test('暂停后保留已扫描目录，从未完成批次继续', async () => {
  const pending = Promise.withResolvers<ReturnType<typeof listing>>()
  const calls: string[] = []
  const search = createFileSearch(async (path: string) => {
    calls.push(path)
    return !path ? listing([file('root.txt'), directory('src')])
      : calls.length === 2 ? pending.promise : listing([file('src/current.txt')])
  })
  search.activate(true)
  await new Promise(resolve => setImmediate(resolve))
  search.activate(false); search.activate(true); await finished(search)
  pending.resolve(listing([file('src/stale.txt')]))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['', 'src', 'src'])
  assert.deepEqual(search.snapshot().files, ['root.txt', 'src/current.txt'])
  search.dispose()
})

test('部分目录失败不吞掉其他结果，保留错误与截断提示，重试恢复', async () => {
  const failure = new Error('Permission denied')
  let failing = true
  const search = createFileSearch(async (path: string) => {
    if (!path) return listing([directory('ok'), directory('denied')], failing)
    if (path === 'denied' && failing) throw failure
    return listing([file(`${path}/file.txt`)])
  })
  search.activate(true); await finished(search)
  assert.deepEqual(search.snapshot().files, ['ok/file.txt'])
  assert.equal(search.snapshot().error, failure)
  assert.equal(search.snapshot().truncated, true)
  failing = false; search.reset(); await finished(search)
  assert.deepEqual(search.snapshot().files, ['ok/file.txt', 'denied/file.txt'])
  assert.equal(search.snapshot().error, null)
  assert.equal(search.snapshot().truncated, false)
  search.dispose()
})

test('空目录正常完成，销毁取消请求且不再通知订阅者', async () => {
  const empty = createFileSearch(async () => listing([]))
  empty.activate(true); await finished(empty)
  assert.deepEqual(empty.snapshot().files, [])
  assert.equal(empty.snapshot().error, null)
  empty.dispose()
  const pending = Promise.withResolvers<ReturnType<typeof listing>>()
  let signal: AbortSignal | undefined, notifications = 0
  const search = createFileSearch(async (_path: string, value: AbortSignal) => { signal = value; return pending.promise })
  search.subscribe(() => notifications++)
  search.activate(true); search.dispose()
  pending.resolve(listing([file('late.txt')]))
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(signal!.aborted)
  assert.equal(notifications, 1)
  assert.deepEqual(search.snapshot().files, [])
})
