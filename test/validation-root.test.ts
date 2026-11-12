import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validationRoot } from './validation-root.js'

const exec = promisify(execFile)
async function fixture(t: test.TestContext) {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, '路径 空格 %-')), checkout = join(root, 'checkout')
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(checkout, 'test'), { recursive: true })
  await writeFile(join(checkout, 'package.json'), '{"type":"module"}')
  const helper = join(checkout, 'test/validation-root.ts')
  await copyFile(new URL('./validation-root.ts', import.meta.url), helper)
  const read = async (override?: string) => {
    const env = { ...process.env }
    delete env.SUPER_CODE_TEST_ROOT
    if (override !== undefined) env.SUPER_CODE_TEST_ROOT = override
    const result = await exec(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e',
      `import { validationRoot } from ${JSON.stringify(pathToFileURL(helper).href)}; console.log(JSON.stringify(validationRoot))`], { cwd: root, env })
    return JSON.parse(result.stdout) as string
  }
  return { root, read }
}

test('a fresh checkout places artifacts under source regardless of cwd or URL-sensitive characters', async t => {
  const f = await fixture(t)
  const expected = join(f.root, 'source/validation/dsh-super-code/unit')
  for (const override of [undefined, '']) assert.equal((await f.read(override)).replace(/[\\/]$/, ''), expected)
})

test('an isolated runner can direct all artifacts to an absolute Unicode directory', async t => {
  const f = await fixture(t), selected = join(f.root, '本轮 验证 %')
  assert.equal(await f.read(selected), selected)
})

test('a relative artifact directory resolves against the runner working directory', async t => {
  const f = await fixture(t)
  assert.equal(await f.read('source/本轮 验证 %'), join(f.root, 'source/本轮 验证 %'))
})
