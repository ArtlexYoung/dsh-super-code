import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
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
    let value;
    if (url.pathname === '/open') value = await windows.open('demo', false);
    else if (url.pathname === '/send') windows.send('demo', body.id, body.content);
    else if (url.pathname === '/close') windows.close('demo', body.id);
    else { res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>'); return; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value || {}));
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
const evidence = process.env.SC_TEST_ARTIFACTS, measurements = [];
const capture = async (page, name) => { if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, name + '.png') }); } };
try {
  await test('工作台体验：快速导航、保存冲突、默认布局和独立窗口', { timeout: 120000 }, async t => {
    let page, errors;
    const check = (name, run) => t.test(name, { skip: Boolean(process.env.SC_TEST_CASE && !name.includes(process.env.SC_TEST_CASE)) }, run);
    t.beforeEach(async () => {
      page = await browser.newPage({ viewport: { width: 1160, height: 840 } }); errors = [];
      page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.test?.controller.snapshot().indexed === 3);
    });
    t.afterEach(async () => { await page.evaluate(() => window.test.dispose()); await page.close(); assert.deepEqual(errors, []); });
    const visit = () => page.evaluate(() => window.test.controller.visit({ file: 'a.ts' }));
    const navigation = () => page.getByRole('combobox', { name: '快速导航', exact: true });
    const conflict = async (overlap = false) => {
      await visit();
      await page.evaluate(overlap => {
        const { controller, texts, external } = window.test, original = texts['a.ts'];
        if (overlap) {
          const at = original.indexOf('value + 1'); controller.view().dispatch({ changes: { from: at, to: at + 9, insert: 'value + 3' } });
        } else controller.view().dispatch({ changes: { from: 0, insert: '// draft\n' } });
        external('a.ts', original.replace('value + 1', 'value + 2'));
      }, overlap);
      await page.locator('[data-toolbar-action=save]').click();
      await page.locator('.sc-wb-status').getByRole('button', { name: '比较并合并' }).click();
      await page.locator('.sc-wb-conflict-summary').waitFor();
    };
    await check('空工作台用快捷键打开文件，最近访问、路径、空结果、中文组合键和 Esc 返回', async () => {
      await page.locator('.sc-wb-main').focus(); await page.keyboard.press('Control+Shift+o');
      await navigation().fill('missing'); await page.getByText('没有找到结果', { exact: true }).waitFor();
      await navigation().fill('a.ts');
      await navigation().dispatchEvent('keydown', { key: 'Enter', isComposing: true });
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().file), null);
      await navigation().press('Enter'); await page.waitForFunction(() => window.test.controller.snapshot().file === 'a.ts');
      await page.keyboard.press('Control+Shift+o'); await navigation().fill('folder test'); await navigation().press('Enter');
      await page.waitForFunction(() => window.test.controller.snapshot().file === 'folder/test.py');
      await page.keyboard.press('Control+Shift+o');
      assert.equal(await page.locator('.sc-wb-navigator-list [role=option]').first().getAttribute('title'), 'a.ts');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.test.controller.view().hasFocus), true);
    });
    await check('当前符号、隐藏工具、专注阅读和可搜索操作均可从键盘使用', async () => {
      await visit(); await page.waitForFunction(() => window.test.controller.snapshot().symbols.length > 0);
      await page.keyboard.press('Control+F12'); await navigation().fill('@add'); await navigation().press('Enter');
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().cursor.line), 1);
      await page.keyboard.press('Control+Shift+p'); await navigation().fill('>参数');
      assert.equal(await page.locator('.sc-wb-navigator-list [role=option]').count(), 1);
      await capture(page, 'commands-light'); await page.keyboard.press('Escape');
      await page.keyboard.press('Control+Shift+Enter'); assert.equal(await page.locator('.sc-wb-body').getAttribute('data-reading-focus'), 'true');
      await page.keyboard.press('Control+Shift+Enter'); assert.equal(await page.locator('.sc-wb-body').getAttribute('data-reading-focus'), 'false');
      await page.keyboard.press('Control+Shift+p'); await navigation().fill('>设置'); await navigation().press('Enter');
      await page.locator('.sc-wb-settings').waitFor();
    });
    await check('取消比较保留草稿；非重叠合并先回编辑区，保存后才写盘', async () => {
      await conflict();
      assert.match(await page.locator('.sc-wb-conflict-summary').innerText(), /不重叠/);
      assert.ok(await page.locator('.sc-wb-save-conflict .sc-wb-conflict-changed').count() >= 3);
      assert.equal(await page.locator('.sc-wb-save-conflict .cm-lineWrapping').count(), 3);
      await capture(page, 'conflict-light');
      await page.evaluate(() => window.test.theme('idea', true)); await capture(page, 'conflict-dark');
      await page.evaluate(() => window.test.theme('idea', false));
      await page.locator('.sc-wb-save-conflict').getByRole('button', { name: '取消', exact: true }).click();
      assert.match(await page.evaluate(() => window.test.controller.view().state.doc.toString()), /^\/\/ draft/);
      await page.locator('.sc-wb-status').getByRole('button', { name: '比较并合并' }).click();
      await page.getByRole('button', { name: '应用到编辑区', exact: true }).click();
      await page.waitForFunction(() => !window.test.controller.snapshot().panel);
      assert.match(await page.evaluate(() => window.test.controller.view().state.doc.toString()), /value \+ 2/);
      assert.doesNotMatch(await page.evaluate(() => window.test.texts['a.ts']), /\/\/ draft/);
      await page.locator('[data-toolbar-action=save]').click();
      await page.waitForFunction(() => window.test.texts['a.ts'].startsWith('// draft'));
      assert.equal(await page.evaluate(() => window.test.controller.documents.get('a.ts').dirty), false);
    });
    await check('重叠修改要求选择，磁盘再次变化时保留处理结果并允许重新比较', async () => {
      await conflict(true);
      assert.equal(await page.getByRole('button', { name: '应用到编辑区', exact: true }).isDisabled(), true);
      await page.getByRole('button', { name: '采用全部草稿', exact: true }).click();
      await page.evaluate(() => window.test.external('a.ts', window.test.texts['a.ts'].replace('value + 2', 'value + 4')));
      await page.getByRole('button', { name: '应用到编辑区', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '磁盘内容再次变化' }).waitFor();
      assert.match(await page.locator('.sc-wb-save-conflict .cm-content[aria-label="处理结果（可编辑）"]').innerText(), /value \+ 3/);
      await page.getByRole('button', { name: '重新比较', exact: true }).click();
      await page.locator('.sc-wb-conflict-actions').getByRole('button', { name: '重新比较', exact: true }).click();
      await page.getByRole('button', { name: '采用全部磁盘内容', exact: true }).click();
      await page.getByRole('button', { name: '应用到编辑区', exact: true }).click();
      await page.waitForFunction(() => !window.test.controller.snapshot().panel);
      assert.match(await page.evaluate(() => window.test.controller.view().state.doc.toString()), /value \+ 4/);
      await page.keyboard.press('Control+z');
      await page.waitForFunction(() => window.test.controller.view().state.doc.toString().includes('value + 3'));
    });
    await check('默认布局在 1160 和 900 宽度下给代码留空间，已保存设置仍可恢复', async () => {
      await visit();
      for (const width of [1160, 900]) for (const dark of [false, true]) {
        await page.setViewportSize({ width, height: 840 }); await page.evaluate(dark => window.test.theme('idea', dark), dark);
        const bounds = await page.evaluate(() => {
          const width = selector => document.querySelector(selector).getBoundingClientRect().width;
          const toolbar = document.querySelector('.sc-wb-toolbar-scroll');
          return { root: width('.sc-wb-main'), code: width('.sc-wb-code'), left: width('.sc-wb-explorer'), right: width('.sc-wb-right'), toolbar: toolbar.clientWidth, toolbarContent: toolbar.scrollWidth };
        });
        measurements.push({ ...bounds, dark });
        assert.ok(bounds.code >= (width === 1160 ? 540 : 419), JSON.stringify(bounds));
        if (width === 1160) assert.ok(bounds.toolbarContent <= bounds.toolbar + 1, JSON.stringify(bounds));
        await capture(page, `layout-${width}-${dark ? 'dark' : 'light'}`);
      }
      await page.evaluate(() => {
        const { controller } = window.test;
        controller.layout.change({ explorer: 250, reading: 350 }); controller.layout.save();
        controller.settings({ ...controller.snapshot().preferences, showToolbarShortcuts: true, toolbar: controller.snapshot().preferences.toolbar.map(item => ({ ...item, visible: item.id === 'parameters' })) });
      });
      await page.reload(); await page.waitForFunction(() => window.test?.controller.snapshot().indexed === 3);
      assert.equal(await page.evaluate(() => window.test.controller.layout.snapshot().reading), 350);
      assert.equal(await page.locator('[data-toolbar-action=parameters]').count(), 1);
      assert.equal(await page.locator('[data-toolbar-action=parameters] kbd').count(), 1);
    });
    await check('关闭文件的独立窗口可比较保存冲突，取消和应用均保留草稿', async () => {
      await visit();
      await page.evaluate(() => {
        const { controller, external, texts } = window.test;
        controller.view().dispatch({ changes: { from: 0, insert: '// closing draft\n' } });
        external('a.ts', texts['a.ts'].replace('value + 1', 'value + 2'));
      });
      await page.locator('[data-file-tab="a.ts"] .sc-wb-tab-close').click();
      const opened = page.waitForEvent('popup');
      await page.locator('.sc-wb-close-file').getByRole('button', { name: '独立窗口', exact: true }).click();
      const popup = await opened; popup.setDefaultTimeout(5000);
      popup.on('pageerror', error => errors.push(error.message));
      try {
        await popup.getByRole('button', { name: '保存并关闭', exact: true }).click();
        await popup.locator('.sc-wb-close-file').getByRole('button', { name: '比较并合并', exact: true }).click();
        await popup.locator('.sc-wb-conflict-summary').waitFor();
        await capture(popup, 'close-conflict-window');
        await popup.locator('.sc-wb-save-conflict').getByRole('button', { name: '取消', exact: true }).click();
        assert.match(await page.evaluate(() => window.test.controller.documents.get('a.ts').text), /^\/\/ closing draft/);
        await popup.locator('.sc-wb-status').getByRole('button', { name: '比较并合并', exact: true }).click();
        await popup.getByRole('button', { name: '应用到编辑区', exact: true }).click();
        await popup.locator('.sc-wb-save-conflict').waitFor({ state: 'hidden' });
        await popup.getByRole('button', { name: '返回 DSH', exact: true }).click();
        await page.waitForFunction(() => !window.test.controller.snapshot().window);
        const state = await page.evaluate(() => ({ draft: window.test.controller.documents.get('a.ts').text, disk: window.test.texts['a.ts'], file: window.test.controller.snapshot().file }));
        assert.match(state.draft, /^\/\/ closing draft/); assert.match(state.draft, /value \+ 2/);
        assert.doesNotMatch(state.disk, /closing draft/); assert.equal(state.file, 'a.ts');
      } finally { if (!popup.isClosed()) await popup.close(); }
    });
    await check('独立窗口使用同样的快速导航和冲突比较，返回后共享草稿保留', async () => {
      await visit();
      const opened = page.waitForEvent('popup'); await page.locator('[data-toolbar-action=window]').click();
      const popup = await opened; popup.setDefaultTimeout(8000);
      popup.on('pageerror', error => errors.push(error.message));
      await popup.locator('.cm-content').first().waitFor();
      await popup.locator('.cm-content').first().click(); await popup.keyboard.press('Control+Shift+o');
      await popup.getByRole('combobox', { name: '快速导航', exact: true }).fill('b.ts');
      await popup.locator('.sc-wb-navigator-list [role=option]').filter({ hasText: 'b.ts' }).waitFor(); await popup.keyboard.press('Enter');
      try { await popup.getByRole('button', { name: '浏览 b.ts 的同级项', exact: true }).waitFor(); }
      catch (error) { await capture(popup, 'window-failure'); throw error; }
      await popup.locator('.cm-content').first().click(); await popup.keyboard.press('Meta+ArrowUp'); await popup.keyboard.insertText('// window draft\n');
      await page.evaluate(() => window.test.controller.visit({ file: 'b.ts' }));
      await page.waitForFunction(() => window.test.controller.documents.get('b.ts')?.text.startsWith('// window draft'));
      await page.evaluate(() => window.test.external('b.ts', window.test.texts['b.ts'] + '\n// disk'));
      await popup.locator('[data-toolbar-action=save]').click();
      await popup.locator('.sc-wb-status').getByRole('button', { name: '比较并合并' }).click();
      await popup.getByRole('button', { name: '应用到编辑区', exact: true }).click();
      await popup.locator('.sc-wb-save-conflict').waitFor({ state: 'hidden' });
      await popup.locator('[data-toolbar-action=commandPalette]').click();
      await popup.getByRole('combobox', { name: '快速导航', exact: true }).fill('>返回 DSH');
      await popup.getByRole('option').filter({ hasText: '返回 DSH' }).click();
      await page.evaluate(() => window.test.controller.visit({ file: 'b.ts' }));
      const text = await page.evaluate(() => window.test.controller.view().state.doc.toString());
      assert.match(text, /\/\/ window draft/); assert.match(text, /\/\/ disk/);
    });
  });
} finally {
  if (evidence && measurements.length) { await mkdir(evidence, { recursive: true }); await writeFile(join(evidence, 'measurements.json'), JSON.stringify(measurements, null, 2)); }
  await browser.close(); windows.dispose(); await new Promise(resolve => server.close(resolve));
}
