import React from 'react';
import { toolbarActions, readToolbar, moveToolbar } from '../toolbar.js';
import { Icon } from './Icon.jsx';

export function ToolbarSettings({ items, change, Button, t }) {
  return <section className="sc-wb-toolbar-settings" aria-label={t('toolbar')}>
    <div className="sc-wb-section"><strong>{t('toolbar')}</strong><Button title={t('toolbarReset')} onClick={() => change(readToolbar())}>{t('reset')}</Button></div>
    <ol>{items.map((item, index) => {
      const definition = toolbarActions.find(action => action.id === item.id), label = t(definition.label);
      return <li key={item.id} data-toolbar-setting={item.id}>
        <span className="sc-wb-toolbar-option"><input aria-label={label} type="checkbox" checked={item.visible} onChange={event => change(items.map(row => row.id === item.id ? { ...row, visible: event.target.checked } : row))} />
          {definition.icon && <Icon name={definition.icon} />}<span>{label}</span></span>
        <div><Button title={`${t('toolbarMoveUp')} ${label}`} aria-label={`${t('toolbarMoveUp')} ${label}`} disabled={index === 0} onClick={() => change(moveToolbar(items, item.id, -1))}><Icon name="up" /></Button>
          <Button title={`${t('toolbarMoveDown')} ${label}`} aria-label={`${t('toolbarMoveDown')} ${label}`} disabled={index === items.length - 1} onClick={() => change(moveToolbar(items, item.id, 1))}><Icon name="down" /></Button></div>
      </li>;
    })}</ol>
  </section>;
}
