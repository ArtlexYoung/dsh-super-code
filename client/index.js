/* Browser entry for dsh-super-code. It deliberately uses the Harness public
 * slot and Remote faces; no DOM selectors or private React internals are used.
 *
 * The Harness client module table serves classic scripts and expects every
 * plugin artifact to register a closure factory. Keeping the small bundle
 * self-contained here also makes the published package usable outside the
 * Harness monorepo's tsdown workspace.
 */
;(globalThis.window || globalThis).__ModuleLoader__.load({ id: 'dsh-super-code', factory: (require) => {
const React = require('react')
const { useEffect, useLayoutEffect, useRef, useMemo, useState, useSyncExternalStore } = React
const icons = require('@deepseek-ai/dsh-client-ui-primitives')
// Harness 0.2 names shared artwork by weight instead of its nominal size.
const IconChevronDownOutline14 = icons.IconChevronDownOutlineRegular ?? icons.IconChevronDownOutline14
const IconRefreshOutline16 = icons.IconRefreshOutlineRegular ?? icons.IconRefreshOutline16
const { SessionEventStream } = require('@deepseek-ai/dsh-api-session-controller')

/* Shared controls use public React APIs without host-private dependencies. */
let selectControlSequence = 0
function selectControlPlacement(rect, count) {
  const margin = 8, gap = 6, width = Math.min(Math.max(rect.width, 184), window.innerWidth - margin * 2)
  const below = Math.max(0, window.innerHeight - rect.bottom - gap - margin)
  const above = Math.max(0, rect.top - gap - margin)
  const upwards = below < Math.min(count * 32 + 8, 256) && above > below
  return {
    left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)), width,
    maxHeight: Math.min(256, upwards ? above : below),
    ...(upwards ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
  }
}
function SelectControl({ id, label, value, choices, onChange, disabled = false }) {
  const identity = useRef('')
  if (!identity.current) identity.current = id || `super-code-select-${++selectControlSequence}`
  const controlId = identity.current, listId = `${controlId}-list`
  const trigger = useRef(null), menu = useRef(null), search = useRef({ text: '', at: 0 })
  const selected = Math.max(0, choices.findIndex(([choice]) => String(choice) === String(value)))
  const [open, setOpen] = useState(false), [active, setActive] = useState(selected), [placement, setPlacement] = useState({})
  const unavailable = disabled || choices.length === 0
  const show = (index = selected) => {
    if (unavailable) return
    setActive(index)
    setPlacement(selectControlPlacement(trigger.current.getBoundingClientRect(), choices.length))
    search.current = { text: '', at: 0 }
    setOpen(true)
  }
  const choose = index => {
    onChange(choices[index][0])
    setOpen(false)
    trigger.current.focus({ preventScroll: true })
  }
  useLayoutEffect(() => {
    if (!open) return
    const place = () => setPlacement(selectControlPlacement(trigger.current.getBoundingClientRect(), choices.length))
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, choices.length])
  useLayoutEffect(() => {
    if (open) menu.current.querySelector(`[data-option-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])
  useEffect(() => {
    if (!open) return
    const inside = target => Boolean(trigger.current?.contains(target) || menu.current?.contains(target))
    let pointerInside = false
    // Dock hosts focus their pane during pointer capture. Observe the pointer
    // before that focus change so an option survives until its click commits.
    const pointerDown = event => { pointerInside = inside(event.target); if (!pointerInside) setOpen(false) }
    const pointerEnd = () => { pointerInside = false }
    const outsideFocus = event => { if (!pointerInside && !inside(event.target)) setOpen(false) }
    // Capture Escape before host shortcuts; Tab keeps its normal focus movement.
    const escape = event => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopImmediatePropagation()
      setOpen(false); trigger.current.focus({ preventScroll: true })
    }
    window.addEventListener('pointerdown', pointerDown, true)
    window.addEventListener('pointerup', pointerEnd, true)
    window.addEventListener('pointercancel', pointerEnd, true)
    document.addEventListener('focusin', outsideFocus, true)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('pointerdown', pointerDown, true)
      window.removeEventListener('pointerup', pointerEnd, true)
      window.removeEventListener('pointercancel', pointerEnd, true)
      document.removeEventListener('focusin', outsideFocus, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [open])
  const keyDown = event => {
    if (unavailable || event.isComposing) return
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
        : Math.max(0, Math.min(choices.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)))
      if (open) setActive(next)
      else show(event.key === 'Home' || event.key === 'End' ? next : selected)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation()
      if (open) choose(active)
      else show()
    } else if (event.key === 'Tab') setOpen(false)
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now(), previous = now - search.current.at < 700 ? search.current.text : ''
      const query = (previous + event.key).toLocaleLowerCase()
      const next = choices.findIndex(([, text]) => String(text).toLocaleLowerCase().startsWith(query))
      if (next >= 0) {
        event.preventDefault(); event.stopPropagation()
        if (open) setActive(next)
        else show(next)
      }
      search.current = { text: query, at: now }
    }
  }
  return React.createElement('span', { className: 'dsh-super-code-select' },
    React.createElement(ActionButton, {
      ref: trigger, id: controlId, type: 'button', role: 'combobox', disabled: unavailable,
      'aria-label': label, 'aria-haspopup': 'listbox', 'aria-expanded': open, 'aria-controls': open ? listId : undefined,
      'aria-activedescendant': open ? `${listId}-${active}` : undefined, 'data-value': String(value),
      className: 'dsh-super-code-select-trigger', onKeyDown: keyDown, onClick: () => { if (open) setOpen(false); else show() },
    }, React.createElement('span', null, choices[selected]?.[1] || ''),
    React.createElement('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
      React.createElement('path', { d: 'm4 6 4 4 4-4', strokeLinecap: 'round', strokeLinejoin: 'round' }))),
    open && React.createElement('div', { ref: menu, id: listId, role: 'listbox', 'aria-label': label,
      className: 'dsh-super-code-select-menu', style: placement,
      onPointerDown: event => event.preventDefault(),
    }, choices.map(([choice, text], index) => React.createElement('div', {
      key: choice, id: `${listId}-${index}`, role: 'option', 'aria-selected': String(choice) === String(value),
      'data-value': String(choice), 'data-option-index': index, 'data-active': index === active,
      className: 'dsh-super-code-select-option', onPointerMove: () => setActive(index), onClick: () => choose(index),
    }, React.createElement('span', null, text),
    React.createElement('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
      React.createElement('path', { d: 'm3.5 8 3 3 6-6', strokeLinecap: 'round', strokeLinejoin: 'round' }))))))
}


function Glyph({ type }) {
  const paths = {
    code: 'M8 5 3 10l5 5m8-10 5 5-5 5M14 3l-4 14',
    branch: 'M5 3v8a4 4 0 0 0 4 4h6M5 7h10M5 3h0M15 4v6M15 12v6',
    memory: 'M4 3h12a2 2 0 0 1 2 2v13H6a2 2 0 0 1-2-2V3Zm0 11h14M8 7h6M8 10h4',
    search: 'M13 13l5 5M15 8a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
    folder: 'M2 6V4h6l2 2h8v10H2V6Z',
    user: 'M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 7a6 6 0 0 1 12 0',
    agent: 'm10 2 2.2 5.8L18 10l-5.8 2.2L10 18l-2.2-5.8L2 10l5.8-2.2L10 2Z',
    tool: 'm6 5-4 5 4 5m8-10 4 5-4 5M12 3 8 17',
    context: 'M3 5h14M3 10h14M3 15h9',
    error: 'M10 6v5m0 3h0M10 2l8 15H2L10 2Z',
    chevron: 'm6 8 4 4 4-4',
    arrow: 'M3 10h13m-5-5 5 5-5 5',
    fit: 'M3 7V3h4m6 0h4v4m0 6v4h-4m-6 0H3v-4',
    history: 'M3 4v5h5M3 9a7 7 0 1 1 2 6m5-10v5l3 2',
    organize: 'M8 2h4v4H8zM2 14h4v4H2zm12 0h4v4h-4zM10 6v4m-6 4v-4h12v4'
  }
  return React.createElement('svg', { className: 'dsh-super-code-glyph', viewBox: type === 'code' ? '0 0 24 20' : '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, React.createElement('path', { d: paths[type] || paths.code }))
}

function AgentMessage({ record, saved, t, toolName }) {
  const item = record.entry ? detailRecord(record.entry, t) : record
  const eventType = record.entry?.event?.type
  const kind = eventType === 'user/message' ? 'user' : eventType === 'assistant/message' ? 'agent'
    : ['user', 'agent', 'tool', 'context', 'error'].includes(item.kind) ? item.kind : 'context'
  const time = new Date(item.time).toLocaleTimeString(localeCode(t), { hour12: false })
  const label = React.createElement('div', { className: 'dsh-super-code-detail-entry-label' },
    React.createElement('span', null, item.label, toolName && !item.toolName ? ' · ' + toolName : ''), React.createElement('time', { dateTime: new Date(item.time).toISOString() }, time))
  return React.createElement('article', { className: 'dsh-super-code-detail-entry ' + kind, 'data-event-type': eventType },
    React.createElement('span', { className: 'dsh-super-code-detail-avatar', 'aria-hidden': true }, React.createElement(Glyph, { type: kind })),
    React.createElement('div', { className: 'dsh-super-code-detail-message' }, item.collapsed
      ? React.createElement('details', { open: saved.open.has(item.seq), onToggle: event => {
          if (event.currentTarget.open) saved.open.add(item.seq); else saved.open.delete(item.seq)
        } },
        React.createElement('summary', null, label, React.createElement(Glyph, { type: 'chevron' })),
        React.createElement(DetailText, { text: item.text, t }))
      : React.createElement(React.Fragment, null, label, React.createElement(DetailText, { text: item.text, t }))))
}

/* Keep the native button and its refs/events; mount name bubbles outside clipped
 * panels, or in the active dialog's top layer. No host-private UI is needed. */
let actionTooltipSequence = 0
let actionTooltipDismiss = () => {}
function actionButtonText(children) {
  return React.Children.toArray(children).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    if (!React.isValidElement(child) || child.props['aria-hidden']) return ''
    return actionButtonText(child.props.children)
  }).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}
const ActionButton = React.forwardRef(function ActionButton({ children, title, ...props }, forwardedRef) {
  const button = useRef(null), pending = useRef(0), cleanup = useRef(() => {})
  const name = props['aria-label'] || title || actionButtonText(children)
  const attach = React.useCallback(node => {
    button.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }, [forwardedRef])
  // Event procedures deliberately return no value.
  const hide = () => {
    clearTimeout(pending.current)
    pending.current = 0
    cleanup.current()
    cleanup.current = () => {}
    if (actionTooltipDismiss === hide) actionTooltipDismiss = () => {}
  }
  const show = () => {
    hide()
    actionTooltipDismiss()
    const anchor = button.current
    if (!anchor || !name) return
    const bubble = document.createElement('div'), id = `super-code-tooltip-${++actionTooltipSequence}`
    bubble.id = id
    bubble.className = 'dsh-super-code-tooltip'
    bubble.setAttribute('role', 'tooltip')
    bubble.textContent = name
    bubble.style.visibility = 'hidden'
    ;(anchor.closest('dialog[open]') || document.body).appendChild(bubble)
    const rect = anchor.getBoundingClientRect(), bounds = bubble.getBoundingClientRect(), margin = 8, gap = 8
    const left = Math.max(margin, Math.min(rect.left + rect.width / 2 - bounds.width / 2, window.innerWidth - bounds.width - margin))
    const top = Math.max(margin, rect.top - bounds.height - gap)
    bubble.dataset.side = 'top'
    bubble.style.left = left + 'px'
    bubble.style.top = top + 'px'
    bubble.style.setProperty('--sc-tooltip-arrow-left', Math.max(8, Math.min(bounds.width - 8, rect.left + rect.width / 2 - left)) + 'px')
    bubble.style.visibility = 'visible'
    anchor.setAttribute('aria-describedby', [anchor.getAttribute('aria-describedby'), id].filter(Boolean).join(' '))
    const escape = event => { if (event.key === 'Escape') hide() }
    window.addEventListener('resize', hide)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('keydown', escape, true)
    document.addEventListener('pointerdown', hide, true)
    cleanup.current = () => {
      bubble.remove()
      const remaining = (anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(value => value && value !== id).join(' ')
      if (remaining) anchor.setAttribute('aria-describedby', remaining)
      else anchor.removeAttribute('aria-describedby')
      window.removeEventListener('resize', hide)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('keydown', escape, true)
      document.removeEventListener('pointerdown', hide, true)
    }
    actionTooltipDismiss = hide
  }
  useEffect(() => { hide() }, [name])
  useEffect(() => () => hide(), [])
  return React.createElement('button', {
    ...props, ref: attach, 'data-tooltip-name': name,
    onPointerEnter: event => {
      props.onPointerEnter?.(event)
      if (event.pointerType !== 'touch') { hide(); pending.current = setTimeout(show, 250) }
    },
    onPointerLeave: event => { hide(); props.onPointerLeave?.(event) },
    onPointerCancel: event => { hide(); props.onPointerCancel?.(event) },
    onFocus: event => { props.onFocus?.(event); if (event.currentTarget.matches(':focus-visible')) show() },
    onBlur: event => { hide(); props.onBlur?.(event) },
    onKeyDown: event => { hide(); props.onKeyDown?.(event) },
  }, children)
})

const LOCALE_NS = 'dshSuperCode'
const zh = {
  'settings.presetTab': '预设状态', 'settings.contextTab': '上下文配置', 'settings.tabs': 'Super Code 配置',
  'budget.common': '通用预算', 'budget.superCode': 'Super Code 专属预算',
  'budget.applyToOfficialPresets': '同时应用到官方预设', 'budget.officialHint': '开启后，通用预算也用于标准、PTC、极简和创造模式；不包含下方的 Super Code 专属预算。',
  'budget.superCodeHint': '仅用于 Super Code 的任务记录和任务记忆，始终不影响官方预设。',
  'budget.defaultValue': '（默认：{value}）', 'budget.off': '关闭', 'budget.managed': '宿主管理',
  'budget.title': '上下文配置', 'budget.scope': '保存后对新建 Agent 生效，运行中的任务保留原配置。',
  'budget.defaults': '留空沿用默认值，括号内显示默认值；通用预算随宿主版本变化。恢复默认会清除这里的覆盖，回到插件加载配置；未配置时跟随宿主。',
  'budget.context': '上下文压缩', 'budget.execution': '批量工具执行', 'budget.advanced': '更多预算',
  'budget.pressureBasis': '压缩预算基准', 'budget.inherit': '跟随默认', 'budget.host': '宿主策略', 'budget.window': '完整上下文窗口',
  'budget.thresholdRatio': '压缩触发比例（%）', 'budget.retainRatio': '最近原文保留比例（%）', 'budget.summaryMaxTokens': '摘要输出上限（Token）',
  'budget.compactionRetries': '压缩追加尝试次数', 'budget.maxOverflowRetries': '上下文溢出重试次数',
  'budget.ptcTimeoutMs': '默认执行时限（秒）', 'budget.ptcMaxTimeoutMs': '执行时限上限（秒）',
  'budget.maxTasks': '活跃任务记录上限', 'budget.maxContextBytes': '任务记忆上下文（字节）',
  'budget.contextHint': '保留比例需小于触发比例。较大的预算会占用更多上下文。',
  'budget.ptcHint': '包含工具等待时间；默认时限不能超过上限，也不能超过宿主允许值。',
  'budget.ptcUnavailable': '此宿主的 PTC 计时由宿主管理；其他预算仍可配置。', 'budget.ptcCeiling': '宿主允许的最长时限：{seconds} 秒。',
  'budget.save': '保存预算', 'budget.reset': '恢复默认', 'budget.reload': '重新读取', 'budget.saving': '正在保存…',
  'budget.saved': '已保存，对新建 Agent 生效。', 'budget.resetDone': '已恢复默认，对新建 Agent 生效。',
  'budget.error.connection': '暂时无法读取预算，请重试。', 'budget.error.invalid': '请检查数值范围、保留比例和执行时限。',
  'budget.error.retain': '保留比例必须小于压缩触发比例；未填写时分别按 16% 和 80% 校验。', 'budget.error.ptc-order': '默认执行时限不能超过执行时限上限。',
  'budget.error.conflict': '预算已在别处修改。草稿已保留，请重新读取后再修改。', 'budget.error.read-only': '当前宿主的设置只读，无法保存。',
  'budget.error.ptc-unavailable': '此宿主不支持覆盖 PTC 总执行时限。', 'budget.error.ptc-ceiling': '执行时限超过了宿主允许的上限。',
  'budget.error.save-failed': '保存失败，草稿已保留，请重试。',
  'memory.add': '新增记忆', 'memory.edit': '编辑', 'memory.cancel': '取消', 'memory.save': '保存', 'memory.delete': '删除', 'memory.deleting': '正在删除…', 'memory.saving': '正在保存…',
  'memory.topic': '主题', 'memory.kind': '类型', 'memory.summaryLabel': '标题', 'memory.detailLabel': '内容', 'memory.manual': '手动维护',
  'memory.topicHint': '字母、数字、点、下划线或短横线，最多 96 个字符。',
  'memory.deleteTitle': '删除记忆', 'memory.deleteHint': '确定删除“{summary}”吗？删除后无法恢复。',
  'memory.writeError': '操作失败，内容已保留，请重试。', 'memory.conflict': '这条记忆已在别处更改，请取消后刷新再编辑。',
  'memory.missingEdit': '这条记忆已被删除，输入内容已保留。', 'memory.full': '该主题或记忆库已满，请删除不再需要的条目。',
  'workspace.title': 'Super Code', 'workspace.description': 'Agent 执行树与记忆库', 'workspace.resize': '调整执行树与记忆库高度',
  'tree.collapsedLabel': '已收起', 'tree.organizeLabel': '自动整理',
  'detail.toolCall': '工具调用', 'detail.toolResult': '工具结果', 'detail.toolError': '工具失败',
  'detail.cache': '缓存', 'detail.info': '详情', 'tree.countCompact': '{shown}/{total} · 运行 {running}',
  'memory.loading': '正在读取记忆…', 'memory.topics': '知识主题', 'memory.allTopics': '全部主题', 'memory.related': '同主题知识', 'preset.configuration': '预设配置',
  'memory.title': '记忆库', 'memory.project': '当前项目', 'memory.global': '全局偏好', 'memory.search': '搜索主题或记忆',
  'memory.description': '知识主题与条目',
  'memory.empty': '还没有保存的记忆。需要长期保留时，直接告诉 Agent 即可。', 'memory.noMatches': '没有匹配的记忆',
  'memory.selectSession': '先打开一个对话，查看它所在项目的记忆。', 'memory.error': '暂时无法读取记忆，请刷新重试。',
  'memory.refresh': '刷新记忆库', 'memory.count': '{count} 条记忆', 'memory.back': '返回列表', 'memory.missing': '这条记忆已删除或更新，请刷新列表。',
  'memory.historical': '历史记录，不代表当前代码仍然如此；以本次需求和实际验证为准。',
  'memory.constraint': '用户约定', 'memory.fact': '项目事实', 'memory.experience': '实践经验', 'memory.source': '来源', 'memory.version': '记录时版本',
  'memory.user': '用户消息', 'memory.tool': '工具结果', 'memory.agentUsage': '记忆使用记录', 'memory.usageHint': '只展示已记录的上下文与工具动作，不代表模型已理解或遵守。',
  'memory.usageEmpty': '尚无记忆读取记录', 'memory.context': '带入上下文', 'memory.read': '读取详情', 'memory.summary': '读取摘要',
  'memory.remember': '保存', 'memory.forget': '删除', 'memory.omitted': '仅展示最近 100 条不同动作，完整记录保留在会话中。', 'memory.open': '查看记忆库',
  'preset.title': 'Super Code 模式', 'usage.cacheUnknown': '缓存 —',
  'preset.description': '更快、更省、更聪明的编码模式。', 'preset.refresh': '刷新状态',
  'preset.state.available': '预设可用', 'preset.state.installed': '用户预设已安装', 'preset.state.conflict': '已有同名预设',
  'preset.state.missing': '尚未安装', 'preset.state.broken': '预设不可用',
  'preset.availableHint': '可在新对话中选择此预设。',
  'preset.installHint': '安装 Super Code 预设；已有内容会保留，标识符冲突时请换个标识符。',
  'preset.userConflict': '用户目录中已有相同标识符的预设，已保留。可更换标识符安装独立副本。',
  'preset.declaredHint': '此宿主通过预设声明加载 Super Code，可在此安装或确认重装。',
  'preset.declaredReadonly': '此宿主通过插件声明加载预设，但未开放管理接口。请检查插件启用状态或重启宿主。',
  'preset.state.declaredInstalled': '预设已安装',
  'preset.installDeclared': '安装预设',
  'preset.declaredNameHint': '用于识别预设，通常保留 super-code。以小写字母或数字开头，仅支持小写字母、数字和连字符，最多 64 个字符。',
  'preset.readonly': '此宿主未开放用户预设目录，无法在此安装或重装副本。',
  'preset.unavailableHint': '请检查插件是否已启用，然后重启宿主或刷新状态。',
  'preset.pluginVersion': '插件版本', 'preset.presetVersion': '当前预设版本',
  'preset.versionUnknown': '未记录版本', 'preset.versionMissing': '未安装',
  'preset.versionMatches': '预设版本与当前插件一致。',
  'preset.versionMismatch': '预设版本与当前插件版本不一致。',
  'preset.versionUnknownHint': '此预设未记录版本，无法确认是否与当前插件一致。',
  'preset.versionReinstallHint': '如需更新预设，请先保留自定义内容，再确认重新安装。',
  'preset.versionReloadHint': '请确认插件更新已生效，重启宿主后刷新状态；若仍不一致，请重新安装插件。',
  'preset.displayName': '显示名称', 'preset.displayNameHint': '支持中文和空格，最多 120 个字符，例如 Super Code 模式。', 'preset.name': '预设标识符', 'preset.nameHint': '用于安装目录，通常保留 super-code 即可。以小写字母或数字开头，仅含小写字母、数字和连字符，最多 64 个字符。',
  'preset.confirmTitle': '确认重新安装预设',
  'preset.confirmHint': '以下是通过本插件安装的预设，将会被移除并按照新名称重新安装，旧内容会保留恢复备份。对于需要保留的预设可以手动在列表中移除。',
  'preset.confirmEmpty': '没有需要重装的预设。', 'preset.remove': '从列表移除', 'preset.cancel': '取消', 'preset.confirm': '确认重装',
  'preset.reinstall': '重新安装预设', 'preset.reinstallHint': '使用下方名称和标识符重新安装，移除旧预设并保留恢复备份。',
  'preset.error.ownership-unverified': '无法确认旧预设归属（可能来自旧版本或目录已被替换），未删除任何预设。',
  'preset.install': '安装用户预设', 'preset.working': '处理中…',
  'preset.error.invalid-name': '标识符须以小写字母或数字开头，仅含小写字母、数字和连字符，最多 64 个字符。',
  'preset.error.invalid-display-name': '显示名称不能为空或全为空格，最多 120 个字符；支持中文和空格。',
  'preset.error.name-taken': '该标识符已被占用，原预设未改动。请更换标识符。',
  'preset.error.no-user-root': '此宿主没有可写的用户预设目录。',
  'preset.error.management-unavailable': '此宿主未开放预设管理接口，请检查插件启用状态或重启宿主。',
  'preset.error.install-failed': '安装未完成，已尝试恢复原配置。请检查写入权限和宿主日志后重试。',
  'preset.error.connection': '暂时无法读取预设状态，请刷新重试。',
  'task.memory': '任务档案', 'task.other': '其他任务', 'task.history': '任务记录',
  'status.active': '进行中', 'status.paused': '已暂停', 'status.completed': '已完成', 'status.cancelled': '已取消',
  'next': '下一步：', 'tree.title': '协作执行', 'tree.count': '显示 {shown} / {total} · 运行中 {running}',
  'tree.refresh': '刷新执行记录', 'tree.legend.active': '运行中', 'tree.legend.idle': '待命', 'tree.legend.stopped': '已停止', 'tree.legend.unavailable': '记录不可用',
  'tree.empty': '暂无会话', 'tree.zoom.out': '缩小节点图', 'tree.zoom.in': '放大节点图', 'tree.fit': '适应窗口',
  'tree.organize': '自动整理', 'tree.collapsed': '已收起 {count}', 'tree.more': '显示更多', 'tree.canvas': '拖动平移，滚轮缩放，双击空白适应窗口',
  'tree.aria': 'Agent 执行树', 'tree.status': '状态颜色', 'tree.usage': '本节点及所有已知下级合计，包含本节点。{partial}Token {tokens}；缓存读取 {cache}；{agents} 个 Agent',
  'usage.unknown': '用量 —', 'usage.cache': '缓存 {value}%', 'usage.partial': '部分', 'usage.incomplete': '部分记录或用量尚不可用；仅显示已知值。',
  'history.aria': '已收起的 Agent', 'history.search': '搜索 Agent 或上级任务', 'history.find': '查找收起的 Agent', 'history.created': '创建时间', 'history.sort': '排序',
  'history.all': '全部时间', 'history.today': '今天', 'history.week': '近 7 天', 'history.month': '近 30 天', 'history.custom': '自定义', 'history.latest': '最新创建', 'history.earliest': '最早创建', 'history.tokensHigh': 'Token 从多到少', 'history.tokensLow': 'Token 从少到多', 'history.titleAsc': '标题正序', 'history.titleDesc': '标题倒序',
  'history.start': '开始日期', 'history.end': '结束日期', 'history.summary': '{shown} / {total} 个已收起节点 · Token 含下级', 'history.invalid': '请选择有效的起止日期', 'history.empty': '没有匹配的节点', 'history.view': '查看 {title} 的详情', 'history.unknownTime': '时间未知', 'history.unknownUsage': '用量未知',
  'detail.path': 'Agent 路径', 'detail.title': 'Agent 详情', 'detail.refresh': '刷新对话详情', 'detail.task': '任务', 'detail.agent': 'Agent', 'detail.interrupted': 'Agent · 已中断', 'detail.error': '执行错误', 'detail.incomplete': '执行未完成，请稍后重试。', 'detail.input': '输入', 'detail.output': '输出', 'detail.cacheRead': '缓存读取', 'detail.cacheWrite': '缓存写入', 'detail.total': 'Token 总量', 'detail.hitRate': '缓存命中率', 'detail.moreUsage': '用量详情', 'detail.unavailable': '未提供', 'detail.reading': '正在读取对话…', 'detail.read': '读取中…', 'detail.older': '加载更早记录', 'detail.latest': '回到最新', 'detail.empty': '暂无执行内容', 'detail.new': '有新内容 · 查看最新', 'detail.loadError': '对话详情读取失败', 'detail.connection': '连接中断，正在重连', 'detail.historyError': '历史记录读取失败', 'detail.open': '展开全文', 'detail.noAccess': '无法打开详情，请重试', 'tree.loadError': '部分执行记录读取失败，请刷新重试', 'detail.unknown': '用量未知', 'main.agent': '主 Agent', 'tree.open': '点击查看详情', 'tree.expand': '展开', 'tree.collapse': '收起', 'image': '[图片]'
}
const en = {
  'settings.presetTab': 'Preset status', 'settings.contextTab': 'Context settings', 'settings.tabs': 'Super Code settings',
  'budget.common': 'Common budgets', 'budget.superCode': 'Super Code budgets',
  'budget.applyToOfficialPresets': 'Also apply to official presets', 'budget.officialHint': 'Apply common budgets to Standard, PTC, Minimal and Create. Super Code task and memory limits below remain exclusive to Super Code.',
  'budget.superCodeHint': 'Task records and task memory for Super Code. These limits never affect official presets.',
  'budget.defaultValue': '(default: {value})', 'budget.off': 'off', 'budget.managed': 'host-managed',
  'budget.title': 'Context settings', 'budget.scope': 'Changes apply to new Agents. Running tasks keep their current settings.',
  'budget.defaults': 'Leave fields blank to inherit defaults. Parentheses show defaults; common budgets follow the host version. Reset clears overrides and restores the plugin configuration, or host defaults when unconfigured.',
  'budget.context': 'Context compression', 'budget.execution': 'Batched tool execution', 'budget.advanced': 'More budgets',
  'budget.pressureBasis': 'Compression budget basis', 'budget.inherit': 'Inherit default', 'budget.host': 'Host policy', 'budget.window': 'Full context window',
  'budget.thresholdRatio': 'Compress at (%)', 'budget.retainRatio': 'Keep recent context (%)', 'budget.summaryMaxTokens': 'Summary output limit (tokens)',
  'budget.compactionRetries': 'Additional compression attempts', 'budget.maxOverflowRetries': 'Context overflow retries',
  'budget.ptcTimeoutMs': 'Default deadline (seconds)', 'budget.ptcMaxTimeoutMs': 'Maximum deadline (seconds)',
  'budget.maxTasks': 'Active task record limit', 'budget.maxContextBytes': 'Task-memory context (bytes)',
  'budget.contextHint': 'Retention must be below the compression threshold. Larger budgets use more context.',
  'budget.ptcHint': 'Includes tool waits. The default deadline must fit within both the configured maximum and the host ceiling.',
  'budget.ptcUnavailable': 'This host manages PTC timing. Other budgets remain configurable.', 'budget.ptcCeiling': 'Host deadline ceiling: {seconds} seconds.',
  'budget.save': 'Save budgets', 'budget.reset': 'Reset to defaults', 'budget.reload': 'Reload settings', 'budget.saving': 'Saving…',
  'budget.saved': 'Saved. New Agents will use these settings.', 'budget.resetDone': 'Defaults restored for new Agents.',
  'budget.error.connection': 'Budgets could not be loaded. Try again.', 'budget.error.invalid': 'Check the ranges, retention ratio, and deadlines.',
  'budget.error.retain': 'Retention must be below the compression threshold. Blank values are checked as 16% and 80%, respectively.', 'budget.error.ptc-order': 'The default deadline must not exceed the maximum deadline.',
  'budget.error.conflict': 'Budgets changed elsewhere. Your draft is retained; reload before editing again.', 'budget.error.read-only': 'This host has read-only settings.',
  'budget.error.ptc-unavailable': 'This host cannot override PTC elapsed deadlines.', 'budget.error.ptc-ceiling': 'The deadline exceeds the host ceiling.',
  'budget.error.save-failed': 'Save failed. Your draft is retained; try again.',
  'memory.add': 'Add memory', 'memory.edit': 'Edit', 'memory.cancel': 'Cancel', 'memory.save': 'Save', 'memory.delete': 'Delete', 'memory.deleting': 'Deleting…', 'memory.saving': 'Saving…',
  'memory.topic': 'Topic', 'memory.kind': 'Type', 'memory.summaryLabel': 'Title', 'memory.detailLabel': 'Content', 'memory.manual': 'Manually maintained',
  'memory.topicHint': 'Letters, digits, dots, underscores or hyphens; up to 96 characters.',
  'memory.deleteTitle': 'Delete memory', 'memory.deleteHint': 'Delete “{summary}”? This cannot be undone.',
  'memory.writeError': 'The operation failed. Your input is retained; try again.', 'memory.conflict': 'This memory changed elsewhere. Cancel and refresh before editing again.',
  'memory.missingEdit': 'This memory was deleted. Your input is retained.', 'memory.full': 'This topic or library is full. Remove entries you no longer need.',
  'workspace.title': 'Super Code', 'workspace.description': 'Agent tree and memory library', 'workspace.resize': 'Resize agent tree and memory library',
  'tree.collapsedLabel': 'Collapsed', 'tree.organizeLabel': 'Organize',
  'detail.toolCall': 'Tool call', 'detail.toolResult': 'Tool result', 'detail.toolError': 'Tool failed',
  'detail.cache': 'Cache', 'detail.info': 'Details', 'tree.countCompact': '{shown}/{total} · Running {running}',
  'memory.loading': 'Loading memories…', 'memory.topics': 'Knowledge topics', 'memory.allTopics': 'All topics', 'memory.related': 'More in this topic', 'preset.configuration': 'Preset configuration',
  'memory.title': 'Memory library', 'memory.project': 'This project', 'memory.global': 'Global preferences', 'memory.search': 'Search topics or memories',
  'memory.description': 'Knowledge topics and entries',
  'memory.empty': 'No saved memories yet. Tell the agent when something is worth keeping.', 'memory.noMatches': 'No matching memories',
  'memory.selectSession': 'Open a conversation to view memory for its project.', 'memory.error': 'Memory is unavailable. Refresh to try again.',
  'memory.refresh': 'Refresh memory', 'memory.count': '{count} memories', 'memory.back': 'Back to list', 'memory.missing': 'This memory was removed or changed. Refresh the list.',
  'memory.historical': 'A historical record, not proof of the current code. Follow the current request and verify changing facts.',
  'memory.constraint': 'User agreement', 'memory.fact': 'Project fact', 'memory.experience': 'Experience', 'memory.source': 'Source', 'memory.version': 'Recorded version',
  'memory.user': 'User message', 'memory.tool': 'Tool result', 'memory.agentUsage': 'Memory activity', 'memory.usageHint': 'Recorded context and tool actions only; not proof the model understood or followed them.',
  'memory.usageEmpty': 'No memory reads recorded yet', 'memory.context': 'Added to context', 'memory.read': 'Read details', 'memory.summary': 'Read summary',
  'memory.remember': 'Saved', 'memory.forget': 'Removed', 'memory.omitted': 'Showing the latest 100 distinct actions. Full records remain in the conversation.', 'memory.open': 'Open memory library',
  'preset.title': 'Super Code', 'usage.cacheUnknown': 'Cache —',
  'preset.description': 'A faster, more efficient, smarter coding mode.', 'preset.refresh': 'Refresh status',
  'preset.state.available': 'Preset available', 'preset.state.installed': 'User preset installed', 'preset.state.conflict': 'Preset name already exists',
  'preset.state.missing': 'Not installed', 'preset.state.broken': 'Preset unavailable',
  'preset.availableHint': 'Select this preset in a new conversation.',
  'preset.installHint': 'Install the Super Code preset. Existing content is preserved; choose another identifier if it is taken.',
  'preset.userConflict': 'A user preset with this identifier already exists and was preserved. Choose another identifier for a separate copy.',
  'preset.declaredHint': 'This host loads Super Code through a preset declaration. You can install it here or confirm reinstallation.',
  'preset.declaredReadonly': 'This host loads plugin preset declarations but does not expose preset management. Check plugin activation or restart the host.',
  'preset.state.declaredInstalled': 'Preset installed',
  'preset.installDeclared': 'Install preset',
  'preset.declaredNameHint': 'Identifies the preset; usually keep super-code. Start with a lowercase letter or digit; use only lowercase letters, digits and hyphens, up to 64 characters.',
  'preset.readonly': 'This host does not expose a user preset directory for installing or reinstalling copies.',
  'preset.unavailableHint': 'Check that the plugin is enabled, then restart the host or refresh the status.',
  'preset.pluginVersion': 'Plugin version', 'preset.presetVersion': 'Current preset version',
  'preset.versionUnknown': 'Version not recorded', 'preset.versionMissing': 'Not installed',
  'preset.versionMatches': 'The preset version matches the installed plugin.',
  'preset.versionMismatch': 'The preset version differs from the installed plugin.',
  'preset.versionUnknownHint': 'This preset has no recorded version, so its version cannot be compared with the installed plugin.',
  'preset.versionReinstallHint': 'To update the preset, save any custom content, then confirm reinstallation.',
  'preset.versionReloadHint': 'Check that the plugin update has taken effect, restart the host and refresh the status. If the versions still differ, reinstall the plugin.',
  'preset.displayName': 'Display name', 'preset.displayNameHint': 'Supports Chinese characters and spaces, up to 120 characters, e.g. Super Code 模式.', 'preset.name': 'Preset identifier', 'preset.nameHint': 'Used for the installation directory; usually keep super-code. Start with a lowercase letter or digit; use only lowercase letters, digits and hyphens, up to 64 characters.',
  'preset.confirmTitle': 'Confirm preset reinstallation',
  'preset.confirmHint': 'These presets were installed by this plugin. They will be removed and reinstalled with the new names shown, and recovery backups will be kept. Remove any preset you want to keep from the list.',
  'preset.confirmEmpty': 'No presets selected for reinstallation.', 'preset.remove': 'Remove from list', 'preset.cancel': 'Cancel', 'preset.confirm': 'Confirm reinstall',
  'preset.reinstall': 'Reinstall preset', 'preset.reinstallHint': 'Reinstall with the name and identifier below, removing the old preset and keeping a recovery backup.',
  'preset.error.ownership-unverified': 'Cannot verify ownership of the old preset (it may come from an older version or a replaced directory). No presets were deleted.',
  'preset.install': 'Install user preset', 'preset.working': 'Working…',
  'preset.error.invalid-name': 'The identifier must start with a lowercase letter or digit and contain only lowercase letters, digits and hyphens, up to 64 characters.',
  'preset.error.invalid-display-name': 'The display name cannot be empty or whitespace-only and must be at most 120 characters. Chinese characters and spaces are supported.',
  'preset.error.name-taken': 'This identifier is taken. The existing preset was preserved. Choose another identifier.',
  'preset.error.no-user-root': 'This host has no writable user preset directory.',
  'preset.error.management-unavailable': 'This host does not expose preset management. Check plugin activation or restart the host.',
  'preset.error.install-failed': 'Installation failed and restoration of the original configuration was attempted. Check write permissions and host logs, then retry.',
  'preset.error.connection': 'Preset status is unavailable. Refresh to try again.',
  'task.memory': 'Task memory', 'task.other': 'Other tasks', 'task.history': 'Task history',
  'status.active': 'Active', 'status.paused': 'Paused', 'status.completed': 'Completed', 'status.cancelled': 'Cancelled', 'next': 'Next: ',
  'tree.title': 'Collaborative execution', 'tree.count': 'Showing {shown} / {total} · Running {running}', 'tree.refresh': 'Refresh execution records', 'tree.legend.active': 'Running', 'tree.legend.idle': 'Idle', 'tree.legend.stopped': 'Stopped', 'tree.legend.unavailable': 'Unavailable', 'tree.empty': 'No sessions', 'tree.zoom.out': 'Zoom out', 'tree.zoom.in': 'Zoom in', 'tree.fit': 'Fit to window', 'tree.organize': 'Organize automatically', 'tree.collapsed': '{count} collapsed', 'tree.more': 'Show more', 'tree.canvas': 'Drag to pan, scroll to zoom, double-click empty space to fit', 'tree.aria': 'Agent execution tree', 'tree.status': 'Status colors', 'tree.usage': 'This node and all known descendants. {partial}Tokens {tokens}; cache reads {cache}; {agents} agents', 'usage.unknown': 'Usage —', 'usage.cache': 'Cache {value}%', 'usage.partial': 'partial', 'usage.incomplete': 'Some records or usage are unavailable; showing known values only.',
  'history.aria': 'Collapsed agents', 'history.search': 'Search agents or parent tasks', 'history.find': 'Find collapsed agents', 'history.created': 'Created', 'history.sort': 'Sort', 'history.all': 'All time', 'history.today': 'Today', 'history.week': 'Last 7 days', 'history.month': 'Last 30 days', 'history.custom': 'Custom', 'history.latest': 'Newest first', 'history.earliest': 'Oldest first', 'history.tokensHigh': 'Most tokens first', 'history.tokensLow': 'Fewest tokens first', 'history.titleAsc': 'Title A–Z', 'history.titleDesc': 'Title Z–A', 'history.start': 'Start date', 'history.end': 'End date', 'history.summary': '{shown} / {total} collapsed nodes · Includes descendants', 'history.invalid': 'Choose a valid date range', 'history.empty': 'No matching nodes', 'history.view': 'View details for {title}', 'history.unknownTime': 'Unknown time', 'history.unknownUsage': 'Usage unknown',
  'detail.path': 'Agent path', 'detail.title': 'Agent details', 'detail.refresh': 'Refresh conversation details', 'detail.task': 'Task', 'detail.agent': 'Agent', 'detail.interrupted': 'Agent · Interrupted', 'detail.error': 'Execution error', 'detail.incomplete': 'Execution did not finish. Try again later.', 'detail.input': 'Input', 'detail.output': 'Output', 'detail.cacheRead': 'Cache reads', 'detail.cacheWrite': 'Cache writes', 'detail.total': 'Total tokens', 'detail.hitRate': 'Cache hit rate', 'detail.moreUsage': 'Usage details', 'detail.unavailable': 'Unavailable', 'detail.reading': 'Reading conversation…', 'detail.read': 'Reading…', 'detail.older': 'Load earlier records', 'detail.latest': 'Back to latest', 'detail.empty': 'No execution content', 'detail.new': 'New content · View latest', 'detail.loadError': 'Could not read conversation details', 'detail.connection': 'Connection interrupted, reconnecting', 'detail.historyError': 'Could not read history', 'detail.open': 'Expand', 'detail.noAccess': 'Could not open details. Try again.', 'tree.loadError': 'Some execution records failed to load. Refresh to retry.', 'detail.unknown': 'Usage unknown', 'main.agent': 'Main agent', 'tree.open': 'Click to view details', 'tree.expand': 'Expand', 'tree.collapse': 'Collapse', 'image': '[Image]'
}
function formatText(template, values = {}) { return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '') }
function text(t, key, values) { return formatText(t(key), values) }
function localeCode(t) { return text(t, 'status.active') === en['status.active'] ? 'en-US' : 'zh-CN' }

// The registry captures a fallback title when a tab opens. Title slots receive
// live locale updates, including for tabs whose bodies are not currently shown.
function LocalizedTabTitle({ titleKey, t }) { return t(titleKey) }

function agentTabTitle(state, address, t) {
  const target = agentDetailTarget(address), id = target.childSessionId || target.sessionId
  const node = buildAgentView(agentSessionState(state, id)).nodes.get(id)
  return node?.title || node?.displayTitle || t('detail.title')
}

function AgentDetailTitle({ useTabInfo, useSessions, t }) {
  const { tab } = useTabInfo(), state = useSessions(value => value)
  return agentTabTitle(state, tab.contentId, t)
}

function TaskMemoryPanel({ state, t = key => zh[key] || key }) {
  const tasks = state?.tasks || []
  if (!tasks.length) return null
  const current = state.current?.kind === 'task' ? state.current : undefined
  const labels = { active: text(t, 'status.active'), paused: text(t, 'status.paused'), completed: text(t, 'status.completed'), cancelled: text(t, 'status.cancelled') }
  return React.createElement('section', { className: 'dsh-super-code-task-memory', 'aria-label': text(t, 'task.memory') },
    current && React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'dsh-super-code-task-heading' },
        React.createElement('strong', null, current.title),
        React.createElement('span', null, labels[current.status] || current.status)),
      current.goal && React.createElement('p', null, current.goal),
      current.next && React.createElement('p', null, text(t, 'next'), current.next)),
    tasks.some(task => task.id !== current?.id) && React.createElement('details', null,
      React.createElement('summary', null, current ? text(t, 'task.other') : text(t, 'task.history')),
      React.createElement('ul', null, tasks.filter(task => task.id !== current?.id).map(task => React.createElement('li', { key: task.id }, `${task.title} · ${labels[task.status] || task.status}`)))),
  )
}

/** Normalize the two published host catalog shapes, without opening Agents. */
function agentSessionState(state, sessionId, statuses) {
  const current = sessionId || state.current
  if (state.subagentsByParent) return { ...state, current }
  const snapshots = state.projectionsBySession || {}, byId = { ...state.byId }, catalogs = {}
  for (const [id, snapshot] of Object.entries(snapshots)) {
    byId[id] = { ...byId[id], id, projectionValues: snapshot.values,
      running: statuses?.get(id)?.running ?? byId[id]?.running }
  }
  for (const [parentId, snapshot] of Object.entries(snapshots)) {
    const entries = snapshot.values.subagentCatalog || []
    catalogs[parentId] = { state: snapshot.state === 'idle' ? snapshot.values.subagentCatalog === undefined ? 'loading' : 'ready' : snapshot.state,
      entries: entries.map(entry => {
        const child = byId[entry.id], children = snapshots[entry.id]?.values.subagentCatalog
        const running = statuses?.get(entry.id)?.running ?? child?.running
        return { ...entry, hasChildren: children === undefined || children.length > 0,
          kind: entry.mode === 'unknown' ? 'diagnostic' : 'child',
          ...(typeof running === 'boolean' ? { activity: running ? 'running' : 'inactive' } : {}) }
      }) }
  }
  return { ...state, current, byId, subagentsByParent: catalogs }
}

/** Join host catalogs without leaking agents from unrelated conversations. */
function buildAgentView(state) {
  const nodes = new Map(Object.values(state.byId || {}).map(node => [node.id, { ...node }]))
  for (const [parentId, catalog] of Object.entries(state.subagentsByParent || {})) {
    // Navigation rows omit timestamps; the parent's public projection retains them.
    const created = new Map((nodes.get(parentId)?.projectionValues?.subagentCatalog || []).map(entry => [entry.id, entry.createdAt]))
    for (const entry of catalog?.entries || []) {
      const summary = nodes.get(entry.id)
      nodes.set(entry.id, { ...summary, id: entry.id, parentId,
        title: entry.label || summary?.title || summary?.displayTitle || entry.id,
        mode: entry.mode, hasChildren: entry.hasChildren, createdAt: created.get(entry.id),
        running: summary?.running ?? (entry.activity === undefined ? undefined : entry.activity === 'running'),
        unavailable: entry.kind === 'diagnostic',
      })
    }
  }
  if (!state.current) return { root: '', nodes: new Map(), children: new Map(), ancestors: new Set() }
  if (state.currentAddress && !nodes.get(state.current)?.parentId) {
    nodes.set(state.current, { ...nodes.get(state.current), id: state.current,
      parentId: state.currentAddress.parentSessionId, mode: state.currentAddress.mode })
  }
  let root = state.current
  const ancestors = new Set()
  while (!ancestors.has(root)) {
    ancestors.add(root)
    if (!nodes.has(root)) nodes.set(root, { id: root, title: root })
    const parent = nodes.get(root).parentId
    if (!parent || ancestors.has(parent)) break
    root = parent
  }
  const children = new Map()
  for (const node of nodes.values()) {
    if (!children.has(node.parentId)) children.set(node.parentId, [])
    children.get(node.parentId).push(node.id)
  }
  // The public catalog is ordered by creation time; summary insertion order is not.
  for (const [parent, catalog] of Object.entries(state.subagentsByParent || {})) {
    const rank = new Map((catalog.entries || []).map((entry, index) => [entry.id, index]))
    children.get(parent)?.sort((a, b) => (rank.get(a) ?? -1) - (rank.get(b) ?? -1))
  }
  const reachable = new Map(), pending = [root]
  while (pending.length) {
    const id = pending.pop()
    if (reachable.has(id)) continue
    reachable.set(id, nodes.get(id))
    for (const child of children.get(id) || []) pending.push(child)
  }
  return { root, nodes: reachable, children, ancestors }
}

/** Iterative traversal bounds rendered rows even for long-running sessions. */
function visibleAgentRows(view, expanded, limit) {
  const rows = [], seen = new Set(), stack = view.root ? [{ id: view.root, level: 1 }] : []
  while (stack.length && rows.length < limit) {
    const row = stack.pop()
    if (seen.has(row.id)) continue
    seen.add(row.id)
    rows.push(row)
    if (expanded(row.id)) {
      const children = view.children.get(row.id) || []
      for (let i = children.length - 1; i >= 0; i--) stack.push({ id: children[i], level: row.level + 1 })
    }
  }
  return { rows, more: stack.length > 0 }
}

/** Presentation only: never archive sessions or discard usage/history. */
function agentTreeDisplay(view, catalogs = {}, options = {}) {
  const expanded = options.expanded || new Set(), collapsed = options.collapsed || new Set()
  const recent = options.compact ? 2 : 4
  const all = visibleAgentRows(view, () => true, view.nodes.size).rows
  const levels = new Map(all.map(row => [row.id, row.level])), required = new Set(view.ancestors)
  if (options.focused) required.add(options.focused)
  const children = new Map()
  for (let index = all.length - 1; index >= 0; index--) {
    const { id, level } = all[index], node = view.nodes.get(id)
    const original = (view.children.get(id) || []).filter(child => levels.get(child) === level + 1)
    const unknownChildren = node.hasChildren && catalogs[id]?.state !== 'ready'
    if (node.running !== false || node.unavailable || unknownChildren || original.some(child => required.has(child))) required.add(id)
    const deep = level >= 2 && !expanded.has(id)
    const keep = collapsed.has(id) || deep ? new Set() : new Set(original.slice(-recent))
    const visible = original.filter(child => required.has(child) || (!collapsed.has(id) && (expanded.has(id) || keep.has(child))))
    children.set(id, visible)
  }
  const display = { ...view, children }
  const shown = new Set(visibleAgentRows(display, () => true, view.nodes.size).rows.map(row => row.id))
  return { view: display, hidden: all.filter(row => !shown.has(row.id)).map(row => row.id) }
}

function agentTreeTotals(view, catalogs = {}) {
  const totals = new Map(), order = [], parents = new Map(), seen = new Set(), pending = view.root ? [view.root] : []
  while (pending.length) {
    const id = pending.pop()
    if (seen.has(id)) continue
    seen.add(id); order.push(id)
    for (const child of view.children.get(id) || []) {
      if (!seen.has(child) && !parents.has(child)) { parents.set(child, id); pending.push(child) }
    }
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i], node = view.nodes.get(id), projections = node.projectionValues || {}
    const usage = projections.superAgentUsage?.totals || projections.tokenUsage
    const input = usage ? (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0) : 0
    const total = totals.get(id) || { agents: 0, tokens: 0, cache: 0, input: 0, known: 0, partial: false }
    total.agents++; total.tokens += input + (usage?.outputTokens || 0); total.cache += usage?.cacheReadTokens || 0; total.input += input
    if (usage) total.known++
    if (node.unavailable || ((id === view.root || node.hasChildren) && catalogs[id]?.state !== 'ready')) total.partial = true
    totals.set(id, total)
    const parent = parents.get(id)
    if (parent && parent !== id) {
      const sum = totals.get(parent) || { agents: 0, tokens: 0, cache: 0, input: 0, known: 0, partial: false }
      for (const key of ['agents', 'tokens', 'cache', 'input', 'known']) sum[key] += total[key]
      sum.partial ||= total.partial
      totals.set(parent, sum)
    }
  }
  return totals
}

const historyRowHeight = 56

function agentHistoryRange(range, from = '', to = '', now = Date.now()) {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const parse = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
    const [year, month, day] = value.split('-').map(Number), date = new Date(year, month - 1, day)
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date.getTime() : NaN
  }
  let start = -Infinity, end = Infinity
  if (range === 'custom') {
    start = from ? parse(from) : -Infinity
    if (to) { const date = new Date(parse(to)); date.setDate(date.getDate() + 1); end = date.getTime() }
  } else if (range !== 'all') {
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    today.setDate(today.getDate() - ({ today: 0, week: 6, month: 29 }[range] ?? 0))
    start = today.getTime(); end = tomorrow.getTime()
  }
  return { start, end, valid: !Number.isNaN(start) && !Number.isNaN(end) && start < end }
}

function agentHistoryRows(view, hidden, totals, options = {}) {
  const historyCollator = new Intl.Collator(localeCode(options.t || (key => zh[key] || key)), { numeric: true, sensitivity: 'base' })
  const query = (options.query || '').trim().toLocaleLowerCase()
  const range = agentHistoryRange(options.range || 'all', options.from, options.to, options.now)
  if (!range.valid) return []
  const rows = []
  for (const id of hidden) {
    const node = view.nodes.get(id), title = node.title || node.displayTitle || id
    const parent = view.nodes.get(node.parentId)?.title || text(options.t || (key => zh[key] || key), 'main.agent'), usage = totals.get(id)
    const time = Number.isFinite(node.createdAt) && node.createdAt >= 0 && node.createdAt <= 8640000000000000 ? node.createdAt : -1
    if (query && !`${title} ${parent}`.toLocaleLowerCase().includes(query)) continue
    if (options.range && options.range !== 'all' && (time < 0 || time < range.start || time >= range.end)) continue
    rows.push({ id, node, title, parent, time, tokens: usage?.known ? usage.tokens : -1, partial: !!usage && (usage.partial || usage.known < usage.agents) })
  }
  const [field, direction] = (options.sort || 'time-desc').split('-'), sign = direction === 'asc' ? 1 : -1
  return rows.sort((a, b) => {
    let comparison
    if (field === 'title') comparison = historyCollator.compare(a.title, b.title)
    else {
      const left = field === 'tokens' ? a.tokens : a.time, right = field === 'tokens' ? b.tokens : b.time
      // Missing metadata stays last in either direction, never masquerades as zero.
      if ((left < 0) !== (right < 0)) return left < 0 ? 1 : -1
      comparison = left - right
    }
    return comparison * sign || historyCollator.compare(a.title, b.title) || a.id.localeCompare(b.id)
  })
}

function agentHistoryWindow(count, scrollTop, height) {
  const top = Math.max(0, Math.min(scrollTop, Math.max(0, count * historyRowHeight - height)))
  return { top, start: Math.max(0, Math.floor(top / historyRowHeight) - 3),
    end: Math.min(count, Math.ceil((top + height) / historyRowHeight) + 3), height: count * historyRowHeight }
}

/** Local scroll state keeps the graph out of the scrolling render path. */
function AgentHistory({ view, hidden, totals, open, saved, t = key => zh[key] || key }) {
  const [filters, setFilters] = useState(saved.historyFilters || { query: '', range: 'all', from: '', to: '', sort: 'time-desc' })
  const [scroll, setScroll] = useState({ top: saved.historyTop || 0, height: 168 })
  const previousFilters = useRef(filters)
  const viewport = useRef(null), focusTarget = useRef('')
  const records = useMemo(() => agentHistoryRows(view, hidden, totals, { ...filters, t }), [view, hidden, totals, filters, t])
  const language = localeCode(t)
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(language, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), [language])
  const window = agentHistoryWindow(records.length, scroll.top, scroll.height)
  const range = agentHistoryRange(filters.range, filters.from, filters.to)
  const change = (key, value) => setFilters(previous => ({ ...previous, [key]: value }))
  useLayoutEffect(() => {
    saved.historyFilters = filters
    if (previousFilters.current !== filters) {
      viewport.current.scrollTop = 0; saved.historyTop = 0
      setScroll(previous => ({ ...previous, top: 0 }))
    }
    previousFilters.current = filters
  }, [filters, saved])
  useLayoutEffect(() => {
    const element = viewport.current
    const measure = () => setScroll(previous => previous.top === element.scrollTop && previous.height === element.clientHeight
      ? previous : { top: element.scrollTop, height: element.clientHeight })
    element.scrollTop = saved.historyTop || 0
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    viewport.current.scrollTop = window.top; saved.historyTop = window.top
    if (focusTarget.current) {
      const target = Array.from(viewport.current.querySelectorAll('button')).find(button => button.dataset.historyId === focusTarget.current)
      if (target) { target.focus({ preventScroll: true }); focusTarget.current = '' }
    }
  }, [window.top, window.start, window.end, records, scroll])
  const keyDown = (event, index) => {
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: records.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const target = Math.max(0, Math.min(records.length - 1, next)), element = viewport.current
    focusTarget.current = records[target].id
    if (target * historyRowHeight < element.scrollTop) element.scrollTop = target * historyRowHeight
    else if ((target + 1) * historyRowHeight > element.scrollTop + element.clientHeight) element.scrollTop = (target + 1) * historyRowHeight - element.clientHeight
    setScroll({ top: element.scrollTop, height: element.clientHeight })
  }
  const select = (key, label, choices) => React.createElement('div', { className: 'dsh-super-code-select-field' },
    React.createElement('label', { htmlFor: 'super-code-history-' + key }, label),
    React.createElement(SelectControl, { id: 'super-code-history-' + key, label, value: filters[key], choices, onChange: value => change(key, value) }))
  return React.createElement('section', { className: 'dsh-super-code-history', 'aria-label': text(t, 'history.aria') },
    React.createElement('input', { type: 'search', value: filters.query, 'aria-label': text(t, 'history.find'), placeholder: text(t, 'history.search'), onChange: event => change('query', event.target.value) }),
    React.createElement('div', { className: 'dsh-super-code-history-filters' },
      select('range', text(t, 'history.created'), [['all', text(t, 'history.all')], ['today', text(t, 'history.today')], ['week', text(t, 'history.week')], ['month', text(t, 'history.month')], ['custom', text(t, 'history.custom')]]),
      select('sort', text(t, 'history.sort'), [['time-desc', text(t, 'history.latest')], ['time-asc', text(t, 'history.earliest')], ['tokens-desc', text(t, 'history.tokensHigh')], ['tokens-asc', text(t, 'history.tokensLow')], ['title-asc', text(t, 'history.titleAsc')], ['title-desc', text(t, 'history.titleDesc')]])),
    filters.range === 'custom' && React.createElement('div', { className: 'dsh-super-code-history-filters' },
      ['from', 'to'].map((key, index) => React.createElement('label', { key }, index ? text(t, 'history.end') : text(t, 'history.start'),
        React.createElement('input', { type: 'date', value: filters[key], 'aria-label': index ? text(t, 'history.end') : text(t, 'history.start'), onChange: event => change(key, event.target.value) })))),
    React.createElement('p', { className: 'dsh-super-code-history-summary', role: 'status' }, range.valid ? text(t, 'history.summary', { shown: records.length, total: hidden.length }) : text(t, 'history.invalid')),
    React.createElement('div', { ref: viewport, className: 'dsh-super-code-history-list', role: 'list', 'aria-label': text(t, 'history.aria'),
      onScroll: event => { const top = event.currentTarget.scrollTop; setScroll(previous => previous.top === top ? previous : { ...previous, top }) } },
      React.createElement('div', { style: { height: window.height, position: 'relative' } }, records.slice(window.start, window.end).map((record, offset) => {
        const index = window.start + offset, status = agentExecutionStatus(record.node, false, t)
        const date = record.time < 0 ? text(t, 'history.unknownTime') : dateFormat.format(record.time)
        return React.createElement('div', { key: record.id, role: 'listitem', 'aria-posinset': index + 1, 'aria-setsize': records.length,
          style: { position: 'absolute', top: index * historyRowHeight, height: historyRowHeight, width: '100%' } },
          React.createElement(ActionButton, { type: 'button', 'data-history-id': record.id, onClick: () => open(record.node), onKeyDown: event => keyDown(event, index),
            title: `${record.title} · ${record.parent} · ${record.time < 0 ? date : new Date(record.time).toLocaleString(localeCode(t))} · ${record.tokens < 0 ? text(t, 'history.unknownUsage') : record.tokens + ' Token' + (record.partial ? ' (' + text(t, 'usage.partial') + ')' : '')}`,
            'aria-label': text(t, 'history.view', { title: record.title }) },
            React.createElement('i', { className: 'dsh-super-code-circle ' + status.tone, 'aria-hidden': true }),
            React.createElement('span', null, React.createElement('strong', null, record.title), React.createElement('small', null, `${status.label} · ${date} · ${record.parent}`)),
            React.createElement('small', null, record.tokens < 0 ? '—' : `${record.partial ? '≈' : ''}${record.tokens.toLocaleString(localeCode(t), { notation: 'compact', maximumFractionDigits: 1 })} tok`)))
      })),
      !records.length && React.createElement('p', { className: 'dsh-super-code-history-empty' }, text(t, 'history.empty'))))
}

function AgentTree({ useSessions, useSessionStatus, sessionId, useTabInfo, treeStates, openDetail, refresh, watchCatalog, onToggle, t = key => zh[key] || key }) {
  const catalog = useSessions(s => s)
  const statuses = useSessionStatus ? useSessionStatus(s => s) : undefined
  const state = useMemo(() => agentSessionState(catalog, sessionId, statuses), [catalog, sessionId, statuses])
  const { tab } = useTabInfo()
  const view = useMemo(() => buildAgentView(state), [state.byId, state.subagentsByParent, state.current, state.currentAddress])
  const saved = useMemo(() => {
    let value = treeStates.get(tab.signal)
    if (!value || value.root !== view.root) {
      value = { root: view.root, limit: 200, focused: state.current, expanded: new Set(), collapsed: new Set() }
      treeStates.set(tab.signal, value)
    }
    return value
  }, [treeStates, tab.signal, view.root])
  return React.createElement(AgentTreeBody, { key: view.root, state, view, saved, openDetail, refresh, watchCatalog, onToggle, t })
}

function WorkspaceSectionToggle({ section, expanded, onToggle, children, t }) {
  const label = text(t, section === 'tree' ? 'tree.title' : 'memory.title')
  return React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-section-toggle',
    'data-workspace-section': section, 'aria-label': label, 'aria-expanded': expanded, onClick: onToggle },
    React.createElement(Glyph, { type: 'chevron' }),
    React.createElement(Glyph, { type: section === 'tree' ? 'branch' : 'memory' }),
    React.createElement('strong', null, label), children)
}

/** One active section guarantees exactly one open view; tab state retains drafts. */
function SuperCodeWorkspace(props) {
  const { tab } = props.useTabInfo()
  const address = typeof tab.navigation?.params?.memory === 'string' ? tab.navigation.params.memory : tab.contentId
  const navigationKey = `${address}/${tab.navigation?.revision || 0}`
  const memoryTarget = memoryLibraryTarget(address, '')
  const saved = useMemo(() => {
    const value = props.workspaceStates.get(tab.signal) || { active: 'tree' }
    if (value.navigationKey !== navigationKey) {
      value.navigationKey = navigationKey
      if (memoryTarget.id) value.active = 'memory'
    }
    props.workspaceStates.set(tab.signal, value)
    return value
  }, [props.workspaceStates, tab.signal])
  const [active, setActive] = useState(saved.active === 'memory' ? 'memory' : 'tree')
  const layout = useRef(null), focusSection = useRef('')
  const toggle = () => {
    const next = active === 'tree' ? 'memory' : 'tree'
    saved.active = next; focusSection.current = next; setActive(next)
  }
  useLayoutEffect(() => {
    if (saved.navigationKey === navigationKey) return
    saved.navigationKey = navigationKey
    if (memoryTarget.id) { saved.active = 'memory'; setActive('memory') }
  }, [saved, navigationKey])
  useLayoutEffect(() => {
    if (!focusSection.current) return
    layout.current.querySelector(`[data-workspace-section="${focusSection.current}"]`)?.focus({ preventScroll: true })
    focusSection.current = ''
  }, [active])
  return React.createElement('section', { className: 'dsh-super-code-workspace', 'aria-label': text(props.t, 'workspace.title') },
    React.createElement('div', { ref: layout, className: 'dsh-super-code-workspace-layout', 'data-active-section': active, style: {
      gridTemplateRows: active === 'tree' ? 'minmax(280px, 1fr) 44px' : '44px minmax(280px, 1fr)',
    } },
      active === 'tree' ? React.createElement(AgentTree, { ...props, key: 'tree', onToggle: toggle })
        : React.createElement('header', { key: 'tree-collapsed', className: 'dsh-super-code-workspace-collapsed' },
          React.createElement(WorkspaceSectionToggle, { section: 'tree', expanded: false, onToggle: toggle, t: props.t })),
      active === 'memory' ? React.createElement(MemoryLibrary, { ...props, key: 'memory', onToggle: toggle })
        : React.createElement('header', { key: 'memory-collapsed', className: 'dsh-super-code-workspace-collapsed' },
          React.createElement(WorkspaceSectionToggle, { section: 'memory', expanded: false, onToggle: toggle, t: props.t }))))
}

function AgentCatalogWatch({ id, watchCatalog }) {
  useEffect(() => {
    watchCatalog(id, true)
    return () => watchCatalog(id, false)
  }, [id, watchCatalog])
  return null
}

// Keep connector anchors and canvas bounds in step with the node's text stack.
const agentTreeNodeHeight = 120, agentTreeLevelSpacing = 152
function agentTreeLayout(view, limit) {
  const { rows, more } = visibleAgentRows(view, () => true, limit)
  const positions = new Map(), edges = []
  let leaves = 0
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    const children = (view.children.get(row.id) || []).filter(id => positions.has(id) && positions.get(id).level === row.level + 1)
    const x = children.length ? children.reduce((sum, id) => sum + positions.get(id).x, 0) / children.length : 70 + leaves++ * 140
    positions.set(row.id, { ...row, x, y: 18 + (row.level - 1) * agentTreeLevelSpacing })
    for (const child of children) edges.push({ parent: row.id, child })
  }
  const width = Math.max(140, leaves * 140)
  // Reverse the postorder leaf allocation to preserve catalog order.
  for (const position of positions.values()) position.x = width - position.x
  return { rows: rows.map(row => positions.get(row.id)), edges, positions, more, width,
    height: Math.max(140, ...rows.map(row => row.level * agentTreeLevelSpacing)) }
}

function agentExecutionStatus(node, isRoot, t = key => zh[key] || key) {
  if (!node || node.unavailable || typeof node.running !== 'boolean') return { tone: 'unavailable', label: text(t, 'tree.legend.unavailable') }
  if (node.running) return { tone: 'active', label: text(t, 'tree.legend.active') }
  return isRoot || node.mode === 'continuable' ? { tone: 'idle', label: text(t, 'tree.legend.idle') } : { tone: 'stopped', label: text(t, 'tree.legend.stopped') }
}

function AgentTreeBody({ state, view, saved, openDetail, refresh, watchCatalog, onToggle, t = key => zh[key] || key }) {
  const [pan, setPan] = useState(saved.pan || { x: 0, y: 0 })
  const [zoom, setZoom] = useState(saved.zoom || 1)
  const viewport = useRef(null), graph = useRef(null)
  const autoFit = useRef(!saved.pan)
  const camera = useRef({ pan, zoom })
  camera.current = { pan, zoom }
  const changeCamera = (nextPan, nextZoom) => {
    saved.pan = nextPan; saved.zoom = nextZoom
    camera.current = { pan: nextPan, zoom: nextZoom }
    setPan(nextPan); setZoom(nextZoom)
  }
  const zoomAt = (factor, x, y) => {
    autoFit.current = false
    const current = camera.current, rect = graph.current.getBoundingClientRect()
    const next = Math.max(.4, Math.min(2, current.zoom * factor))
    const dx = (x - rect.left) / current.zoom, dy = (y - rect.top) / current.zoom
    changeCamera({ x: current.pan.x - dx * (next - current.zoom), y: current.pan.y - dy * (next - current.zoom) }, next)
  }
  useEffect(() => {
    const element = viewport.current
    const wheel = event => { event.preventDefault(); zoomAt(Math.exp(-event.deltaY * (event.deltaMode === 1 ? .04 : .002)), event.clientX, event.clientY) }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])
  const gesture = useRef({ moved: false })
  const finishDrag = event => {
    const drag = gesture.current
    if (drag.id !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    drag.id = undefined
    event.currentTarget.classList.remove('dragging')
  }
  const [limit, setLimit] = useState(saved.limit)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [focused, setFocused] = useState(saved.focused)
  const [expanded, setExpanded] = useState(saved.expanded || new Set())
  const [collapsed, setCollapsed] = useState(saved.collapsed || new Set())
  const [historyOpen, setHistoryOpen] = useState(saved.historyOpen || false)
  const [compact, setCompact] = useState(false)
  useEffect(() => { Object.assign(saved, { limit, focused, expanded, collapsed, historyOpen }) }, [saved, limit, focused, expanded, collapsed, historyOpen])
  const catalogs = state.subagentsByParent || {}
  const display = useMemo(() => agentTreeDisplay(view, catalogs, { expanded, collapsed, focused, compact }), [view, catalogs, expanded, collapsed, focused, compact])
  const { rows, more, edges, positions, width, height } = useMemo(() => agentTreeLayout(display.view, limit), [display, limit])
  const toggleBranch = id => {
    autoFit.current = true
    const show = collapsed.has(id) || !(display.view.children.get(id) || []).length
    const nextExpanded = new Set(expanded), nextCollapsed = new Set(collapsed)
    nextExpanded.delete(id); nextCollapsed.delete(id)
    if (show) nextExpanded.add(id); else nextCollapsed.add(id)
    setExpanded(nextExpanded); setCollapsed(nextCollapsed)
  }
  const fit = () => {
    autoFit.current = true
    const element = viewport.current
    const next = Math.max(.4, Math.min(1.25, (element.clientWidth - 24) / width, (element.clientHeight - 24) / height))
    changeCamera({ x: (element.clientWidth - 24 - width * next) / 2, y: 8 }, next)
    element.scrollLeft = 0; element.scrollTop = 0
  }
  useLayoutEffect(() => {
    const resize = () => {
      setCompact(viewport.current.clientWidth < 400)
      if (autoFit.current) fit()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [width, height])
  const zoomButton = factor => {
    const rect = viewport.current.getBoundingClientRect()
    zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }
  const totals = useMemo(() => agentTreeTotals(view, catalogs), [view, catalogs])
  // Retain already-loaded branch subscriptions so a hidden worker can become visible.
  const watched = [...new Set([...rows.filter(({ id }) => id === view.root || view.nodes.get(id)?.hasChildren).map(row => row.id),
    ...Object.keys(catalogs).filter(id => view.nodes.has(id))])]
  const open = node => {
    setError('')
    Promise.resolve().then(() => openDetail(node)).catch(() => setError('detail.noAccess'))
  }
  const reload = async () => {
    setBusy(true); setError('')
    try { await Promise.all([...new Set([view.root, ...watched])].filter(Boolean).map(id => refresh(id))) }
    catch { setError('tree.loadError') }
    finally { setBusy(false) }
  }
  const keyDown = (event, row) => {
    const index = rows.findIndex(item => item.id === row.id)
    let target
    if (event.key === 'ArrowDown') target = rows[Math.min(rows.length - 1, index + 1)]?.id
    else if (event.key === 'ArrowUp') target = rows[Math.max(0, index - 1)]?.id
    else if (event.key === 'Home') target = rows[0]?.id
    else if (event.key === 'End') target = rows.at(-1)?.id
    else if (event.key === 'ArrowRight') {
      target = rows[index + 1]?.level > row.level ? rows[index + 1].id : row.id
    } else if (event.key === 'ArrowLeft') {
      target = view.nodes.get(row.id).parentId
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (!view.nodes.get(row.id).unavailable) open(view.nodes.get(row.id))
    } else return
    event.preventDefault()
    if (target) {
      setFocused(target)
      const tree = event.currentTarget.closest('[role="tree"]')
      Array.from(tree.querySelectorAll('[role="treeitem"]')).find(item => item.dataset.agentId === target)?.focus()
    }
  }
  const focusId = rows.some(row => row.id === focused) ? focused : view.root
  const running = [...view.nodes.values()].filter(node => node.running).length
  const catalogError = watched.some(id => catalogs[id]?.state === 'error')
  return React.createElement('section', { className: 'dsh-super-code-tree', 'data-super-agent-tree': true },
    watched.map(id => React.createElement(AgentCatalogWatch, { key: id, id, watchCatalog })),
    React.createElement('header', { className: 'dsh-super-code-tree-header' },
      React.createElement('div', { className: 'dsh-super-code-tree-heading' },
        onToggle ? React.createElement(WorkspaceSectionToggle, { section: 'tree', expanded: true, onToggle, t },
          React.createElement('span', { className: 'dsh-super-code-tree-count' }, text(t, 'tree.countCompact', { shown: rows.length, total: view.nodes.size, running })))
          : React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'dsh-super-code-title-line' }, React.createElement(Glyph, { type: 'branch' }), React.createElement('strong', null, text(t, 'tree.title'))),
            React.createElement('span', { className: 'dsh-super-code-tree-count', title: text(t, 'tree.count', { shown: rows.length, total: view.nodes.size, running }) }, text(t, 'tree.countCompact', { shown: rows.length, total: view.nodes.size, running })))),
      React.createElement('div', { className: 'dsh-super-code-tree-toolbar' },
        React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-icon-button', disabled: busy || !view.root, onClick: reload, title: text(t, 'tree.refresh'), 'aria-label': text(t, 'tree.refresh') }, React.createElement(IconRefreshOutline16)),
        React.createElement('div', { className: 'dsh-super-code-graph-controls', 'aria-label': text(t, 'tree.canvas') },
          React.createElement(ActionButton, { type: 'button', title: text(t, 'tree.zoom.out'), 'aria-label': text(t, 'tree.zoom.out'), disabled: zoom <= .4, onClick: () => zoomButton(1 / 1.2) }, '−'),
          React.createElement('span', { 'aria-live': 'polite' }, `${Math.round(zoom * 100)}%`),
          React.createElement(ActionButton, { type: 'button', title: text(t, 'tree.zoom.in'), 'aria-label': text(t, 'tree.zoom.in'), disabled: zoom >= 2, onClick: () => zoomButton(1.2) }, '+')),
        React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-icon-button', title: text(t, 'tree.fit'), 'aria-label': text(t, 'tree.fit'), onClick: fit }, React.createElement(Glyph, { type: 'fit' })),
        (display.hidden.length > 0 || expanded.size > 0 || collapsed.size > 0) && React.createElement('div', { className: 'dsh-super-code-history-controls' },
          React.createElement(ActionButton, { type: 'button', title: text(t, 'tree.collapsed', { count: display.hidden.length }), 'aria-label': text(t, 'tree.collapsed', { count: display.hidden.length }), 'aria-expanded': historyOpen, onClick: () => setHistoryOpen(!historyOpen) }, React.createElement(Glyph, { type: 'history' }), React.createElement('span', { className: 'dsh-super-code-action-label' }, text(t, 'tree.collapsedLabel')), React.createElement('span', { className: 'dsh-super-code-action-count' }, display.hidden.length)),
          (expanded.size > 0 || collapsed.size > 0) && React.createElement(ActionButton, { type: 'button', title: text(t, 'tree.organize'), 'aria-label': text(t, 'tree.organize'), onClick: () => { autoFit.current = true; setExpanded(new Set()); setCollapsed(new Set()); setHistoryOpen(false); setFocused(state.current) } }, React.createElement(Glyph, { type: 'organize' }), React.createElement('span', { className: 'dsh-super-code-action-label' }, text(t, 'tree.organizeLabel'))))),
      React.createElement('div', { className: 'dsh-super-code-graph-legend', 'aria-label': text(t, 'tree.status') },
        ['tree.legend.active', 'tree.legend.idle', 'tree.legend.stopped', 'tree.legend.unavailable'].map((key, index) => React.createElement('span', { key },
          React.createElement('i', { className: 'dsh-super-code-circle ' + ['active', 'idle', 'stopped', 'unavailable'][index], 'aria-hidden': true }), text(t, key))))),
    (error || catalogError) && React.createElement('p', { role: 'alert', className: 'dsh-super-code-tree-error' }, text(t, error || 'tree.loadError')),
    !view.root && React.createElement('p', { className: 'dsh-super-code-tree-empty' }, text(t, 'tree.empty')),
    historyOpen && React.createElement(AgentHistory, { view, hidden: display.hidden, totals, open, saved, t }),
    React.createElement('div', { ref: viewport, className: 'dsh-super-code-graph-scroll',
      onPointerDown: event => {
        if (!event.isPrimary || event.button !== 0) return
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: pan, moved: false }
      },
      onPointerMove: event => {
        const drag = gesture.current
        if (drag.id !== event.pointerId) return
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y
        if (!drag.moved && Math.hypot(dx, dy) < 6) return
        autoFit.current = false
        if (!drag.moved) { drag.moved = true; event.currentTarget.setPointerCapture(event.pointerId) }
        event.currentTarget.classList.add('dragging')
        const next = { x: drag.origin.x + dx, y: drag.origin.y + dy }
        changeCamera(next, camera.current.zoom)
      },
      onPointerUp: finishDrag, onPointerCancel: finishDrag, onLostPointerCapture: finishDrag,
      onClickCapture: event => { if (gesture.current.moved && event.detail !== 0) { event.preventDefault(); event.stopPropagation() } },
      onDoubleClick: event => { if (!event.target.closest('[role="treeitem"]')) fit() },
      title: text(t, 'tree.canvas'),
    },
    React.createElement('div', { ref: graph, role: 'tree', 'aria-label': text(t, 'tree.aria'), className: 'dsh-super-code-graph', style: { width, height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` } },
      React.createElement('svg', { width, height, className: 'dsh-super-code-graph-edges', 'aria-hidden': true }, edges.map(edge => {
        const parent = positions.get(edge.parent), child = positions.get(edge.child)
        return React.createElement('path', { key: edge.child, d: `M ${parent.x} ${parent.y + agentTreeNodeHeight} V ${child.y - 16} H ${child.x} V ${child.y - 10}`, fill: 'none' })
      })),
      rows.map(row => {
      const node = view.nodes.get(row.id)
      const title = node.title || node.displayTitle || text(t, 'main.agent')
      const { label: status, tone } = agentExecutionStatus(node, row.id === view.root, t)
      const usage = totals.get(row.id)
      const partial = usage.partial || usage.known < usage.agents
      const number = value => value.toLocaleString(localeCode(t), { notation: 'compact', maximumFractionDigits: 1 })
      const hasChildren = (view.children.get(row.id) || []).length > 0
      const isExpanded = (display.view.children.get(row.id) || []).length > 0
      return React.createElement(React.Fragment, { key: row.id }, React.createElement(ActionButton, {
          type: 'button',
          role: 'treeitem', tabIndex: row.id === focusId ? 0 : -1, 'data-agent-id': row.id,
          'aria-level': row.level, 'aria-selected': row.id === state.current,
          'aria-expanded': hasChildren ? isExpanded : undefined,
          'aria-disabled': node.unavailable || undefined, 'aria-label': `${title}，${status}`,
          className: `dsh-super-code-graph-node${row.id === state.current ? ' selected' : ''}${node.running ? ' running' : ''}`,
          style: { left: row.x - 64, top: row.y }, title: `${title} · ${status} · ${text(t, 'tree.open')}`,
          onFocus: () => setFocused(row.id), onClick: () => { if (!node.unavailable) open(node) },
          onKeyDown: event => { if (event.target === event.currentTarget) keyDown(event, row) },
        },
        React.createElement('span', { className: 'dsh-super-code-circle ' + tone, 'aria-hidden': true }, row.id === view.root ? text(t, 'main.agent').slice(0, 1) : String(rows.findIndex(item => item.id === row.id))),
        React.createElement('span', { className: 'dsh-super-code-tree-content' },
          React.createElement('span', { className: 'dsh-super-code-tree-title' }, title),
          React.createElement('span', { className: 'dsh-super-code-node-status', 'data-tone': tone }, React.createElement('i', { 'aria-hidden': true }), status),
          React.createElement('span', { className: 'dsh-super-code-tree-usage', title: text(t, 'tree.usage', { partial: partial ? text(t, 'usage.incomplete') : '', tokens: usage.tokens.toLocaleString(localeCode(t)), cache: usage.cache.toLocaleString(localeCode(t)), agents: usage.agents }) },
            React.createElement('span', null, usage.known ? `${number(usage.tokens)} token` : text(t, 'usage.unknown')),
            React.createElement('span', null, usage.known ? text(t, 'usage.cache', { value: usage.input ? Math.round(usage.cache / usage.input * 100) : 0 }) + (partial ? ` · ${text(t, 'usage.partial')}` : '') : text(t, 'usage.cacheUnknown'))))),
        hasChildren && React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-branch-toggle',
          style: { left: row.x + 21, top: row.y + 25 }, 'aria-label': `${collapsed.has(row.id) || !isExpanded ? text(t, 'tree.expand') : text(t, 'tree.collapse')} ${title}`,
          title: text(t, 'tree.organize'), onClick: () => toggleBranch(row.id) },
          React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true, style: { transform: collapsed.has(row.id) || !isExpanded ? 'rotate(-90deg)' : undefined } },
            React.createElement('path', { d: 'M3 4.5 6 7.5 9 4.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }))))
    }))),
    more && React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-tree-more', onClick: () => setLimit(limit + 200) }, text(t, 'tree.more')))
}

function agentDetailAddress(node) {
  const address = new URL('dsh-resource://super-agent/' + encodeURIComponent(node.id))
  if (node.parentId && node.mode) {
    address.searchParams.set('parent', node.parentId)
    address.searchParams.set('mode', node.mode)
  }
  return address.href
}

function agentDetailTarget(address) {
  const url = new URL(address)
  if (url.protocol !== 'dsh-resource:' || url.hostname !== 'super-agent') throw new Error('Invalid Agent address')
  const id = decodeURIComponent(url.pathname.slice(1))
  if (!id) throw new Error('Missing Agent identity')
  const parent = url.searchParams.get('parent'), mode = url.searchParams.get('mode')
  if (parent && (mode === 'one-shot' || mode === 'continuable')) return { kind: 'subagent', parentSessionId: parent, childSessionId: id, mode }
  return { kind: 'session', sessionId: id }
}

function agentPath(view, id) {
  const path = [], seen = new Set()
  while (id && !seen.has(id)) {
    seen.add(id)
    const node = view.nodes.get(id)
    path.unshift({ id, title: node?.title || node?.displayTitle || id })
    id = node?.parentId
  }
  return path
}

function contentText(blocks, t) {
  return (blocks || []).map(block => {
    if (block.type === 'text' && typeof block.text === 'string') return block.text
    if (block.type === 'image') return text(t, 'image')
    return ''
  }).filter(Boolean).join('\n\n')
}

function detailRecord(entry, t = key => zh[key] || key) {
  const event = entry.event, data = event?.data
  if (!data) return { kind: 'skip' }
  const base = { seq: event.seq, time: event.time, entry }
  if (event.type === 'user/message') {
    if (data.source?.kind !== 'user') return { kind: 'skip' }
    return { ...base, kind: 'message', label: text(t, 'detail.task'), text: contentText(data.content, t) }
  }
  if (event.type === 'assistant/message') return { ...base, kind: 'message', label: data.interrupted ? text(t, 'detail.interrupted') : text(t, 'detail.agent'), text: contentText(data.message?.content, t) }
  if (event.type === 'tool/call' && typeof data.name === 'string' && data.name) {
    let value = typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {})
    try { value = JSON.stringify(JSON.parse(value), null, 2) } catch { /* Incomplete arguments remain readable. */ }
    return { ...base, kind: 'tool', collapsed: true, toolName: data.name, callId: data.callId,
      label: text(t, 'detail.toolCall') + ' · ' + data.name, text: value }
  }
  if (event.type === 'tool/result') {
    const blocks = (data.message?.content || []).filter(block => block.type === 'tool-result')
    // Harness journals use both direct tool messages (v4) and nested results.
    const direct = data.message?.role === 'tool'
    if (!blocks.length && !direct) return { kind: 'skip' }
    const failed = direct ? data.message.isError : blocks.some(block => block.isError)
    return { ...base, kind: failed ? 'error' : 'tool', collapsed: true,
      callId: direct ? data.message.toolCallId : blocks[0]?.toolCallId,
      label: text(t, failed ? 'detail.toolError' : 'detail.toolResult'),
      text: contentText(direct ? data.message.content : blocks.flatMap(block => block.content || []), t) }
  }
  if (event.type === 'turn/error') return { ...base, kind: 'error', label: text(t, 'detail.error'), text: data.message || text(t, 'detail.incomplete') }
  return { kind: 'skip' }
}

// The host journal owns decoding, cursor validation and reconnects. This view
// keeps a bounded display window and never stages or sends to another session.
function createAgentInspector(createStream, address, readPage, initial, t = key => zh[key] || key) {
  let snapshot = initial || { status: 'loading', items: [], hasMore: false, earlier: false, truncated: false, projections: {}, error: '', firstSeq: 0, cursor: -1 }
  let cursor = snapshot.cursor
  let disposed = false, stream
  const listeners = new Set()
  const publish = patch => {
    if (disposed) return
    if (patch.cursor !== undefined) cursor = patch.cursor
    snapshot = { ...snapshot, cursor, ...patch }
    listeners.forEach(listener => listener())
  }
  const itemsOf = entries => entries.map(entry => detailRecord(entry, t)).filter(item => item.kind !== 'skip' && item.text)
  stream = createStream(agentDetailTarget(address), {
    publish: change => {
      if (disposed) return
      if (change.type === 'replace') {
        if (snapshot.earlier) {
          publish({ status: 'ready', projections: change.page.projections?.values || {}, error: '' })
          return
        }
        const fresh = itemsOf(change.entries)
        const sequences = new Set(fresh.map(item => item.seq))
        const overlaps = snapshot.items.some(item => sequences.has(item.seq))
        // A resumed tail page can start later than the user's reading window.
        // Immutable journal records can be merged without moving that window.
        const items = overlaps ? [...new Map([...snapshot.items, ...fresh].map(item => [item.seq, item])).values()].sort((a, b) => a.seq - b.seq) : fresh
        publish({ status: 'ready', items: items.slice(-200), hasMore: (overlaps ? snapshot.hasMore : change.hasMore) || items.length > 200, earlier: false, truncated: items.length > 200,
          firstSeq: items.length > 200 ? items.at(-200).seq : overlaps ? snapshot.firstSeq : change.entries[0]?.event.seq ?? 0,
          cursor: change.entries.at(-1)?.event.seq ?? -1,
          projections: change.page.projections?.values || {}, error: '' })
      } else if (change.type === 'append' && !snapshot.earlier) {
        const item = detailRecord(change.entry, t)
        cursor = change.entry.event.seq
        if (item.kind !== 'skip' && item.text) {
          const items = [...snapshot.items, item]
          publish({ items: items.slice(-200), cursor, truncated: snapshot.truncated || items.length > 200,
            firstSeq: items.length > 200 ? items.at(-200).seq : snapshot.firstSeq, hasMore: snapshot.hasMore || items.length > 200 })
        }
      }
    },
    carrierFailed: () => publish({ error: 'detail.connection' }),
    failed: () => publish({ status: 'error', error: 'detail.loadError' }),
  })
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    start: () => { stream.open({ maxMessages: 40 }).catch(() => publish({ status: 'error', error: 'detail.loadError' })) },
    older: async () => {
      if (snapshot.status === 'paging' || !snapshot.hasMore) return
      publish({ status: 'paging', error: '' })
      const throughSeq = cursor
      try {
        const result = await readPage({ address: agentDetailTarget(address), throughSeq, beforeSeq: snapshot.firstSeq, maxMessages: 40 }, stream.signal)
        if (!result.ok) throw new Error('History unavailable')
        const items = itemsOf(result.value.records), visible = items.slice(-200)
        publish({ status: 'ready', items: visible, earlier: true, cursor: throughSeq, truncated: items.length > 200,
          firstSeq: items.length > 200 ? visible[0].seq : result.value.records[0]?.event.seq ?? 0,
          hasMore: result.value.hasMore || items.length > 200 })
      }
      catch { publish({ status: 'error', error: 'detail.historyError' }) }
    },
    dispose: () => { disposed = true; listeners.clear(); void stream.dispose() },
  }
}

