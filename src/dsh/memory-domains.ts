import type { Context } from '@deepseek-ai/cordis'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'

export async function apply(ctx: Context): Promise<void> {
  await Promise.allSettled([
    ctx.inject(['storageDomain'], async owner => {
      const { LongMemoryStore, longMemoryDomainSpec } = await import('../long-memory.js')
      const facility = owner.get('storageDomain') as DomainFacility
      try {
        const domain = await facility.open(longMemoryDomainSpec)
        owner.effect(() => () => domain.close())
        owner.provide('superCodeLongMemory', new LongMemoryStore(domain.table('topics')))
      } catch (error) { owner.logger.warn('Long memory is unavailable; other features remain available.', error) }
    }).await(),
    ctx.inject(['storageDomain', 'sessions'], async owner => {
      const { TaskMemoryStore, taskMemoryDomainSpec } = await import('../task-memory-store.js')
      const facility = owner.get('storageDomain') as DomainFacility
      try {
        const domain = await facility.open(taskMemoryDomainSpec)
        owner.effect(() => () => domain.close())
        owner.provide('superCodeTaskMemory', new TaskMemoryStore(owner, domain.table('records')))
      } catch (error) { owner.logger.warn('Task storage is unavailable; changes cannot be saved.', error) }
    }).await(),
  ])
}
