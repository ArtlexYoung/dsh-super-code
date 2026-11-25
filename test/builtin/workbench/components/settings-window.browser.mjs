import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { tsImport } from 'tsx/esm/api';
import { fixture } from './fixture.mjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const { WorkbenchWindows } = await tsImport('../../../../src/workbench/window.ts', import.meta.url);
const windows = new WorkbenchWindows(undefined, () => readFile(join(repo, 'dist/window.js')));
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text', '.woff2': 'dataurl' } });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (url.pathname === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(app.outputFiles[0].contents); return; }
    if (url.pathname === '/events') {
      const abort = new AbortController(); res.on('close', () => abort.abort()); res.setHeader('content-type', 'application/x-ndjson'); res.flushHeaders();
      for await (const event of windows.events('demo', url.searchParams.get('id'), abort.signal)) res.write(JSON.stringify(event) + '\n');
      res.end(); return;
    }
    const reply = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
    if (url.pathname === '/open') { reply(await windows.open('demo', false)); return; }
    if (url.pathname === '/send') { windows.send('demo', body.id, body.content); reply({}); return; }
    if (url.pathname === '/close') { windows.close('demo', body.id); reply({}); return; }
    res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>');
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
const evidence = process.env.SC_TEST_ARTIFACTS;
const capture = async (page, name) => { if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, name + '.png'), animations: 'disabled' }); } };
try {
  await test('设置搜索和逐项恢复通过主页面与真实独立窗口入口', { timeout: 45000 }, async t => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 920 } }), errors = [];
    page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('[data-toolbar-action=settings]').click();
    await page.getByRole('searchbox', { name: '搜索设置', exact: true }).waitFor();
    await t.test('主页面按名称筛选后修改，并显示恢复入口', async () => {
      await page.getByRole('searchbox', { name: '搜索设置', exact: true }).fill('自动保存');
      await page.getByRole('combobox', { name: '自动保存', exact: true }).selectOption('15');
      await page.locator('[data-setting=autoSave]').getByRole('button', { name: '恢复默认：自动保存', exact: true }).waitFor();
      await capture(page, 'settings-search-light');
      await page.evaluate(() => window.test.theme('idea', true)); await capture(page, 'settings-search-dark');
    });
    await t.test('独立窗口恢复一项并同步主页面，保留另一个新修改的设置', async () => {
      const opened = page.waitForEvent('popup'); await page.locator('.sc-wb-dialog-heading').getByRole('button', { name: '独立窗口', exact: true }).click(); const popup = await opened;
      popup.setDefaultTimeout(5000); popup.on('pageerror', error => errors.push(error.message));
      try {
        await popup.getByRole('searchbox', { name: '搜索设置', exact: true }).fill('保存');
        await page.evaluate(() => { const c = window.test.controller; return c.settings({ ...c.snapshot().preferences, fontSize: 18 }); });
        await popup.getByRole('checkbox', { name: '只看已修改', exact: true }).check();
        await popup.locator('[data-setting=autoSave]').getByRole('button', { name: '恢复默认：自动保存', exact: true }).click();
        await page.waitForFunction(() => window.test.controller.snapshot().preferences.autoSave === 'manual');
        assert.equal(await page.evaluate(() => window.test.controller.snapshot().preferences.fontSize), 18);
        await popup.getByText('没有匹配的设置', { exact: true }).waitFor();
        await popup.getByRole('button', { name: '清除筛选', exact: true }).click();
        assert.match(await popup.getByRole('combobox', { name: '代码字号', exact: true }).innerText(), /18/);
        await popup.getByRole('searchbox', { name: '搜索设置', exact: true }).fill('撤销');
        const limit = popup.getByRole('spinbutton', { name: '最大撤销历史步数', exact: true });
        await page.evaluate(() => { window.test.storageWrite = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'dsh-super-code-workbench') throw Error('storage unavailable'); return window.test.storageWrite.call(this, key, value); }; });
        await limit.fill('1200'); await limit.press('Tab');
        await popup.getByRole('alert').filter({ hasText: '未能保存' }).waitFor();
        assert.equal(await limit.inputValue(), '1200');
        assert.equal(await page.evaluate(() => window.test.controller.snapshot().preferences.undoLimit), 1000);
        await page.evaluate(() => { Storage.prototype.setItem = window.test.storageWrite; });
        await limit.focus(); await limit.press('Tab');
        await page.waitForFunction(() => window.test.controller.snapshot().preferences.undoLimit === 1200);
        await popup.setViewportSize({ width: 500, height: 800 });
        await popup.getByRole('searchbox', { name: '搜索设置', exact: true }).fill('字体');
        assert.equal(await popup.locator('.sc-wb-settings-content').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
        await capture(popup, 'settings-window-narrow');
      } finally { if (!popup.isClosed()) await popup.close(); }
    });
    await page.evaluate(() => window.test.dispose()); await page.close(); assert.deepEqual(errors, []);
  });
} finally { await browser.close(); await windows.dispose(); await new Promise(resolve => server.close(resolve)); }