function DetailText({ text: value, t = key => zh[key] || key }) {
  const [full, setFull] = useState(false)
  return React.createElement(React.Fragment, null,
    React.createElement('pre', null, full ? value : value.slice(0, 12000)),
    !full && value.length > 12000 && React.createElement(ActionButton, { type: 'button', onClick: () => setFull(true) }, text(t, 'detail.open')))
}

function MemoryActivity({ usage, openMemory, sessionId, t }) {
  const rows = [...(usage?.rows || [])].reverse()
  return React.createElement('details', { className: 'dsh-super-code-memory-activity' },
    React.createElement('summary', null, text(t, 'memory.agentUsage'), rows.length ? ` · ${rows.length}` : ''),
    !rows.length && React.createElement('p', null, text(t, 'memory.usageEmpty')),
    React.createElement('div', { className: 'dsh-super-code-memory-activity-list' }, rows.map(row =>
      React.createElement(ActionButton, { key: `${row.scope}/${row.topic}/${row.id}/${row.action}`, type: 'button',
        onClick: () => openMemory(sessionId, row), title: text(t, 'memory.open') },
      React.createElement('span', { className: 'dsh-super-code-memory-action', 'data-action': row.action }, text(t, `memory.${row.action}`)),
      React.createElement('span', null, row.summary || row.id),
      React.createElement('small', null, `${text(t, `memory.${row.scope}`)} · ${row.topic}`)))),
    usage?.omitted > 0 && React.createElement('p', { className: 'dsh-super-code-memory-muted' }, text(t, 'memory.omitted')))
}

