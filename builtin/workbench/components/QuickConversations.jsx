import React, { useId, useMemo, useState } from 'react';
import { FileList } from '../git/FileList.jsx';
import { FileIcon } from './FileIcon.jsx';
import { message } from '../locales.js';
import { Icon } from './Icon.jsx';

export function QuickConversations({ items = [], workbench, Button, t }) {
  const [open, setOpen] = useState(false), id = useId();
  const rows = useMemo(() => items.map(item => ({ ...item, key: item.id })), [items]);
  const act = callback => () => { Promise.resolve().then(callback).catch(workbench.fail); };
  return <section className="sc-wb-quick" data-open={open} aria-label={t('quickConversations')}>
    <Button className="sc-wb-section" title={t('quickConversations')} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <Icon name="chevron" /><strong>{t('quickConversations')}</strong><small>{items.length}</small>
    </Button>
    {open && <div id={id} className="sc-wb-quick-content">{rows.length ? <FileList items={rows} rowHeight={60}>{row => <div className="sc-wb-quick-row">
      <Button title={t('quickOpen')} onClick={act(() => workbench.openConversation(row))}><span>{row.preview}</span>{row.status === 'running' && <i aria-label={t('working')}>…</i>}</Button>
      <Button title={t('quickFile')} onClick={act(() => workbench.visit({ file: row.file, line: row.line, character: row.character, length: row.to - row.from }))}>
        <FileIcon path={row.file} /><span>{row.file}:{row.line + 1}</span>{row.count > 0 && <small>{message(t, 'quickMessages', { count: row.count })}</small>}
      </Button>
    </div>}</FileList> : <p>{t('quickEmpty')}</p>}</div>}
  </section>;
}
