import React, { useState, useRef, useEffect } from '../../builtin/ui/react.js'
import { ActionButton } from '../../builtin/ui/controls.js'
import { DirectoryBrowser } from '../../builtin/settings/connection.js'

function DirectoryRecovery({ sessionId, useSessions, api, directoryApi, openSession, t }) {
  const revision = useSessions(state => state.byId[sessionId])
  const [info, setInfo] = useState(null), [open, setOpen] = useState(false), [choices, setChoices] = useState(null)
  const [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [browser, setBrowser] = useState(false), [error, setError] = useState('')
  const dialog = useRef(null), lifetime = useRef(null), dismissed = useRef(false), checking = useRef(null)
  const check = async () => {
    if (checking.current || !lifetime.current) return
    const signal = lifetime.current.signal
    const request = api.directory(sessionId, signal); checking.current = request
    try {
      const result = await request
      if (signal.aborted || !result.ok) return
      setInfo(result.value)
      if (result.value.state === 'missing' && !dismissed.current) { dismissed.current = true; setOpen(true) }
      if (result.value.state !== 'missing') { dismissed.current = false; setOpen(false) }
    } finally { if (checking.current === request) checking.current = null }
  }
  useEffect(() => {
    lifetime.current = new AbortController(); dismissed.current = false
    setInfo(null); setSelected(''); setChoices(null); setError(''); setBusy(false); setOpen(false); setBrowser(false)
    const refresh = () => { void check().catch(() => {}) }
    refresh(); window.addEventListener('focus', refresh)
    return () => { lifetime.current?.abort(); lifetime.current = null; checking.current = null; window.removeEventListener('focus', refresh) }
  }, [sessionId, api])
  useEffect(() => { const timer = setTimeout(() => { void check().catch(() => {}) }, 500); return () => clearTimeout(timer) }, [revision, sessionId, api])
  useEffect(() => {
    if (!open) return
    const element = dialog.current; element.showModal()
    let active = true
    directoryApi.directories().then(result => {
      if (!active) return
      if (result.ok) setChoices(result.value); else setError(t('directory.failed'))
    }).catch(() => { if (active) setError(t('directory.failed')) })
    return () => { active = false; if (element.open) element.close() }
  }, [open, directoryApi])
  const choose = async () => {
    if (choices?.picker === 'browse') { setBrowser(true); return }
    const signal = lifetime.current.signal
    setBusy(true); setError('')
    try {
      const result = await directoryApi.pickDirectory(signal)
      if (signal.aborted) return
      if (!result.ok) throw new Error()
      if (result.value.kind === 'selected') setSelected(result.value.path)
    } catch { if (!signal.aborted) setError(t('directory.failed')) } finally { if (!signal.aborted) setBusy(false) }
  }
  const recover = async () => {
    const signal = lifetime.current.signal
    setBusy(true); setError('')
    try {
      const result = await api.recoverDirectory(sessionId, JSON.stringify({ path: selected, sequence: info.sequence }), signal)
      if (signal.aborted) return
      if (!result.ok) throw new Error(result.error?.message || '')
      await openSession(result.value.sessionId); setOpen(false)
    } catch (failure) {
      if (signal.aborted) return
      const code = /WORKBENCH_DIRECTORY_[A-Z_]+/.exec(failure.message)?.[0]
      setError(code ? t(`directory.${code}`) : t('directory.failed')); await check()
    } finally { if (!signal.aborted) setBusy(false) }
  }
  if (info?.state !== 'missing') return null
  return React.createElement('div', { className: 'dsh-super-code-directory-recovery' },
    React.createElement(ActionButton, { type: 'button', className: 'dsh-super-code-view-button', title: t('directory.switch'), onClick: () => { setError(''); setOpen(true) } }, t('directory.switch')),
    open && React.createElement('dialog', { ref: dialog, className: 'dsh-super-code-confirm', 'aria-labelledby': `super-code-directory-recovery-${sessionId}`,
      onCancel: event => { event.preventDefault(); if (!busy) setOpen(false) }, onKeyDown: event => event.stopPropagation() },
      React.createElement('h3', { id: `super-code-directory-recovery-${sessionId}` }, t('directory.title')),
      React.createElement('p', null, t('directory.explain')), React.createElement('code', { className: 'dsh-super-code-directory-path' }, info.cwd),
      React.createElement('div', { className: 'dsh-super-code-directory-options' },
        (choices?.items || []).filter(item => item.available).map(item => React.createElement('label', { key: item.path },
          React.createElement('input', { type: 'radio', name: `directory-${sessionId}`, value: item.path, checked: selected === item.path, disabled: busy, onChange: () => setSelected(item.path) }),
          React.createElement('span', null, item.title || item.path))),
        selected && !choices?.items.some(item => item.path === selected) && React.createElement('code', null, selected)),
      React.createElement(ActionButton, { type: 'button', disabled: busy || !choices || choices.picker === 'unavailable', onClick: () => { void choose() } }, t('directory.choose')),
      error && React.createElement('p', { role: 'alert' }, error),
      React.createElement('div', { className: 'dsh-super-code-confirm-actions' },
        React.createElement(ActionButton, { type: 'button', disabled: busy, onClick: () => setOpen(false) }, t('preset.cancel')),
        React.createElement(ActionButton, { type: 'button', disabled: busy || !selected, className: 'dsh-super-code-primary-button', onClick: () => { void recover() } }, t('directory.continue')))),
    browser && React.createElement(DirectoryBrowser, { api: directoryApi, t, onClose: () => setBrowser(false), onSelect: path => { setSelected(path); setBrowser(false) } }))
}

export { DirectoryRecovery }
