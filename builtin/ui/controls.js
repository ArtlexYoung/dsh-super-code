import React, { useRef, useState, useLayoutEffect, useEffect } from './react.js'

let icons = {}
try { icons = require('@deepseek-ai/dsh-client-ui-primitives') }
catch (error) { console.warn('Super Code icons:', error) }
// Harness 0.2 names shared artwork by weight instead of its nominal size.
const IconChevronDownOutline14 = icons.IconChevronDownOutlineRegular ?? icons.IconChevronDownOutline14 ?? (() => React.createElement(Glyph, { type: 'chevron' }))
const IconRefreshOutline16 = icons.IconRefreshOutlineRegular ?? icons.IconRefreshOutline16 ?? (() => React.createElement(Glyph, { type: 'history' }))

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
    if (unavailable) return
    onChange(choices[index][0])
    setOpen(false)
    trigger.current.focus({ preventScroll: true })
  }
  useLayoutEffect(() => { if (unavailable) setOpen(false) }, [unavailable])
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
    organize: 'M8 2h4v4H8zM2 14h4v4H2zm12 0h4v4h-4zM10 6v4m-6 4v-4h12v4',
    info: 'M10 9v5m0-8h0M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z',
    shield: 'M10 2 3 5v5c0 4 3 7 7 8 4-1 7-4 7-8V5l-7-3Z',
    plug: 'M7 2v4m6-4v4M5 6h10v3a5 5 0 0 1-10 0V6Zm5 8v4',
    check: 'm4 10 4 4 8-8'
  }
  return React.createElement('svg', { className: 'dsh-super-code-glyph', viewBox: type === 'code' ? '0 0 24 20' : '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, React.createElement('path', { d: paths[type] || paths.code }))
}

/* Keep native controls and their refs/events; mount name bubbles outside clipped
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
const ActionButton = React.forwardRef(function ActionButton({ as: Tag = 'button', children, title, ...props }, forwardedRef) {
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
  return React.createElement(Tag, {
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

export { ActionButton, Glyph, IconRefreshOutline16, SelectControl, icons }
