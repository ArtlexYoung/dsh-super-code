import test from 'node:test'
import assert from 'node:assert/strict'
import { createReading } from '../../../../builtin/workbench/reading/controller.js'

const source = { id: 'S1', file: 'main.ts', fromLine: 1, toLine: 1, text: 'const value = 1;', version: 'v1' }
const reference = { file: source.file, fromLine: 1, toLine: 1, quote: source.text }
const plan = { title: '入口', summary: '流程', steps: [{ title: '值', reason: '理解值', refs: [reference] }] }
function fixture(stream?: (input: any, signal: AbortSignal) => AsyncGenerator<any>) {
  const documents = new Map([['main.ts', { text: source.text, original: source.text, version: 'v1' }]])
  const requests: any[] = [], visited: any[] = []
  const reading = createReading({ documents, currentFile: () => 'main.ts', t: (key: string) => key, locale: () => 'zh', visit: async (ref: any) => { visited.push(ref) },
    api: { read: async () => ({ text: documents.get('main.ts')!.text }), async *reading(input: any, signal: AbortSignal) {
      requests.push(input)
      if (stream) { yield* stream(input, signal); return }
      yield { kind: 'sources', sources: [source], partial: false }
      if (input.kind === 'plan') yield { kind: 'plan', plan }
      else yield { kind: 'section', section: { title: '值', text: '声明变量', refs: [reference] } }
      yield { kind: 'done' }
    } } })
  return { reading, requests, documents, visited }
}

test('规划、解释、引用跳转及缓存均使用原目标，修改输入草稿不污染现有路径', async () => {
  const { reading, requests, visited } = fixture()
  reading.goal('入口'); await reading.plan()
  reading.goal('另一个目标'); await reading.step(0)
  assert.equal(requests[1].goal, '入口'); assert.equal(visited[0].file, 'main.ts')
  await reading.step(0); assert.equal(requests.length, 2)
  assert.equal(reading.snapshot().status, 'ready')
})

test('读取未保存缓冲区，编辑引用依赖后标过期并拒绝跳到旧片段', async () => {
  const { reading, requests, documents } = fixture()
  reading.goal('入口'); await reading.plan(); await reading.step(0)
  documents.get('main.ts')!.text = 'const value = 2;'
  reading.changed('main.ts')
  assert.equal(reading.snapshot().stale, true)
  assert.equal(await reading.open(reference), false)
  await reading.file()
  assert.equal(requests.at(-1).buffers[0].text, 'const value = 2;')
  assert.equal(reading.snapshot().stale, true)
})

test('取消和新请求会淘汰晚到结果，不将部分解释显示为完成', async () => {
  const gate = Promise.withResolvers<void>()
  let calls = 0
  const { reading } = fixture(async function* (_input, _signal) {
    calls++
    if (calls === 1) { await gate.promise; yield { kind: 'plan', plan: { ...plan, title: '晚到' } } }
    else yield { kind: 'plan', plan }
    yield { kind: 'done' }
  })
  reading.goal('第一'); const pending = reading.plan()
  await Promise.resolve(); reading.goal('第二'); await reading.plan(); gate.resolve(); await pending
  assert.equal(reading.snapshot().plan.title, '入口')
  assert.equal(reading.snapshot().status, 'ready')
  const incomplete = fixture(async function* () { yield { kind: 'sources', sources: [source], partial: false } })
  await incomplete.reading.file(); assert.equal(incomplete.reading.snapshot().finished, false); assert.equal(incomplete.reading.snapshot().status, 'error')
})

test('读取失败保留已有说明，卸载后不再通知或写入状态', async () => {
  const { reading } = fixture(async function* () {
    yield { kind: 'section', section: { title: '部分', text: '已显示', refs: [reference] } }
    throw new Error('connection lost')
  })
  await reading.file(); assert.equal(reading.snapshot().sections.length, 1); assert.equal(reading.snapshot().status, 'error')
  let changed = 0; reading.subscribe(() => changed++); reading.dispose(); reading.goal('卸载后')
  assert.equal(changed, 0)
})

