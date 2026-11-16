import { WorkspaceSectionToggle } from './controls.js'
import { featureView } from '../ui/boundary.js'
import { text } from '../ui/locale.js'
import React, { useMemo, useState, useRef, useLayoutEffect } from '../ui/react.js'
import { MemoryLibrary, memoryLibraryTarget } from './memory.js'
import { TaskFeedback } from './feedback.js'
import { AgentTree } from './agents.js'

/** Accordion: exactly one open view. Tab state retains drafts across section switches. */
function SuperCodeWorkspace(props) {
  const { tab } = props.useTabInfo()
  const address = typeof tab.navigation?.params?.memory === 'string' ? tab.navigation.params.memory : tab.contentId
  const navigationKey = `${address}/${tab.navigation?.revision || 0}`
  const memoryTarget = memoryLibraryTarget(address, '')
  const saved = useMemo(() => {
    const value = props.workspaceStates.get(tab.signal) || { active: 'tasks' }
    if (!['tasks', 'tree', 'memory'].includes(value.active)) value.active = 'tasks'
    if (value.navigationKey !== navigationKey) {
      value.navigationKey = navigationKey
      if (memoryTarget.id) value.active = 'memory'
    }
    props.workspaceStates.set(tab.signal, value)
    return value
  }, [props.workspaceStates, tab.signal])
  const [active, setActive] = useState(saved.active)
  const layout = useRef(null), focusSection = useRef('')
  const toggle = section => {
    if (active === section) return
    saved.active = section; focusSection.current = section; setActive(section)
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
      gridTemplateRows: ['tasks', 'tree', 'memory'].map(section => active === section ? 'minmax(280px, 1fr)' : '44px').join(' '),
    } }, ['tasks', 'tree', 'memory'].map(section => {
      const onToggle = () => toggle(section)
      return active === section ? featureView(section === 'tasks' ? TaskFeedback : section === 'tree' ? AgentTree : MemoryLibrary, { ...props, key: section, onToggle })
        : React.createElement('header', { key: section + '-collapsed', className: 'dsh-super-code-workspace-collapsed' },
          React.createElement(WorkspaceSectionToggle, { section, expanded: false, onToggle, t: props.t }))
    })))
}

export { SuperCodeWorkspace }
