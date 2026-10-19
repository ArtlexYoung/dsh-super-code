import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { configurationSchema, settingsConfigurationSchema, configurationOf, configurationValues, validateConfiguration } from '../src/dsh/budgets.js'
import type { Configuration } from '../src/dsh/budgets.js'
import { BudgetSettings, applyBudgetSettings } from '../src/dsh/budget-settings.js'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'

class MemorySettings extends SettingsProvider {
  writable = true
  fail = false
  stored: Record<string, unknown> = {}
  protected async load(): Promise<Record<string, unknown>> { return structuredClone(this.stored) }
  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    if (this.fail) throw new Error('disk full')
    this.stored[ns] = structuredClone(section)
  }
}

async function fixture(t: test.TestContext, base: Configuration = {}) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const settings = new MemorySettings(ctx)
  await ctx.inject(['settings'], () => {})
  const scope = settings.register('super-code-budgets', settingsConfigurationSchema, { base, validate: validateConfiguration })
  const api = new BudgetSettings(settings, scope, () => 600000)
  return { ctx, settings, scope, api }
}

test('Loader volatile config references yield validated snapshots instead of live references', () => {
  let summaryMaxTokens = 2048
  const input = { budgets: { get: () => ({ summaryMaxTokens }) }, maxTasks: { get: () => 48 },
    maxContextBytes: { get: () => undefined } } as unknown as Configuration
  const first = configurationValues(input)
  summaryMaxTokens = 8192
  assert.deepEqual(first, { budgets: { summaryMaxTokens: 2048 }, maxTasks: 48 })
  assert.equal(configurationValues(input).budgets?.summaryMaxTokens, 8192)
  summaryMaxTokens = -1
  assert.throws(() => configurationValues(input))
})

test('budget UI settings persist, restore composition defaults and reject stale writes', async t => {
  const { settings, scope, api } = await fixture(t, { maxTasks: 20 })
  const first = api.read()
  const saved = await api.save(JSON.stringify({ applyToOfficialPresets: true, budgets: { pressureBasis: 'window', thresholdRatio: 0.8,
    retainRatio: 0.16, summaryMaxTokens: 8192, ptcTimeoutMs: 600000 } }), String(first.revision))
  assert.equal(saved.ok, true)
  assert.equal(scope.get().applyToOfficialPresets, true)
  assert.equal((settings.stored['super-code-budgets'] as Configuration).applyToOfficialPresets, true)
  assert.equal(scope.get().budgets?.summaryMaxTokens, 8192)
  assert.equal((settings.stored['super-code-budgets'] as Configuration).budgets?.ptcTimeoutMs, 600000)
  assert.deepEqual(await api.reset(String(first.revision)), { ok: false, error: 'conflict' })
  const reset = await api.reset(String(api.read().revision))
  assert.equal(reset.ok, true)
  assert.deepEqual(scope.get(), first.configuration)
  assert.deepEqual(settings.stored['super-code-budgets'], {})
})

test('invalid, over-ceiling, unavailable, read-only and failed writes preserve the prior budget', async t => {
  const { settings, scope, api } = await fixture(t)
  const revision = String(api.read().revision)
  for (const input of ['{', 'null', '{"budgets":{"retainRatio":0.9}}', '{"maxTasks":0}', '{"unexpected":true}', '{"applyToOfficialPresets":"true"}']) {
    assert.deepEqual(await api.save(input, revision), { ok: false, error: 'invalid' })
  }
  assert.deepEqual(await api.save('{"budgets":{"ptcTimeoutMs":600001}}', revision), { ok: false, error: 'ptc-ceiling' })
  assert.deepEqual(await new BudgetSettings(settings, scope, () => false).save('{"budgets":{"ptcTimeoutMs":500}}', revision), { ok: false, error: 'ptc-unavailable' })
  settings.fail = true
  assert.deepEqual(await api.save('{"maxTasks":24}', revision), { ok: false, error: 'save-failed' })
  assert.deepEqual(scope.get(), { budgets: {} })
  settings.writable = false
  assert.deepEqual(await api.save('{}', revision), { ok: false, error: 'read-only' })
  assert.deepEqual(await api.reset(revision), { ok: false, error: 'read-only' })
})