test('未改变的片段跟随插行移动，内容修改和重复候选不猜测位置', async () => {
  const { reading, documents, visited } = fixture()
  reading.goal('入口'); await reading.plan()
  documents.get('main.ts')!.text = '// 插入说明\n' + source.text
  reading.changed('main.ts')
  assert.equal(reading.snapshot().stale, false)
  assert.equal(reading.snapshot().plan.steps[0].refs[0].fromLine, 2)
  assert.equal(await reading.open(reference), true)
  assert.equal(visited.at(-1).line, 1)
  documents.get('main.ts')!.text = '// 插入说明\nother\n' + source.text + '\n' + source.text
  reading.changed('main.ts')
  assert.equal(reading.snapshot().stale, true)
  assert.equal(await reading.open(reference), false)
})

test('切换步骤前的异步读取也可取消，旧步骤不会抢回新目标', async () => {
  const { requests, documents } = fixture()
  const gate = Promise.withResolvers<any>()
  const custom = createReading({ documents, currentFile: () => 'main.ts', t: (key: string) => key, locale: () => 'zh',
    visit: () => gate.promise, api: { read: async () => ({ text: source.text }), async *reading(input: any) {
      requests.push(input)
      yield { kind: 'sources', sources: [source], partial: false }
      yield { kind: 'plan', plan }; yield { kind: 'done' }
    } } })
  custom.goal('旧目标'); await custom.plan()
  const pending = custom.step(0)
  await new Promise(resolve => setImmediate(resolve))
  custom.goal('新目标'); await custom.plan()
  gate.resolve(); await pending
  assert.equal(custom.snapshot().planGoal, '新目标')
  assert.equal(requests.at(-1).kind, 'plan')
  assert.equal(custom.snapshot().status, 'ready')
})

test('干净缓冲区不掩盖磁盘改动；关闭立即显示停止并丢弃晚到输出', async () => {
  const { reading, documents } = fixture()
  reading.goal('入口'); await reading.plan()
  const clean = documents.get('main.ts')!
  clean.text = clean.original = 'changed outside'
  await reading.verify(); assert.equal(reading.snapshot().stale, true)
  const gate = Promise.withResolvers<void>()
  const pendingFixture = fixture(async function* () { await gate.promise; yield { kind: 'plan', plan }; yield { kind: 'done' } })
  pendingFixture.reading.goal('入口'); const pending = pendingFixture.reading.plan()
  pendingFixture.reading.stop(); assert.equal(pendingFixture.reading.snapshot().status, 'stopped')
  gate.resolve(); await pending
  assert.equal(pendingFixture.reading.snapshot().plan, null)
})

test('生成结束核对磁盘期间，用户新输入的目标不会被旧快照覆盖', async () => {
  const gate = Promise.withResolvers<{ text: string }>(), started = Promise.withResolvers<void>()
  const reading = createReading({ documents: new Map(), currentFile: () => 'main.ts', visit: async () => {}, t: (key: string) => key, locale: () => 'zh',
    api: { read: async () => { started.resolve(); return gate.promise }, async *reading() {
      yield { kind: 'sources', sources: [source], partial: false }; yield { kind: 'plan', plan }; yield { kind: 'done' }
    } } })
  reading.goal('原始目标'); const pending = reading.plan(); await started.promise
  reading.goal('下一步的新目标'); gate.resolve({ text: source.text }); await pending
  assert.equal(reading.snapshot().goal, '下一步的新目标')
  assert.equal(reading.snapshot().planGoal, '原始目标')
  assert.equal(reading.snapshot().status, 'ready')
})

test('CRLF 源码引用只选择目标行内容，不把行尾回车算成下一行', async () => {
  const text = 'first\r\nsecond\r\nthird\r\n', visited: any[] = []
  const reading = createReading({ documents: new Map(), currentFile: () => 'windows.ts', t: (key: string) => key, locale: () => 'zh',
    api: { read: async () => ({ text, version: 'v1' }) }, visit: async (target: any) => { visited.push(target) } })
  try {
    for (const [fromLine, toLine, quote, length] of [[1, 1, 'first\r', 5], [2, 3, 'second\r\nthird\r', 12]] as const) {
      assert.equal(await reading.open({ file: 'windows.ts', fromLine, toLine, quote }), true)
      assert.equal(visited.at(-1).line, fromLine - 1)
      assert.equal(visited.at(-1).length, length)
      assert.equal(visited.at(-1).source.text, text)
    }
  } finally { reading.dispose() }
})

