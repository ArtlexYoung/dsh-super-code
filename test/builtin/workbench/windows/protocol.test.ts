import test from 'node:test'
import assert from 'node:assert/strict'
import { createMessageReader, createMessageSender, encode } from '../../../../builtin/workbench/windows/protocol.js'

test('跨帧消息保留中文、代理字符对、Map 和错误，多个消息不会交叉', async () => {
  const read = createMessageReader(), messages: any[] = [], sizes: number[] = []
  const send = createMessageSender(async (content: string) => {
    sizes.push(Buffer.byteLength(content))
    const message = read(content)
    if (message) messages.push(message)
    await Promise.resolve()
  })
  const value = { kind: 'state', text: 'a'.repeat(256 * 1024 - 25) + '😀中文\\\n'.repeat(180000), map: new Map([['代码', new Error('读取失败')]]) }
  await Promise.all([send(value), send({ kind: 'result', value: '后续消息' })])
  assert.equal(messages.length, 2)
  assert.equal(encode(messages[0]), encode(value))
  assert.equal(messages[0].map instanceof Map, true)
  assert.equal(messages[0].map.get('代码') instanceof Error, true)
  assert.deepEqual(messages[1], { kind: 'result', value: '后续消息' })
  assert.ok(sizes.length > 3)
  assert.ok(sizes.every(bytes => bytes < 2 * 1024 * 1024))
})

test('分片期间心跳不打断消息，空数组、空字符串和后续小消息正常读取', async () => {
  const read = createMessageReader(), result: any[] = []
  const send = createMessageSender(async (content: string) => {
    assert.deepEqual(read('{"kind":"ping"}'), { kind: 'ping' })
    const message = read(content); if (message) result.push(message)
  })
  const value = { kind: 'state', empty: '', items: [], text: 'x'.repeat(600000) }
  await send(value)
  await send({ kind: 'result' })
  assert.deepEqual(result, [value, { kind: 'result' }])
})

test('单条派生状态超过32MiB时仍完整交接，不提高后端消息上限', async () => {
  const read = createMessageReader(), text = 'x'.repeat(33 * 1024 * 1024)
  let received: any, frames = 0
  const send = createMessageSender(async (content: string) => {
    frames++
    assert.ok(Buffer.byteLength(content) < 2 * 1024 * 1024)
    const value = read(content); if (value) received = value
  })
  await send({ kind: 'state', text })
  assert.ok(frames > 100)
  assert.equal(received.kind, 'state')
  assert.equal(received.text === text, true)
})

test('畸形或被插入的分片立即失败，发送失败后不重试后续状态', async () => {
  for (const frame of [{ kind: 'chunk', content: 1, last: true }, { kind: 'chunk', content: '', last: 1 }, { kind: 'chunk', content: 'x'.repeat(256 * 1024 + 1), last: true }]) {
    assert.throws(() => createMessageReader()(encode(frame)), /WORKBENCH_WINDOW_PROTOCOL/)
  }
  const read = createMessageReader()
  assert.equal(read(encode({ kind: 'chunk', content: '{', last: false })), null)
  assert.throws(() => read('{"kind":"state"}'), /WORKBENCH_WINDOW_PROTOCOL/)
  let sent = 0
  const send = createMessageSender(async () => { sent++; throw new Error('断开') })
  await assert.rejects(send({ kind: 'state', value: 'x'.repeat(600000) }), /断开/)
  await assert.rejects(send({ kind: 'result' }), /断开/)
  assert.equal(sent, 1)
})
