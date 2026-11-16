import React from '../ui/react.js'
import { ActionButton, Glyph } from '../ui/controls.js'

/* Settings primitives. Every tab composes titled sections of label/control rows,
 * one callout style for notices, and one autosave indicator. */
function SettingsSection({ id, title, description, actions, plain = false, children }) {
  const lines = [].concat(description ?? []).filter(Boolean)
  return React.createElement('section', { id, className: 'dsh-super-code-section', 'aria-labelledby': `${id}-title` },
    React.createElement('header', { className: 'dsh-super-code-section-head' },
      React.createElement('div', { className: 'dsh-super-code-section-heading' },
        React.createElement('h3', { id: `${id}-title` }, title),
        ...lines.map((line, index) => React.createElement('p', { key: index }, line))),
      actions && React.createElement('div', { className: 'dsh-super-code-section-actions' }, actions)),
    React.createElement('div', { className: 'dsh-super-code-section-body', 'data-plain': plain || undefined }, children))
}
/** Label and hint on the left, control on the right; `children` may take the describedby ids. */
function SettingRow({ id, label, hint, error, children }) {
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
  return React.createElement('div', { className: 'dsh-super-code-setting-row', 'data-invalid': error ? true : undefined },
    React.createElement('div', { className: 'dsh-super-code-setting-row-text' },
      React.createElement('label', { htmlFor: id }, label),
      hint && React.createElement('p', { id: `${id}-hint` }, hint),
      error && React.createElement('p', { id: `${id}-error`, className: 'dsh-super-code-setting-row-error' }, error)),
    React.createElement('div', { className: 'dsh-super-code-setting-row-control' }, typeof children === 'function' ? children(described) : children))
}
function Callout({ tone = 'info', action, children }) {
  return React.createElement('div', { className: 'dsh-super-code-callout', 'data-tone': tone, role: tone === 'error' ? 'alert' : tone === 'success' ? 'status' : undefined },
    React.createElement(Glyph, { type: tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'error' }),
    React.createElement('div', { className: 'dsh-super-code-callout-text' }, children),
    action || null)
}
function SaveIndicator({ state, t }) {
  return React.createElement('p', { className: 'dsh-super-code-save-indicator', role: 'status', 'data-save-state': state },
    React.createElement('i', { 'aria-hidden': true }), React.createElement('span', null, t(`save.${state}`)))
}
/** Exclusive choices that need a sentence each; native radios keep arrow-key behavior. */
function ChoiceCards({ name, label, value, choices, onChange, disabled = false }) {
  return React.createElement('div', { className: 'dsh-super-code-choice-cards', role: 'radiogroup', 'aria-label': label },
    ...choices.map(([choice, title, hint]) => React.createElement('label', { key: choice, className: 'dsh-super-code-choice-card', 'data-checked': choice === value || undefined },
      React.createElement('input', { type: 'radio', name, value: choice, checked: choice === value, disabled, 'aria-describedby': `${name}-${choice}-hint`,
        onChange: () => { if (choice !== value) onChange(choice) } }),
      React.createElement('i', { 'aria-hidden': true }),
      React.createElement('span', { className: 'dsh-super-code-choice-card-text' },
        React.createElement('strong', null, title), React.createElement('small', { id: `${name}-${choice}-hint` }, hint)))))
}
/** Disabled inputs do not receive hover; their label hosts the shared top-side tooltip. */
function ConnectionSwitch({ checked, disabled, onChange, children, tooltip, ...input }) {
  return React.createElement(tooltip ? ActionButton : 'label', {
    className: 'dsh-super-code-connection-switch', ...(tooltip ? { as: 'label', title: tooltip } : {}),
  },
    React.createElement('input', { ...input, type: 'checkbox', role: 'switch', checked, disabled, onChange: event => onChange(event.target.checked) }),
    React.createElement('span', { className: 'dsh-super-code-connection-track', 'aria-hidden': true }, React.createElement('i')), children)
}

/* A few exclusive choices read faster as one visible radio group than as a menu. */
function SegmentedControl({ label, value, choices, onChange, disabled = false, busy = false, describedBy }) {
  const selected = choices.findIndex(([choice]) => choice === value)
  const focusable = Math.max(0, selected)
  const pick = choice => { if (!disabled && !busy && choice !== value) onChange(choice) }
  return React.createElement('div', { className: 'dsh-super-code-segmented', role: 'radiogroup', 'aria-label': label, 'aria-describedby': describedBy,
    'aria-busy': busy || undefined, 'aria-disabled': disabled || undefined,
    onKeyDown: event => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
        : step === undefined ? -1 : (focusable + step + choices.length) % choices.length
      if (next < 0 || disabled || busy) return
      event.preventDefault()
      event.currentTarget.querySelectorAll('[role=radio]')[next]?.focus()
      pick(choices[next][0])
    } },
    ...choices.map(([choice, text], index) => React.createElement('button', { key: choice, type: 'button', role: 'radio',
      'aria-checked': index === selected, tabIndex: index === focusable ? 0 : -1, disabled, onClick: () => pick(choice) }, text)))
}

export { Callout, ChoiceCards, ConnectionSwitch, SaveIndicator, SegmentedControl, SettingRow, SettingsSection }
