import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = String.raw`import React from 'react';
import { createRoot } from 'react-dom/client';
import { Workbench } from './builtin/workbench/components/Workbench.jsx';
import { createWorkbench } from './builtin/workbench/controller.js';
import { zh } from './builtin/workbench/locales.js';
import css from './builtin/workbench/style.css';

const sources = new Map([
  ['billing.ts', 'function calculateInvoice() { return 1; }\ncalculateInvoice();\nfunction 计算账单() {}\n'],
  ['订单.ts', '// 样例 🧪\ncalculateInvoice();\n计算账单();'],
  ['note.ts', '// calculateInvoice() 说明\nconst note = "calculateInvoice()";'],
  ...Array.from({ length: 48 }, (_, index) => ['items' + index + '.ts', '// 示例条目\nexport const value' + index + ' = ' + index + ';']),
]);
const paths = [...sources.keys()], reads = [];
const api = {
  fileOperation: async () => ({ path: '/sample-project' }),
  list: async () => ({ entries: paths.map(path => ({ name: path, path, type: 'file' })), truncated: false }),
  read: async (path, signal) => { signal?.throwIfAborted(); reads.push(path); return { path, text: sources.get(path), version: 'v1' }; },
  project: async () => ({ files: paths, truncated: false }), models: async () => [], fonts: async () => [],
};
const style = document.createElement('style'); style.textContent = css; document.head.append(style);
const t = key => zh[key] || key, controller = createWorkbench(api, t), root = createRoot(document.getElementById('root'));
function Button({ children, ...props }) { return <button type='button' {...props}>{children}</button>; }
function Select() { return null; }
controller.layout.change({ explorerOpen: false, panes: { conversation: false, quick: false, changes: false, learning: false } });
root.render(<Workbench workbench={controller} Button={Button} Select={Select} Conversation={() => null} sessionId='usage-filter' t={t}/>);
window.test = {
  controller, sources, reads,
  async select(name) {
    await controller.visit({ file: 'billing.ts' });
    const view = controller.view(); view.dispatch({ selection: { anchor: sources.get('billing.ts').indexOf(name) + 1 } }); view.focus();
    for (const key of controller.index.cache.keys()) controller.index.forget(key);
    reads.length = 0;
  },
  dispose() { root.unmount(); controller.dispose(); },
};`;
const worker = await build({ entryPoints: [join(repo, 'builtin/workbench/analysis/worker.js')], bundle: true, write: false, format: 'iife', platform: 'browser' });
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text' }, define: { __WORKBENCH_ANALYSIS_WORKER__: JSON.stringify(worker.outputFiles[0].text) } });
const server = createServer((req, res) => {
  res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/app.js' ? app.outputFiles[0].contents : '<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('中英文混合项目的 Ctrl+B 用法和跳转', { timeout: 40000 }, async t => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.waitForFunction(() => !!window.test?.controller);
      await page.evaluate(async () => { await window.test.controller.visit({ file: 'billing.ts' }); await window.test.controller.refresh(); });
      const list = page.getByRole('listbox', { name: '定位结果' });
      const results = list.getByRole('option');
      await t.test('英文名称跳过不相关源码并能用键盘打开真实用法', async () => {
        const dialog = page.getByRole('dialog', { name: 'calculateInvoice · 用法' });
        await page.evaluate(() => window.test.select('calculateInvoice'));
        await page.keyboard.press('Control+b'); await dialog.waitFor();
        assert.equal(await results.count(), 2);
        assert.deepEqual(await results.locator('code').allTextContents(), ['calculateInvoice();', 'calculateInvoice();']);
        const reads = await page.evaluate(() => window.test.reads);
        if (process.env.SC_TEST_ARTIFACTS) {
          await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true });
          await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, 'usages.png') });
        }
        await list.focus(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.test.controller.snapshot().file === '订单.ts');
        assert.equal(await page.evaluate(() => window.test.controller.view().state.selection.main.from), '// 样例 🧪\n'.length);
        await dialog.waitFor({ state: 'detached' });
        assert.deepEqual(reads, ['订单.ts', 'note.ts']);
      });
      await t.test('纯中文名称仍能跨文件跳到正确位置', async () => {
        await page.evaluate(() => window.test.select('计算账单'));
        await page.keyboard.press('Control+b'); await page.getByRole('dialog', { name: '计算账单 · 用法' }).waitFor();
        assert.deepEqual(await results.locator('code').allTextContents(), ['计算账单();']);
        await results.first().click();
        await page.waitForFunction(() => window.test.controller.snapshot().file === '订单.ts');
        assert.equal(await page.evaluate(() => window.test.controller.view().state.selection.main.from), '// 样例 🧪\ncalculateInvoice();\n'.length);
      });
      assert.deepEqual(errors, []);
    } finally { await page.evaluate(() => window.test?.dispose()).catch(() => {}); await page.close(); }
  });
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
