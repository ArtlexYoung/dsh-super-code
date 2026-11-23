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
  await test('全局查找和替换共享选项', { timeout: 60000 }, async t => {
    let page, errors;
    const search = target => target.locator('.sc-wb-locations');
    const replace = target => target.locator('.sc-wb-replace');
    const openReplace = async () => {
      await page.keyboard.press('Escape'); await page.locator('[data-toolbar-action=commandPalette]').click();
      await page.getByRole('combobox', { name: '快速导航', exact: true }).fill('>全局替换');
      await page.getByRole('option', { name: /全局替换/ }).click();
    };
    const expand = async target => { const detail = target.locator('.sc-wb-search-options details'); if (await detail.getAttribute('open') === null) await detail.locator('summary').click(); };
    t.beforeEach(async () => {
      page = await browser.newPage({ viewport: { width: 1280, height: 920 } }); errors = [];
      page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
      await page.evaluate(async () => {
        for (const path of ['src/main.ts', 'src/skip.test.ts', 'src/nested/other.ts', 'outside.ts']) window.test.external(path, 'Token12 token34 tokenLong');
        await window.test.controller.visit({ file: 'src/main.ts' });
      });
      await page.locator('[data-toolbar-action=project]').click();
    });
    t.afterEach(async () => { await page.evaluate(() => window.test?.dispose()); await page.close(); assert.deepEqual(errors, []); });

    await t.test('目录范围、大小写和正则全词一致传给替换，预览与写入使用相同捕获组', async () => {
      await search(page).getByRole('combobox', { name: '全局搜索', exact: true }).fill('token(\\d+)');
      await search(page).getByRole('checkbox', { name: '正则表达式', exact: true }).check();
      await search(page).getByRole('checkbox', { name: '全词匹配', exact: true }).check();
      await expand(search(page));
      await search(page).getByRole('button', { name: '当前文件目录', exact: true }).click();
      await search(page).getByRole('textbox', { name: '包含文件', exact: true }).fill('*.ts');
      await search(page).getByRole('textbox', { name: '排除文件', exact: true }).fill('*.test.ts');
      await page.waitForFunction(() => document.querySelectorAll('.sc-wb-locations [role=option]').length === 4);
      await search(page).getByRole('checkbox', { name: '区分大小写', exact: true }).check();
      await page.waitForFunction(() => document.querySelectorAll('.sc-wb-locations [role=option]').length === 2);
      await capture(page, 'search-options-light');
      await page.evaluate(() => window.test.theme('idea', true)); await capture(page, 'search-options-dark');
      await openReplace();
      await replace(page).waitFor();
      assert.equal(await replace(page).getByRole('textbox', { name: '查找文本', exact: true }).inputValue(), 'token(\\d+)');
      assert.equal(await replace(page).getByRole('checkbox', { name: '区分大小写', exact: true }).isChecked(), true);
      await replace(page).getByRole('textbox', { name: '替换为', exact: true }).fill('item$1');
      await replace(page).getByRole('button', { name: '预览匹配', exact: true }).click();
      await replace(page).getByRole('button', { name: '查看 src/main.ts 的替换预览', exact: true }).click();
      await replace(page).getByRole('textbox', { name: '修改后 src/main.ts', exact: true }).waitFor();
      await capture(page, 'search-regex-replacement');
      await replace(page).getByRole('button', { name: '替换 2 个文件', exact: true }).click();
      await page.waitForFunction(() => window.test.texts['src/main.ts'] === 'Token12 item34 tokenLong');
      assert.equal(await page.evaluate(() => window.test.texts['src/skip.test.ts']), 'Token12 token34 tokenLong');
      assert.equal(await page.evaluate(() => window.test.texts['outside.ts']), 'Token12 token34 tokenLong');
    });

    await t.test('无效正则显示错误，改正后恢复；新范围立即清除旧结果', async () => {
      await search(page).getByRole('checkbox', { name: '正则表达式', exact: true }).check();
      await search(page).getByRole('combobox', { name: '全局搜索', exact: true }).fill('[');
      await search(page).getByRole('alert').filter({ hasText: '正则表达式无效' }).waitFor();
      await search(page).getByRole('combobox', { name: '全局搜索', exact: true }).fill('Token12');
      await page.waitForFunction(() => document.querySelectorAll('.sc-wb-locations [role=option]').length === 4);
      await expand(search(page)); await search(page).getByRole('textbox', { name: '目录', exact: true }).fill('missing');
      await page.waitForFunction(() => document.querySelectorAll('.sc-wb-locations [role=option]').length === 0);
      assert.equal(await search(page).getByRole('alert').count(), 0);
    });

    await t.test('英文和两倍显示下范围控件可操作，收起范围可继续阅读结果', async () => {
      await page.evaluate(() => { window.test.locale(); document.body.style.zoom = '2'; });
      await search(page).getByRole('combobox', { name: 'Project search', exact: true }).fill('Token12');
      await expand(search(page));
      await search(page).getByRole('textbox', { name: 'Include files', exact: true }).fill('*.ts');
      await search(page).getByRole('textbox', { name: 'Directory', exact: true }).fill('src/nested');
      await capture(page, 'search-options-english-zoom');
      await search(page).locator('summary').click();
      await search(page).getByRole('option').first().waitFor();
      assert.equal(await search(page).getByRole('option').count(), 1);
      await capture(page, 'search-options-english-collapsed');
    });

    await t.test('独立工具窗更新范围同步原页面并废弃过期替换预览', async () => {
      await openReplace();
      await replace(page).getByRole('textbox', { name: '查找文本', exact: true }).fill('Token12');
      await replace(page).getByRole('textbox', { name: '替换为', exact: true }).fill('new');
      await replace(page).getByRole('button', { name: '预览匹配', exact: true }).click();
      await replace(page).getByRole('button', { name: '替换 4 个文件', exact: true }).waitFor();
      const opened = page.waitForEvent('popup'); await page.locator('.sc-wb-dialog-heading').getByRole('button', { name: '独立窗口', exact: true }).click(); const popup = await opened;
      popup.on('pageerror', error => errors.push(error.message));
      try {
        await replace(popup).waitFor(); await expand(replace(popup));
        await replace(popup).getByRole('textbox', { name: '目录', exact: true }).fill('src/nested');
        await page.waitForFunction(() => window.test.controller.snapshot().searchQuery.directory === 'src/nested');
        assert.equal(await replace(popup).locator('.sc-wb-replace-row').count(), 0);
        await replace(popup).getByRole('button', { name: '预览匹配', exact: true }).click();
        await replace(popup).getByRole('button', { name: '替换 1 个文件', exact: true }).click();
        await page.waitForFunction(() => window.test.texts['src/nested/other.ts'].startsWith('new'));
        assert.equal(await page.evaluate(() => window.test.texts['src/main.ts']), 'Token12 token34 tokenLong');
        await capture(popup, 'search-options-window');
      } finally { if (!popup.isClosed()) await popup.close(); }
    });
  });
} finally { await browser.close(); await windows.dispose(); await new Promise(resolve => server.close(resolve)); }
