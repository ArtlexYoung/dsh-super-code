import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('MCP cleanup remains bounded when garbage collection runs during the DELETE request', { timeout: 15_000 }, async () => {
  const child = await promisify(execFile)(process.execPath, ['--expose-gc', '--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict'
    import { createServer } from 'node:http'
    import { invokeConnectionTool } from './src/connection/client.ts'
    let deleted = false
    const server = createServer(async (request, response) => {
      if (request.method === 'DELETE') { deleted = true; console.log('DELETE started'); return }
      if (request.url === '/warmup') { response.end('ready'); return }
      if (request.method === 'GET') { response.writeHead(405); response.end(); return }
      const body = []
      for await (const chunk of request) body.push(chunk)
      const message = JSON.parse(Buffer.concat(body).toString())
      if (message.method === 'notifications/initialized') { response.writeHead(202); response.end(); return }
      const result = message.method === 'initialize'
        ? { protocolVersion: message.params.protocolVersion, capabilities: {}, serverInfo: { name: 'local-timeout-probe', version: '1' } }
        : { tools: [] }
      response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'local-timeout-probe' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = 'http://127.0.0.1:' + server.address().port
    await (await fetch(url + '/warmup')).text()
    const gc = setInterval(() => global.gc(), 20), start = performance.now()
    try {
      await assert.rejects(invokeConnectionTool({ url: url + '/mcp', token: '0'.repeat(64), tool: 'tools', arguments: {} }), error => error.name === 'TimeoutError')
      assert.equal(deleted, true)
      assert.ok(performance.now() - start < 7_500)
      console.log('cleanup timed out and released the client')
    } finally {
      clearInterval(gc)
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  `], { cwd: new URL('../..', import.meta.url), timeout: 10_000, maxBuffer: 1024 * 1024 })
  assert.match(child.stdout, /cleanup timed out and released the client/)
})