function memoryLibraryAddress(sessionId, row = {}) {
  const url = new URL(`dsh-resource://super-code-memory/${encodeURIComponent(sessionId)}`)
  for (const key of ['scope', 'topic', 'id']) if (row[key]) url.searchParams.set(key, row[key])
  return url.href
}

function memoryLibraryTarget(address, current) {
  try {
    const url = new URL(address)
    if (url.protocol === 'dsh-resource:' && url.host === 'super-code-memory') return {
      sessionId: decodeURIComponent(url.pathname.slice(1)) || current, scope: url.searchParams.get('scope') === 'global' ? 'global' : 'project',
      topic: url.searchParams.get('topic') || '', id: url.searchParams.get('id') || '',
    }
  } catch {}
  return { sessionId: current, scope: 'project', topic: '', id: '' }
}

/** A repeated explicit navigation reopens its entry; ordinary remounts retain reading state. */
function memoryLibraryNavigation(saved, tab, current) {
  const address = typeof tab.navigation?.params?.memory === 'string' ? tab.navigation.params.memory : tab.contentId
  const navigationKey = `${address}/${tab.navigation?.revision || 0}`
  if (saved.navigationKey === navigationKey) return saved
  const target = memoryLibraryTarget(address, current)
  return { ...saved, navigationKey, ...(target.id ? {
    scope: target.scope, selected: { topic: target.topic, id: target.id }, detailTop: 0,
    ...(saved.scope && saved.scope !== target.scope ? { topicFilter: '', top: 0 } : {}),
  } : {}) }
}

