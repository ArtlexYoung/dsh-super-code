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
  await test('标签管理入口', { timeout: 90000 }, async t => {
    let page, errors;
    const tab = (target, path, kind = 'file') => target.locator(`[data-file-tab="${path}"][data-kind="${kind}"]`);
    const menu = async (target, path, action, kind) => {
      await tab(target, path, kind).click({ button: 'right' });
      await target.locator('.sc-wb-file-menu').getByRole('menuitem', { name: action, exact: true }).click();
    };
    const open = paths => page.evaluate(async paths => {
      const c = window.test.controller;
      for (const file of paths) await c.visit({ file });
    }, paths);
    t.beforeEach(async () => {
      page = await browser.newPage({ viewport: { width: 1200, height: 900 } }); errors = [];
      page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
      await page.evaluate(() => { const c = window.test.controller; return c.settings({ ...c.snapshot().preferences, previewTabs: false }); });
    });
    t.afterEach(async () => { await page.evaluate(() => window.test?.dispose()); await page.close(); assert.deepEqual(errors, []); });

    await t.test('右键批量关闭保留固定项，逐个确认草稿，取消后快捷键恢复', async () => {
      await open(['a.ts', 'b.ts', 'folder/test.py']);
      await page.evaluate(async () => {
        const c = window.test.controller; await c.pinFile('a.ts');
        for (const file of ['b.ts', 'folder/test.py']) { await c.visit({ file }); c.view().dispatch({ changes: { from: 0, insert: '// draft ' } }); }
      });
      await menu(page, 'a.ts', '关闭其他标签');
      const dialog = page.locator('.sc-wb-close-file');
      await dialog.getByText(/b.ts.*未保存/).waitFor();
      await dialog.getByRole('button', { name: '保留修改并关闭', exact: true }).click();
      await dialog.getByText(/folder\/test.py.*未保存/).waitFor();
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await tab(page, 'a.ts').count(), 1); assert.equal(await tab(page, 'b.ts').count(), 0);
      assert.equal(await tab(page, 'folder/test.py').count(), 1);
      await page.locator('.sc-wb-editor .cm-content').click(); await page.keyboard.press('Control+Shift+t');
      await tab(page, 'b.ts').waitFor();
      assert.equal(await tab(page, 'b.ts').getAttribute('data-preview'), 'false');
      assert.match(await page.locator('.sc-wb-editor .cm-content').textContent(), /draft/);
      assert.doesNotMatch(await page.evaluate(() => window.test.texts['b.ts']), /draft/);
    });

    await t.test('同名目录、关闭右侧与空工作台命令恢复', async () => {
      await page.evaluate(() => { for (const path of ['src/a.ts', 'test/a.ts']) window.test.external(path, 'export const named = 1;'); });
      await open(['a.ts', 'src/a.ts', 'test/a.ts']);
      assert.equal(await tab(page, 'a.ts').locator('.sc-wb-tab-directory').textContent(), '.');
      assert.equal(await tab(page, 'src/a.ts').locator('.sc-wb-tab-directory').textContent(), 'src');
      assert.equal(await tab(page, 'test/a.ts').locator('.sc-wb-tab-directory').textContent(), 'test');
      await capture(page, 'tab-directories-light');
      await page.evaluate(() => window.test.theme('idea', true));
      await tab(page, 'src/a.ts').click({ button: 'right' }); await capture(page, 'tab-menu-dark'); await page.keyboard.press('Escape');
      await menu(page, 'src/a.ts', '关闭右侧标签'); assert.equal(await tab(page, 'test/a.ts').count(), 0);
      await menu(page, 'a.ts', '关闭已保存标签'); await page.locator('.sc-wb-tab').waitFor({ state: 'detached' });
      await page.locator('[data-toolbar-action=commandPalette]').click();
      await page.getByRole('combobox', { name: '快速导航', exact: true }).fill('>恢复刚关闭');
      await page.getByRole('option', { name: /恢复刚关闭的标签/ }).click();
      await tab(page, 'src/a.ts').waitFor();
      assert.equal(await page.locator('.sc-wb-tab').count(), 1);
    });

    await t.test('Markdown 预览恢复不额外打开源码，分栏收起后仍能恢复', async () => {
      await page.evaluate(() => window.test.external('guide.md', '# Guide'));
      await open(['a.ts', 'guide.md']);
      await page.getByRole('button', { name: '渲染预览', exact: true }).click();
      await menu(page, 'guide.md', '关闭其他标签', 'markdown');
      await menu(page, 'guide.md', '关闭文件', 'markdown');
      await page.locator('.sc-wb-tab').waitFor({ state: 'detached' });
      await page.evaluate(() => window.test.controller.reopenTab());
      await tab(page, 'guide.md', 'markdown').waitFor(); assert.equal(await tab(page, 'guide.md', 'file').count(), 0);
      await menu(page, 'guide.md', '向右分栏', 'markdown');
      await page.waitForFunction(() => document.querySelectorAll('.sc-wb-editor-group:not([hidden])').length === 2);
      const right = page.locator('.sc-wb-editor-group:not([hidden])').last();
      await tab(right, 'guide.md', 'markdown').click({ button: 'right' });
      await page.getByRole('menuitem', { name: '关闭已保存标签', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('.sc-wb-editor-group:not([hidden])').length === 1);
      await page.evaluate(() => window.test.controller.reopenTab());
      await tab(page, 'guide.md', 'markdown').waitFor();
    });

    await t.test('独立窗口可批量关闭与恢复，原窗口标签保留', async () => {
      await open(['a.ts', 'b.ts', 'folder/test.py']);
      const opened = page.waitForEvent('popup'); await page.locator('[data-toolbar-action=window]').click(); const popup = await opened;
      popup.on('pageerror', error => errors.push(error.message));
      try {
        await tab(popup, 'b.ts').waitFor();
        await menu(popup, 'a.ts', '关闭右侧标签');
        await tab(popup, 'b.ts').waitFor({ state: 'detached' });
        await menu(popup, 'a.ts', '恢复刚关闭的标签');
        await tab(popup, 'folder/test.py').waitFor();
        assert.equal(await page.locator('.sc-wb-tab').count(), 3);
        await capture(popup, 'tab-window');
      } finally { if (!popup.isClosed()) await popup.close(); }
    });

    await t.test('英文及 200% 显示下菜单可滚动且关闭操作可用', async () => {
      await open(['a.ts', 'b.ts']);
      await page.evaluate(() => { window.test.locale(); document.body.style.zoom = '2'; });
      await tab(page, 'a.ts').click({ button: 'right' });
      const menuBox = page.locator('.sc-wb-file-menu');
      await menuBox.getByRole('menuitem', { name: 'Close saved tabs', exact: true }).waitFor();
      const bounds = await menuBox.boundingBox();
      assert.ok(bounds.y + bounds.height <= 900);
      await menuBox.getByRole('menuitem', { name: 'Move to trash', exact: true }).scrollIntoViewIfNeeded();
      await menuBox.getByRole('menuitem', { name: 'Close saved tabs', exact: true }).scrollIntoViewIfNeeded();
      await capture(page, 'tab-menu-english-zoom');
      await menuBox.getByRole('menuitem', { name: 'Close saved tabs', exact: true }).click();
      await page.locator('.sc-wb-tab').waitFor({ state: 'detached' });
    });
  });
} finally { await browser.close(); await windows.dispose(); await new Promise(resolve => server.close(resolve)); }
