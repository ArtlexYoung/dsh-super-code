import test from 'node:test'
import assert from 'node:assert/strict'
import { uniqueId } from '../../../builtin/workbench/id.js'
import { encode, decode } from '../../../builtin/workbench/windows/protocol.js'

test('局域网HTTP没有randomUUID时，工具和窗口标识仍唯一，符号身份保持稳定', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto'), crypto = globalThis.crypto
  try {
    for (const value of [crypto, { getRandomValues: crypto.getRandomValues.bind(crypto) }]) {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value })
      const ids = Array.from({ length: 1000 }, () => uniqueId())
      assert.equal(new Set(ids).size, ids.length)
      for (const id of ids) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
      const owner = Symbol('view'), first = decode(encode({ owner }))
      assert.equal(first.owner, decode(encode({ owner })).owner)
      assert.notEqual(first.owner, decode(encode({ owner: Symbol('view') })).owner)
    }
  } finally { if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor) }
})