/** A fixed-height index keeps large libraries cheap; entry bodies load on click. */
function memoryLibraryWindow(items, query, top, height) {
  const search = query.trim().toLocaleLowerCase()
  const matches = items.filter(item => !search || `${item.topic} ${item.id} ${item.summary}`.toLocaleLowerCase().includes(search))
  const start = Math.min(Math.max(0, Math.floor(top / 76) - 3), Math.max(0, matches.length - 1))
  const end = Math.min(matches.length, start + Math.ceil(height / 76) + 7)
  return { rows: matches.slice(start, end), count: matches.length, before: start * 76, after: (matches.length - end) * 76 }
}

/** Drafts and in-flight operations survive the host unmounting a hidden tab. */
function createMemoryEditor(saved, api) {
  if (saved.editorStore) return saved.editorStore
  let snapshot = { draft: null, confirmation: null, busy: false, error: '', refresh: 0 }
  const listeners = new Set()
  const update = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener() }
  const run = async (method, target) => {
    if (snapshot.busy) return { kind: 'busy' }
    update({ busy: true, error: '' })
    try {
      const response = method === 'save' ? await api.saveEntry(target.sessionId, target.scope, target.topic, target.id, JSON.stringify({
        expected: target.expected, kind: target.kind, summary: target.summary.trim(), detail: target.detail.trim(),
      })) : await api.deleteEntry(target.sessionId, target.scope, target.topic, target.id, target.expected)
      if (!response.ok) throw new Error('Remote unavailable')
      const result = response.value
      if (!['saved', 'removed'].includes(result.kind)) {
        update({ busy: false, error: { conflict: 'memory.conflict', missing: 'memory.missingEdit', full: 'memory.full' }[result.kind] || 'memory.writeError' })
        return result
      }
      saved.scope = target.scope
      saved.selected = result.kind === 'saved' ? { topic: target.topic, id: target.id } : null
      saved.detailTop = 0
      update({ draft: null, confirmation: null, busy: false, error: '', refresh: snapshot.refresh + 1 })
      return result
    } catch {
      update({ busy: false, error: 'memory.writeError' })
      return { kind: 'error' }
    }
  }
  saved.editorStore = { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    update, save: () => run('save', snapshot.draft), remove: () => run('remove', snapshot.confirmation) }
  return saved.editorStore
}

function MemoryEditor({ store, state, t }) {
  const draft = state.draft
  const set = (key, value) => store.update({ draft: { ...draft, [key]: value }, error: '' })
  return React.createElement('form', { className: 'dsh-super-code-memory-editor', 'aria-label': text(t, draft.expected ? 'memory.edit' : 'memory.add'),
    onSubmit: event => { event.preventDefault(); void store.save() } },
    React.createElement('div', { className: 'dsh-super-code-memory-editor-heading' },
      React.createElement('strong', null, text(t, draft.expected ? 'memory.edit' : 'memory.add')),
      React.createElement('small', null, text(t, `memory.${draft.scope}`))),
    React.createElement('label', null, text(t, 'memory.topic'),
      React.createElement('input', { value: draft.topic, 'aria-label': text(t, 'memory.topic'), required: true, maxLength: 96,
        disabled: state.busy || Boolean(draft.expected) || draft.scope === 'global', onChange: event => set('topic', event.target.value) }),
      !draft.expected && draft.scope !== 'global' && React.createElement('small', null, text(t, 'memory.topicHint'))),
    React.createElement(SelectControl, { label: text(t, 'memory.kind'), value: draft.kind, disabled: state.busy || draft.scope === 'global',
      choices: ['constraint', 'fact', 'experience'].map(kind => [kind, text(t, `memory.${kind}`)]), onChange: kind => set('kind', kind) }),
    React.createElement('label', null, text(t, 'memory.summaryLabel'), React.createElement('small', null, `${Array.from(draft.summary).length}/30`),
      React.createElement('input', { value: draft.summary, 'aria-label': text(t, 'memory.summaryLabel'), required: true, disabled: state.busy, onChange: event => set('summary', event.target.value) })),
    React.createElement('label', null, text(t, 'memory.detailLabel'), React.createElement('small', null, `${draft.detail.length}/1000`),
      React.createElement('textarea', { value: draft.detail, 'aria-label': text(t, 'memory.detailLabel'), required: true, maxLength: 1000, rows: 5, disabled: state.busy, onChange: event => set('detail', event.target.value) })),
    state.error && React.createElement('p', { role: 'alert' }, text(t, state.error)),
    React.createElement('div', { className: 'dsh-super-code-memory-actions' },
      React.createElement(ActionButton, { type: 'button', disabled: state.busy, onClick: () => store.update({ draft: null, error: '' }) }, text(t, 'memory.cancel')),
      React.createElement(ActionButton, { type: 'submit', className: 'dsh-super-code-memory-primary', disabled: state.busy || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(draft.topic) || !draft.summary.trim() || Array.from(draft.summary.trim()).length > 30 || !draft.detail.trim() }, text(t, state.busy ? 'memory.saving' : 'memory.save'))))
}

function MemoryDeleteConfirmation({ store, state, t }) {
  const dialog = useRef(null), target = state.confirmation
  useLayoutEffect(() => {
    dialog.current.showModal()
    return () => { if (dialog.current?.open) dialog.current.close() }
  }, [])
  const cancel = () => { if (!store.getSnapshot().busy) store.update({ confirmation: null, error: '' }) }
  return React.createElement('dialog', { ref: dialog, className: 'dsh-super-code-confirm', 'aria-label': text(t, 'memory.deleteTitle'),
    onCancel: event => { event.preventDefault(); cancel() }, onKeyDown: event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() }
    } },
    React.createElement('h3', null, text(t, 'memory.deleteTitle')),
    React.createElement('p', null, text(t, 'memory.deleteHint', { summary: target.summary })),
    state.error && React.createElement('p', { role: 'alert' }, text(t, state.error)),
    React.createElement('div', { className: 'dsh-super-code-confirm-actions' },
      React.createElement(ActionButton, { type: 'button', disabled: state.busy, onClick: cancel }, text(t, 'memory.cancel')),
      React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-memory-danger', disabled: state.busy, onClick: () => { void store.remove() } }, text(t, state.busy ? 'memory.deleting' : 'memory.delete'))))
}