test('configuration readers provide detached creation-time snapshots without changing other settings', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const settings = new MemorySettings(ctx)
  await ctx.inject(['settings'], () => {})
  const other = settings.register('unrelated-preset', settingsConfigurationSchema, { base: { maxTasks: 11 } })
  await ctx.plugin({ apply(owner: Context) { applyBudgetSettings(owner, { maxTasks: 32 }) } })
  await ctx.inject(['superCodeBudgets'], () => {})
  const oldAgent = configurationOf(ctx)
  await settings.replace('super-code-budgets', { maxTasks: 64, budgets: { summaryMaxTokens: 2048 } })
  const newAgent = configurationOf(ctx)
  assert.deepEqual(oldAgent, { applyToOfficialPresets: false, maxTasks: 32, maxContextBytes: 32768,
    budgets: { pressureBasis: 'window', thresholdRatio: 0.8, retainRatio: 0.16,
      summaryMaxTokens: 8192, compactionRetries: 1, maxOverflowRetries: 1 } })
  assert.equal(newAgent.maxTasks, 64)
  assert.equal(newAgent.budgets?.summaryMaxTokens, 2048)
  assert.deepEqual(other.get(), { maxTasks: 11, budgets: {} })
  assert.ok(newAgent.budgets)
  ;(newAgent.budgets as { summaryMaxTokens: number }).summaryMaxTokens = 1
  assert.equal(configurationOf(ctx).budgets?.summaryMaxTokens, 2048)
})

test('legacy settings remain plain data when Schemastery supports volatile Loader fields', async t => {
  const { api } = await fixture(t, { budgets: { summaryMaxTokens: 2048 }, maxTasks: 24 })
  assert.deepEqual(api.read().configuration, { budgets: { summaryMaxTokens: 2048 }, maxTasks: 24 })
  assert.equal(settingsConfigurationSchema.dict!.budgets!.meta.volatile, undefined)
  assert.equal(configurationSchema.dict!.budgets!.meta.volatile, true)
  assert.equal((await api.save('{"maxTasks":48}', String(api.read().revision))).ok, true)
  assert.equal(api.read().configuration.maxTasks, 48)
})

test('retained presets read a separate creation-time snapshot for each Agent', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const settings = new MemorySettings(ctx)
  await ctx.inject(['settings'], () => {})
  await ctx.plugin({ apply(owner: Context) { applyBudgetSettings(owner, {}) } })
  await ctx.inject(['superCodeBudgets'], () => {})
  const first = {} as any, second = {} as any
  await settings.replace('super-code-budgets', { applyToOfficialPresets: true, maxTasks: 1, budgets: { summaryMaxTokens: 2048 } })
  ctx.emit(scopeTarget(first, first), 'agent/created', { agent: first })
  await settings.replace('super-code-budgets', { applyToOfficialPresets: false, maxTasks: 2, budgets: { summaryMaxTokens: 4096 } })
  ctx.emit(scopeTarget(second, second), 'agent/created', { agent: second })
  assert.equal(configurationOf(ctx, first).maxTasks, 1)
  assert.equal(configurationOf(ctx, first).applyToOfficialPresets, true)
  assert.equal(configurationOf(ctx, second).applyToOfficialPresets, false)
  assert.equal(configurationOf(ctx, first).budgets?.summaryMaxTokens, 2048)
  assert.equal(configurationOf(ctx, second).maxTasks, 2)
  assert.equal(configurationOf(ctx, second).budgets?.summaryMaxTokens, 4096)
  ;(configurationOf(ctx, first) as { maxTasks: number }).maxTasks = 99
  assert.equal(configurationOf(ctx, first).maxTasks, 1)
})

test('settings show actual host defaults separately from saved overrides', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new MemorySettings(ctx)
  const runtime = { timeout: { defaultMs: 150, maxMs: 600 } }
  ctx.provide('ptcRuntime', runtime)
  await ctx.plugin({ apply(owner: Context) { applyBudgetSettings(owner, { budgets: { summaryMaxTokens: 1024 } }) } })
  await ctx.inject(['superCodeBudgets'], () => {})
  const api = ctx.get('superCodeBudgets') as { readConfig(): any }
  const native = new BasicCompactionEngine(ctx.isolate('compaction'), { auto: false }).config
  const first = api.readConfig()
  assert.equal(first.defaults.applyToOfficialPresets, false)
  assert.equal(first.defaults.maxTasks, 32)
  assert.equal(first.defaults.maxContextBytes, 32768)
  assert.equal(first.defaults.budgets.summaryMaxTokens, native.maxTokens)
  assert.equal(first.defaults.budgets.thresholdRatio, native.thresholdRatio)
  assert.equal(first.defaults.budgets.retainRatio, native.retainRatio)
  assert.equal(first.defaults.budgets.compactionRetries, native.compactionRetries)
  assert.equal(first.defaults.budgets.maxOverflowRetries, native.maxOverflowRetries)
  assert.equal(first.defaults.budgets.ptcTimeoutMs, 150)
  assert.equal(first.defaults.budgets.ptcMaxTimeoutMs, 600)
  assert.equal(first.configuration.budgets.summaryMaxTokens, 1024)
  assert.equal(first.configuration.budgets.pressureBasis, 'window')
  assert.equal(first.configuration.budgets.ptcTimeoutMs, 600, 'implicit legacy deadline respects the actual host ceiling')
  assert.equal(first.configuration.budgets.ptcMaxTimeoutMs, 600)
  first.defaults.budgets.summaryMaxTokens = 1
  assert.equal(api.readConfig().defaults.budgets.summaryMaxTokens, native.maxTokens)
})

