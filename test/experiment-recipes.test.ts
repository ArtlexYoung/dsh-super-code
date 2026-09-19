import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { EXPERIMENT_RECIPES, readExperimentRecipe } from '../src/core/experiment-recipes.js'

test('every on-demand example runs and reports a real counterexample through its returned module URL', async () => {
  for (const recipe of EXPERIMENT_RECIPES) {
    const text = readExperimentRecipe(recipe)
    const script = /```js\n([\s\S]+)\n```/.exec(text)![1]!
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { timeout: 10000 })
    const report = JSON.parse(stdout)
    assert.equal(report.status, recipe === 'reduce' ? 'reduced' : 'counterexample', recipe)
    assert.equal(Object.hasOwn(report, 'input'), false)
    assert.equal(Object.hasOwn(report, 'verdict'), false)
    assert.ok(report.inputPreview.length <= 8)
    assert.ok(report.inputLength >= report.inputPreview.length)
    if (recipe === 'reduce') {
      assert.deepEqual(report.inputPreview, [2, 2])
      assert.equal(report.reproduced, true)
      assert.equal(report.minimality, 'one-removal')
    }
    if (recipe === 'differential') {
      assert.deepEqual(report.inputPreview, [0, 2, 8, 2, 9])
      assert.equal(report.stats.checks, 2) // No hidden reduction or additional observations.
      assert.equal(report.signature, 'behavior-difference')
      assert.equal(Object.hasOwn(report, 'minimality'), false)
    }
    if (recipe === 'interleavings') assert.equal(report.coverage, 'complete')
    assert.ok(report.stats.checks <= 100)
  }
  assert.throws(() => readExperimentRecipe('unknown' as never), /Unknown/)
})