function MemoryLibrary({ useTabInfo, useSessions, sessionId: scopeSessionId, api, memoryStates, onToggle, t = key => zh[key] || key }) {
  const { tab } = useTabInfo(), current = useSessions(state => scopeSessionId || state.current)
  const address = typeof tab.navigation?.params?.memory === 'string' ? tab.navigation.params.memory : tab.contentId
  const target = memoryLibraryTarget(address, current)
  const saved = useMemo(() => {
    const value = memoryStates.get(tab.signal) || {}
    Object.assign(value, memoryLibraryNavigation(value, tab, current))
    memoryStates.set(tab.signal, value)
    return value
  }, [memoryStates, tab.signal])
  const editor = useMemo(() => createMemoryEditor(saved, api), [saved, api])
  const editing = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot)
  const [scope, setScope] = useState(saved.scope || target.scope)
  const [query, setQuery] = useState(saved.query || '')
  const [topicFilter, setTopicFilter] = useState(saved.topicFilter || '')
  const [selected, setSelected] = useState(saved.selected || null)
  const [state, setState] = useState({ key: '', items: [], loading: true, error: false })
  const [detail, setDetail] = useState(null), [revision, setRevision] = useState(0)
  const [viewport, setViewport] = useState({ top: saved.top || 0, height: 600 })
  const list = useRef(null), detailBody = useRef(null), sessionId = editing.draft?.sessionId || editing.confirmation?.sessionId || target.sessionId
  const key = `${sessionId}/${scope}`, selectionKey = selected ? `${key}/${selected.topic}/${selected.id}` : ''
  const visibleState = state.key === key ? state : { items: [], loading: true, error: false }
  useLayoutEffect(() => {
    if (editing.draft || editing.confirmation || editing.busy) return
    const next = memoryLibraryNavigation(saved, tab, current)
    if (next === saved) return
    Object.assign(saved, next)
    setScope(saved.scope || target.scope); setSelected(saved.selected || null)
    setTopicFilter(saved.topicFilter || '')
    setViewport(value => ({ ...value, top: saved.top || 0 }))
    if (detailBody.current) detailBody.current.scrollTop = 0
  }, [saved, address, tab.navigation?.revision, editing.draft, editing.confirmation, editing.busy])
  useLayoutEffect(() => {
    if (!editing.refresh) return
    setScope(saved.scope); setSelected(saved.selected); setRevision(value => value + 1)
  }, [editing.refresh])
  useEffect(() => {
    if (!tab.visible || !sessionId) return
    let cancelled = false
    setState(previous => ({ ...previous, loading: true, error: false }))
    api.list(sessionId, scope).then(result => {
      if (!cancelled) setState({ key, items: result.ok ? result.value.items : [], loading: false, error: !result.ok })
    }).catch(() => { if (!cancelled) setState({ key, items: [], loading: false, error: true }) })
    return () => { cancelled = true }
  }, [api, tab.visible, sessionId, scope, revision])
  useEffect(() => {
    if (!tab.visible || !sessionId || !selected) return
    let cancelled = false
    setDetail(null)
    api.read(sessionId, scope, selected.topic, selected.id).then(result => {
      if (!cancelled) setDetail({ key: selectionKey, ...(result.ok ? result.value : { kind: 'error' }) })
    }).catch(() => { if (!cancelled) setDetail({ key: selectionKey, kind: 'error' }) })
    return () => { cancelled = true }
  }, [api, tab.visible, sessionId, scope, selectionKey, revision])
  useLayoutEffect(() => {
    const element = list.current
    if (!element) return
    element.scrollTop = saved.top || 0
    const resize = () => setViewport({ top: element.scrollTop, height: element.clientHeight || 600 })
    resize()
    const observer = new ResizeObserver(resize); observer.observe(element)
    return () => observer.disconnect()
  }, [selected, key, tab.visible, Boolean(editing.draft)])
  useLayoutEffect(() => {
    if (detailBody.current) detailBody.current.scrollTop = saved.detailTop || 0
  }, [selectionKey, detail?.key, tab.visible, Boolean(editing.draft)])
  const resetScroll = () => { saved.top = 0; if (list.current) list.current.scrollTop = 0; setViewport(value => ({ ...value, top: 0 })) }
  const choose = value => { saved.detailTop = 0; if (detailBody.current) detailBody.current.scrollTop = 0; saved.selected = value; setSelected(value) }
  const changeTopic = value => { saved.topicFilter = value; setTopicFilter(value); resetScroll() }
  const topics = useMemo(() => {
    const counts = new Map()
    for (const item of visibleState.items) counts.set(item.topic, (counts.get(item.topic) || 0) + 1)
    return [...counts].map(([topic, count]) => ({ topic, count })).sort((a, b) => a.topic.localeCompare(b.topic, localeCode(t)))
  }, [visibleState.items, t])
  const topicItems = useMemo(() => topicFilter ? visibleState.items.filter(item => item.topic === topicFilter) : visibleState.items, [visibleState.items, topicFilter])
  const page = useMemo(() => memoryLibraryWindow(topicItems, query, viewport.top, viewport.height), [topicItems, query, viewport])
  const currentDetail = detail?.key === selectionKey ? detail : null
  const entry = currentDetail?.kind === 'found' ? currentDetail.entry : null
  const related = entry ? visibleState.items.filter(item => item.topic === entry.topic && item.id !== entry.id).slice(0, 5) : []
  return React.createElement('section', { className: 'dsh-super-code-memory', 'aria-label': text(t, 'memory.title') },
    React.createElement('header', null,
      React.createElement('div', { className: 'dsh-super-code-memory-heading' },
        onToggle ? React.createElement(WorkspaceSectionToggle, { section: 'memory', expanded: true, onToggle, t })
          : React.createElement('div', { className: 'dsh-super-code-title-line' }, React.createElement(Glyph, { type: 'memory' }), React.createElement('h2', null, text(t, 'memory.title'))),
        React.createElement('div', { className: 'dsh-super-code-memory-header-actions' },
          React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-view-button', 'aria-label': text(t, 'memory.add'), disabled: !sessionId || editing.busy || Boolean(editing.draft), onClick: () => editor.update({ error: '', draft: {
            sessionId, scope, topic: scope === 'global' ? 'preferences' : topicFilter || 'notes', id: window.crypto.randomUUID(), expected: '', kind: 'constraint', summary: '', detail: '',
          } }) }, `+ ${text(t, 'memory.add')}`),
          React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-icon-button', title: text(t, 'memory.refresh'), 'aria-label': text(t, 'memory.refresh'), disabled: editing.busy || Boolean(editing.draft), onClick: () => { editor.update({ error: '' }); setRevision(value => value + 1) } }, React.createElement(IconRefreshOutline16)))),
      React.createElement('div', { className: 'dsh-super-code-memory-scopes', role: 'group', 'aria-label': text(t, 'memory.title') },
        ['project', 'global'].map(value => React.createElement(ActionButton, { key: value, type: 'button', 'aria-pressed': scope === value, disabled: editing.busy || Boolean(editing.draft), onClick: () => {
          saved.scope = value; setScope(value); changeTopic(''); choose(null)
        } }, text(t, `memory.${value}`)))),
      !selected && !editing.draft && React.createElement('div', { className: 'dsh-super-code-memory-search' }, React.createElement(Glyph, { type: 'search' }),
        React.createElement('input', { type: 'search', 'aria-label': text(t, 'memory.search'), placeholder: text(t, 'memory.search'), value: query, onChange: event => { saved.query = event.target.value; setQuery(event.target.value); resetScroll() } }))),
    !sessionId ? React.createElement('p', { className: 'dsh-super-code-memory-empty' }, text(t, 'memory.selectSession')) : editing.draft ? React.createElement(MemoryEditor, { store: editor, state: editing, t }) : selected
      ? React.createElement('div', { ref: detailBody, className: 'dsh-super-code-memory-body', 'aria-busy': !currentDetail, onScroll: event => { saved.detailTop = event.currentTarget.scrollTop } },
        React.createElement('div', { className: 'dsh-super-code-memory-actions' },
          React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-view-button', onClick: () => choose(null) }, `← ${text(t, 'memory.back')}`),
          entry && React.createElement(React.Fragment, null,
            React.createElement(ActionButton, { type: 'button', onClick: () => editor.update({ error: '', draft: { sessionId, scope, topic: entry.topic, id: entry.id, expected: entry.token, kind: entry.kind, summary: entry.summary, detail: entry.detail } }) }, text(t, 'memory.edit')),
            React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-memory-danger', onClick: () => editor.update({ error: '', confirmation: { sessionId, scope, topic: entry.topic, id: entry.id, expected: entry.token, summary: entry.summary } }) }, text(t, 'memory.delete')))),
        !currentDetail && React.createElement('p', { role: 'status', className: 'dsh-super-code-memory-empty' }, text(t, 'memory.loading')),
        currentDetail?.kind === 'error' && React.createElement('p', { role: 'alert' }, text(t, 'memory.error')),
        currentDetail?.kind === 'missing' && React.createElement('p', null, text(t, 'memory.missing')),
        entry && React.createElement('article', { 'data-kind': entry.kind },
          React.createElement('div', { className: 'dsh-super-code-memory-detail-meta' },
            React.createElement('span', null, React.createElement(Glyph, { type: 'folder' }), entry.topic),
            React.createElement('span', null, text(t, `memory.${entry.kind}`))),
          React.createElement('h3', null, entry.summary), React.createElement('p', { className: 'dsh-super-code-memory-detail' }, entry.detail),
          React.createElement('dl', null, React.createElement('dt', null, text(t, 'memory.source')),
            React.createElement('dd', null, `${text(t, `memory.${entry.source.kind}`)}${entry.source.eventSeq === undefined ? '' : ` · #${entry.source.eventSeq}`}`, React.createElement('br'), entry.source.sessionId)),
          related.length > 0 && React.createElement('section', { className: 'dsh-super-code-memory-related' },
            React.createElement('h4', null, text(t, 'memory.related')),
            related.map(item => React.createElement(ActionButton, { key: item.id, type: 'button', onClick: () => choose({ topic: item.topic, id: item.id }) },
              React.createElement(Glyph, { type: 'memory' }), React.createElement('span', null, item.summary), React.createElement(Glyph, { type: 'arrow' }))))))
      : React.createElement('div', { className: 'dsh-super-code-memory-workspace' },
        React.createElement('nav', { className: 'dsh-super-code-memory-topic-index', 'aria-label': text(t, 'memory.topics') },
          React.createElement('div', { className: 'dsh-super-code-memory-topic-label' }, text(t, 'memory.topics'), React.createElement('span', null, topics.length)),
          React.createElement('div', { className: 'dsh-super-code-memory-topic-options' },
            [{ topic: '', count: visibleState.items.length }, ...topics].map(({ topic, count }) => React.createElement(ActionButton, { key: topic, type: 'button', title: topic || text(t, 'memory.allTopics'), 'data-topic': topic, 'aria-pressed': topicFilter === topic, onClick: () => changeTopic(topic) },
              React.createElement(Glyph, { type: topic ? 'folder' : 'memory' }), React.createElement('span', null, topic || text(t, 'memory.allTopics')), React.createElement('small', null, count))))),
        React.createElement('div', { className: 'dsh-super-code-memory-results' },
          React.createElement('div', { className: 'dsh-super-code-memory-list-heading' }, React.createElement('strong', null, topicFilter || text(t, 'memory.allTopics')), React.createElement('small', null, text(t, 'memory.count', { count: page.count }))),
          React.createElement('div', { ref: list, className: 'dsh-super-code-memory-list', role: 'list', 'aria-busy': visibleState.loading, onScroll: event => { saved.top = event.currentTarget.scrollTop; setViewport(value => ({ ...value, top: saved.top })) } },
            visibleState.loading && !visibleState.error && React.createElement('p', { role: 'status', className: 'dsh-super-code-memory-empty' }, text(t, 'memory.loading')),
            visibleState.error && React.createElement('p', { role: 'alert' }, text(t, 'memory.error')),
            !visibleState.error && !visibleState.loading && !page.count && React.createElement('p', { className: 'dsh-super-code-memory-empty' }, text(t, query || topicFilter ? 'memory.noMatches' : 'memory.empty')),
            React.createElement('div', { 'aria-hidden': true, style: { height: page.before } }),
            page.rows.map(item => React.createElement('div', { role: 'listitem', key: `${item.topic}/${item.id}` },
              React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-memory-row', 'data-topic': item.topic, 'data-kind': item.kind, onClick: () => choose({ topic: item.topic, id: item.id }) },
                React.createElement('span', { className: 'dsh-super-code-memory-row-heading' }, React.createElement(Glyph, { type: 'folder' }), React.createElement('span', { className: 'dsh-super-code-memory-row-topic' }, item.topic)),
                React.createElement('strong', null, item.summary),
                React.createElement('span', { className: 'dsh-super-code-memory-row-meta' }, React.createElement('span', { className: 'dsh-super-code-memory-row-kind' }, text(t, `memory.${item.kind}`)))))),
            React.createElement('div', { 'aria-hidden': true, style: { height: page.after } })))),
    editing.confirmation && React.createElement(MemoryDeleteConfirmation, { store: editor, state: editing, t }))
}

function AgentDetail({ useTabInfo, useSessions, useSessionStatus, sessionId, createInspector, detailStates, openMemory, t = key => zh[key] || key }) {
  const { tab } = useTabInfo()
  const catalog = useSessions(s => s)
  const statuses = useSessionStatus ? useSessionStatus(s => s) : undefined
  const state = useMemo(() => agentSessionState(catalog, sessionId, statuses), [catalog, sessionId, statuses])
  const saved = useMemo(() => {
    if (!detailStates.has(tab.signal)) detailStates.set(tab.signal, { top: 0, following: true, open: new Set(), snapshot: undefined })
    return detailStates.get(tab.signal)
  }, [detailStates, tab.signal])
  const log = useRef(null)
  const restored = useRef(false)
  const previous = useRef(saved.snapshot)
  const [unread, setUnread] = useState(saved.unread || false)
  const markUnread = value => { saved.unread = value; setUnread(value) }
  const [revision, setRevision] = useState(0)
  const inspector = useMemo(() => createInspector(tab.contentId, saved.snapshot), [createInspector, tab.contentId, tab.visible, revision])
  const snapshot = useSyncExternalStore(inspector.subscribe, inspector.getSnapshot, inspector.getSnapshot)
  const latest = () => {
    saved.snapshot = undefined; saved.following = true; saved.top = 0
    restored.current = false; previous.current = undefined; markUnread(false)
    setRevision(value => value + 1)
  }
  useLayoutEffect(() => {
    const element = log.current
    if (!element || snapshot.status === 'loading') return
    if (!restored.current) {
      element.scrollTop = saved.following && !snapshot.earlier ? element.scrollHeight : saved.top
      restored.current = true
    } else if (snapshot.items !== previous.current?.items) {
      if (snapshot.earlier && snapshot.firstSeq !== previous.current?.firstSeq) {
        element.scrollTop = 0; saved.following = false
      } else if (saved.following && !snapshot.earlier) element.scrollTop = element.scrollHeight
      else if (snapshot.items.at(-1)?.seq > (previous.current?.items.at(-1)?.seq ?? -1)) markUnread(true)
    }
    saved.top = element.scrollTop; saved.snapshot = snapshot; previous.current = snapshot
    const visible = new Set(snapshot.items.map(item => item.seq))
    for (const key of saved.open) if (key !== 'usage' && !visible.has(key)) saved.open.delete(key)
  }, [snapshot, saved])
  useEffect(() => {
    if (tab.visible) inspector.start()
    return () => inspector.dispose()
  }, [inspector, tab.visible])
  const target = agentDetailTarget(tab.contentId), id = target.childSessionId || target.sessionId
  const view = buildAgentView(state), node = view.nodes.get(id)
  const path = agentPath(view, id)
  const projections = { ...snapshot.projections, ...state.byId[id]?.projectionValues }
  const totals = projections.superAgentUsage?.totals || projections.tokenUsage
  const input = totals ? (totals.uncachedInputTokens || 0) + (totals.cacheReadTokens || 0) + (totals.cacheWriteTokens || 0) : 0
  const format = value => value === undefined ? text(t, 'detail.unavailable') : value.toLocaleString(localeCode(t))
  const tasks = projections.superCodeTasks
  const toolNames = new Map(snapshot.items.filter(item => item.toolName && item.callId).map(item => [item.callId, item.toolName]))
  const task = tasks?.current?.kind === 'task' ? tasks.current : undefined
  const title = node?.title || node?.displayTitle || text(t, 'detail.title')
  const metrics = [
    [text(t, 'detail.input'), totals ? input : undefined], [text(t, 'detail.output'), totals?.outputTokens],
    [text(t, 'detail.cacheRead'), totals?.cacheReadTokens], [text(t, 'detail.cacheWrite'), totals?.cacheWriteTokens],
  ]
  return React.createElement('section', { className: 'dsh-super-code-detail', 'data-agent-detail': id },
    React.createElement('header', { className: 'dsh-super-code-detail-header' },
      path.length > 1 && React.createElement('nav', { 'aria-label': text(t, 'detail.path'), title: path.map(part => part.title).join(' / ') },
        path.slice(0, -1).map((part, index) => React.createElement('span', { key: part.id }, index > 0 ? ' / ' : '', part.title))),
      React.createElement('div', { className: 'dsh-super-code-detail-heading' },
        React.createElement('h2', { title }, title),
        React.createElement('span', { className: 'dsh-super-code-detail-status', 'data-tone': agentExecutionStatus(node, id === view.root, t).tone }, agentExecutionStatus(node, id === view.root, t).label),
        React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-icon-button', title: text(t, 'detail.refresh'), 'aria-label': text(t, 'detail.refresh'), onClick: latest }, React.createElement(IconRefreshOutline16))),
      React.createElement('details', { className: 'dsh-super-code-usage-details', open: saved.open.has('usage'), onToggle: event => {
        if (event.target !== event.currentTarget) return
        if (event.currentTarget.open) saved.open.add('usage'); else saved.open.delete('usage')
      } },
        React.createElement('summary', null,
          React.createElement('span', { className: 'dsh-super-code-detail-summary' },
            React.createElement('span', { title: text(t, 'detail.total') }, React.createElement('span', null, 'Token'), React.createElement('strong', null, format(totals ? input + (totals.outputTokens || 0) : undefined))),
            React.createElement('span', { title: text(t, 'detail.hitRate') }, React.createElement('span', null, text(t, 'detail.cache')), React.createElement('strong', null, totals ? (input ? Math.round((totals.cacheReadTokens || 0) / input * 100) : 0) + '%' : text(t, 'detail.unavailable')))),
          React.createElement('span', { className: 'dsh-super-code-detail-info-toggle' }, text(t, 'detail.info'), React.createElement(Glyph, { type: 'chevron' }))),
        React.createElement('div', { className: 'dsh-super-code-detail-info' },
          React.createElement('dl', { className: 'dsh-super-code-detail-metrics' }, metrics.map(([label, value]) => React.createElement('div', { key: label }, React.createElement('dt', null, label), React.createElement('dd', null, format(value))))),
          id !== view.root && task?.goal && task.goal !== title && React.createElement('p', { className: 'dsh-super-code-detail-task' }, task.goal),
          id === view.root && React.createElement(TaskMemoryPanel, { state: tasks, t }),
          React.createElement(MemoryActivity, { usage: projections.superCodeMemoryUsage, sessionId: id, openMemory, t })))),
    React.createElement('div', { ref: log, className: 'dsh-super-code-detail-log', 'aria-label': text(t, 'tree.title'), onScroll: event => {
      const element = event.currentTarget
      saved.top = element.scrollTop
      saved.following = !snapshot.earlier && element.scrollHeight - element.clientHeight - element.scrollTop < 32
      if (saved.following) markUnread(false)
    } },
      snapshot.error && React.createElement('p', { role: 'alert' }, text(t, snapshot.error)),
      snapshot.status === 'loading' && React.createElement('p', { role: 'status' }, text(t, 'detail.reading')),
      snapshot.hasMore && React.createElement(ActionButton, { type: 'button', disabled: snapshot.status === 'paging', onClick: inspector.older }, snapshot.status === 'paging' ? text(t, 'detail.read') : text(t, 'detail.older')),
      (snapshot.earlier || snapshot.truncated) && React.createElement(ActionButton, { type: 'button', onClick: latest }, text(t, 'detail.latest')),
      snapshot.status === 'ready' && !snapshot.items.length && React.createElement('p', null, text(t, 'detail.empty')),
      snapshot.items.map(record => React.createElement(AgentMessage, { key: record.seq, record, saved, t, toolName: toolNames.get(record.callId) }))),
    unread && React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-new-content', onClick: () => {
      saved.following = true; log.current.scrollTop = log.current.scrollHeight; markUnread(false)
    } }, text(t, 'detail.new')))
}

// Explicit public Remote contribution; no model tools or private transport hooks.
const remoteStringSchema = {
  parse(value) {
    if (typeof value !== 'string') throw new TypeError('Expected a string')
    return value
  },
}
const remoteStringCodec = { mode: 'strict', typeSymbol: 'string', schema: remoteStringSchema, create: () => remoteStringSchema }
const presetRemoteContribution = {
  package: 'dsh-super-code',
  descriptors: ['status', 'installPreset', 'reinstallPreset', 'synchronize'].map(method => ({
    id: `dsh-super-code:superCodePresets/${method}`, service: 'superCodePresets',
    namespace: 'superCodePresets', method, invocation: { kind: 'direct' },
    parameters: (method === 'reinstallPreset' ? ['previousId', 'id', 'name'] : method === 'installPreset' ? ['id', 'name'] : method === 'synchronize' ? ['language'] : []).map(name => ({
      name, wire: name, source: 'json', codec: remoteStringCodec,
    })),
    result: { mode: 'src-json' },
  })),
}
const memoryRemoteContribution = {
  package: 'dsh-super-code', descriptors: ['list', 'read', 'saveEntry', 'deleteEntry'].map(method => ({
    id: `dsh-super-code:superCodeMemory/${method}`, service: 'superCodeMemory', namespace: 'superCodeMemory', method, invocation: { kind: 'direct' },
    parameters: (method === 'list' ? ['sessionId', 'scope'] : method === 'saveEntry' ? ['sessionId', 'scope', 'topic', 'id', 'content'] : method === 'deleteEntry' ? ['sessionId', 'scope', 'topic', 'id', 'expected'] : ['sessionId', 'scope', 'topic', 'id']).map(name => ({ name, wire: name, source: 'json', codec: remoteStringCodec })), result: { mode: 'src-json' },
  })),
}

// Budget settings use the same public Remote transport as the preset settings.
const budgetRemoteContribution = {
  package: 'dsh-super-code', descriptors: ['readConfig', 'saveConfig', 'resetConfig'].map(method => ({
    id: `dsh-super-code:superCodeBudgets/${method}`, service: 'superCodeBudgets', namespace: 'superCodeBudgets', method, invocation: { kind: 'direct' },
    parameters: (method === 'saveConfig' ? ['content', 'expected'] : method === 'resetConfig' ? ['expected'] : [])
      .map(name => ({ name, wire: name, source: 'json', codec: remoteStringCodec })), result: { mode: 'src-json' },
  })),
}

const budgetFields = [
  { key: 'thresholdRatio', group: 'context', factor: 0.01, min: 1, max: 100, step: 'any' },
  { key: 'retainRatio', group: 'context', factor: 0.01, min: 0, max: 100, step: 'any' },
  { key: 'summaryMaxTokens', group: 'context', factor: 1, min: 1, step: 1 },
  { key: 'ptcTimeoutMs', group: 'execution', factor: 1000, min: 0.001, step: 0.001 },
  { key: 'ptcMaxTimeoutMs', group: 'execution', factor: 1000, min: 0.001, step: 0.001 },
  { key: 'compactionRetries', group: 'advanced', factor: 1, min: 0, max: 10, step: 1 },
  { key: 'maxOverflowRetries', group: 'advanced', factor: 1, min: 0, max: 10, step: 1 },
  { key: 'maxTasks', group: 'superCode', root: true, factor: 1, min: 1, max: 128, step: 1 },
  { key: 'maxContextBytes', group: 'superCode', root: true, factor: 1, min: 1024, max: 262144, step: 1 },
]
function budgetDraft(configuration) {
  return Object.fromEntries([['applyToOfficialPresets', configuration.applyToOfficialPresets ?? false], ['pressureBasis', configuration.budgets?.pressureBasis ?? ''],
    ...budgetFields.map(field => {
      const value = field.root ? configuration[field.key] : configuration.budgets?.[field.key]
      return [field.key, value === undefined ? '' : String(value / field.factor)]
    })])
}
function budgetConfiguration(draft) {
  const config = {}, budgets = {}
  if (draft.applyToOfficialPresets !== undefined) {
    if (typeof draft.applyToOfficialPresets !== 'boolean') return { ok: false, error: 'invalid' }
    config.applyToOfficialPresets = draft.applyToOfficialPresets
  }
  if (draft.pressureBasis) {
    if (!['host', 'window'].includes(draft.pressureBasis)) return { ok: false, error: 'invalid' }
    budgets.pressureBasis = draft.pressureBasis
  }
  for (const field of budgetFields) {
    const input = draft[field.key]?.trim()
    if (!input) continue
    const value = Number(input)
    if (!Number.isFinite(value) || value < field.min || (field.max !== undefined && value > field.max)) return { ok: false, error: 'invalid' }
    const scaled = value * field.factor
    const selected = field.step === 'any' ? scaled : Math.round(scaled)
    if (field.step !== 'any' && (Math.abs(selected - scaled) > 1e-7 || !Number.isSafeInteger(selected))) return { ok: false, error: 'invalid' }
    ;(field.root ? config : budgets)[field.key] = selected
  }
  if ((budgets.retainRatio ?? 0.16) >= (budgets.thresholdRatio ?? 0.8)) return { ok: false, error: 'retain' }
  if (budgets.ptcTimeoutMs !== undefined && budgets.ptcMaxTimeoutMs !== undefined && budgets.ptcTimeoutMs > budgets.ptcMaxTimeoutMs) return { ok: false, error: 'ptc-order' }
  if (Object.keys(budgets).length) config.budgets = budgets
  return { ok: true, configuration: config }
}

