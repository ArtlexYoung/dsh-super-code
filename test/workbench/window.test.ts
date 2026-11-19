import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchWindows } from '../../src/workbench/window.js'
import { EventEmitter, once } from 'node:events'
import { spawn } from 'node:child_process'

const signal = () => new AbortController().signal
const broker = () => new WorkbenchWindows(async () => { throw new Error('WORKBENCH_WINDOW_COMPONENT') }, async () => Buffer.from('document.title="test"'))
function endpoint(address: { url: string }) {
  const url = new URL(address.url), token = url.hash.slice(1); url.hash = ''
  return { url: url.origin, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
}
test('窗口服务只接受所选会话及凭证，拒绝跨源和任意文件路径', async t => {
  const windows = broker(); t.after(() => windows.dispose())
  const address = await windows.open('first', false), { url, headers } = endpoint(address)
  assert.match(address.id, /^[a-f0-9]{32}$/)
  assert.equal((await fetch(url)).status, 200)
  assert.equal((await fetch(url + '/window.js')).headers.get('content-type'), 'text/javascript; charset=utf-8')
  for (const options of [{}, { headers: { ...headers, Origin: 'https://example.invalid' } }, { headers: { ...headers, Authorization: 'Bearer invalid' } }]) assert.equal((await fetch(url + '/events', options)).status, 403)
  assert.equal((await fetch(url + '/../../package.json', { headers })).status, 404)
  assert.throws(() => windows.send('second', address.id, '{}'), /WORKBENCH_WINDOW_CLOSED/)
  assert.throws(() => windows.close('second', address.id), /WORKBENCH_WINDOW_CLOSED/)
  const second = await windows.open('first', false)
  assert.notEqual(second.id, address.id)
  windows.close('first', address.id)
  assert.equal((await fetch(endpoint(second).url)).status, 200)
})
test('真实回环 HTTP 与 Remote 流双向传递，关窗后释放端口', async t => {
  const windows = broker(); t.after(() => windows.dispose())
  const address = await windows.open('first', false), { url, headers } = endpoint(address)
  const events = windows.events('first', address.id, signal())
  const next = events.next()
  const child = await fetch(url + '/events', { headers }), reader = child.body!.getReader()
  windows.send('first', address.id, '{"kind":"state","value":"中文"}')
  assert.match(new TextDecoder().decode((await reader.read()).value), /中文/)
  assert.equal((await fetch(url + '/message', { method: 'POST', headers, body: '{"kind":"hello"}' })).status, 204)
  assert.deepEqual((await next).value, { kind: 'message', content: '{"kind":"hello"}' })
  windows.close('first', address.id)
  assert.equal((await events.next()).value.kind, 'closed'); await reader.cancel()
  await assert.rejects(fetch(url))
})
test('页面断开、取消流、组件缺失、卸载都能清理并重新打开', async t => {
  const windows = broker(); t.after(() => windows.dispose())
  await assert.rejects(windows.open('first', true), /WORKBENCH_WINDOW_COMPONENT/)
  for (const mode of ['page', 'cancel', 'dispose']) {
    const address = await windows.open('first', false), { url, headers } = endpoint(address)
    const abort = new AbortController(), events = windows.events('first', address.id, abort.signal), next = events.next()
    const page = await fetch(url + '/events', { headers })
    if (mode === 'page') await page.body!.cancel()
    else if (mode === 'cancel') abort.abort()
    else windows.dispose()
    await next
    await page.body?.cancel().catch(() => {})
    await events.return(undefined)
  }
})

test('同一会话可并行打开多个窗口，卸载期间晚到资源不遗留窗口', async () => {
  const windows = broker()
  try {
    const addresses = await Promise.all([windows.open('same', false), windows.open('same', false), windows.open('same', false)])
    assert.equal(new Set(addresses.map(value => value.id)).size, 3)
    windows.close('same', addresses[0]!.id)
    for (const address of addresses.slice(1)) assert.equal((await fetch(endpoint(address).url)).status, 200)
  } finally { windows.dispose() }
  const loaded = Promise.withResolvers<Buffer>(), delayed = new WorkbenchWindows(undefined, () => loaded.promise)
  const opening = [delayed.open('same', false), delayed.open('same', false)]
  delayed.dispose(); loaded.resolve(Buffer.from(''))
  for (const pending of opening) await assert.rejects(pending, /WORKBENCH_WINDOW_CLOSED/)
  await assert.rejects(delayed.open('same', false), /WORKBENCH_WINDOW_CLOSED/)
})

test('窗口开始监听前卸载能结束打开请求，不启动原生程序或返回失效地址', async () => {
  for (const native of [false, true]) {
    let launches = 0
    const windows = new WorkbenchWindows(async () => { launches++; throw new Error('不应启动原生程序') }, async () => Buffer.from(''))
    const opening = windows.open('same', native).then(() => 'returned-address', error => error.message)
    await Promise.resolve()
    windows.dispose()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([opening, new Promise(resolve => { timer = setTimeout(() => resolve('opening-unsettled'), 1000) })])
      assert.equal(result, 'WORKBENCH_WINDOW_CLOSED')
      assert.equal(launches, 0)
    } finally { clearTimeout(timer); windows.dispose() }
  }
})

