import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runConversationWorkflow } from '../src/core/conversation.js'

describe('conversation model selection', () => {
  it('passes the selected model to every turn without changing history semantics', async () => {
    const selected: string[] = []
    const result = await runConversationWorkflow(['first requirement', 'follow-up requirement'], {
      generate: async context => {
        selected.push(`${context.turn}:${context.model?.id ?? 'none'}:${context.profile.workScenario}`)
        return { text: `answer-${context.turn}`, usage: { inputTokens: 2, outputTokens: 3 } }
      },
    }, {
      profile: { workScenario: 'research' },
      modelSelector: turn => ({ id: turn === 1 ? 'planner' : 'researcher' }),
    })
    assert.deepEqual(selected, ['1:planner:research', '2:researcher:research'])
    assert.equal(result.usage.totalTokens, 10)
    assert.equal(result.messages.at(-1)?.content, 'answer-2')
  })
})
