import React from 'react';

/** 查找和替换使用相同的范围控件，查询仍由工作台控制器保存。 */
export function SearchOptions({ query, change, workbench, disabled, Button, t }) {
  const file = workbench.snapshot().file, directory = file?.split('/').slice(0, -1).join('/');
  const scope = [query.directory || t('searchAllProject'), query.include && `${t('searchInclude')}: ${query.include}`, query.exclude && `${t('searchExclude')}: ${query.exclude}`].filter(Boolean).join(' · ');
  return <div className="sc-wb-search-options">
    <div className="sc-wb-search-toggles">{[['caseSensitive', 'caseSensitive'], ['wholeWord', 'searchWord'], ['regexp', 'searchRegexp']].map(([key, label]) =>
      <label key={key}><input type="checkbox" checked={query[key]} disabled={disabled} onChange={event => change({ [key]: event.target.checked })} />{t(label)}</label>)}</div>
    <details><summary>{t('searchScope')}<small title={scope}>{scope}</small></summary>
      <label>{t('searchDirectory')}<span><input aria-label={t('searchDirectory')} placeholder={t('searchAllProject')} value={query.directory} disabled={disabled} onChange={event => change({ directory: event.target.value })} />
        <Button type="button" disabled={disabled || !file} onClick={() => change({ directory })}>{t('searchCurrentDirectory')}</Button></span></label>
      <label>{t('searchInclude')}<input aria-label={t('searchInclude')} placeholder="*.ts, src/**" value={query.include} disabled={disabled} onChange={event => change({ include: event.target.value })} /></label>
      <label>{t('searchExclude')}<input aria-label={t('searchExclude')} placeholder="**/*.test.ts, generated/**" value={query.exclude} disabled={disabled} onChange={event => change({ exclude: event.target.value })} /></label>
      <small>{t('searchRulesHint')}</small>
    </details>
  </div>;
}
