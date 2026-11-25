import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { workbenchCommands } from '../commands.js';
import { toolbarActions } from '../toolbar.js';
import { keyOf, keyLabel } from '../editor/preferences.js';
import { Icon } from './Icon.jsx';

export function Commands({ workbench, Button, t }) {
  const snapshot = useSyncExternalStore(workbench.subscribe, workbench.snapshot);
  const [query, setQuery] = useState(''), [selected, select] = useState(0), id = useId(), list = useRef(null);
  const current = snapshot.tabs.find(item => item.path === snapshot.file && item.kind === 'file');
  const commands = workbenchCommands(workbench, snapshot, t, undefined, current);
  const actions = toolbarActions.filter(item => item.id !== 'commandPalette').map(item => ({
    ...item, ...commands[item.id], label: t(item.id === 'window' && workbench.external ? 'windowReturn' : item.label),
    shortcut: item.shortcut ? keyLabel(keyOf(snapshot.preferences, item.shortcut), t('space')) : '',
  }));
  const files = snapshot.tabs.filter(tab => tab.kind === 'file').map(tab => ({ id: `file:${tab.path}`, label: tab.path,
    icon: 'files', shortcut: tab.dirty ? t('unsavedFile') : t('openFileTab'), run: () => workbench.visit({ file: tab.path }) }));
  const terms = query.toLocaleLowerCase().trim().split(/\s+/);
  const rows = [...actions, ...files].filter(item => terms.every(term => `${item.label} ${item.id}`.toLocaleLowerCase().includes(term)));
  const index = Math.min(selected, Math.max(0, rows.length - 1)), active = rows[index];
  useEffect(() => { list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); }, [index]);
  const run = item => {
    if (item.disabled) return;
    workbench.panel(null);
    void Promise.resolve().then(item.run).catch(workbench.fail);
  };
  const keydown = event => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const handlers = { ArrowDown: () => select(Math.min(rows.length - 1, index + 1)), ArrowUp: () => select(Math.max(0, index - 1)), Enter: () => active && run(active) };
    if (!handlers[event.key] || !rows.length) return;
    event.preventDefault(); event.stopPropagation(); handlers[event.key]();
  };
  return <div className="sc-wb-commands" onKeyDown={keydown}>
    <input autoFocus type="search" role="combobox" aria-expanded={true} aria-autocomplete="list" aria-controls={id} aria-activedescendant={active ? `${id}-${index}` : undefined}
      aria-label={t('commandSearch')} placeholder={t('commandSearch')} value={query} onChange={event => { setQuery(event.target.value); select(0); }} />
    <div ref={list} id={id} role="listbox" aria-label={t('commands')}>
      {rows.map((item, row) => <Button key={item.id} id={`${id}-${row}`} role="option" aria-selected={row === index} aria-disabled={!!item.disabled} tabIndex={-1} onClick={() => run(item)}>
        {item.icon && <Icon name={item.icon} />}<span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}
      </Button>)}
      {!rows.length && <p role="status">{t('noResults')}</p>}
    </div><footer>{t('locationKeys')}</footer>
  </div>;
}
