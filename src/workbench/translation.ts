import { z } from 'zod'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { modelRouteSchema, modelEffortSchema } from './model.js'
import type { WorkbenchModel, WorkbenchModelOptions } from './model.js'

export interface TranslationInput extends WorkbenchModelOptions {
  instruction: string
  history: { role: 'user' | 'assistant'; text: string }[]
}
const translationSchema: z.ZodType<TranslationInput> = z.object({
  instruction: z.string().trim().min(1).max(256 * 1024),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(256 * 1024) }).strict()).max(40),
  model: modelRouteSchema.optional(), reasoningEffort: modelEffortSchema.optional(),
}).strict()
export interface TranslationModelOption {
  provider: string; model: string; name: string; current: boolean
  efforts: { id: string; name: string }[]
}

export function parseTranslation(value: unknown): TranslationInput { return translationSchema.parse(value) }

/** 翻译只接收本对话的用户文本，不注入源码、工具或系统提示。 */
export function translationRequest(input: TranslationInput, model: WorkbenchModel, signal: AbortSignal): GenerateOptions {
  const messages = input.history.map(item => item.role === 'user'
    ? createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: item.text }] })
    : createAssistantMessage({ source: { provider: model.provider, model: model.model }, content: [{ type: 'text', text: item.text }] }))
  messages.push(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: input.instruction }] }))
  return { ...model, signal, messages }
}
