/** Installed only for no-model preflight, never in paid solver runs. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { scopeOf } from '@deepseek-ai/dsh-scope'
export const name = 'fastctx-boot-inspector'
export const inject = ['agents', 'tools', 'systemPrompt', 'spillStore']
export function apply(ctx) {
  ctx.on('agent/created', ({ agent }) => {
    const inspect = async () => {
      const root = join(process.env.DSH_EVAL_WORKSPACE, '.git/dsh-context-output')
      assert.equal(ctx.spillStore.root, root)
      const scope = scopeOf(agent.ctx), kind = process.env.DSH_GRAPH_KIND
      const required = ['super_code_task']
      // Preset composition can finish just after the creation notification.
      for (let attempt = 0; attempt < 400; attempt++) {
        if (required.every(name => ctx.tools.get(name, scope))) {
          const assembly = await ctx.systemPrompt.assemble({ agent, scope })
          const sections = assembly.sections.map(section => section.name)
          if (!assembly.sections.some(section => section.name === 'deployment:persona-prefix' && section.text.includes("You are super-code, completing the user's authorized coding work."))) { await new Promise(resolve => setTimeout(resolve, 50)); continue }
          if (kind === 'exploration' && !sections.includes('super-code:context-exploration')) throw new Error('Exploration guidance missing in real Web preset')
          const report = { passed: true, kind, sessionId: agent.session.id, spillRoot: root, requiredTools: required, promptSections: sections, guidanceSection: 'deployment:persona-prefix', modelCalls: 0 }
          await writeFile(process.env.DSH_FASTCTX_BOOT_INSPECTOR, JSON.stringify(report, null, 2) + '\n')
          return
        }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Installed context tools not available in Web preset')
    }
    void inspect().catch(async error => { await writeFile(process.env.DSH_FASTCTX_BOOT_INSPECTOR, JSON.stringify({ passed: false, message: error.message }) + '\n') })
  })
}
