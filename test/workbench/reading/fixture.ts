import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFS from '@deepseek-ai/dsh-fs-local'
import { WorkbenchFiles } from '../../../src/workbench/files.js'
import { validationRoot } from '../../validation-root.js'

export async function readingFixture(t: any) {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'reading-')), ctx = new Context()
  await ctx.plugin(LocalFS, { cwd: root, diffBasisMaxBytes: 10485760 })
  const files = new WorkbenchFiles(ctx.fs, async () => ({ cwd: root }))
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  return { root, ctx, files }
}
