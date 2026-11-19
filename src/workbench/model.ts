import { z } from 'zod'
import type { GenerateOptions, LlmRuntime } from '@deepseek-ai/dsh-llm'

export type WorkbenchModel = Pick<GenerateOptions, 'provider' | 'model' | 'reasoningEffort'>
export interface WorkbenchModelOptions {
  model?: Pick<WorkbenchModel, 'provider' | 'model'>
  reasoningEffort?: string
}
export const modelRouteSchema: z.ZodType<NonNullable<WorkbenchModelOptions['model']>> = z.object({
  provider: z.string().trim().min(1).max(256), model: z.string().trim().min(1).max(256),
}).strict()
export const modelEffortSchema: z.ZodType<string> = z.string().trim().min(1).max(256)

/** 辅助请求独立选择模型和思考等级，不继承或修改主对话的思考配置。 */
export async function resolveWorkbenchModel(llm: Pick<LlmRuntime, 'resolveModelInfo'>, selected: WorkbenchModel, signal: AbortSignal, reasoningEffort = 'off'): Promise<WorkbenchModel> {
  signal.throwIfAborted()
  const model = { provider: selected.provider, model: selected.model }
  const info = await llm.resolveModelInfo(model.provider, model.model, signal)
  signal.throwIfAborted()
  const efforts = info.reasoning?.efforts ?? []
  if (!efforts.length && reasoningEffort === 'off') return model
  const effort = efforts.find(item => reasoningEffort === 'off' ? ['off', 'none', 'disabled'].includes(item.id) : item.id === reasoningEffort)
  if (!effort) throw new Error(reasoningEffort === 'off' ? 'WORKBENCH_TRANSLATION_THINKING' : 'WORKBENCH_MODEL_SETTING')
  return { ...model, reasoningEffort: effort.id }
}
