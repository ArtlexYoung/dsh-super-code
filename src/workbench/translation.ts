import { z } from 'zod'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { WorkbenchModel } from './assistant.js'

const modelSchema = z.object({ provider: z.string().min(1).max(256), model: z.string().min(1).max(256) }).strict()
export interface TranslationInput {
  instruction: string
  history: { role: 'user' | 'assistant'; text: string }[]
  model?: Pick<WorkbenchModel, 'provider' | 'model'>
}
const translationSchema: z.ZodType<TranslationInput> = z.object({
  instruction: z.string().trim().min(1).max(256 * 1024),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(256 * 1024) }).strict()).max(40),
  model: modelSchema.optional(),
}).strict()
export interface TranslationModelOption { provider: string; model: string; name: string }

export function parseTranslation(value: unknown): TranslationInput { return translationSchema.parse(value) }

export async function translationModel(llm: Pick<LlmRuntime, 'resolveModelInfo'>, selected: WorkbenchModel, signal: AbortSignal): Promise<WorkbenchModel> {
  signal.throwIfAborted()
  const model = { provider: selected.provider, model: selected.model }
  const info = await llm.resolveModelInfo(model.provider, model.model, signal)
  signal.throwIfAborted()
  if (!info.reasoning?.efforts.length) return model
  const effort = info.reasoning.efforts.find(item => ['off', 'none', 'disabled'].includes(item.id))
  if (!effort) throw new Error('WORKBENCH_TRANSLATION_THINKING')
  return { ...model, reasoningEffort: effort.id }
}

/** 翻译只接收本对话的用户文本，不注入源码、工具或系统提示。 */
export function translationRequest(input: TranslationInput, model: WorkbenchModel, signal: AbortSignal): GenerateOptions {
  const messages = input.history.map(item => item.role === 'user'
    ? createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: item.text }] })
    : createAssistantMessage({ source: { provider: model.provider, model: model.model }, content: [{ type: 'text', text: item.text }] }))
  messages.push(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: input.instruction }] }))
  return { ...model, signal, messages }
}
