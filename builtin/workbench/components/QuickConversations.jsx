import React, { useId, useMemo } from 'react';
import { FileList } from '../git/FileList.jsx';
import { FileIcon } from './FileIcon.jsx';
import { message } from '../locales.js';
import { Icon } from './Icon.jsx';

export function QuickConversations({ items = [], workbench, Button, t, open, toggle }) {
  const id = useId();
  const rows = useMemo(() => items.map(item => ({ ...item, key: item.id })), [items]);
  const act = callback => () => { Promise.resolve().then(callback).catch(workbench.fail); };
  return <section className="sc-wb-quick" data-open={open} aria-label={t('quickConversations')}>
    <Button className="sc-wb-section" title={t('quickConversations')} aria-expanded={open} aria-controls={id} onClick={toggle}>
      <Icon name="chevron" /><strong>{t('quickConversations')}</strong><small>{items.length}</small>
    </Button>
    {open && <div id={id} className="sc-wb-quick-content">{rows.length ? <FileList items={rows} rowHeight={60}>{row => <div className="sc-wb-quick-row">
      <Button title={t('quickOpen')} onClick={act(() => workbench.openConversation(row))}><span>{row.preview}</span><small className="sc-wb-quick-state" data-status={row.status}>
        {row.pinned && <span title={t('quickPinned')} aria-label={t('quickPinned')}><Icon name="pin" /></span>}
        {row.status === 'running' && <i className="sc-wb-answer-spinner" aria-hidden="true" />}{t(row.status === 'running' ? 'quickRunning' : row.status === 'error' ? 'quickFailed' : row.status === 'stopped' ? 'quickStopped' : row.count > 1 ? 'quickCompleted' : 'quickReady')}
      </small></Button>
      <Button title={t('quickFile')} onClick={act(() => workbench.openConversation(row, false))}>
        <FileIcon path={row.file} /><span>{row.file}:{row.line + 1}</span>{row.count > 0 && <small>{message(t, 'quickMessages', { count: row.count })}</small>}
      </Button>
    </div>}</FileList> : <p>{t('quickEmpty')}</p>}</div>}
  </section>;
}