test('卸载后晚到的原生启动结果会退出本次子进程并结束打开请求', { timeout: 5000 }, async t => {
  const entered = Promise.withResolvers<void>(), launched = Promise.withResolvers<ReturnType<typeof spawn>>()
  const windows = new WorkbenchWindows(async () => { entered.resolve(); return launched.promise }, async () => Buffer.from(''))
  t.after(() => windows.dispose())
  const opening = windows.open('same', true)
  await entered.promise
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  t.after(() => { child.kill() })
  await once(child, 'spawn')
  const exited = once(child, 'exit')
  windows.dispose(); launched.resolve(child)
  await assert.rejects(opening, /WORKBENCH_WINDOW_CLOSED/)
  await exited
  assert.ok(child.exitCode !== null || child.signalCode !== null)
})

test('未知消息、无内容类型和重复领取不能操作窗口', async t => {
  const windows = broker(); t.after(() => windows.dispose())
  const address = await windows.open('first', false), { url, headers } = endpoint(address)
  for (const body of ['null', '[]', '{"kind":1}', 'not json']) assert.equal((await fetch(url + '/message', { method: 'POST', headers, body })).status, 400)
  assert.equal((await fetch(url + '/message', { method: 'POST', headers: { Authorization: headers.Authorization }, body: '{}' })).status, 404)
  const page = await fetch(url + '/events', { headers })
  assert.equal((await fetch(url + '/events', { headers })).status, 404)
  await page.body!.cancel()
})

test('原页面断连保留只读系统窗口，主动关闭和卸载结束本次窗口进程', async () => {
  for (const mode of ['disconnect', 'close', 'dispose']) {
    let killed = false
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill() { killed = true; return true } })
    const windows = new WorkbenchWindows(async () => child as any, async () => Buffer.from(''))
    const address = await windows.open('first', true), { url, headers } = endpoint(address)
    const page = await fetch(url + '/events', { headers }), abort = new AbortController()
    await fetch(url + '/message', { method: 'POST', headers, body: '{"kind":"ready"}' })
    const events = windows.events('first', address.id, abort.signal), waiting = events.next()
    if (mode === 'disconnect') abort.abort()
    else if (mode === 'close') windows.close('first', address.id)
    else windows.dispose()
    await waiting; await events.return(undefined)
    assert.equal(killed, mode !== 'disconnect', mode)
    await page.body!.cancel().catch(() => {})
    await assert.rejects(fetch(url))
    windows.dispose()
  }
})

test('尚未就绪的系统窗口断连后结束进程，不遗留空白窗口', async () => {
  let killed = false
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill() { killed = true; return true } })
  const windows = new WorkbenchWindows(async () => child as any, async () => Buffer.from(''))
  try {
    const address = await windows.open('first', true), { url, headers } = endpoint(address)
    const page = await fetch(url + '/events', { headers }), abort = new AbortController()
    const events = windows.events('first', address.id, abort.signal), waiting = events.next()
    abort.abort(); await waiting; await events.return(undefined)
    await page.body!.cancel().catch(() => {})
    assert.equal(killed, true)
  } finally { windows.dispose() }
})

test('已就绪页面暂停脚本而连接仍在时不误断开，未就绪超时和真实断流仍能清理', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const windows = broker(); t.after(() => windows.dispose())
  for (const ready of [true, false]) {
    const address = await windows.open('first', false), { url, headers } = endpoint(address)
    const page = await fetch(url + '/events', { headers })
    if (ready) await fetch(url + '/message', { method: 'POST', headers, body: '{"kind":"ready"}' })
    t.mock.timers.setTime(Date.now() + 30000)
    windows.send('first', address.id, '')
    t.mock.timers.tick(3000)
    if (ready) {
      assert.doesNotThrow(() => windows.send('first', address.id, '{"kind":"state"}'))
      const abort = new AbortController(), events = windows.events('first', address.id, abort.signal)
      const closed = (async () => { for await (const event of events) if (event.kind === 'closed') return event })()
      await page.body!.cancel()
      assert.equal((await closed)?.reason, 'WORKBENCH_WINDOW_DISCONNECTED')
      assert.throws(() => windows.send('first', address.id, '{}'), /WORKBENCH_WINDOW_CLOSED/)
    } else {
      assert.throws(() => windows.send('first', address.id, '{}'), /WORKBENCH_WINDOW_CLOSED/)
      await page.body!.cancel()
    }
  }
})
