import { z } from 'zod'

export const MAX_READING_BUFFER_CHARS: number = 2 * 1024 * 1024
export const MAX_READING_REQUEST_CHARS: number = MAX_READING_BUFFER_CHARS * 6 + 65536
export const MAX_READING_OUTPUT_CHARS: number = 128 * 1024
export const MAX_READING_ROUNDS = 4
const path = z.string().min(1).max(4096)
const range = { file: path, fromLine: z.number().int().positive(), toLine: z.number().int().positive() }
export interface ReadingRange { file: string; fromLine: number; toLine: number }
export interface ReadingReference extends ReadingRange { quote: string }
export interface ReadingSource extends ReadingRange { id: string; text: string; version: string }
export interface ReadingStep { title: string; reason: string; refs: ReadingReference[] }
export interface ReadingPlan { title: string; summary: string; steps: ReadingStep[] }
export interface ReadingSection { title: string; text: string; refs: ReadingReference[] }
export interface ReadingRequest {
  kind: 'plan' | 'explain'; goal: string; locale: 'zh' | 'en'; file?: string
  step?: ReadingStep
  buffers: { path: string; text: string; version: string }[]
}
const reference = z.object({ ...range, quote: z.string().max(24000) }).strict().refine(item => item.toLine >= item.fromLine)
const request = z.object({
  kind: z.enum(['plan', 'explain']), goal: z.string().trim().min(1).max(4000), locale: z.enum(['zh', 'en']), file: path.optional(),
  step: z.object({ title: z.string().min(1).max(300), reason: z.string().max(2000), refs: z.array(reference).min(1).max(8) }).strict().optional(),
  buffers: z.array(z.object({ path, text: z.string().max(MAX_READING_BUFFER_CHARS), version: z.string().min(1).max(4096) }).strict()).max(32),
}).strict().refine(input => input.buffers.reduce((sum, file) => sum + file.text.length, 0) <= MAX_READING_BUFFER_CHARS, 'READING_BUFFER_SIZE')
  .refine(input => new Set(input.buffers.map(file => file.path)).size === input.buffers.length, 'READING_BUFFERS')
  .refine(input => input.kind !== 'explain' || !!input.file || !!input.step, 'READING_TARGET')

export function parseReadingRequest(input: unknown): ReadingRequest {
  const result = request.safeParse(input)
  if (!result.success) throw new Error('READING_REQUEST')
  return result.data
}

export interface ModelReadingReference { source: string; fromLine: number; toLine: number }
export type ReadingValue =
  | { kind: 'read'; ranges: ReadingRange[]; queries: string[] }
  | { kind: 'plan'; title: string; summary: string; steps: { title: string; reason: string; refs: ModelReadingReference[] }[] }
  | { kind: 'section'; title: string; text: string; refs: ModelReadingReference[] }
const modelReference = z.object({ source: z.string().min(1).max(12), fromLine: z.number().int().positive(), toLine: z.number().int().positive() }).strict()
const refs = z.array(modelReference).min(1).max(8)
export const readingValue: z.ZodType<ReadingValue> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('read'), ranges: z.array(z.object({ ...range }).strict()).max(8), queries: z.array(z.string().trim().min(1).max(200)).max(3) }).strict()
    .refine(value => value.ranges.length + value.queries.length > 0, 'READING_EMPTY_READ'),
  z.object({ kind: z.literal('plan'), title: z.string().trim().min(1).max(300), summary: z.string().trim().min(1).max(4000),
    steps: z.array(z.object({ title: z.string().trim().min(1).max(300), reason: z.string().trim().min(1).max(2000), refs }).strict()).min(1).max(12) }).strict(),
  z.object({ kind: z.literal('section'), title: z.string().trim().min(1).max(300), text: z.string().trim().min(1).max(16000), refs }).strict(),
])
export type ReadingEvent =
  | { kind: 'status'; stage: 'catalog' | 'reading' | 'generating' }
  | { kind: 'sources'; sources: ReadingSource[]; partial: boolean }
  | { kind: 'plan'; plan: ReadingPlan }
  | { kind: 'section'; section: ReadingSection }
  | { kind: 'done' }
