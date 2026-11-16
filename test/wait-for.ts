import { setTimeout } from 'node:timers/promises'

const timeoutMs = 2000
const intervalMs = 5

/** 父插件就绪不代表可选功能已完成初始化；测试等待实际要验证的能力。 */
export async function waitFor(ready: () => boolean): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (!ready()) {
    if (performance.now() >= deadline) throw new Error('Required test capability did not become ready')
    await setTimeout(intervalMs)
  }
}
