import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { Context, Service } from '@deepseek-ai/cordis';
import { waitFor } from '../../wait-for.js';

test('workflow conversation declares the session API and recovers when it reconnects', async t => {
  const result = await build({ entryPoints: [new URL('../../../builtin/workflows/apply.jsx', import.meta.url).pathname], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'text' } });
  const module = { exports: {} as { applyWorkflows: (ctx: Context, hasWorkbench: () => boolean, conversation: string) => void } };
  runInNewContext(`(function(require,module,exports){${result.outputFiles[0].text}\n})`, { AbortController })(createRequire(import.meta.url), module, module.exports);
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  type Contribution = { id: string; inject: () => { conversationRemote: { session: { page: () => string } }; Conversation: string; agentActions: { watch: (id: string, open: boolean) => void; refresh: (id: string) => Promise<void> } } };
  const active = new Map<string, Contribution>();
  class Slots extends Service {
    constructor() { super(ctx, 'slots'); }
    inject(_name: string, run: () => () => void) { this.ctx.effect(run); }
    register(contribution: Contribution) { active.set(contribution.id, contribution); return () => { active.delete(contribution.id); }; }
  }
  class Remote extends Service {
    constructor() { super(ctx, 'remote'); }
    get session() { return Reflect.get(this.ctx, 'remote.session'); }
    get skills() { return Reflect.get(this.ctx, 'remote.skills'); }
    get superCodeBudgets() { return Reflect.get(this.ctx, 'remote.superCodeBudgets'); }
    get superCodeWorkbench() { return Reflect.get(this.ctx, 'remote.superCodeWorkbench'); }
    $on() { return () => {}; }
  }
  new Slots(); new Remote();
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key });
  ctx.provide('remote.skills', {});
  ctx.provide('remote.superCodeWorkbench', {});
  ctx.provide('remote.superCodeBudgets', { readConfig: async () => ({ ok: true, value: { configuration: { mattpocockSkills: true } } }) });
  const catalogCalls: unknown[][] = [];
  const sessions = ctx.plugin({ apply(owner: Context) { owner.provide('sessions', {
    list: {},
    setSubagentCatalogOpen: (id: string, open: boolean) => catalogCalls.push([id, open]),
    refreshSubagents: async (id: string) => { catalogCalls.push([id]); },
  }); } });
  await sessions;
  const mountSession = () => ctx.plugin({ apply(owner: Context) { owner.provide('remote.session', { page: () => 'history' }); } });
  const session = mountSession(); await session;
  await ctx.plugin({ inject: ['slots', 'remote', 'locale'], apply(owner) { module.exports.applyWorkflows(owner, () => false, 'native-conversation'); } });
  await waitFor(() => active.has('super-code-mattpocock'));
  assert.equal(active.get('super-code-mattpocock')!.inject().conversationRemote.session.page(), 'history');
  assert.equal(active.get('super-code-mattpocock')!.inject().Conversation, 'native-conversation');
  const actions = active.get('super-code-mattpocock')!.inject().agentActions;
  actions.watch('root', true); actions.watch('root', false); await actions.refresh('root');
  assert.deepEqual(catalogCalls, [['root', true], ['root', false], ['root']]);
  await session.dispose();
  assert.equal(active.has('super-code-mattpocock'), false);
  await mountSession(); await waitFor(() => active.has('super-code-mattpocock'));
  assert.equal(active.get('super-code-mattpocock')!.inject().conversationRemote.session.page(), 'history');
  await sessions.dispose();
  assert.equal(active.has('super-code-mattpocock'), false);
});