function BudgetSettings({ api, t, active }) {
  const [snapshot, setSnapshot] = useState(null)
  const [draft, setDraft] = useState(() => budgetDraft({})), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const alive = useRef(false), pending = useRef(false)
  const receive = value => { setSnapshot(value); setDraft(budgetDraft(value.configuration)) }
  const read = async () => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const response = await api.readConfig()
      if (!response.ok) throw new Error('Remote unavailable')
      if (alive.current) receive(response.value)
    } catch { if (alive.current) setError('connection') }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [api])
  useEffect(() => { if (active && !snapshot && !error) read() }, [api, active])
  const save = async reset => {
    if (pending.current || !snapshot?.writable) return
    const parsed = reset ? { ok: true } : budgetConfiguration(draft)
    if (!parsed.ok) { setError(parsed.error); setNotice(''); return }
    pending.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const response = reset ? await api.resetConfig(String(snapshot.revision))
        : await api.saveConfig(JSON.stringify(parsed.configuration), String(snapshot.revision))
      if (!response.ok) throw new Error('Remote unavailable')
      if (!alive.current) return
      if (response.value.ok) { receive(response.value.snapshot); setNotice(reset ? 'resetDone' : 'saved') }
      else setError(response.value.error)
    } catch { if (alive.current) setError('save-failed') }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  const disabled = busy || !snapshot?.writable
  const dirty = snapshot && JSON.stringify(draft) !== JSON.stringify(budgetDraft(snapshot.configuration))
  const edit = (key, value) => { setDraft(current => ({ ...current, [key]: value })); setError(''); setNotice('') }
  const defaultLabel = (key, field) => {
    const value = field?.root ? snapshot?.defaults?.[key] : snapshot?.defaults?.budgets?.[key]
    const shown = key === 'pressureBasis' ? t('budget.host') : value === undefined ? t('budget.managed') : Number(value / field.factor).toLocaleString('en-US', { maximumFractionDigits: 3 })
    return React.createElement('span', { className: 'dsh-super-code-budget-default' }, text(t, 'budget.defaultValue', { value: shown }))
  }
  const fields = group => budgetFields.filter(field => field.group === group).map(field => {
    const id = `super-code-budget-${field.key}`
    return React.createElement('div', { className: 'dsh-super-code-settings-field', key: field.key },
      React.createElement('label', { htmlFor: id }, t(`budget.${field.key}`), ' ', defaultLabel(field.key, field)),
      React.createElement('input', { id, type: 'number', inputMode: 'decimal', value: draft[field.key],
        min: field.min, max: group === 'execution' && snapshot?.ptcMaxTimeoutMs ? snapshot.ptcMaxTimeoutMs / 1000 : field.max,
        step: field.step, placeholder: t('budget.inherit'), disabled: disabled || (group === 'execution' && snapshot?.ptcMaxTimeoutMs === false),
        onChange: event => edit(field.key, event.target.value) }))
  })
  return React.createElement('section', { className: 'dsh-super-code-budgets' },
    React.createElement('form', { 'aria-label': t('budget.title'), 'aria-busy': busy, onSubmit: event => { event.preventDefault(); save(false) } },
      React.createElement('p', { className: 'dsh-super-code-budget-hint' }, t('budget.scope')),
      React.createElement('section', { className: 'dsh-super-code-budget-group', 'aria-labelledby': 'super-code-common-title' },
      React.createElement('h3', { id: 'super-code-common-title' }, t('budget.common')),
      React.createElement('label', { className: 'dsh-super-code-budget-switch' },
        React.createElement('input', { type: 'checkbox', role: 'switch', checked: draft.applyToOfficialPresets, disabled,
          'aria-describedby': 'super-code-official-hint', onChange: event => edit('applyToOfficialPresets', event.target.checked) }),
        React.createElement('span', null, t('budget.applyToOfficialPresets'), ' ', React.createElement('span', { className: 'dsh-super-code-budget-default' }, text(t, 'budget.defaultValue', { value: t('budget.off') })))),
      React.createElement('p', { id: 'super-code-official-hint', className: 'dsh-super-code-budget-hint' }, t('budget.officialHint')),
      React.createElement('p', { className: 'dsh-super-code-budget-hint' }, t('budget.defaults')),
      React.createElement('fieldset', null, React.createElement('legend', null, t('budget.context')),
        React.createElement('div', { className: 'dsh-super-code-budget-grid' },
          React.createElement('div', { className: 'dsh-super-code-settings-field' },
            React.createElement('label', { id: 'super-code-budget-basis-label' }, t('budget.pressureBasis'), ' ', defaultLabel('pressureBasis')),
            React.createElement(SelectControl, { id: 'super-code-budget-basis', label: t('budget.pressureBasis'), value: draft.pressureBasis,
              choices: [['', t('budget.inherit')], ['host', t('budget.host')], ['window', t('budget.window')]], disabled,
              onChange: value => edit('pressureBasis', value) })), fields('context')),
        React.createElement('small', null, t('budget.contextHint'))),
      React.createElement('fieldset', null, React.createElement('legend', null, t('budget.execution')),
        React.createElement('div', { className: 'dsh-super-code-budget-grid' }, fields('execution')),
        React.createElement('small', null, t(snapshot?.ptcMaxTimeoutMs === false ? 'budget.ptcUnavailable' : 'budget.ptcHint')),
        snapshot?.ptcMaxTimeoutMs && React.createElement('small', null, text(t, 'budget.ptcCeiling', { seconds: snapshot.ptcMaxTimeoutMs / 1000 }))),
      React.createElement('details', { className: 'dsh-super-code-budget-more' },
        React.createElement('summary', null, t('budget.advanced')),
        React.createElement('div', { className: 'dsh-super-code-budget-grid' }, fields('advanced')))),
      React.createElement('section', { className: 'dsh-super-code-budget-group dsh-super-code-budget-exclusive', 'aria-labelledby': 'super-code-exclusive-title' },
        React.createElement('h3', { id: 'super-code-exclusive-title' }, t('budget.superCode')),
        React.createElement('p', { className: 'dsh-super-code-budget-hint' }, t('budget.superCodeHint')),
        React.createElement('div', { className: 'dsh-super-code-budget-grid' }, fields('superCode'))),
      !busy && snapshot && !snapshot.writable && React.createElement('small', null, t('budget.error.read-only')),
      error && React.createElement('p', { role: 'alert' }, t(`budget.error.${error}`)),
      notice && React.createElement('p', { role: 'status', className: 'dsh-super-code-budget-hint' }, t(`budget.${notice}`)),
      React.createElement('div', { className: 'dsh-super-code-settings-form-actions' },
        error && React.createElement(ActionButton, { type: 'button', disabled: busy, onClick: read }, t('budget.reload')),
        React.createElement(ActionButton, { type: 'button', disabled, onClick: () => save(true) }, t('budget.reset')),
        React.createElement(ActionButton, { type: 'submit', className: 'dsh-super-code-primary-button', disabled: disabled || !dirty }, t(busy ? 'budget.saving' : 'budget.save')))))
}

// Old hosts render file metadata. Synchronize through our own Remote, then
// reload their cached roster only when a managed field actually changed.
function synchronizePresetDisplay(api, locale, reload, onError, preferenceScope) {
  let disposed = false, running = false, pending = '', last = '', needsReload = false
  let observed = locale.getSnapshot().active, awaitingPreference = false, settled = false
  const changed = () => {
    const language = locale.getSnapshot().active
    if (language !== observed) { observed = language; awaitingPreference = !!preferenceScope }
    const preference = preferenceScope?.getSnapshot()
    // Locale publishes optimistically, before its host write starts. A reload
    // must wait for that preference to appear in the accepted public snapshot.
    settled = preference?.status !== 'loading'
    if (preference?.status === 'ready' && preference.mode !== 'memory') {
      if (preference.value?.preference === language) awaitingPreference = false
      else if (awaitingPreference || preference.value?.preference !== undefined) settled = false
    }
    if (!settled) return
    pending = language
    if (running || (pending === last && !needsReload)) return
    running = true
    void (async () => {
      try {
        while (!disposed && settled && pending !== last) {
          const language = pending
          const result = await api.synchronize(language)
          if (!result.ok) throw new Error('Preset display synchronization failed')
          last = language
          needsReload ||= result.value.changed
        }
        if (!disposed && settled && needsReload && pending === last) reload()
      } catch (error) { if (!disposed) onError(error) }
      finally { running = false }
    })()
  }
  const unsubscribe = locale.subscribe(changed)
  const unsubscribePreference = preferenceScope ? preferenceScope.subscribe(changed) : () => {}
  changed()
  return () => { disposed = true; unsubscribe(); unsubscribePreference() }
}

function PresetSettings({ api, budgetApi, t }) {
  const [tab, setTab] = useState('preset')
  const [status, setStatus] = useState(null), [customId, setCustomId] = useState(null)
  const reinstall = status?.reinstallable ?? status?.state === 'installed'
  const name = customId ?? (reinstall ? status.id : 'super-code')
  const [customDisplayName, setCustomDisplayName] = useState(null)
  const displayName = customDisplayName ?? (reinstall ? status.name || t('preset.title') : t('preset.title'))
  const [busy, setBusy] = useState(true), [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const dialog = useRef(null)
  const alive = useRef(false), pending = useRef(false)
  useEffect(() => {
    if (!confirmation || !dialog.current) return
    const element = dialog.current
    element.showModal()
    element.querySelector('[data-super-code-cancel]')?.focus()
    // Removing the focused list row can leave focus outside the native dialog.
    // Capture Escape before the host's document listener closes Settings too.
    const target = element.ownerDocument.defaultView
    const cancel = event => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      setConfirmation(null)
    }
    target.addEventListener('keydown', cancel, true)
    return () => {
      target.removeEventListener('keydown', cancel, true)
      if (element.open) element.close()
    }
  }, [confirmation !== null])
  const run = async (install, confirmed = null) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try {
      const installName = customDisplayName === null ? '' : displayName.trim()
      const response = !install ? await api.status() : confirmed
        ? await api.reinstallPreset(confirmed.previousId, confirmed.id, confirmed.name)
        : await api.installPreset(name.trim(), installName)
      if (!response.ok) throw new Error('Remote unavailable')
      if (!alive.current) return
      const value = response.value
      setStatus(install ? value.status : value)
      if (install && !value.ok) setError(`preset.error.${value.error}`)
      if (!install || value.ok) {
        const synced = await api.synchronize(localeCode(t))
        if (!synced.ok) throw new Error('Preset display synchronization failed')
        if (install || synced.value.changed) window.location.reload()
      }
    } catch {
      if (alive.current) setError('preset.error.connection')
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  useEffect(() => { alive.current = true; run(false); return () => { alive.current = false } }, [api])
  const submit = () => {
    if (busy || pending.current || !displayName.trim() || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name.trim())) return
    if (reinstall) {
      setConfirmation([{ previousId: status.id, id: name.trim(),
        name: customDisplayName === null && displayName === t('preset.title') ? '' : displayName.trim(), label: displayName.trim() }])
    } else run(true)
  }
  const available = status && ['available', 'installed'].includes(status.state)
  const versionState = status?.presetVersion ? status.presetVersion === status.pluginVersion ? 'match' : 'mismatch' : 'unknown'
  return React.createElement('section', { className: 'dsh-super-code-settings' },
    React.createElement('div', { className: 'dsh-super-code-settings-tabs', role: 'tablist', 'aria-label': t('settings.tabs'), onKeyDown: event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const selected = event.key === 'Home' ? 'preset' : event.key === 'End' ? 'context' : tab === 'preset' ? 'context' : 'preset'
      setTab(selected)
      event.currentTarget.querySelector(`#super-code-tab-${selected}`)?.focus()
    } }, ...['preset', 'context'].map(value => React.createElement('button', { key: value, type: 'button', role: 'tab',
      id: `super-code-tab-${value}`, 'aria-selected': tab === value, 'aria-controls': `super-code-panel-${value}`,
      tabIndex: tab === value ? 0 : -1, onClick: () => setTab(value) }, t(`settings.${value}Tab`)))),
    React.createElement('div', { className: 'dsh-super-code-settings-body' },
      React.createElement('div', { role: 'tabpanel', id: 'super-code-panel-preset', 'aria-labelledby': 'super-code-tab-preset', hidden: tab !== 'preset' },
      React.createElement('header', { className: 'dsh-super-code-settings-header' },
        React.createElement('span', { className: 'dsh-super-code-settings-mark', 'aria-hidden': true }, React.createElement(Glyph, { type: 'code' })),
        React.createElement('div', { className: 'dsh-super-code-settings-head-text' },
          React.createElement('h2', { className: 'dsh-super-code-settings-name' }, t('preset.title')),
          React.createElement('p', { className: 'dsh-super-code-settings-description' }, t('preset.description')))),
      React.createElement('div', { className: 'dsh-super-code-settings-summary' },
        React.createElement('div', { className: 'dsh-super-code-settings-status-row' },
          status ? React.createElement('p', { className: 'dsh-super-code-preset-status', role: 'status', 'data-available': available },
            React.createElement('i', { 'aria-hidden': true }),
            React.createElement('span', null, t(status.delivery === 'declaration' && status.state === 'installed' ? 'preset.state.declaredInstalled' : `preset.state.${status.state}`)),
            React.createElement('code', null, status.id))
            : React.createElement('p', { className: 'dsh-super-code-preset-status', role: 'status' }, busy ? t('preset.working') : t('preset.unavailableHint')),
          React.createElement('div', { className: 'dsh-super-code-settings-actions' },
            React.createElement(ActionButton, { type: 'button', disabled: busy, onClick: () => run(false), 'aria-label': t('preset.refresh') },
              React.createElement(IconRefreshOutline16), t('preset.refresh')))),
        status && React.createElement('dl', { className: 'dsh-super-code-preset-versions' },
          React.createElement('div', null, React.createElement('dt', null, t('preset.pluginVersion')), React.createElement('dd', null, status.pluginVersion)),
          React.createElement('div', null, React.createElement('dt', null, t('preset.presetVersion')), React.createElement('dd', null, status.state === 'missing' ? t('preset.versionMissing') : status.presetVersion || t('preset.versionUnknown')))),
        status && status.state !== 'missing' && React.createElement('p', { className: 'dsh-super-code-version-hint', role: 'status', 'data-version-state': versionState },
          t(versionState === 'match' ? 'preset.versionMatches' : versionState === 'mismatch' ? 'preset.versionMismatch' : 'preset.versionUnknownHint'),
          versionState === 'mismatch' && ` ${t(reinstall && status.authorable ? 'preset.versionReinstallHint' : 'preset.versionReloadHint')}`)),
      status?.authorable && React.createElement('form', { onSubmit: event => { event.preventDefault(); submit() } },
        React.createElement('h3', null, t('preset.configuration')),
        React.createElement('div', { className: 'dsh-super-code-settings-field' },
          React.createElement('label', { htmlFor: 'super-code-display-name' }, t('preset.displayName')),
          React.createElement('input', { id: 'super-code-display-name', value: displayName, maxLength: 120, required: true, disabled: busy, 'aria-describedby': 'super-code-display-name-hint', onChange: event => setCustomDisplayName(event.target.value) }),
          React.createElement('small', { id: 'super-code-display-name-hint' }, t('preset.displayNameHint'))),
        React.createElement('div', { className: 'dsh-super-code-settings-field' },
          React.createElement('label', { htmlFor: 'super-code-preset-name' }, t('preset.name')),
          React.createElement('input', { id: 'super-code-preset-name', className: 'dsh-super-code-technical', value: name, maxLength: 64, disabled: busy,
            pattern: '[a-z0-9][a-z0-9\\-]{0,63}', required: true, autoComplete: 'off', spellCheck: false,
            'aria-describedby': 'super-code-preset-name-hint', onChange: event => setCustomId(event.target.value) }),
          React.createElement('small', { id: 'super-code-preset-name-hint' }, t(status?.delivery === 'declaration' ? 'preset.declaredNameHint' : 'preset.nameHint'))),
        React.createElement('div', { className: 'dsh-super-code-settings-form-actions' },
          React.createElement(ActionButton, { type: 'submit', className: 'dsh-super-code-primary-button', disabled: busy || !displayName.trim() || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name.trim()) }, t(busy ? 'preset.working' : reinstall ? 'preset.reinstall' : status?.delivery === 'declaration' ? 'preset.installDeclared' : 'preset.install')))),
      React.createElement('div', { className: 'dsh-super-code-settings-guidance' },
        status && !status.authorable && ['missing', 'broken'].includes(status.state) && React.createElement('p', { role: 'note' }, t('preset.unavailableHint')),
        status?.userConflict && status.state !== 'conflict' && React.createElement('p', null, t('preset.userConflict')),
        status?.delivery === 'declaration' && !status.authorable && React.createElement('p', { role: 'note' }, t('preset.declaredReadonly')),
        status?.delivery === 'directory' && !status.authorable && React.createElement('p', { role: 'note' }, t('preset.readonly'))),
      error && React.createElement('p', { role: 'alert' }, t(error))),
      React.createElement('div', { role: 'tabpanel', id: 'super-code-panel-context', 'aria-labelledby': 'super-code-tab-context', hidden: tab !== 'context' },
        React.createElement(BudgetSettings, { api: budgetApi, t, active: tab === 'context' }))),
    confirmation && React.createElement('dialog', { ref: dialog, className: 'dsh-super-code-confirm',
      'aria-labelledby': 'super-code-confirm-title', 'aria-describedby': 'super-code-confirm-hint',
      onKeyDown: event => { if (event.key === 'Escape') event.stopPropagation() },
      onCancel: event => { event.preventDefault(); event.stopPropagation(); setConfirmation(null) } },
      React.createElement('h3', { id: 'super-code-confirm-title' }, t('preset.confirmTitle')),
      React.createElement('p', { id: 'super-code-confirm-hint' }, t('preset.confirmHint')),
      confirmation.length ? React.createElement('ul', null, ...confirmation.map(item =>
        React.createElement('li', { key: item.previousId },
          React.createElement('div', { className: 'dsh-super-code-confirm-item-info' },
            React.createElement('span', { className: 'dsh-super-code-confirm-previous' }, React.createElement('code', null, item.previousId), ' →'),
            React.createElement('strong', null, item.label), React.createElement('code', { className: 'dsh-super-code-confirm-new-id' }, item.id)),
          React.createElement(ActionButton, { type: 'button', 'aria-label': `${t('preset.remove')}: ${item.previousId}`,
            onClick: () => setConfirmation(items => items.filter(row => row.previousId !== item.previousId)) }, t('preset.remove')))))
        : React.createElement('p', { className: 'dsh-super-code-confirm-empty', role: 'status' }, t('preset.confirmEmpty')),
      React.createElement('div', { className: 'dsh-super-code-confirm-actions' },
        React.createElement(ActionButton, { type: 'button', autoFocus: true, 'data-super-code-cancel': true, onClick: () => setConfirmation(null) }, t('preset.cancel')),
        React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-primary-button', disabled: busy || !confirmation.length,
          onClick: () => {
            if (busy || pending.current || !confirmation.length) return
            const selected = confirmation[0]
            setConfirmation(null)
            run(true, selected)
          } }, t('preset.confirm')))))
}

const inject = [
  'slots', 'remote', 'remote.session', 'sessions', 'locale',
  'sidebarRightTabs', 'sidebarRight',
]

