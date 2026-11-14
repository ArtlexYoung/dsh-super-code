import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { TaskMemoryStore, taskMemoryDomainSpec } from '../src/task-memory-store.js'
import type { StoredTaskRecord } from '../src/task-memory-store.js'
import { validationRoot } from './validation-root.js'

export async function installTaskMemory(ctx: Context, existingRoot?: string) {
  await mkdir(validationRoot, { recursive: true })
  const root = existingRoot ?? await mkdtemp(join(validationRoot, 'task-memory-'))
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const domain = await (ctx.get('storageDomain') as DomainFacility).open(taskMemoryDomainSpec)
  ctx.effect(() => () => domain.close())
  const table = domain.table('records')
  let failure: 'before' | 'after' | undefined
  const proxy = new Proxy(table, { get(target, key) {
    if (key !== 'put') return Reflect.get(target, key)
    return async (id: string, value: StoredTaskRecord) => {
      if (failure === 'before') throw new Error('Task disk unavailable')
      await table.put(id, value)
      if (failure === 'after') throw new Error('Task write acknowledgement lost')
    }
  } }) as KvTable<string, StoredTaskRecord>
  const memory = new TaskMemoryStore(ctx, proxy)
  ctx.provide('superCodeTaskMemory', memory)
  return { root, memory, table, failTaskWrite: (mode?: 'before' | 'after') => { failure = mode } }
}
