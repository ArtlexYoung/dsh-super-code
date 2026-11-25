import React, { useMemo, useSyncExternalStore } from 'react';
import { workspaceApi } from './remote.js';
export { descriptors } from './remote.js';
import { featureView } from '../ui/boundary.js';
import { NS, zh, en } from './locales.js';
import stylesheet from './style.css';
import fontStyles from './fonts/style.js';
import { createWorkbenchPreference, createEditorPreference } from './preference.js';
import { createLayoutPreference } from './layout.js';
import { closingFileMentions, registerFileNavigation } from './file-links.js';
export { createWorkbenchPreference } from './preference.js';

export function SafeMarkdown(props) {
  const { SafeMarkdown: Markdown } = require('./windows/markdown.jsx');
  return <Markdown {...props} />;
}

export function apply(ctx, { Button, Select, MarkdownText, Conversation, preference = createWorkbenchPreference(localStorage) }) {
  const workspaces = new Map(), projects = new Map();
  const editorPreference = createEditorPreference(localStorage);
  const layoutPreference = createLayoutPreference(localStorage);
  let mentions;
  ctx.inject(['chatFileMentions'], ready => {
    mentions = ready.chatFileMentions;
    ready.effect(() => () => { mentions = undefined; });
  });
  function Workbench(props) {
    const { Workbench: WorkbenchView } = require('./components/Workbench.jsx');
    return featureView(WorkbenchView, { ...props, t: props.t || ctx.locale.bind('dshSuperCode') });
  }
  function WorkbenchButton({ title, ...props }) { return React.createElement(Button, { ...props, title, 'aria-label': props['aria-label'] || title }); }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'super-code: workbench locale');
  const t = ctx.locale.bind(NS);
  const translationLanguage = () => {
    const locale = ctx.locale.getLocale();
    return locale.locales.find(item => item.id === locale.active).label;
  };
  function workspace(remote, sessionId) {
    let workbench = workspaces.get(sessionId);
    if (!workbench) {
      const { createWorkbench } = require('./controller.js');
      const { createWorkspaceSession } = require('./session.js');
      const { createDraftStore } = require('./draft-store.js');
      const { createStudyStore } = require('./study-store.js');
      workbench = createWorkbench(workspaceApi(remote, sessionId), t, { projects, translationLanguage, settings: editorPreference, layout: layoutPreference, session: createWorkspaceSession(localStorage, sessionId), draftStore: createDraftStore(sessionId), studyStore: createStudyStore(sessionId) });
      workspaces.set(sessionId, workbench);
    }
    return workbench;
  }
  function Changes({ remote, sessionId, revision }) {
    if (!sessionId) return null;
    const { FileChanges } = require('./git/Changes.jsx');
    return <FileChanges key={sessionId} workbench={workspace(remote, sessionId)} Button={WorkbenchButton} Select={Select} t={t} revision={revision} standalone />;
  }
  function GlobalSettings({ remote }) {
    const { Settings } = require('./components/Settings.jsx');
    const state = useSyncExternalStore(editorPreference.subscribe, editorPreference.snapshot);
    const workbench = useMemo(() => ({
      models: workspaceApi(remote, '').models,
      fonts: workspaceApi(remote, '').fonts,
      settings: value => editorPreference.save(value),
      snapshot: () => ({ preferences: editorPreference.snapshot().preferences }),
    }), [remote]);
    return <div className="sc-workbench sc-wb-global-settings" data-palette={state.preferences.palette}>
      {state.invalid && <p role="alert">{t('settingInvalid')}</p>}
      <Settings workbench={workbench} preferences={state.preferences} Button={WorkbenchButton} Select={Select} t={t} general />
    </div>;
  }
  ctx.effect(() => {
    const style = document.createElement('style'); style.textContent = fontStyles + stylesheet; style.dataset.superCodeWorkbench = 'true'; document.head.append(style);
    return () => { style.remove(); for (const workspace of workspaces.values()) workspace.dispose(); for (const project of projects.values()) project.dispose(); workspaces.clear(); projects.clear(); };
  }, 'super-code: workbench lifecycle');
  function fileContext(sessionId) {
    const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
    const projections = ctx.sessions.binding?.(sessionId)?.session.projections;
    const current = projections?.faceOf?.('workingDirectory').getSnapshot();
    return { cwd, current: typeof current === 'string' && current ? current : cwd };
  }
  registerFileNavigation(ctx, { preference, fileContext, t });
  ctx.inject(['remote.superCodeWorkbench', 'remote.session'], ready => {
    const contribution = {
      name: 'conversation.view', id: 'super-code-workbench', order: 20, locale: NS, label: () => t('title'),
      inject: sessionId => {
        const workbench = workspace(ready.remote.superCodeWorkbench, sessionId);
        return { workbench, Button: WorkbenchButton, Select, MarkdownText, Conversation, conversationRemote: ready.remote,
          conversationT: ctx.locale.bind('dshSuperCode'), fileContext: () => fileContext(sessionId),
          fileMentions: (chat, openFile) => closingFileMentions(chat, mentions, sessionId, openFile) };
      },
    };
    ready.slots.inject('conversation.view', () => {
      let dispose = () => {};
      let enabled;
      const update = () => {
        if (enabled === preference.snapshot().enabled) return;
        enabled = preference.snapshot().enabled;
        dispose();
        if (enabled) {
          // 启用后先准备编辑器，避免把模块初始化留到首次点击文件时。
          require('./controller.js');
          require('./components/Workbench.jsx');
        }
        if (!enabled) for (const workspace of workspaces.values()) workspace.reading.stop();
        dispose = enabled ? ready.slots.register(contribution, Workbench) : () => {};
      };
      update(); const unsubscribe = preference.subscribe(update);
      return () => { unsubscribe(); dispose(); };
    });
  });
  ctx.effect(() => {
    const refreshEnvironment = event => { for (const project of projects.values()) project.environment?.refresh(event); };
    window.addEventListener('storage', refreshEnvironment);
    window.addEventListener('storage', preference.refresh);
    window.addEventListener('storage', editorPreference.refresh);
    return () => { window.removeEventListener('storage', refreshEnvironment); window.removeEventListener('storage', preference.refresh); window.removeEventListener('storage', editorPreference.refresh); };
  });
  return { Changes, Settings: GlobalSettings };
}