function apply(ctx) {
  const locale = ctx.locale || { register: () => () => {}, bind: () => key => zh[key] || key }
  ctx.effect(() => locale.register(LOCALE_NS, { zh, en }), 'dsh-super-code: dictionaries')
  const t = locale.bind(LOCALE_NS)
  // $mount creates a lifecycle effect on this same fiber; awaiting it from
  // another effect would stall the namespace and the settings contribution.
  void ctx.remote.$mount({ package: 'dsh-super-code', descriptors: [
    ...presetRemoteContribution.descriptors, ...memoryRemoteContribution.descriptors, ...budgetRemoteContribution.descriptors,
  ] }).catch(error => console.warn('Super Code Remote:', error))
  const memoryStates = new WeakMap(), workspaceStates = new WeakMap()
  // Locale already requires its host's preference service. Declare that same
  // service here: Cordis rejects even optional reads without an injection.
  const preferenceService = 'configForms' in ctx ? 'configForms' : 'settingsScope'
  ctx.inject(['remote.superCodePresets', 'remote.superCodeBudgets', preferenceService], ready => {
    const preferenceScope = preferenceService === 'configForms'
      ? ready.configForms.get('locale') : ready.settingsScope.bind({ namespace: 'locale' })
    ready.effect(() => synchronizePresetDisplay(ready.remote.superCodePresets, locale,
      () => window.location.reload(), error => console.warn('Super Code preset display:', error), preferenceScope), 'super-code: preset display')
    ready.slots.inject('settings.section', () => ready.slots.register({
      name: 'settings.section', id: 'super-code', order: 120, label: () => t('preset.title'), locale: LOCALE_NS,
      inject: () => ({ api: ready.remote.superCodePresets, budgetApi: ready.remote.superCodeBudgets }),
    }, PresetSettings))
  })
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshSuperCode = 'true'
    style.textContent = `
/* Host aliases remain the source of theme colors. */
:where(.dsh-super-code-workspace,.dsh-super-code-settings,.dsh-super-code-tree,.dsh-super-code-detail,.dsh-super-code-memory,.dsh-super-code-confirm,.dsh-super-code-select,.dsh-super-code-tooltip){
  --sc-text:var(--dsw-alias-label-primary,#242831);
  --sc-muted:var(--dsw-alias-label-secondary,#6a707a);
  --sc-faint:var(--dsw-alias-label-tertiary,#818793);
  --sc-bg:var(--dsw-alias-bg-layer-1,#fff);
  --sc-surface:var(--dsw-alias-bg-layer-2,#f5f6f8);
  --sc-line:var(--dsw-alias-border-l1,#e2e4e8);
  --sc-hover:color-mix(in srgb,var(--sc-text) 5%,var(--sc-bg));
  --sc-selected:color-mix(in srgb,var(--dsw-color-primary,#3e78c5) 7%,var(--sc-bg));
  --sc-accent:var(--dsw-color-primary,#3e78c5);
  --sc-success:var(--dsw-color-text-success,#197661);
  --sc-warning:var(--dsw-color-text-warning,#9c650c);
  --sc-error:var(--dsw-color-text-error,#bb4545);
  --sc-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --agent-muted:var(--sc-muted);--agent-line:var(--sc-line);
  color:var(--sc-text);font-size:14px;line-height:1.55;letter-spacing:0;
  box-sizing:border-box;min-width:0;
}
:where(.dsh-super-code-workspace,.dsh-super-code-settings,.dsh-super-code-tree,.dsh-super-code-detail,.dsh-super-code-memory,.dsh-super-code-confirm) *{box-sizing:border-box}
:where(.dsh-super-code-workspace,.dsh-super-code-settings,.dsh-super-code-tree,.dsh-super-code-detail,.dsh-super-code-memory,.dsh-super-code-confirm) :is(button,input,select){font:inherit;color:inherit;min-width:0}
:where(.dsh-super-code-workspace,.dsh-super-code-settings,.dsh-super-code-tree,.dsh-super-code-detail,.dsh-super-code-memory,.dsh-super-code-confirm) button{cursor:pointer;transition:background-color .12s,border-color .12s;color:inherit}
:where(.dsh-super-code-workspace,.dsh-super-code-settings,.dsh-super-code-tree,.dsh-super-code-detail,.dsh-super-code-memory,.dsh-super-code-confirm) button:disabled{opacity:.45;cursor:default}
:where(.dsh-super-code-workspace,.dsh-super-code-settings,.dsh-super-code-tree,.dsh-super-code-detail,.dsh-super-code-memory,.dsh-super-code-confirm) :is(button,input,select,summary):focus-visible{outline:2px solid var(--sc-accent);outline-offset:2px}
:where(.dsh-super-code-workspace,.dsh-super-code-settings,.dsh-super-code-tree,.dsh-super-code-detail,.dsh-super-code-memory) :is(input,select){width:100%;height:36px;padding:7px 12px;border:1px solid var(--sc-line);border-radius:8px;background:var(--sc-bg);transition:border-color .12s;outline-offset:2px}
:where(.dsh-super-code-workspace,.dsh-super-code-settings,.dsh-super-code-tree,.dsh-super-code-memory) input::placeholder{color:var(--sc-faint)}
:where(.dsh-super-code-workspace,.dsh-super-code-settings,.dsh-super-code-tree,.dsh-super-code-memory) :is(input,select):hover{border-color:color-mix(in srgb,var(--sc-text) 25%,var(--sc-line))}
.dsh-super-code-technical,.dsh-super-code-confirm code,.dsh-super-code-preset-status code{font-family:var(--sc-mono);font-size:12px}
.dsh-super-code-title-line{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-super-code-glyph{width:18px;height:18px;flex:none;color:var(--sc-muted)}
.dsh-super-code-icon-button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;border:0;border-radius:8px;padding:0;background:transparent;color:var(--sc-muted)}
.dsh-super-code-icon-button:hover,.dsh-super-code-view-button:hover{background:var(--sc-hover);color:var(--sc-text)}
.dsh-super-code-icon-button svg{width:16px;height:16px}
.dsh-super-code-view-button{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:8px;padding:6px 8px;background:transparent;color:var(--sc-muted);font-size:13px}

/* Settings. */
.dsh-super-code-settings{container-type:inline-size;border:1px solid var(--sc-line);border-radius:12px;background:var(--sc-bg);overflow:hidden}
.dsh-super-code-settings-header{display:flex;align-items:center;gap:12px;padding-bottom:20px;margin-bottom:20px;border-bottom:1px solid var(--sc-line)}
.dsh-super-code-settings-mark{display:grid;place-items:center;flex:none;width:40px;height:40px;background:var(--sc-surface);border:1px solid var(--sc-line);border-radius:10px}
.dsh-super-code-settings-mark svg{width:22px;height:22px;color:var(--sc-text)}
.dsh-super-code-settings-head-text{display:grid;gap:4px;min-width:0}
.dsh-super-code-settings-name{font-size:16px;font-weight:600;line-height:1.4;margin:0}
.dsh-super-code-settings-description{font-size:13px;color:var(--sc-muted);margin:0}
.dsh-super-code-settings-body{padding:20px 24px 24px}
.dsh-super-code-settings-summary{padding:16px;border-radius:12px;background:var(--sc-surface)}
.dsh-super-code-settings-status-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dsh-super-code-preset-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0;font-size:13px;min-width:0;flex:1}
.dsh-super-code-preset-status>i{width:7px;height:7px;flex:none;border-radius:50%;background:var(--sc-warning)}
.dsh-super-code-preset-status[data-available=true]>i{background:var(--sc-success)}
.dsh-super-code-preset-status>span{font-weight:500}
.dsh-super-code-preset-status code{color:var(--sc-muted);overflow-wrap:anywhere}
.dsh-super-code-settings-actions{display:flex;flex:none;margin-left:auto}
.dsh-super-code-settings-actions button,.dsh-super-code-settings-form-actions button,.dsh-super-code-confirm button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;border:1px solid var(--sc-line);border-radius:8px;background:var(--sc-bg);padding:5px 10px;font-size:13px}
.dsh-super-code-settings-actions button:hover,.dsh-super-code-confirm button:hover{background:var(--sc-hover)}
.dsh-super-code-settings-actions svg{width:14px;height:14px}
.dsh-super-code-preset-versions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:16px 0 0;padding-top:16px;border-top:1px solid var(--sc-line)}
.dsh-super-code-preset-versions>div+div{border-left:1px solid var(--sc-line);padding-left:16px}
.dsh-super-code-preset-versions dt{font-size:12px;color:var(--sc-muted)}
.dsh-super-code-preset-versions dd{font-family:var(--sc-mono);font-variant-numeric:tabular-nums;font-size:15px;margin:4px 0 0;overflow-wrap:anywhere}
.dsh-super-code-version-hint{font-size:12px;color:var(--sc-muted);margin:12px 0 0;overflow-wrap:anywhere}
.dsh-super-code-version-hint[data-version-state=mismatch],.dsh-super-code-version-hint[data-version-state=unknown]{padding:10px 12px;background:color-mix(in srgb,var(--sc-warning) 8%,var(--sc-bg));border-left:2px solid var(--sc-warning);border-radius:0 6px 6px 0;color:var(--sc-text)}
.dsh-super-code-settings form{display:grid;gap:16px;margin-top:24px}
.dsh-super-code-settings form>h3{margin:0;font-size:14px;font-weight:600}
.dsh-super-code-settings-field{display:grid;gap:6px}
.dsh-super-code-settings label{font-size:13px;font-weight:500}
.dsh-super-code-settings small{display:block;font-size:12px;color:var(--sc-muted);line-height:1.6;overflow-wrap:anywhere}
.dsh-super-code-settings-form-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:12px;padding-top:4px}
.dsh-super-code-settings-form-actions>small{flex:1;min-width:220px}
.dsh-super-code-settings-form-actions>button{margin-left:auto;flex:none}
.dsh-super-code-settings .dsh-super-code-primary-button,.dsh-super-code-confirm .dsh-super-code-primary-button{background:var(--sc-text);border-color:var(--sc-text);color:var(--sc-bg);font-weight:500}
.dsh-super-code-settings .dsh-super-code-primary-button:hover,.dsh-super-code-confirm .dsh-super-code-primary-button:hover{background:color-mix(in srgb,var(--sc-text) 85%,var(--sc-bg))}
.dsh-super-code-settings-guidance:empty{display:none}
.dsh-super-code-settings-guidance{margin-top:20px;padding-top:12px;border-top:1px solid var(--sc-line);color:var(--sc-muted);font-size:12px}
.dsh-super-code-settings-guidance p{margin:0 0 4px}
.dsh-super-code-settings-tabs{display:flex;gap:24px;padding:0 24px;border-bottom:1px solid var(--sc-line)}
.dsh-super-code-settings-tabs>[role=tab]{border:0;border-bottom:2px solid transparent;background:none;color:var(--sc-muted);padding:12px 0;font-size:13px;cursor:pointer}
.dsh-super-code-settings-tabs>[role=tab][aria-selected=true]{border-bottom-color:var(--sc-text);color:var(--sc-text);font-weight:600}
.dsh-super-code-settings-tabs>[role=tab]:focus-visible{outline:2px solid var(--sc-active);outline-offset:3px;border-radius:2px}
.dsh-super-code-settings [role=tabpanel][hidden]{display:none}
.dsh-super-code-budgets form{gap:24px}
.dsh-super-code-budget-hint{margin:0;color:var(--sc-muted);font-size:12px;line-height:1.65}
.dsh-super-code-budget-group{display:flex;flex-direction:column;gap:16px;min-width:0}
.dsh-super-code-budget-group h3{margin:0;font-size:14px;font-weight:600}
.dsh-super-code-budget-exclusive{border-top:1px solid var(--sc-line);padding-top:24px}
.dsh-super-code-budget-switch{display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer}
.dsh-super-code-budget-switch input{width:30px;height:17px;flex:none;accent-color:var(--sc-active);cursor:pointer}
.dsh-super-code-budget-default{color:var(--sc-muted);font-weight:400;font-size:12px}
.dsh-super-code-budgets fieldset{min-width:0;margin:0;border:0;padding:0}
.dsh-super-code-budgets legend{font-size:13px;font-weight:500;margin-bottom:12px;padding:0}
.dsh-super-code-budget-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px}
.dsh-super-code-budgets fieldset>small{margin-top:8px}
.dsh-super-code-budget-more>summary{cursor:pointer;color:var(--sc-muted);font-size:13px;margin-bottom:12px}
.dsh-super-code-budgets .dsh-super-code-settings-form-actions>button{margin-left:0}
.dsh-super-code-budgets .dsh-super-code-settings-form-actions{border-top:1px solid var(--sc-line);padding-top:16px}
@container(max-width:420px){.dsh-super-code-budget-grid{grid-template-columns:1fr}.dsh-super-code-settings-tabs{padding:0 16px}}
.dsh-super-code-settings [role=alert],.dsh-super-code-detail [role=alert],.dsh-super-code-tree-error{font-size:13px;color:var(--sc-error);overflow-wrap:anywhere}
@container(max-width:420px){.dsh-super-code-settings-header{padding-bottom:16px;margin-bottom:16px}.dsh-super-code-settings-body{padding:16px}.dsh-super-code-settings-summary{padding:12px}.dsh-super-code-settings-status-row{gap:8px}.dsh-super-code-preset-status{flex-basis:100%}.dsh-super-code-settings-form-actions>small{min-width:0;flex-basis:100%}}

/* Confirmation. */
.dsh-super-code-confirm{width:min(520px,calc(100vw - 32px));max-height:calc(100dvh - 48px);overflow:auto;border:1px solid var(--sc-line);border-radius:16px;padding:24px;background:var(--sc-bg);box-shadow:0 12px 48px #0003}
.dsh-super-code-confirm::backdrop{background:#10182066}
.dsh-super-code-confirm h3{font-size:16px;font-weight:600;margin:0 0 8px}
.dsh-super-code-confirm>p{font-size:13px;color:var(--sc-muted);margin:0 0 16px;line-height:1.7}
.dsh-super-code-confirm ul{padding:0;list-style:none;margin:20px 0;background:var(--sc-surface);border-radius:12px;overflow:hidden}
.dsh-super-code-confirm li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px;overflow-wrap:anywhere}
.dsh-super-code-confirm li+li{border-top:1px solid var(--sc-line)}
.dsh-super-code-confirm li>button{background:transparent;flex:none;font-size:12px}
.dsh-super-code-confirm-item-info{display:grid;gap:3px;min-width:0}
.dsh-super-code-confirm-item-info strong{font-size:14px;font-weight:500}
.dsh-super-code-confirm-previous,.dsh-super-code-confirm-new-id{font-size:12px;color:var(--sc-muted)}
.dsh-super-code-confirm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
.dsh-super-code-confirm .dsh-super-code-confirm-empty{padding:20px 16px;background:var(--sc-surface);border-radius:12px}

/* Exactly one section fills the pane; the other keeps its clickable heading. */
.dsh-super-code-workspace{height:100%;min-height:0;overflow:auto;background:var(--sc-bg)}
.dsh-super-code-workspace-layout{display:grid;height:100%;min-height:324px;min-width:0}
.dsh-super-code-workspace-collapsed{display:flex;align-items:center;border-block:1px solid var(--sc-line);background:var(--sc-bg);padding:0 12px}
.dsh-super-code-section-toggle{display:flex;align-items:center;gap:6px;flex:1;min-width:0;width:100%;min-height:36px;border:0;border-radius:6px;background:transparent;padding:6px 8px;text-align:left}
.dsh-super-code-section-toggle>.dsh-super-code-tree-count{margin-left:auto}
.dsh-super-code-section-toggle strong{font-size:14px;font-weight:600;white-space:nowrap}
.dsh-super-code-section-toggle>.dsh-super-code-glyph{width:16px;height:16px}
.dsh-super-code-section-toggle>.dsh-super-code-glyph:first-child{width:12px;height:12px;transition:transform .12s}
.dsh-super-code-section-toggle[aria-expanded=false]>.dsh-super-code-glyph:first-child{transform:rotate(-90deg)}
.dsh-super-code-section-toggle:hover{background:var(--sc-hover)}
.dsh-super-code-workspace-collapsed>.dsh-super-code-section-toggle{width:100%;height:100%}

/* Memory library: geometry stays at 76px per row. */
.dsh-super-code-memory{height:100%;min-height:0;display:flex;flex-direction:column;container-type:inline-size}
.dsh-super-code-memory>header{padding:16px;border-bottom:1px solid var(--sc-line);flex:none}
.dsh-super-code-memory-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-super-code-memory h2{font-size:16px;font-weight:600;margin:0}
.dsh-super-code-memory-muted{font-size:13px;color:var(--sc-muted);line-height:1.65;margin:8px 0}
.dsh-super-code-memory-scopes{display:flex;gap:2px;padding:3px;margin:16px 0 12px;border-radius:18px;background:var(--sc-surface)}
.dsh-super-code-memory-scopes button{flex:1;min-height:28px;padding:3px 8px;border:0;border-radius:16px;font-size:13px;background:transparent;color:var(--sc-muted)}
.dsh-super-code-memory-scopes button[aria-pressed=true]{background:var(--sc-bg);color:var(--sc-text);box-shadow:inset 0 0 0 1px var(--sc-line)}
.dsh-super-code-memory-search{position:relative;margin-bottom:8px}
.dsh-super-code-memory-search>svg{position:absolute;left:11px;top:9px;width:16px;height:16px;color:var(--sc-muted);pointer-events:none}
.dsh-super-code-memory-search input{padding-left:34px}
.dsh-super-code-memory small{font-size:12px;color:var(--sc-muted);overflow-wrap:anywhere}
.dsh-super-code-memory-workspace{flex:1;display:flex;flex-direction:column;min-height:0;background:var(--sc-surface)}
.dsh-super-code-memory-topic-index{display:flex;flex-direction:column;flex:none;gap:8px;min-width:0;padding:12px 16px;border-bottom:1px solid var(--sc-line);background:var(--sc-bg)}
.dsh-super-code-memory-topic-label{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:500;color:var(--sc-muted)}
.dsh-super-code-memory-topic-label>span{padding:0 5px;border-radius:4px;background:var(--sc-surface);font-variant-numeric:tabular-nums}
.dsh-super-code-memory-topic-options{display:flex;gap:6px;overflow:auto;min-width:0;padding:2px 0 5px}
.dsh-super-code-memory-topic-index button{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:5px 8px;border:1px solid var(--sc-line);border-radius:8px;background:var(--sc-bg);color:var(--sc-muted);font-size:12px;white-space:nowrap}
.dsh-super-code-memory-topic-index button .dsh-super-code-glyph{width:14px;height:14px}
.dsh-super-code-memory-topic-index button>span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dsh-super-code-memory-topic-index button small{font-size:11px;line-height:1.3;min-width:16px;text-align:center;padding:1px 4px;border-radius:4px;background:var(--sc-surface);font-variant-numeric:tabular-nums}
.dsh-super-code-memory-topic-index button:hover{background:var(--sc-hover);color:var(--sc-text)}
.dsh-super-code-memory-topic-index button[aria-pressed=true]{border-color:var(--sc-accent);background:var(--sc-selected);color:var(--sc-text)}
.dsh-super-code-memory-results{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
.dsh-super-code-memory-list-heading{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:12px 16px 8px;flex:none}
.dsh-super-code-memory-list-heading strong{font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-super-code-memory-list-heading small{font-size:11px;flex:none}
.dsh-super-code-memory-list{flex:1;min-height:0;overflow:auto;padding:0 12px;background:var(--sc-surface)}
.dsh-super-code-memory-list>[role=listitem]{height:76px;padding-bottom:6px}
.dsh-super-code-memory-row{position:relative;display:flex;flex-direction:column;justify-content:center;gap:2px;width:100%;height:70px;border:1px solid var(--sc-line);border-radius:10px;padding:6px 12px 6px 16px;text-align:left;background:var(--sc-bg);box-shadow:0 1px 2px #00000008;overflow:hidden}
.dsh-super-code-memory-row:before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--sc-accent)}
.dsh-super-code-memory-row[data-kind=constraint]:before{background:var(--sc-warning)}
.dsh-super-code-memory-row[data-kind=fact]:before{background:var(--sc-accent)}
.dsh-super-code-memory-row[data-kind=experience]:before{background:var(--sc-success)}
.dsh-super-code-memory-row:hover{background:var(--sc-hover);border-color:color-mix(in srgb,var(--sc-accent) 35%,var(--sc-line))}
.dsh-super-code-memory-row-heading{display:flex;align-items:center;gap:6px;min-width:0;line-height:14px}
.dsh-super-code-memory-row-heading .dsh-super-code-glyph{width:12px;height:12px;color:var(--sc-faint)}
.dsh-super-code-memory-row-topic{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sc-muted);font-size:11px}
.dsh-super-code-memory-row-kind{color:var(--sc-muted);white-space:nowrap}
.dsh-super-code-memory-row strong{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:16px}
.dsh-super-code-memory-row-meta{display:flex;align-items:center;gap:8px;font-size:10px;color:var(--sc-muted);white-space:nowrap;line-height:12px}
.dsh-super-code-memory-row-meta>span+span{border-left:1px solid var(--sc-line);padding-left:8px;font-family:var(--sc-mono)}
.dsh-super-code-memory-empty{padding:24px 8px;color:var(--sc-muted);font-size:13px;line-height:1.8}
.dsh-super-code-memory-body{flex:1;min-height:0;overflow:auto;padding:16px;background:var(--sc-surface)}
.dsh-super-code-memory-body article{padding:16px;border:1px solid var(--sc-line);border-radius:12px;background:var(--sc-bg);box-shadow:0 1px 3px #0000000a}
.dsh-super-code-memory-detail-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;color:var(--sc-muted);font-size:11px}
.dsh-super-code-memory-detail-meta>span{display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border-radius:6px;background:var(--sc-surface)}
.dsh-super-code-memory-detail-meta>span:first-child{background:var(--sc-selected);color:var(--sc-accent)}
.dsh-super-code-memory-detail-meta .dsh-super-code-glyph{width:13px;height:13px;color:inherit}
.dsh-super-code-memory-body h3{font-size:16px;font-weight:600;line-height:1.6;margin:12px 0 16px;overflow-wrap:anywhere}
.dsh-super-code-memory-detail{font-size:14px;white-space:pre-wrap;line-height:1.8;overflow-wrap:anywhere}
.dsh-super-code-memory-body dl{padding-top:8px;border-top:1px solid var(--sc-line)}
.dsh-super-code-memory-body dt{font-size:12px;color:var(--sc-muted);margin-top:12px}
.dsh-super-code-memory-body dd{margin:4px 0;font-size:12px;line-height:1.7;overflow-wrap:anywhere}
.dsh-super-code-memory-related{border-top:1px solid var(--sc-line);margin-top:20px;padding-top:12px}
.dsh-super-code-memory-related h4{font-size:12px;font-weight:500;color:var(--sc-muted);margin:0 0 6px}
.dsh-super-code-memory-related button{display:flex;align-items:center;gap:8px;width:100%;padding:8px 4px;border:0;border-radius:6px;background:transparent;font-size:12px;text-align:left}
.dsh-super-code-memory-related button:hover{background:var(--sc-hover)}
.dsh-super-code-memory-related button>span{min-width:0;flex:1;overflow-wrap:anywhere}
.dsh-super-code-memory-related .dsh-super-code-glyph{width:14px;height:14px}
@container(min-width:520px){
  .dsh-super-code-memory-workspace{display:grid;grid-template-columns:170px minmax(0,1fr)}
  .dsh-super-code-memory-topic-index{min-height:0;padding:16px 10px;border-bottom:0;border-right:1px solid var(--sc-line)}
  .dsh-super-code-memory-topic-label{padding:0 6px}
  .dsh-super-code-memory-topic-options{flex-direction:column;gap:4px;padding:2px;min-height:0;overflow:auto}
  .dsh-super-code-memory-topic-index button{width:100%;justify-content:space-between;border-color:transparent;background:transparent}
  .dsh-super-code-memory-topic-index button>span{flex:1;text-align:left}
}
.dsh-super-code-memory-activity{margin-top:12px;font-size:13px}
.dsh-super-code-memory-activity summary{cursor:pointer;color:var(--sc-muted)}
.dsh-super-code-memory-activity-list{max-height:200px;overflow:auto}
.dsh-super-code-memory-activity-list button{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 8px;width:100%;border:0;border-bottom:1px solid var(--sc-line);background:transparent;padding:8px 0;text-align:left;font-size:12px}
.dsh-super-code-memory-activity-list small{grid-column:2;color:var(--sc-muted);font-size:11px;overflow-wrap:anywhere}
.dsh-super-code-memory-activity-list span{overflow-wrap:anywhere}
.dsh-super-code-memory-action{color:var(--sc-muted)}
.dsh-super-code-memory-action[data-action=read]{color:var(--sc-accent)}
.dsh-super-code-memory-action[data-action=remember]{color:var(--sc-success)}

/* Direct memory editing keeps one current copy, with no version UI. */
.dsh-super-code-memory-editor{display:grid;align-content:start;gap:12px;flex:1;min-height:0;overflow:auto;padding:12px 16px}
.dsh-super-code-memory-editor-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-super-code-memory-editor label{display:grid;grid-template-columns:1fr auto;gap:6px;font-size:12px}
.dsh-super-code-memory-editor label>:is(input,textarea),.dsh-super-code-memory-editor label>small:last-child{grid-column:1/-1}
.dsh-super-code-memory-editor textarea{font:inherit;color:inherit;resize:vertical;min-height:100px;width:100%;padding:8px 12px;border:1px solid var(--sc-line);border-radius:8px;background:var(--sc-bg)}
.dsh-super-code-memory-editor [role=alert]{margin:0;font-size:12px;color:var(--sc-error)}
.dsh-super-code-memory-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}
.dsh-super-code-memory-actions>button{padding:5px 10px;font-size:12px;border:1px solid var(--sc-line);border-radius:7px;background:var(--sc-bg)}
.dsh-super-code-memory-actions>.dsh-super-code-view-button{margin-right:auto;border:0;padding-left:0}
.dsh-super-code-memory-actions>.dsh-super-code-memory-primary{background:var(--sc-text);color:var(--sc-bg);border-color:var(--sc-text)}
.dsh-super-code-memory-danger{color:var(--sc-error)!important}
.dsh-super-code-memory-editor textarea:focus-visible{outline:2px solid var(--sc-accent);outline-offset:2px}

/* Compact library header leaves room for entries in the shared pane. */
.dsh-super-code-workspace .dsh-super-code-memory>header{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:10px 12px}
.dsh-super-code-workspace .dsh-super-code-memory-heading{display:contents}
.dsh-super-code-workspace .dsh-super-code-memory h2{font-size:14px}
.dsh-super-code-workspace .dsh-super-code-memory-header-actions{display:flex;align-items:center;gap:4px;grid-column:2;grid-row:1}
.dsh-super-code-memory-header-actions>.dsh-super-code-view-button{font-size:12px;white-space:nowrap}
.dsh-super-code-workspace .dsh-super-code-memory-scopes{grid-column:1/-1;margin:0;padding:2px}
.dsh-super-code-workspace .dsh-super-code-memory-search{grid-column:1/-1;margin:0}
.dsh-super-code-workspace .dsh-super-code-memory-topic-index{padding:8px 12px;gap:6px}
.dsh-super-code-workspace .dsh-super-code-memory-list-heading{padding:8px 12px 6px}

/* Graph: reserve space for animated/selected rings before the text stack. */
.dsh-super-code-tree{height:100%;min-height:0;display:flex;flex-direction:column;overflow:auto;container-type:inline-size}
.dsh-super-code-tree>header,.dsh-super-code-graph-legend,.dsh-super-code-graph-controls,.dsh-super-code-history-controls{flex:none}
.dsh-super-code-tree-header{display:flex;flex-direction:column;gap:8px;padding:12px}
.dsh-super-code-tree-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.dsh-super-code-tree-header strong{font-size:15px;font-weight:600;white-space:nowrap}
.dsh-super-code-tree-header .dsh-super-code-title-line{gap:6px;min-width:0}
.dsh-super-code-tree-header .dsh-super-code-title-line>.dsh-super-code-glyph{width:16px;height:16px}
.dsh-super-code-tree-count{font-size:11px;color:var(--sc-muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.dsh-super-code-tree-toolbar{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-super-code-tree-toolbar>.dsh-super-code-icon-button{width:28px;height:28px;border-radius:6px}
.dsh-super-code-tree-toolbar>.dsh-super-code-icon-button svg{width:16px;height:16px}
.dsh-super-code-graph-legend{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:10px;color:var(--sc-muted)}
.dsh-super-code-graph-legend>span{display:flex;align-items:center;gap:5px}
.dsh-super-code-circle.active{--state-color:#008b78}
.dsh-super-code-circle.idle{--state-color:#3971de}
.dsh-super-code-circle.stopped{--state-color:#777d87}
.dsh-super-code-circle.unavailable{--state-color:#b87716}
.dsh-super-code-graph-legend .dsh-super-code-circle,.dsh-super-code-history-list .dsh-super-code-circle{display:block;width:7px;height:7px;flex:none;border-radius:50%;background:var(--state-color)}
.dsh-super-code-graph-legend .dsh-super-code-circle.idle{background:transparent;border:1px solid var(--state-color)}
.dsh-super-code-graph-controls{display:flex;align-items:center;gap:0;padding:0;border:1px solid var(--sc-line);border-radius:7px;color:var(--sc-muted);font-size:12px;flex:none}
.dsh-super-code-graph-controls button,.dsh-super-code-history-controls button{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:28px;min-width:28px;padding:3px 6px;border:0;border-radius:6px;background:transparent;font-size:12px}
.dsh-super-code-graph-controls button:hover,.dsh-super-code-history-controls button:hover{background:var(--sc-hover)}
.dsh-super-code-graph-controls span{min-width:36px;text-align:center;font-family:var(--sc-mono);font-size:11px}
.dsh-super-code-history-controls{display:flex;align-items:center;gap:6px;border-left:1px solid var(--sc-line);padding-left:6px}
.dsh-super-code-history-controls .dsh-super-code-glyph{width:16px;height:16px}
.dsh-super-code-history-controls button{white-space:nowrap}
.dsh-super-code-history-controls .dsh-super-code-action-count{font-family:var(--sc-mono);font-size:11px}
.dsh-super-code-history-controls button[aria-expanded=true]{background:var(--sc-selected);border-color:var(--sc-accent)}
@container(max-width:360px){
  .dsh-super-code-tree-toolbar{gap:3px}
  .dsh-super-code-graph-controls button{min-width:26px;padding:3px 4px}
  .dsh-super-code-graph-controls span{min-width:28px}
  .dsh-super-code-history-controls{gap:3px;padding-left:3px}
  .dsh-super-code-history-controls button{gap:3px;padding:3px;font-size:11px}
  .dsh-super-code-history-controls .dsh-super-code-glyph{display:none}
}
.dsh-super-code-graph-scroll{flex:1;min-height:180px;overflow:hidden;padding:0 12px;touch-action:none;cursor:grab;user-select:none;border-top:1px solid var(--sc-line);background:var(--sc-surface)}
.dsh-super-code-graph-scroll.dragging,.dsh-super-code-graph-scroll.dragging *{cursor:grabbing!important}
.dsh-super-code-graph{position:relative;transform-origin:0 0}
.dsh-super-code-graph-edges{position:absolute;inset:0;pointer-events:none;stroke:color-mix(in srgb,var(--sc-muted) 35%,var(--sc-surface));stroke-width:1.25}
.dsh-super-code-graph-node{position:absolute;display:flex;align-items:center;flex-direction:column;width:128px;height:${agentTreeNodeHeight}px;gap:16px;padding:0 4px;border:0;border-radius:12px;background:transparent;cursor:pointer}
.dsh-super-code-graph-node[aria-disabled]{cursor:default;opacity:.65}
.dsh-super-code-graph-node>.dsh-super-code-circle{position:relative;display:grid;place-items:center;flex:none;width:40px;height:40px;border-radius:50%!important;corner-shape:round!important;background:linear-gradient(145deg,color-mix(in srgb,var(--state-color) 83%,white),var(--state-color));box-shadow:inset 0 1px 1px #ffffff40,0 2px 6px #00000012;color:#fff;font-size:13px;font-weight:600}
.dsh-super-code-graph-node>.dsh-super-code-circle:after{content:"";position:absolute;inset:-5px;border:1px solid color-mix(in srgb,var(--state-color) 22%,transparent);border-radius:50%;corner-shape:round;pointer-events:none}
.dsh-super-code-graph-node>.dsh-super-code-circle.idle:after{animation:super-agent-breathe 3s ease-in-out infinite}
.dsh-super-code-graph-node>.dsh-super-code-circle.active:after{inset:-6px;border-width:3px;border-color:color-mix(in srgb,var(--state-color) 14%,transparent);border-top-color:var(--state-color);border-right-color:color-mix(in srgb,var(--state-color) 60%,transparent);animation:super-agent-process 1.2s linear infinite}
.dsh-super-code-graph-node>.dsh-super-code-circle.stopped{background:linear-gradient(145deg,#9297a0,#747a84);box-shadow:inset 0 1px 1px #ffffff30}
.dsh-super-code-graph-node>.dsh-super-code-circle.stopped:after{border-color:color-mix(in srgb,var(--state-color) 14%,transparent)}
.dsh-super-code-graph-node>.dsh-super-code-circle.unavailable:after{border-style:dashed;border-color:var(--state-color)}
.dsh-super-code-graph-node:hover>.dsh-super-code-circle{box-shadow:inset 0 1px 1px #ffffff40,0 3px 10px color-mix(in srgb,var(--state-color) 25%,transparent)}
.dsh-super-code-graph-node.selected>.dsh-super-code-circle{outline:2px solid var(--sc-accent);outline-offset:7px}
@keyframes super-agent-breathe{0%,100%{transform:scale(1);opacity:.35}50%{transform:scale(1.12);opacity:.85}}
@keyframes super-agent-process{to{transform:rotate(360deg)}}
.dsh-super-code-tree-content{display:grid;gap:2px;width:100%;min-width:0;text-align:center}
.dsh-super-code-tree-title{height:16px;font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-super-code-node-status{display:flex;align-items:center;justify-content:center;gap:4px;font-size:11px;line-height:14px;color:var(--sc-muted)}
.dsh-super-code-node-status>i{width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}
.dsh-super-code-node-status[data-tone=active]{color:var(--sc-accent)}
.dsh-super-code-node-status[data-tone=unavailable]{color:var(--sc-warning)}
.dsh-super-code-node-status[data-tone=idle]>i{background:transparent;border:1px solid currentColor}
.dsh-super-code-tree-usage{display:flex;flex-direction:column;gap:0;font-size:10px;line-height:12px;color:var(--sc-muted);font-variant-numeric:tabular-nums}
.dsh-super-code-tree-usage>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-super-code-branch-toggle{position:absolute;display:grid;place-items:center;width:22px;height:22px;border:1px solid var(--sc-line);border-radius:50%;padding:0;background:var(--sc-bg);color:var(--sc-muted)}
.dsh-super-code-branch-toggle:hover{color:var(--sc-accent);border-color:currentColor}
.dsh-super-code-tree-empty,.dsh-super-code-tree-error{margin:12px 16px}
.dsh-super-code-tree-more{align-self:center;margin:8px 16px;padding:5px 10px;border:1px solid var(--sc-line);border-radius:8px;background:var(--sc-bg);font-size:13px}
.dsh-super-code-history{display:flex;flex-direction:column;flex:none;height:46%;min-height:220px;max-height:400px;margin:0 12px 12px;padding:12px;border:1px solid var(--sc-line);border-radius:12px;background:var(--sc-surface)}
.dsh-super-code-history>input{flex:none;margin-bottom:8px}
.dsh-super-code-history p{flex:none;font-size:12px;color:var(--sc-muted);margin:0 0 8px;line-height:1.6}
.dsh-super-code-history-filters{display:grid;flex:none;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:8px}
.dsh-super-code-history-filters :is(label,.dsh-super-code-select-field){display:grid;gap:4px;min-width:0;font-size:12px;color:var(--sc-muted)}
.dsh-super-code-history-list{flex:1;min-height:56px;overflow:auto;overflow-anchor:none;overscroll-behavior:contain}
.dsh-super-code-history-list button{display:flex;align-items:center;gap:8px;width:100%;height:56px;padding:8px 4px;text-align:left;border:0;border-radius:8px;background:transparent}
.dsh-super-code-history-list button:hover{background:var(--sc-hover)}
.dsh-super-code-history-list button>span{flex:1;min-width:0}
.dsh-super-code-history-list strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500}
.dsh-super-code-history-list small{font-size:11px;color:var(--sc-muted);white-space:nowrap}
.dsh-super-code-history-list button>span>small{display:block;overflow:hidden;text-overflow:ellipsis}

/* Agent details. */
.dsh-super-code-detail{height:100%;min-height:0;display:flex;flex-direction:column}
.dsh-super-code-detail-header{flex:none;max-height:40%;overflow:auto;padding:10px 12px;border-bottom:1px solid var(--sc-line)}
.dsh-super-code-detail-header nav{font-size:11px;color:var(--sc-muted);line-height:16px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-super-code-detail-heading{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-super-code-detail-heading h2{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600;line-height:20px;margin:0}
.dsh-super-code-detail-heading .dsh-super-code-icon-button{width:28px;height:28px;border-radius:6px}
.dsh-super-code-detail-status{display:inline-flex;align-items:center;flex:none;gap:5px;padding:2px 6px;border-radius:5px;font-size:11px;white-space:nowrap;background:var(--sc-surface);color:var(--sc-muted)}
.dsh-super-code-detail-status:before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}
.dsh-super-code-detail-status[data-tone=active]{color:var(--sc-accent)}
.dsh-super-code-detail-status[data-tone=unavailable]{color:var(--sc-warning)}
.dsh-super-code-detail-task{font-size:14px;line-height:1.7;margin:12px 0 0;overflow-wrap:anywhere}
.dsh-super-code-task-memory{margin-top:16px;padding-top:12px;border-top:1px solid var(--sc-line);font-size:13px;line-height:1.7;overflow-wrap:anywhere}
.dsh-super-code-task-heading{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px}
.dsh-super-code-task-heading strong{font-weight:500}
.dsh-super-code-task-heading span{font-size:12px;color:var(--sc-muted)}
.dsh-super-code-task-memory p{margin:4px 0 0}
.dsh-super-code-task-memory details{margin-top:8px;color:var(--sc-muted)}
.dsh-super-code-task-memory summary{cursor:pointer}
.dsh-super-code-detail-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;margin:0;padding:10px;border-radius:8px;background:var(--sc-surface)}
.dsh-super-code-detail-metrics>div{display:flex;align-items:baseline;justify-content:space-between;gap:6px;min-width:0}
.dsh-super-code-detail-metrics dt{font-size:11px;color:var(--sc-muted)}
.dsh-super-code-detail-metrics dd{font-size:12px;line-height:1.4;margin:0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;font-weight:500}
.dsh-super-code-usage-details{margin-top:4px;color:var(--sc-muted);font-size:12px}
.dsh-super-code-usage-details>summary{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px;border-radius:5px;cursor:pointer;list-style:none}
.dsh-super-code-usage-details>summary::-webkit-details-marker{display:none}
.dsh-super-code-usage-details>summary:hover{background:var(--sc-hover)}
.dsh-super-code-detail-summary{display:flex;align-items:center;gap:16px;min-width:0}
.dsh-super-code-detail-summary>span{display:inline-flex;align-items:baseline;gap:5px;font-size:11px;white-space:nowrap}
.dsh-super-code-detail-summary strong{font-weight:500;font-size:12px;color:var(--sc-text);font-variant-numeric:tabular-nums}
.dsh-super-code-detail-info-toggle{display:inline-flex;align-items:center;gap:3px;flex:none;font-size:11px}
.dsh-super-code-detail-info-toggle .dsh-super-code-glyph{width:13px;height:13px;transition:transform .12s}
.dsh-super-code-usage-details[open]>.dsh-super-code-detail-info-toggle .dsh-super-code-glyph,.dsh-super-code-usage-details[open]>summary .dsh-super-code-detail-info-toggle .dsh-super-code-glyph{transform:rotate(180deg)}
.dsh-super-code-detail-info{padding-top:8px;padding-bottom:2px}
.dsh-super-code-detail-info .dsh-super-code-memory-activity{margin-top:10px;font-size:12px}
.dsh-super-code-detail-info .dsh-super-code-task-memory{margin-top:10px;font-size:12px}
.dsh-super-code-detail-log{flex:1;min-height:0;overflow:auto;padding:14px 14px 24px;background:var(--sc-bg)}
.dsh-super-code-detail-log>button,.dsh-super-code-detail-entry button{border:1px solid var(--sc-line);border-radius:8px;background:var(--sc-bg);padding:5px 8px;margin:0 8px 10px 0;font-size:12px}
.dsh-super-code-detail-entry{display:flex;align-items:flex-start;gap:8px;min-width:0;margin:0 0 16px}
.dsh-super-code-detail-avatar{display:grid;place-items:center;flex:none;width:26px;height:26px;margin-top:2px;border-radius:8px;background:var(--sc-surface);color:var(--sc-muted)}
.dsh-super-code-detail-avatar .dsh-super-code-glyph{width:16px;height:16px;color:inherit}
.dsh-super-code-detail-message{flex:1;min-width:0;padding:10px 12px;border:1px solid var(--sc-line);border-radius:4px 12px 12px 12px;background:var(--sc-bg)}
.dsh-super-code-detail-entry.user{flex-direction:row-reverse;margin-left:28px}
.dsh-super-code-detail-entry.user .dsh-super-code-detail-avatar{background:var(--sc-accent);color:#fff}
.dsh-super-code-detail-entry.user .dsh-super-code-detail-message{border-color:color-mix(in srgb,var(--sc-accent) 22%,var(--sc-line));border-radius:12px 4px 12px 12px;background:var(--sc-selected)}
.dsh-super-code-detail-entry.agent .dsh-super-code-detail-avatar{background:color-mix(in srgb,var(--sc-success) 10%,var(--sc-bg));color:var(--sc-success)}
.dsh-super-code-detail-entry.tool{margin-bottom:12px}
.dsh-super-code-detail-entry.tool .dsh-super-code-detail-message{padding:8px 10px;border-radius:8px;background:var(--sc-surface)}
.dsh-super-code-detail-entry.context .dsh-super-code-detail-message{border-style:dotted;color:var(--sc-muted);background:var(--sc-surface)}
.dsh-super-code-detail-entry.error .dsh-super-code-detail-avatar{color:var(--sc-error);background:color-mix(in srgb,var(--sc-error) 10%,var(--sc-bg))}
.dsh-super-code-detail-entry.error .dsh-super-code-detail-message{border-color:color-mix(in srgb,var(--sc-error) 35%,var(--sc-line));color:var(--sc-error)}
.dsh-super-code-detail-entry-label{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;font-size:11px;font-weight:500;color:var(--sc-muted)}
.dsh-super-code-detail-entry-label>span{min-width:0;overflow-wrap:anywhere}
.dsh-super-code-detail-entry.user .dsh-super-code-detail-entry-label{color:var(--sc-accent)}
.dsh-super-code-detail-entry time{flex:none;font-family:var(--sc-mono);font-size:11px;font-weight:400;color:var(--sc-faint)}
.dsh-super-code-detail-entry pre{min-width:0;font:inherit;font-size:14px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 0}
.dsh-super-code-detail-entry.tool pre{font-family:var(--sc-mono);font-size:12px;line-height:1.6;color:var(--sc-muted)}
.dsh-super-code-detail-message>details{min-width:0;color:var(--sc-muted)}
.dsh-super-code-detail-message>details[open]{color:var(--sc-text)}
.dsh-super-code-detail-message summary{display:flex;align-items:center;gap:6px;cursor:pointer;overflow-wrap:anywhere;list-style:none}
.dsh-super-code-detail-message summary::-webkit-details-marker{display:none}
.dsh-super-code-detail-message summary .dsh-super-code-detail-entry-label{flex:1;min-width:0;font-size:12px}
.dsh-super-code-detail-message summary>.dsh-super-code-glyph{width:14px;height:14px;transition:transform .12s}
.dsh-super-code-detail-message details[open] summary>.dsh-super-code-glyph{transform:rotate(180deg)}
.dsh-super-code-detail-message details pre{margin-top:10px;padding:8px 10px;border:1px solid var(--sc-line);border-radius:7px;background:var(--sc-bg)}
.dsh-super-code-detail-entry button{margin:8px 0 0}
.dsh-super-code-new-content{flex:none;align-self:center;margin:8px 16px 12px;border:1px solid var(--sc-line);border-radius:8px;padding:6px 12px;background:var(--sc-bg);font-size:13px}
@media(hover:none) and (pointer:coarse){:where(.dsh-super-code-workspace,.dsh-super-code-settings,.dsh-super-code-memory,.dsh-super-code-tree) input{font-size:16px}}
@media(prefers-reduced-motion:reduce){:where(.dsh-super-code-workspace,.dsh-super-code-settings,.dsh-super-code-tree,.dsh-super-code-detail,.dsh-super-code-memory,.dsh-super-code-confirm,.dsh-super-code-select) *{transition:none!important;animation:none!important}.dsh-super-code-graph-node>.dsh-super-code-circle:after{animation:none!important}}

/* Same custom trigger and option list for all six dropdowns. Fixed placement
 * keeps history menus visible outside the clipped graph/sidebar viewport. */
.dsh-super-code-select{display:inline-block;min-width:0;width:100%;font-size:12px;vertical-align:middle}
.dsh-super-code-select :is(button,div,span,svg){box-sizing:border-box}
.dsh-super-code-select .dsh-super-code-select-trigger{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;height:36px;min-width:0;padding:7px 10px;border:1px solid var(--sc-line);border-radius:8px;background:var(--sc-bg);color:var(--sc-text);font:inherit;text-align:left;cursor:pointer;transition:border-color .12s,background-color .12s}
.dsh-super-code-select-trigger>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-super-code-select-trigger>svg{flex:none;width:14px;height:14px;color:var(--sc-muted);transition:transform .12s}
.dsh-super-code-select-trigger[aria-expanded=true]>svg{transform:rotate(180deg)}
.dsh-super-code-select .dsh-super-code-select-trigger:hover{background:var(--sc-hover);border-color:color-mix(in srgb,var(--sc-text) 25%,var(--sc-line))}
.dsh-super-code-select .dsh-super-code-select-trigger[aria-expanded=true]{border-color:var(--sc-accent)}
.dsh-super-code-select .dsh-super-code-select-trigger:focus-visible{outline:2px solid var(--sc-accent);outline-offset:2px}
.dsh-super-code-select-trigger:disabled{opacity:.45;cursor:default}
.dsh-super-code-select-menu{position:fixed;z-index:1200;overflow:auto;overscroll-behavior:contain;padding:4px;border:1px solid var(--sc-line);border-radius:10px;background:var(--sc-bg);color:var(--sc-text);box-shadow:0 6px 20px #0002;font-size:12px;line-height:1.5;text-align:left}
.dsh-super-code-select-option{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px;padding:6px 8px;border-radius:6px;cursor:pointer}
.dsh-super-code-select-option>span{min-width:0;overflow-wrap:anywhere}
.dsh-super-code-select-option>svg{flex:none;width:14px;height:14px;color:var(--sc-accent);visibility:hidden}
.dsh-super-code-select-option[aria-selected=true]{font-weight:500}
.dsh-super-code-select-option[aria-selected=true]>svg{visibility:visible}
.dsh-super-code-select-option[data-active=true]{background:var(--sc-selected)}

/* Shared action-name bubble. Fixed outside the panel avoids graph transforms
 * and scroll clipping; dialog bubbles remain in the modal's top layer. */
.dsh-super-code-tooltip{position:fixed;z-index:1400;max-width:min(260px,calc(100vw - 16px));padding:5px 8px;border-radius:6px;background:var(--sc-text);color:var(--sc-bg);box-shadow:0 2px 8px #0002;font-size:12px;line-height:1.5;font-weight:400;text-align:left;overflow-wrap:anywhere;pointer-events:none}
.dsh-super-code-tooltip:after{content:"";position:absolute;left:var(--sc-tooltip-arrow-left);width:6px;height:6px;background:inherit;transform:translateX(-50%) rotate(45deg)}
.dsh-super-code-tooltip[data-side=top]:after{bottom:-3px}
`
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'super-code: browser styles')
  // Keep the original tree kind so restored tabs become the unified workspace.
  const treeId = 'dsh-super-code'
  const treeKind = 'super-agent-agents'
  const disposeTreeType = ctx.sidebarRightTabs.register({
    id: treeId, kind: treeKind,
    title: () => t('workspace.title'),
    guide: [{ order: 40, title: () => t('workspace.title'), description: () => t('workspace.description') }],
  })
  const disposeMemoryType = ctx.sidebarRightTabs.register({ id: 'dsh-super-code-memory', kind: 'super-code-memory',
    patterns: ['dsh-resource://super-code-memory/**'], title: () => t('workspace.title'),
  })
  const openMemory = (sessionId, row) => ctx.sidebarRight.openTab(treeKind, { params: { memory: memoryLibraryAddress(sessionId, row) } })
  const treeActions = {
    // The host unmounts hidden bodies; tab signals live until close/unload.
    treeStates: new WeakMap(),
    refresh: id => ctx.sessions.refreshSubagents ? ctx.sessions.refreshSubagents(id) : ctx.sessions.refreshProjections(id),
    watchCatalog: (id, open) => {
      if (ctx.sessions.setSubagentCatalogOpen) ctx.sessions.setSubagentCatalogOpen(id, open)
      else if (open) void ctx.sessions.refreshProjections(id).catch(error => console.warn('Super Code projections:', error))
    },
    openDetail: child => ctx.sidebarRight.openResource(agentDetailAddress(child), { kind: 'super-agent-detail' }),
  }
  const disposeDetailType = ctx.sidebarRightTabs.register({
    id: 'dsh-super-code-detail', kind: 'super-agent-detail', patterns: ['dsh-resource://super-agent/**'],
    title: address => {
      return agentTabTitle(ctx.sessions.list.getSnapshot(), address, t)
    },
  })
  ctx.slots.inject('sidebar.right.pane.tab.title', function* () {
    for (const [key, titleKey] of [[treeId, 'workspace.title'], ['dsh-super-code-memory', 'workspace.title']]) {
      yield ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key, locale: LOCALE_NS,
        inject: () => ({ titleKey }),
      }, LocalizedTabTitle)
    }
    yield ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: 'dsh-super-code-detail', locale: LOCALE_NS }, AgentDetailTitle)
  })
  const detailActions = { openMemory, detailStates: new WeakMap(), createInspector: (address, initial) => createAgentInspector(
    (target, options) => new SessionEventStream(ctx.remote, target, options), address,
    (request, signal) => ctx.remote.session.page(request, signal), initial, t) }
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: 'dsh-super-code-detail', locale: LOCALE_NS, inject: () => ({ ...detailActions }),
  }, AgentDetail))
  ctx.inject(['remote.superCodeMemory'], ready => {
    ready.slots.inject('sidebar.right.pane.tab', function* () {
      // The hidden legacy key restores old memory tabs and resource URLs.
      for (const key of [treeId, 'dsh-super-code-memory']) yield ready.slots.register({
        name: 'sidebar.right.pane.tab', key, locale: LOCALE_NS,
        inject: () => ({ ...treeActions, api: ready.remote.superCodeMemory, memoryStates, workspaceStates }),
      }, SuperCodeWorkspace)
    })
  })
  ctx.effect(() => disposeTreeType, 'super-code: workspace tab')
  ctx.effect(() => disposeDetailType, 'super-code: Agent detail tab')
  ctx.effect(() => disposeMemoryType, 'super-code: memory library tab')
}

return { inject, apply, budgetDraft, budgetConfiguration, synchronizePresetDisplay, agentSessionState, buildAgentView, visibleAgentRows, agentTreeDisplay, agentTreeTotals, agentTreeLayout, agentExecutionStatus, agentDetailAddress, agentDetailTarget, agentPath, detailRecord, createAgentInspector, agentHistoryRange, agentHistoryRows, agentHistoryWindow, memoryLibraryAddress, memoryLibraryTarget, memoryLibraryNavigation, memoryLibraryWindow, createMemoryEditor }
} })
