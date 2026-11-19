import React from 'react';
import { WorkflowLibrary } from './Library.jsx';
import { NS, zh, en } from './locales.js';
import { featureView } from '../ui/boundary.js';

export function applyWorkflows(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'super-code: workflow locale');
  ctx.inject(['remote.skills'], ready => {
    const subscribe = listener => {
      const off = ready.remote.$on('settings/document-updated', listener);
      const reset = ready.on('connection/reset', listener);
      return () => { off(); reset(); };
    };
    ready.slots.inject('conversation.view', () => ready.slots.register({
      name: 'conversation.view', id: 'super-code-workflows', order: 30, locale: NS,
      label: () => ctx.locale.bind(NS)('title'),
      inject: () => ({ api: ready.remote.skills, subscribe }),
    }, props => featureView(WorkflowLibrary, { ...props, key: props.sessionId, t: ctx.locale.bind(NS) })));
  });
}
