import React from 'react';
import { workspaceApi } from './remote.js';
export { descriptors } from './remote.js';
import { createWorkbench } from './controller.js';
import { Workbench } from './components/Workbench.jsx';
import { NS, zh, en } from './locales.js';
import stylesheet from './style.css';
import { createWorkbenchPreference } from './preference.js';
import { ModuleSettings } from './components/ModuleSettings.jsx';

export function apply(ctx, { Button, Select }) {
  const workspaces = new Map();
  function WorkbenchButton({ title, ...props }) { return React.createElement(Button, { ...props, title, 'aria-label': props['aria-label'] || title }); }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'super-code: workbench locale');
  const t = ctx.locale.bind(NS);
  const preference = createWorkbenchPreference(localStorage);
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
        return { workbench, Button: WorkbenchButton, Select };
      },
    };
    ready.slots.inject('settings.section', () => ready.slots.register({
      name: 'settings.section', id: 'super-code-workbench', order: 121, locale: NS, label: () => t('moduleTitle'),
      inject: () => ({ preference, Button: WorkbenchButton }),
    }, ModuleSettings));
    ready.slots.inject('conversation.view', () => {
      let dispose = () => {};
      const update = () => { dispose(); dispose = preference.snapshot() ? ready.slots.register(contribution, Workbench) : () => {}; };
      update(); const unsubscribe = preference.subscribe(update);
      return () => { unsubscribe(); dispose(); };
    });
  });
  ctx.effect(() => {
    window.addEventListener('storage', preference.refresh);
    return () => window.removeEventListener('storage', preference.refresh);
  });
}
