import React from 'react';
import { WorkflowLibrary } from './Library.jsx';
import { NS, zh, en } from './locales.js';
import { featureView } from '../ui/boundary.js';

const packages = { mattpocock: 'mattpocockSkills', pstack: 'pstackSkills', openspec: 'openspecSkills', 'oil-ui': 'oilUiSkill' };
const pages = [
  { id: 'mattpocock', label: 'Matt 工作流', en: 'Matt Workflows' },
  { id: 'pstack', label: 'PStack 工作流', en: 'PStack Workflows' },
  { id: 'openspec', label: 'OpenSpec', en: 'OpenSpec' },
  { id: 'skills', label: 'Skill 目录', en: 'Skill Library' },
];

export function applyWorkflows(ctx, hasWorkbench) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'super-code: workflow locale');
  ctx.inject(['remote.skills', 'remote.superCodeBudgets'], ready => {
    const subscribe = listener => {
      const off = ready.remote.$on('settings/document-updated', listener);
      const reset = ready.on('connection/reset', listener);
      return () => { off(); reset(); };
    };
    ready.slots.inject('conversation.view', () => {
      let enabled = [], generation = 0;
      const listeners = new Set(), registered = new Map(), lifetime = new AbortController();
      const packageState = { snapshot: () => enabled, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
      const reconcile = () => {
        for (const page of pages) {
          const visible = page.id === 'skills' ? enabled.length > 0 : enabled.includes(page.id);
          if (!visible) { registered.get(page.id)?.(); registered.delete(page.id); continue; }
          if (registered.has(page.id)) continue;
          registered.set(page.id, ready.slots.register({
            name: 'conversation.view', id: `super-code-${page.id}`, order: 30 + pages.indexOf(page), locale: NS,
            label: () => ctx.locale.bind(NS)('language') === 'zh' ? page.label : page.en,
            inject: () => ({ api: ready.remote.skills, subscribe, hasWorkbench, packageState, page: page.id }),
          }, props => featureView(WorkflowLibrary, { ...props, key: `${page.id}-${props.sessionId}`, t: ctx.locale.bind(NS) })));
        }
      };
      const refresh = async () => {
        const request = ++generation;
        try {
          const response = await ready.remote.superCodeBudgets.readConfig();
          if (lifetime.signal.aborted || request !== generation) return;
          if (!response.ok) throw new Error('Workflow settings could not be read');
          const next = Object.entries(packages).filter(([, key]) => response.value.configuration[key] === true).map(([id]) => id);
          if (response.value.configuration.grillMeSkill === true) next.push('grill-me');
          if (next.join() !== enabled.join()) enabled = next;
          reconcile();
          for (const listener of listeners) listener();
        } catch (error) { if (!lifetime.signal.aborted) console.warn('Super Code workflow settings:', error); }
      };
      void refresh();
      const unsubscribe = subscribe(() => { void refresh(); });
      return () => { lifetime.abort(); unsubscribe(); for (const dispose of registered.values()) dispose(); };
    });
  });
}