test('zero configuration uses the Pro legacy budgets before any write and reset restores them', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const settings = new MemorySettings(ctx)
  ctx.provide('ptcRuntime', { timeout: { defaultMs: 120000, maxMs: 1800000 } })
  await ctx.plugin({ apply(owner: Context) { applyBudgetSettings(owner, {}) } })
  await ctx.inject(['superCodeBudgets'], () => {})
  const api = ctx.get('superCodeBudgets') as { readConfig(): any; saveConfig(content: string, revision: string): Promise<any>; resetConfig(revision: string): Promise<any> }
  const initial = api.readConfig()
  assert.deepEqual(initial.configuration, { applyToOfficialPresets: false, maxTasks: 32, maxContextBytes: 32768,
    budgets: { pressureBasis: 'window', thresholdRatio: 0.8, retainRatio: 0.16, summaryMaxTokens: 8192,
      compactionRetries: 1, maxOverflowRetries: 1, ptcTimeoutMs: 600000, ptcMaxTimeoutMs: 600000 } })
  assert.deepEqual(settings.stored, {}, 'reading defaults never writes a user override')
  assert.equal(initial.defaults.budgets.pressureBasis, 'host')
  assert.equal(initial.defaults.budgets.ptcTimeoutMs, 120000, 'host-default hints are unchanged')
  const oldAgent = {} as any
  ctx.emit(scopeTarget(oldAgent, oldAgent), 'agent/created', { agent: oldAgent })
  assert.equal((await api.saveConfig('{"budgets":{"summaryMaxTokens":2048,"ptcMaxTimeoutMs":5000}}', String(initial.revision))).ok, true)
  const changed = api.readConfig()
  assert.equal(changed.configuration.budgets.summaryMaxTokens, 2048)
  assert.equal(changed.configuration.budgets.ptcTimeoutMs, 5000, 'an inherited deadline fits a user-configured lower ceiling')
  assert.equal(changed.configuration.budgets.pressureBasis, 'window')
  assert.deepEqual(configurationOf(ctx, oldAgent), initial.configuration)
  const newAgent = {} as any
  ctx.emit(scopeTarget(newAgent, newAgent), 'agent/created', { agent: newAgent })
  assert.equal(configurationOf(ctx, newAgent).budgets?.summaryMaxTokens, 2048)
  assert.equal((await api.resetConfig(String(changed.revision))).ok, true)
  assert.deepEqual(api.readConfig().configuration, initial.configuration)
  assert.deepEqual(settings.stored['super-code-budgets'], {})
  assert.equal(configurationOf(ctx, newAgent).budgets?.summaryMaxTokens, 2048)
})

test('legacy hosts without a PTC provider can save and reset the automatic compression budgets', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new MemorySettings(ctx)
  await ctx.plugin({ apply(owner: Context) { applyBudgetSettings(owner, { budgets: { retainRatio: 0.12 }, maxTasks: 24 }) } })
  await ctx.inject(['superCodeBudgets'], () => {})
  const api = ctx.get('superCodeBudgets') as { readConfig(): any; saveConfig(content: string, revision: string): Promise<any>; resetConfig(revision: string): Promise<any> }
  const initial = api.readConfig()
  assert.equal(initial.ptcMaxTimeoutMs, false)
  assert.equal(initial.configuration.budgets.ptcTimeoutMs, undefined)
  assert.equal(initial.configuration.budgets.ptcMaxTimeoutMs, undefined)
  assert.equal(initial.configuration.budgets.summaryMaxTokens, 8192)
  assert.equal(initial.configuration.budgets.retainRatio, 0.12, 'explicit plugin configuration takes precedence')
  initial.configuration.budgets.summaryMaxTokens = 4096
  assert.equal((await api.saveConfig(JSON.stringify(initial.configuration), String(initial.revision))).ok, true)
  assert.equal(api.readConfig().configuration.budgets.summaryMaxTokens, 4096)
  assert.equal((await api.resetConfig(String(api.readConfig().revision))).ok, true)
  assert.equal(api.readConfig().configuration.budgets.summaryMaxTokens, 8192)
  assert.equal(api.readConfig().configuration.budgets.retainRatio, 0.12)
  assert.equal(api.readConfig().configuration.maxTasks, 24)
})
