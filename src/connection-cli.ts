#!/usr/bin/env node
import { invokeConnectionTool } from './connection/client.js'

/** Credentials come from private environment variables, never arguments or profile discovery. */
async function main(): Promise<void> {
  const tool = process.argv[2]
  if (process.argv.length !== 3 || !tool) throw new Error('usage')
  const token = process.env.DSH_MCP_TOKEN ?? '', url = process.env.DSH_MCP_URL ?? 'http://127.0.0.1:23457/mcp'
  const chunks: Buffer[] = []
  let bytes = 0
  if (!process.stdin.isTTY) for await (const chunk of process.stdin) {
    bytes += chunk.length
    if (bytes > 131072) throw new Error('input-too-large')
    chunks.push(Buffer.from(chunk))
  }
  const content = Buffer.concat(chunks).toString('utf8').trim(), args: unknown = content ? JSON.parse(content) : {}
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('invalid-input')
  const controller = new AbortController(), abort = (): void => controller.abort()
  process.once('SIGINT', abort); process.once('SIGTERM', abort)
  try {
    const result = await invokeConnectionTool({ tool, token, url, arguments: args as Record<string, unknown> }, controller.signal)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (result.isError) process.exitCode = 1
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort) }
}
void main().catch(() => {
  // Remote error text may include authentication details; retain only safe, actionable guidance.
  process.stderr.write('MCP call failed. Usage: super-code-mcp <dsh_tool|tools>, JSON arguments on stdin; configure DSH_MCP_TOKEN and optional DSH_MCP_URL privately. A transport failure may follow admission: recover the existing task or retry with the same requestId and input; do not control the serving DSH app.\n')
  process.exitCode = 2
})
