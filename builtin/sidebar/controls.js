import React, { useEffect } from '../ui/react.js'
import { text } from '../ui/locale.js'
import { ActionButton, Glyph } from '../ui/controls.js'
function WorkspaceSectionToggle({ section, expanded, onToggle, children, t }) {
  const label = text(t, section === 'tasks' ? 'feedback.title' : section === 'tree' ? 'tree.title' : 'memory.title')
  return React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-section-toggle',
    'data-workspace-section': section, 'aria-label': label, 'aria-expanded': expanded, onClick: onToggle },
    React.createElement(Glyph, { type: 'chevron' }),
    React.createElement(Glyph, { type: section === 'tasks' ? 'context' : section === 'tree' ? 'branch' : 'memory' }),
    React.createElement('strong', null, label), children)
}

function AgentCatalogWatch({ id, watchCatalog }) {
  useEffect(() => {
    watchCatalog(id, true)
    return () => watchCatalog(id, false)
  }, [id, watchCatalog])
  return null
}

export { WorkspaceSectionToggle, AgentCatalogWatch }
