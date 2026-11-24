import test from 'node:test';
import assert from 'node:assert/strict';
import { watchAgentCatalog } from '../../builtin/sidebar/catalog.js';
import { Context, Service } from '@deepseek-ai/cordis';

test('workflow and sidebar catalog consumers release only their own subscription', () => {
  const calls: unknown[][] = [];
  const sessions = { list: {}, setSubagentCatalogOpen: (id: string, open: boolean) => calls.push([id, open]) };
  watchAgentCatalog(sessions, 'root', true);
  watchAgentCatalog(sessions, 'root', true);
  watchAgentCatalog(sessions, 'nested', true);
  watchAgentCatalog(sessions, 'root', false);
  assert.deepEqual(calls, [['root', true], ['nested', true]]);
  watchAgentCatalog(sessions, 'root', false);
  watchAgentCatalog(sessions, 'root', false);
  watchAgentCatalog(sessions, 'nested', false);
  assert.deepEqual(calls.slice(2), [['root', false], ['nested', false]]);
});

test('catalog consumers remain isolated between hosts and reuse legacy projections', async () => {
  const calls: string[] = [];
  const first = { list: {}, refreshProjections: async (id: string) => { calls.push('first/' + id); } };
  const second = { list: {}, refreshProjections: async (id: string) => { calls.push('second/' + id); } };
  watchAgentCatalog(first, 'same', true); watchAgentCatalog(first, 'same', true);
  watchAgentCatalog(second, 'same', true);
  watchAgentCatalog(first, 'same', false); watchAgentCatalog(first, 'same', false);
  watchAgentCatalog(first, 'same', true);
  watchAgentCatalog(first, 'same', false); watchAgentCatalog(second, 'same', false);
  assert.deepEqual(calls, ['first/same', 'second/same', 'first/same']);
});

test('real Cordis consumers share catalog ownership across distinct bound service proxies', async t => {
  const ctx = new Context(), calls: unknown[][] = [];
  t.after(() => ctx.fiber.dispose());
  class Sessions extends Service {
    list = {};
    constructor() { super(ctx, 'sessions'); }
    setSubagentCatalogOpen(id: string, open: boolean) { calls.push([id, open]); }
  }
  new Sessions();
  const mount = () => ctx.plugin({ inject: ['sessions'], apply(owner) {
    const sessions = Reflect.get(owner, 'sessions') as Sessions;
    owner.effect(() => { watchAgentCatalog(sessions, 'root', true); return () => watchAgentCatalog(sessions, 'root', false); });
  } });
  const workflow = mount(), sidebar = mount(); await workflow; await sidebar;
  assert.deepEqual(calls, [['root', true]]);
  await workflow.dispose(); assert.deepEqual(calls, [['root', true]]);
  await sidebar.dispose(); assert.deepEqual(calls, [['root', true], ['root', false]]);
});
