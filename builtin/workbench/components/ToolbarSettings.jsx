import React from 'react';
import { toolbarActions, readToolbar, moveToolbar } from '../toolbar.js';
import { Icon } from './Icon.jsx';
import { Setting, SettingText, useSettings } from './Setting.jsx';

export function ToolbarSettings({ items, change, Button, t }) {
  const { entries } = useSettings();
  return <section className="sc-wb-toolbar-settings" aria-label={t('toolbar')}>
    <div className="sc-wb-section"><strong><SettingText>{t('toolbar')}</SettingText></strong><Button title={t('toolbarReset')} onClick={() => change(readToolbar())}>{t('reset')}</Button></div>
    <Setting id="toolbarOrder"><span>{t(entries.get('toolbarOrder').modified ? 'settingModified' : 'settingDefault')}</span></Setting>
    <ol>{items.map((item, index) => {
      const definition = toolbarActions.find(action => action.id === item.id), label = t(definition.label);
      return <Setting as="li" id={`toolbar.${item.id}`} key={item.id} data-toolbar-setting={item.id}>
        <span className="sc-wb-toolbar-option"><input aria-label={label} type="checkbox" checked={item.visible} onChange={event => change(items.map(row => row.id === item.id ? { ...row, visible: event.target.checked } : row))} />
          {definition.icon && <Icon name={definition.icon} />}</span>
        <div><Button title={`${t('toolbarMoveUp')} ${label}`} aria-label={`${t('toolbarMoveUp')} ${label}`} disabled={index === 0} onClick={() => change(moveToolbar(items, item.id, -1))}><Icon name="up" /></Button>
          <Button title={`${t('toolbarMoveDown')} ${label}`} aria-label={`${t('toolbarMoveDown')} ${label}`} disabled={index === items.length - 1} onClick={() => change(moveToolbar(items, item.id, 1))}><Icon name="down" /></Button></div>
      </Setting>;
    })}</ol>
  </section>;
}
