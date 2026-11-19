import React, { useEffect, useRef, useState } from 'react';
import { editorAppearance, editorFontSizes, editorLineHeights, localFontName } from '../editor/appearance.js';
import { detectFonts, fontChoices } from '../fonts/catalog.js';

export function ReadingSettings({ workbench, preferences, apply, Select, Button, t }) {
  const [catalog, setCatalog] = useState({ families: [], complete: false, failed: false, busy: true });
  const request = useRef(null);
  const load = async full => {
    request.current?.abort();
    const abort = new AbortController(); request.current = abort;
    setCatalog(previous => ({ ...previous, busy: true }));
    try {
      const value = await detectFonts({ host: signal => workbench.fonts(signal), signal: abort.signal, full,
        selected: [preferences.fontFamily, preferences.chineseFontFamily].map(localFontName).filter(Boolean) });
      if (!abort.signal.aborted) setCatalog({ ...value, busy: false });
    } catch (error) { if (!abort.signal.aborted) setCatalog(previous => ({ ...previous, failed: true, busy: false })); }
  };
  useEffect(() => { void load(false); return () => request.current?.abort(); }, [workbench.fonts]);
  return <>
    <div className="sc-wb-setting"><span>{t('editorFont')}</span><Select label={t('editorFont')} value={preferences.fontFamily}
      choices={fontChoices(catalog.families, preferences.fontFamily, false, t)} onChange={fontFamily => apply({ ...preferences, fontFamily })} /></div>
    <div className="sc-wb-setting"><span>{t('chineseFont')}</span><Select label={t('chineseFont')} value={preferences.chineseFontFamily}
      choices={fontChoices(catalog.families, preferences.chineseFontFamily, true, t)} onChange={chineseFontFamily => apply({ ...preferences, chineseFontFamily })} /></div>
    <div className="sc-wb-font-status" role="status"><span>{catalog.busy ? t('fontLoading') : `${t('fontCount')} ${catalog.families.length}`}</span>
      <Button disabled={catalog.busy} onClick={() => { void load(false); }}>{t('fontRefresh')}</Button>
      {typeof globalThis.queryLocalFonts === 'function' && !catalog.complete && <Button disabled={catalog.busy} onClick={() => { void load(true); }}>{t('fontReadAll')}</Button>}
      {catalog.failed && <span>{t('fontPartial')}</span>}
    </div>
    <div className="sc-wb-setting"><span>{t('editorFontSize')}</span><Select label={t('editorFontSize')} value={String(preferences.fontSize)}
      choices={editorFontSizes.map(value => [String(value), `${value} px`])} onChange={fontSize => apply({ ...preferences, fontSize: Number(fontSize) })} /></div>
    <div className="sc-wb-setting"><span>{t('editorLineHeight')}</span><Select label={t('editorLineHeight')} value={String(preferences.lineHeight)}
      choices={[...new Set([...editorLineHeights, preferences.lineHeight])].sort((a, b) => a - b).map(value => [String(value), String(value)])} onChange={lineHeight => apply({ ...preferences, lineHeight: Number(lineHeight) })} /></div>
    {['stickyScroll', 'readerMode'].map(key => <div className="sc-wb-setting" key={key}><span>{t(key)}</span><span className="sc-wb-setting-toggle"><input type="checkbox" aria-label={t(key)} checked={preferences[key]}
      onChange={event => apply({ ...preferences, [key]: event.target.checked })} /></span></div>)}
    <pre className="sc-wb-font-preview" style={editorAppearance(preferences)} aria-label={t('editorFontPreview')}><span>{'function summarize(tasks: Task[]) {'}</span>{'\n  // 汇总任务，保留原始数据\n  return tasks.filter(task => !task.done);\n}'}</pre>
    <p className="sc-wb-setting-note">{t('readerModeHint')}</p>
  </>;
}
