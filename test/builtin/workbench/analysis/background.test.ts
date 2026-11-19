import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

test('后台分析共享线程，启动失败、错误和卸载均释放请求与 Blob 地址', async () => {
  const built = await build({ entryPoints: ['builtin/workbench/analysis/background.js'], bundle: true, write: false,
    platform: 'node', format: 'cjs', define: { __WORKBENCH_ANALYSIS_WORKER__: '"worker"' } })
  const workers: WorkerFixture[] = [], revoked: string[] = []
  let fail = false
  class WorkerFixture {
    onmessage?: (event: { data: unknown }) => void
    onerror?: () => void
    messages: any[] = []
    terminated = false
    constructor() { if (fail) throw new Error('blocked'); workers.push(this) }
    postMessage(value: unknown) { this.messages.push(value) }
    terminate() { this.terminated = true }
  }
  const module = { exports: {} as { createAnalyzer(): { analyze(file: string, text: string): Promise<unknown>; dispose(): void } } }
  runInNewContext(built.outputFiles[0]!.text, { module, exports: module.exports, require: () => { throw new Error('Unexpected dependency') },
    Worker: WorkerFixture, Blob, DOMException, URL: { createObjectURL: () => `blob:${workers.length}`, revokeObjectURL: (url: string) => revoked.push(url) } })
  const analyzer = module.exports.createAnalyzer()
  const first = analyzer.analyze('one.ts', 'one'), second = analyzer.analyze('two.ts', 'two')
  assert.equal(workers.length, 1)
  for (const message of workers[0]!.messages) workers[0]!.onmessage!({ data: { id: message.id, value: message.text } })
  assert.deepEqual(await Promise.all([first, second]), ['one', 'two'])
  const interrupted = analyzer.analyze('three.ts', 'three')
  workers[0]!.onerror!()
  await assert.rejects(interrupted, /WORKBENCH_ANALYSIS/)
  assert.equal(workers[0]!.terminated, true); assert.equal(revoked.length, 1)
  fail = true
  await assert.rejects(analyzer.analyze('blocked.ts', ''), /WORKBENCH_ANALYSIS/)
  assert.equal(revoked.length, 2)
  fail = false
  const disposed = analyzer.analyze('four.ts', 'four')
  analyzer.dispose()
  await assert.rejects(disposed, { name: 'AbortError' })
  assert.equal(workers[1]!.terminated, true); assert.equal(revoked.length, 3)
})
