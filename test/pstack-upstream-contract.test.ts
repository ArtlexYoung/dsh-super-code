import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { adaptMarkdown } from '../runtime/skills/pstack/adapt.mjs'

const root = new URL('../presets/super-code/skill-packs/pstack/', import.meta.url)

test('host adaptation retains upstream read-only role bodies without adding command bans', async () => {
  for (const path of [
    'skills/how/references/explorer-prompt.md', 'skills/how/references/explainer-prompt.md',
    'skills/why/references/investigator-prompt.md', 'skills/why/references/synthesizer-prompt.md',
  ]) {
    const original = await readFile(new URL(path, root), 'utf8')
    assert.equal(adaptMarkdown(path, original), original, path)
  }
})

test('host delegation translation preserves upstream read-only semantics and MCP access', async () => {
  const howPath = 'skills/how/SKILL.md', whyPath = 'skills/why/SKILL.md'
  const how = adaptMarkdown(howPath, await readFile(new URL(howPath, root), 'utf8'))
  const why = adaptMarkdown(whyPath, await readFile(new URL(whyPath, root), 'utf8'))
  assert.match(how, /These roles have read-only access/)
  assert.ok(why.includes("Investigators still shouldn't write anything."))
  assert.ok(why.includes('A no-write brief does not strip MCP access.'))
  assert.ok(!how.includes('runs no shell/program commands'))
  assert.ok(!why.includes('runs no shell/program commands'))
})

test('host adaptation does not replace upstream explanation and API verification procedures', async () => {
  const path = 'skills/how/SKILL.md'
  const original = await readFile(new URL(path, root), 'utf8')
  const presentation = "Present the explainer's output. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it."
  assert.ok(original.includes(presentation))
  assert.ok(adaptMarkdown(path, original).includes(presentation))
  const outcome = 'skills/principle-outcome-oriented-execution/SKILL.md'
  const expected = await readFile(new URL(outcome, root), 'utf8')
  const adapted = adaptMarkdown(outcome, expected)
  assert.ok(adapted.endsWith(expected.split('\n---\n')[1]))
})

test('host adaptation preserves the canonical log rule without imposing a new snapshot audit loop', async () => {
  const path = 'skills/show-me-your-work/SKILL.md'
  const original = await readFile(new URL(path, root), 'utf8')
  const adapted = adaptMarkdown(path, original)
  const rule = original.split('Keep one canonical log.')[1].split('\n\n')[1]
  assert.ok(adapted.includes('Keep one canonical log.\n\n' + rule))
  assert.ok(!adapted.includes('freeze all decision rows'))
  assert.ok(!adapted.includes('source-only role:'))
})
