import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import type { TestContext } from 'node:test'

const exec = promisify(execFile)
/** 用真正的 Git HTTP 后端提供临时远程，不接触用户远程或凭据。 */
export async function gitHttpServer(root: string, t: TestContext): Promise<{ url: string; requests: { method: string; path: string; authenticated: boolean }[]; stall: () => void }> {
  const requests: { method: string; path: string; authenticated: boolean }[] = []
  const backend = (await exec('git', ['--exec-path'])).stdout.trim() + '/git-http-backend'
  let stalled = false
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost')
    const authenticated = req.headers.authorization === `Basic ${Buffer.from('tester:fixture-token').toString('base64')}`
    requests.push({ method: req.method!, path: url.pathname, authenticated })
    if (stalled) return
    if (!authenticated) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' }); res.end(); return }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const child = spawn(backend, [], { env: { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1',
      REQUEST_METHOD: req.method!, PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: req.headers['content-type'] || '', CONTENT_LENGTH: String(body.length),
      REMOTE_USER: 'tester', SERVER_PROTOCOL: 'HTTP/1.1',
    } })
    const parts: Buffer[] = []
    child.stdout.on('data', chunk => parts.push(chunk)); child.stderr.resume()
    child.stdin.end(body)
    res.on('close', () => { if (child.exitCode === null) child.kill() })
    child.on('close', () => {
      if (res.destroyed) return
      const content = Buffer.concat(parts), boundary = content.indexOf('\r\n\r\n')
      if (boundary < 0) { res.writeHead(500); res.end(); return }
      const headers: Record<string, string> = {}; let status = 200
      for (const line of content.subarray(0, boundary).toString().split('\r\n')) {
        const at = line.indexOf(':'); if (at < 0) continue
        const key = line.slice(0, at), value = line.slice(at + 1).trim()
        if (key.toLowerCase() === 'status') status = Number(value.slice(0, 3)); else headers[key] = value
      }
      res.writeHead(status, headers); res.end(content.subarray(boundary + 4))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('server')
  return { url: `http://127.0.0.1:${address.port}/remote.git`, requests, stall: () => { stalled = true } }
}
