import React from 'react';
import { workspaceApi } from './remote.js';
export { descriptors } from './remote.js';
import { createWorkbench } from './controller.js';
import { Workbench } from './components/Workbench.jsx';
import { NS, zh, en } from './locales.js';
import stylesheet from './style.css';
import { createWorkbenchPreference } from './preference.js';
import { ModuleSettings } from './components/ModuleSettings.jsx';
import { Learning } from './reading/Learning.jsx';

export function apply(ctx, { Button, Select, MarkdownText }) {
  const workspaces = new Map();
  function WorkbenchButton({ title, ...props }) { return React.createElement(Button, { ...props, title, 'aria-label': props['aria-label'] || title }); }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'super-code: workbench locale');
  const t = ctx.locale.bind(NS);
  const preference = createWorkbenchPreference(localStorage);
  const readingPreference = createWorkbenchPreference(localStorage, 'dsh-super-code-reading-enabled');
  ctx.effect(() => {
    const style = document.createElement('style'); style.textContent = stylesheet; style.dataset.superCodeWorkbench = 'true'; document.head.append(style);
    return () => { style.remove(); for (const workspace of workspaces.values()) workspace.dispose(); workspaces.clear(); };
  }, 'super-code: workbench lifecycle');
  ctx.inject(['remote.superCodeWorkbench'], ready => {
    const contribution = {
      name: 'conversation.view', id: 'super-code-workbench', order: 20, locale: NS, label: () => t('title'),
      inject: sessionId => {
        let workbench = workspaces.get(sessionId);
        if (!workbench) { workbench = createWorkbench(workspaceApi(ready.remote.superCodeWorkbench, sessionId), t); workspaces.set(sessionId, workbench); }
        return { workbench, Button: WorkbenchButton, Select, MarkdownText };
      },
    };
    ready.slots.inject('settings.section', () => ready.slots.register({
      name: 'settings.section', id: 'super-code-workbench', order: 121, locale: NS, label: () => t('moduleTitle'),
      inject: () => ({ preference, readingPreference, Button: WorkbenchButton }),
    }, ModuleSettings));
    ready.slots.inject('conversation.view', () => {
      const modules = [[preference, contribution, Workbench], [readingPreference,
        { ...contribution, id: 'super-code-reading', order: 21, label: () => t('readingTitle') }, Learning]];
      const cleanups = modules.map(([setting, entry, component]) => {
        let dispose = () => {};
        const update = () => {
          dispose();
          if (!setting.snapshot() && entry.id === 'super-code-reading') for (const workspace of workspaces.values()) workspace.reading.stop();
          dispose = setting.snapshot() ? ready.slots.register(entry, component) : () => {};
        };
        update(); const unsubscribe = setting.subscribe(update);
        return () => { unsubscribe(); dispose(); };
      });
      return () => { for (const cleanup of cleanups) cleanup(); };
    });
  });
  ctx.effect(() => {
    window.addEventListener('storage', preference.refresh);
    window.addEventListener('storage', readingPreference.refresh);
    return () => { window.removeEventListener('storage', preference.refresh); window.removeEventListener('storage', readingPreference.refresh); };
  });
}
