import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { WorkbenchFiles } from '../../src/workbench/files.js'
import { validationRoot } from '../validation-root.js'

test('目录列表和项目索引完整覆盖超过2000文件与1000目录，取消仍有效', async t => {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'index-capacity-')), ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  const files = new WorkbenchFiles(ctx.fs, async () => ({ cwd: root }))
  for (let i = 0; i < 2105; i++) await writeFile(join(root, `source-${i}.ts`), `export const value${i} = ${i}\n`)
  for (let i = 0; i < 1105; i++) { const path = join(root, `folder-${i}`); await mkdir(path); await writeFile(join(path, 'main.py'), 'value = 1\n') }
  const listing = await files.list('test', '')
  assert.equal(listing.entries.length, 3210)
  assert.equal(listing.truncated, false)
  const project = await files.project('test')
  assert.equal(project.files.length, 3210)
  assert.equal(project.truncated, false)
  assert.equal(new Set(project.files).size, project.files.length)
  assert.ok(project.files.includes('source-2104.ts'))
  assert.ok(project.files.includes('folder-1104/main.py'))
  const abort = new AbortController(); abort.abort()
  await assert.rejects(files.project('test', abort.signal), error => error instanceof Error && (error.name === 'AbortError' || 'code' in error && error.code === 'FS_ABORTED'))
})

test('跳过任意名称的嵌套Python环境，保留同名普通目录及项目根源码', async t => {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'index-environments-')), ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  const files = new WorkbenchFiles(ctx.fs, async () => ({ cwd: root }))
  for (const path of ['resource/environments/research', 'resource/environments/project', 'resource/pyvenv.cfg']) await mkdir(join(root, path), { recursive: true })
  await writeFile(join(root, 'pyvenv.cfg'), 'home = /example\n')
  await writeFile(join(root, 'main.py'), 'project = True\n')
  await writeFile(join(root, 'resource/pyvenv.cfg', 'main.py'), 'project = True\n')
  await writeFile(join(root, 'resource/environments/research', 'pyvenv.cfg'), 'home = /example\n')
  await writeFile(join(root, 'resource/environments/research', 'package.py'), 'library = True\n')
  await writeFile(join(root, 'resource/environments/project', 'main.py'), 'project = True\n')
  assert.deepEqual((await files.project('s')).files.sort(), ['main.py', 'resource/environments/project/main.py', 'resource/pyvenv.cfg/main.py'])
})
