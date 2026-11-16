import { budgetDraft, skillPackageKeys } from './budgets.js'
import { icons } from '../ui/controls.js'

/** Recreate only the native Skill UI cache; Agent and input lifetimes stay owned by DSH. */
async function refreshNativeSkillMenus(ctx, plugin, signal) {
  for (const fiber of [...ctx.registry.get(plugin)?.fibers ?? []]) {
    if (signal.aborted) return
    await fiber.restart()
  }
  if (signal.aborted) return
  for (const id of Object.keys(ctx.sessions.list.getSnapshot().byId)) {
    const scope = ctx.sessions.scope(id)
    if (scope) ctx.inputTriggers.sessionOf(scope).refreshOpenMenu()
  }
}

/** Observe accepted host settings, including writes from other connected clients. */
function synchronizeSkillMenus(ctx, api, plugin, onError) {
  const lifetime = new AbortController()
  let namespace, applied = '', dirty = false, running = false
  const refresh = ns => {
    if (lifetime.signal.aborted || (ns && namespace && ns !== namespace)) return
    dirty = true
    if (running) return
    running = true
    void (async () => {
      while (dirty && !lifetime.signal.aborted) {
        dirty = false
        const response = await api.readConfig()
        if (lifetime.signal.aborted) return
        if (!response.ok) throw new Error('Skill settings could not be read')
        if (dirty) continue
        namespace = response.value.namespace
        const draft = budgetDraft(response.value.configuration)
        const next = JSON.stringify(skillPackageKeys.map(key => draft[key]))
        if (next !== applied) {
          await refreshNativeSkillMenus(ctx, plugin, lifetime.signal)
          if (lifetime.signal.aborted) return
          applied = next
        }
      }
    })().catch(error => { if (!lifetime.signal.aborted) onError(error) })
      .finally(() => { running = false; if (dirty && !lifetime.signal.aborted) refresh() })
  }
  const off = ctx.remote.$on('settings/document-updated', refresh)
  const offReset = ctx.on('connection/reset', () => { namespace = undefined; refresh() })
  refresh()
  return () => { lifetime.abort(); off(); offReset() }
}

// 只补充包名搜索；真实命令、覆盖优先级和加载仍由宿主负责。
function skillPackageSource(ctx) {
  const packages = [
    { name: 'grill-me', label: 'grill-me', directory: 'mattpocock/skills/', names: ['grill-me', 'grilling'] },
    { name: 'openspec', label: 'OpenSpec', directory: 'openspec/skills/' },
    { name: 'oil-ui', label: 'oil-ui', directory: '', names: ['oil-ui'] },
    { name: 'mattpocock', label: 'Matt Pocock Skills', directory: 'mattpocock/skills/' },
    { name: 'pstack', label: 'PStack', directory: 'pstack/dsh/skills/' },
  ]
  return {
    trigger: '/', name: 'Super Code', order: 3,
    async candidates(session, { query, signal }) {
      if (!query || signal.aborted || ctx.sessions.subagentAddress(session.sessionId) !== undefined) return []
      const matching = icons.rankByName(packages, query)
      if (!matching.length) return []
      const response = await ctx.remote.skills.list({ sessionId: session.sessionId }, signal)
      if (signal.aborted) return []
      if (!response.ok) throw new Error('Skill catalog could not be read')
      const skills = response.value.skills
      const native = new Set(icons.rankByName(skills, query).map(skill => skill.name))
      return skills.flatMap(skill => {
        if (native.has(skill.name)) return []
        const relative = skill.path?.replaceAll('\\', '/').match(/(?:^|\/)(?:skills\/dsh-super-code|builtin\/skills)\/(.+)$/i)?.[1]
        const pack = matching.find(pack => relative === `${pack.directory}${skill.name}/SKILL.md`
          && (!pack.names || pack.names.includes(skill.name)))
        return pack ? [{ name: skill.name, description: skill.description, section: pack.label }] : []
      })
    },
    onPick({ candidate }) { return { text: `/${candidate.name} ` } },
  }
}

export { refreshNativeSkillMenus, skillPackageSource, synchronizeSkillMenus }
