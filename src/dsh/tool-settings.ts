import type { Context } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { randomUUID } from 'node:crypto'
import { activeToolProfile, builtinToolProfiles, defaultToolConfiguration, maximumCustomProfiles,
  maximumToolConfigurationBytes, maximumToolProfileNameLength, toolGroups, validateToolConfiguration } from './tool-profiles.js'
import type { ToolConfiguration, ToolProfile } from './tool-profiles.js'
import type { ToolAvailability } from './tool-providers.js'
import type { ToolRuntimeStatus } from './tool-access.js'

const settingsSchema: schema<ToolConfiguration> = schema.object({ version: schema.const(1).default(1),
  activeId: schema.string().default('builtin:super-code'),
  custom: schema.array(schema.object({ id: schema.string().required(), name: schema.string().required(),
    execution: schema.union(['native', 'ptc']).required(), shell: schema.union(['standard', 'persistent']).required(),
    tools: schema.array(schema.string()).required(),
    disabledExternalTools: schema.array(schema.string()),
  })).default([]),
})
export const name = 'super-code-tools'
export const inject: string[] = ['settings']
export const Config: schema<ToolConfiguration> = schema.object({
  version: settingsSchema.dict!.version!.extra('volatile', true),
  activeId: settingsSchema.dict!.activeId!.extra('volatile', true),
  custom: settingsSchema.dict!.custom!.extra('volatile', true),
})
interface Writer {
  readonly writable: boolean
  describe(options: { redactSecrets: boolean }): { ns: string; revision: number }[]
  replace(namespace: string, value: object, expected: number): Promise<void>
}
export interface ToolSettingsSnapshot {
  readonly configuration: ToolConfiguration
  readonly builtins: readonly ToolProfile[]
  readonly catalog: readonly ToolAvailability[]
  readonly sessions: readonly ToolRuntimeStatus[]
  readonly revision: number
  readonly generation: string
  readonly writable: boolean
}
export type ToolSettingsResult = { readonly ok: true; readonly snapshot: ToolSettingsSnapshot }
  | { readonly ok: false; readonly error: 'invalid' | 'conflict' | 'read-only' | 'save-failed' | 'limit' }
interface RuntimeReader { status(): ToolRuntimeStatus[]; catalog(): ToolAvailability[] }