test('混合换行阅读引用跳到真实行号，插行后继续跟随且不误报过期', async () => {
  let text = 'first\r\nsecond\nthird\rfourth'
  const visited: any[] = [], reading = createReading({ documents: new Map(), currentFile: () => 'mixed.ts', t: (key: string) => key, locale: () => 'zh',
    api: { read: async () => ({ text, version: 'v1' }) }, visit: async (target: any) => { visited.push(target) } })
  try {
    const ref = { file: 'mixed.ts', fromLine: 3, toLine: 4, quote: 'third\nfourth' }
    assert.equal(await reading.open(ref), true)
    assert.equal(visited.at(-1).line, 2); assert.equal(visited.at(-1).length, 12)
    assert.equal(visited.at(-1).source.text, text)
    text = '// added\r' + text
    assert.equal(await reading.open(ref), true)
    assert.equal(visited.at(-1).line, 3)
  } finally { reading.dispose() }
})

test('多个学习视图共享目标和结果，文件入口与引用导航互不串用', async () => {
  const { reading, requests, visited } = fixture(), first: any[] = [], second: any[] = []
  const a = reading.forView({ currentFile: () => 'first.ts', visit: async (ref: any) => first.push(ref) })
  const b = reading.forView({ currentFile: () => 'second.ts', visit: async (ref: any) => second.push(ref) })
  try {
    a.goal('理解项目'); await a.plan(); assert.equal(requests.at(-1).file, 'first.ts')
    assert.equal(b.snapshot(), reading.snapshot())
    await b.file(); assert.equal(requests.at(-1).file, 'second.ts')
    await a.open(reference); await b.open(reference); await reading.open(reference)
    assert.deepEqual([first.length, second.length, visited.length], [1, 1, 1])
    let updates = 0; const off = a.subscribe(() => updates++)
    b.goal('共同草稿'); off(); assert.equal(updates, 1); assert.equal(reading.snapshot().goal, '共同草稿')
  } finally { reading.dispose() }
})

test('无标签的学习视图仍可规划，文件解释不借用主视图入口', async () => {
  const { reading, requests } = fixture()
  const empty = reading.forView({ currentFile: () => null, visit: async () => assert.fail('规划不能自行导航') })
  try {
    await empty.file(); assert.equal(requests.length, 0)
    empty.goal('理解项目'); await empty.plan()
    assert.equal(requests.length, 1); assert.equal(Object.hasOwn(requests[0], 'file'), false)
  } finally { reading.dispose() }
})

test('学习视图重试步骤使用本视图导航，过期重规划使用本视图当前文件', async () => {
  const { reading, documents, requests, visited } = fixture(), navigated: any[] = []
  const child = reading.forView({ currentFile: () => 'child.ts', visit: async (ref: any) => navigated.push(ref) })
  try {
    reading.goal('入口'); await reading.plan(); await reading.step(0)
    await child.retry()
    assert.equal(navigated.length, 1); assert.equal(visited.length, 1)
    assert.equal(requests.at(-1).step.title, '值')
    documents.get('main.ts')!.text = 'changed'; reading.changed('main.ts')
    await child.retry(); assert.equal(requests.at(-1).kind, 'plan'); assert.equal(requests.at(-1).file, 'child.ts')
  } finally { reading.dispose() }
})

test('项目切换和卸载会取消学习视图的在途引用，不跳转旧项目', async () => {
  for (const dispose of [false, true]) {
    const gate = Promise.withResolvers<any>(), visited: any[] = []
    const reading = createReading({ documents: new Map(), currentFile: () => 'main.ts', visit: async () => assert.fail('不能导航主视图'), t: (key: string) => key, locale: () => 'zh', api: { read: async () => gate.promise } })
    const child = reading.forView({ currentFile: () => 'child.ts', visit: async (ref: any) => visited.push(ref) })
    try {
      const opening = child.open(reference)
      if (dispose) reading.dispose(); else reading.bind(new Map())
      gate.resolve({ text: source.text }); assert.equal(await opening, false); assert.deepEqual(visited, [])
    } finally { reading.dispose() }
  }
})
