import React, { createContext, useContext } from 'react';

export const SettingsContext = createContext(null);
export const useSettings = () => useContext(SettingsContext);

export function SettingText({ children }) {
  const { query } = useSettings(), words = query.trim().split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!words.length) return children;
  const expression = new RegExp(`(${words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return String(children).split(expression).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part);
}

export function Setting({ id, children, as: Element = 'div', className = '', ...props }) {
  const { entries, reset, Button, t } = useSettings(), entry = entries.get(id);
  const label = [t(entry.label), entry.detail].filter(Boolean).join(' · ');
  return <Element {...props} className={`sc-wb-setting ${className}`} data-setting={id} hidden={!entry.visible}>
    <span className="sc-wb-setting-label"><span><SettingText>{label}</SettingText></span>{entry.modified && <small>{t('settingModified')}</small>}</span>
    <div className="sc-wb-setting-control">{children}{entry.modified && <Button className="sc-wb-setting-reset" title={`${t('resetSetting')}${label}`} aria-label={`${t('resetSetting')}${label}`} onClick={() => reset(id)}>{t('reset')}</Button>}</div>
  </Element>;
}

export function SettingGroup({ id, children, heading = true }) {
  const { entries, sections, t } = useSettings(), visible = [...entries.values()].some(entry => entry.group === id && entry.visible);
  return <section className="sc-wb-settings-group" hidden={!visible} ref={node => { sections.current[id] = node; }}>
    {heading && <h2><SettingText>{t(id)}</SettingText></h2>}{children}
  </section>;
}
