import React, { useEffect } from 'react';

/** 文件导航沿用宿主资源地址，路径在点击时按原会话的当前目录解析。 */
export const WORKBENCH_VIEW = 'super-code-workbench';

export function fileResource(address) {
  const prefix = 'dsh-resource://file/session/';
  if (!address.startsWith(prefix)) return undefined;
  try {
    const [id, ...parts] = address.slice(prefix.length).split(/[?#]/, 1)[0].split('/');
    if (!id || !parts.length) return undefined;
    return { sessionId: decodeURIComponent(id), file: parts.map(decodeURIComponent).join('/') };
  } catch { return undefined; }
}

function normalizeFilePath(file) {
  const segments = [];
  for (const part of file.split('/')) {
    if (part === '.') continue;
    if (part === '..' && segments.length && segments.at(-1) !== '..' && segments.at(-1) !== '') segments.pop();
    else segments.push(part);
  }
  return segments.join('/');
}

export function fileTarget(path, options, { cwd, current = cwd } = {}) {
  const normalized = path.replaceAll('\\', '/');
  const absolute = value => value.startsWith('/') || /^[a-z]:\//i.test(value);
  const root = cwd?.replaceAll('\\', '/').replace(/(.)\/+$/, '$1');
  const base = current?.replaceAll('\\', '/').replace(/(.)\/+$/, '$1');
  let file = !absolute(normalized) && base ? `${base.replace(/\/?$/, '/')}${normalized}` : normalized;
  file = normalizeFilePath(file);
  const compare = value => /^[a-z]:(\/|$)/i.test(root || '') || root?.startsWith('//') ? value.toLowerCase() : value;
  const prefix = root?.endsWith('/') ? root : root + '/';
  if (root && compare(file).startsWith(compare(prefix))) file = file.slice(prefix.length);
  return { file, ...(options?.line === undefined ? {} : { line: Math.max(0, options.line - 1) }) };
}

/** 导航句柄来自官方会话的公开 Slot store，不写 localStorage 或模拟点击。 */
export function createFileNavigation() {
  const views = new Map();
  return {
    has: sessionId => views.has(sessionId),
    bind(sessionId, openView) {
      views.set(sessionId, openView);
      return () => { if (views.get(sessionId) === openView) views.delete(sessionId); };
    },
    open(sessionId, target) {
      const openView = views.get(sessionId);
      if (!openView) return false;
      openView(WORKBENCH_VIEW, JSON.stringify(target));
      return true;
    },
  };
}

/** 只为官方已确认的本轮结束回复提供文件提及，保持歧义与失败写入的规则一致。 */
export function closingFileMentions(chat, provider, sessionId, openFile) {
  const mentions = new Map();
  if (!chat || !provider) return mentions;
  for (const turn of chat.timeline.turns.values()) {
    const closing = turn.data.get('turn-tail')?.closing?.finalNode;
    if (turn.status !== 'closed' || !closing) continue;
    const resolver = provider.forClosing({ turn, seq: closing.seq, openFile }, sessionId);
    if (resolver) mentions.set(closing.seq, resolver);
  }
  return mentions;
}

/** 只登记文件查看器和导航桥，保持官方对话组件及其子插槽原样。 */
export function registerFileNavigation(ctx, { preference, fileContext, t }) {
  const navigation = createFileNavigation();
  function Navigation({ sessionId, openView }) {
    useEffect(() => navigation.bind(sessionId, openView), [sessionId, openView]);
    return null;
  }
  function FileResource({ useTabInfo }) {
    const { tab } = useTabInfo();
    useEffect(() => {
      if (!tab.visible || !tab.navigation.revision) return;
      const resource = fileResource(tab.contentId);
      if (resource && navigation.open(resource.sessionId, fileTarget(resource.file, tab.navigation.params, { cwd: fileContext(resource.sessionId).cwd }))) tab.actions.close();
    }, [tab.contentId, tab.visible, tab.navigation.revision]);
    return React.createElement('p', null, t('loading'));
  }
  ctx.slots.inject('conversation.session.header.actions', () => {
    const session = ctx.slots.entries('conversation.session').find(entry => entry.store && entry.inject);
    if (!session) return () => {};
    return ctx.slots.register({ name: 'conversation.session.header.actions', id: 'super-code-file-navigation', store: session.store, inject: session.inject }, Navigation);
  });
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: 'super-code-workbench-file', kind: 'super-code-workbench-file', patterns: ['dsh-resource://file/session/**'],
    canOpen: address => {
      const state = preference.snapshot(), target = fileResource(address);
      return state.enabled && state.openFiles && !!target?.file && navigation.has(target.sessionId);
    },
    title: address => fileResource(address)?.file.split('/').at(-1) || t('title'),
  }));
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'super-code-workbench-file' }, FileResource));
}