export class ToolSettings {
  private readonly generation = randomUUID()
  private readonly listeners = new Set<() => void>()
  private readonly runtimes = new Set<RuntimeReader>()
  constructor(private readonly writer: Writer, private readonly readConfiguration: () => ToolConfiguration,
    private readonly namespace = 'super-code-tools') {}
  get(): ToolConfiguration { return structuredClone(this.readConfiguration()) }
  profile(): ToolProfile { return activeToolProfile(this.get()) }
  watch(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  changed(): void { for (const listener of this.listeners) listener() }
  attach(runtime: RuntimeReader): () => void { this.runtimes.add(runtime); return () => { this.runtimes.delete(runtime) } }
  read(): ToolSettingsSnapshot {
    const descriptor = this.writer.describe({ redactSecrets: true }).find(row => row.ns === this.namespace)
    if (!descriptor) throw new Error('Tool settings are unavailable')
    const catalog = new Map<string, ToolAvailability>()
    for (const group of toolGroups) for (const name of group.tools)
      catalog.set(name, { name, group: group.id, available: false, reason: 'not-loaded' })
    for (const runtime of this.runtimes) for (const item of runtime.catalog()) {
      if (!catalog.get(item.name)?.available) catalog.set(item.name, item)
    }
    return { configuration: this.get(), builtins: structuredClone(builtinToolProfiles), catalog: [...catalog.values()],
      sessions: [...this.runtimes].flatMap(runtime => runtime.status()),
      revision: descriptor.revision, generation: this.generation, writable: this.writer.writable }
  }
  async save(content: string, expected: string): Promise<ToolSettingsResult> {
    if (!this.writer.writable) return { ok: false, error: 'read-only' }
    let configuration: ToolConfiguration
    try {
      if (Buffer.byteLength(content, 'utf8') > maximumToolConfigurationBytes) return { ok: false, error: 'invalid' }
      configuration = validateToolConfiguration(JSON.parse(content))
    } catch { return { ok: false, error: 'invalid' } }
    const [revision, generation, extra] = expected.split(':')
    if (extra !== undefined || !/^(0|[1-9]\d*)$/.test(revision!) || !Number.isSafeInteger(Number(revision)) || !generation)
      return { ok: false, error: 'invalid' }
    if (generation !== this.generation) return { ok: false, error: 'conflict' }
    try { await this.writer.replace(this.namespace, configuration, Number(revision)) }
    catch (error) { return { ok: false, error: error instanceof Error && 'code' in error && error.code === 'SETTINGS_CONFLICT' ? 'conflict' : 'save-failed' } }
    this.changed()
    return { ok: true, snapshot: this.read() }
  }
  async copy(sourceId: string, expected: string): Promise<ToolSettingsResult> {
    const configuration = this.get()
    if (configuration.custom.length >= maximumCustomProfiles) return { ok: false, error: 'limit' }
    const source = [...builtinToolProfiles, ...configuration.custom].find(profile => profile.id === sourceId)
    if (sourceId && !source) return { ok: false, error: 'invalid' }
    const suffix = ' (2)'
    const profile: ToolProfile = source ? { ...structuredClone(source), id: 'custom:' + randomUUID(), name: source.name.slice(0, maximumToolProfileNameLength - suffix.length) + suffix }
      : { id: 'custom:' + randomUUID(), name: 'Custom', execution: 'native', shell: 'standard', tools: [] }
    return this.save(JSON.stringify({ ...configuration, custom: [...configuration.custom, profile] }), expected)
  }
}
declare module '@deepseek-ai/cordis' { interface Context { superCodeTools: ToolSettings } }

export class SuperCodeTools extends TypertRemoteService {
  constructor(ctx: Context, private readonly source: ToolSettings) { super(ctx, 'superCodeToolSettings') }
  @Remote
  readConfig(): ToolSettingsSnapshot { return this.source.read() }
  @Remote
  saveConfig(content: string, expected: string): Promise<ToolSettingsResult> { return this.source.save(content, expected) }
  @Remote
  copyProfile(sourceId: string, expected: string): Promise<ToolSettingsResult> { return this.source.copy(sourceId, expected) }
  @Remote
  status(): readonly ToolRuntimeStatus[] { return this.source.read().sessions }
}

/** 独立Loader入口使新旧宿主都能持久化工具配置，不扩大预算文档。 */
export function apply(ctx: Context, config: ToolConfiguration = defaultToolConfiguration): void {
  if (ctx.get('superCodeTools')) return
  let read = (): ToolConfiguration => validateToolConfiguration(Object.fromEntries(Object.entries(config).map(([key, value]) => {
    const reference = value as unknown as { get?: () => unknown }
    return [key, typeof reference?.get === 'function' ? reference.get() : value]
  })))
  const settings = ctx.get('settings')!
  let key = 'super-code-tools'
  let watch: ((listener: () => void) => () => void) | undefined
  if (typeof settings.register === 'function') {
    const scope = settings.register(key, settingsSchema, { base: defaultToolConfiguration, validate: validateToolConfiguration })
    read = () => validateToolConfiguration(scope.get())
    watch = listener => scope.watch(listener)
  } else {
    const forms = settings as unknown as { configure(options: { auto: boolean }, owner: typeof ctx.fiber): () => void }
    const entryId = ctx.fiber.entry?.options.id
    if (!entryId) throw new Error('Tool settings require their own profile entry')
    key = entryId
    ctx.effect(() => forms.configure({ auto: false }, ctx.fiber))
  }
  const source = new ToolSettings(settings, read, key)
  ctx.provide('superCodeTools', source)
  if (watch) ctx.effect(() => watch!(() => source.changed()))
  new SuperCodeTools(ctx, source)
}
