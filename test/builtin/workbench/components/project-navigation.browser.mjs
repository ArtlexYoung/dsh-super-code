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
  await test('快速导航行列与项目符号（真实编辑器与窗口传输）', { timeout: 90000 }, async t => {
    let page, errors;
    const input = target => target.getByRole('combobox', { name: /^(快速导航|Quick navigation)$/ });
    const results = target => target.locator('.sc-wb-navigator-list [role=option]');
    const start = async (target = page) => { await target.locator('[data-toolbar-action=navigateFiles]').click(); await input(target).waitFor(); };
    const choose = async (query, target = page) => { await input(target).fill(query); await results(target).first().waitFor(); await input(target).press('Enter'); };
    t.beforeEach(async () => {
      page = await browser.newPage({ viewport: { width: 1280, height: 920 } }); errors = [];
      page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/?recovery=navigation`);
      await page.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
      await page.evaluate(() => window.test.controller.visit({ file: 'a.ts' }));
    });
    t.afterEach(async () => { await page.evaluate(() => window.test.dispose()); await page.close(); assert.deepEqual(errors, []); });

    await t.test('输入文件行列、当前文件行列和超出范围位置，确认后才跳转', async () => {
      await start(); await choose('a.ts:120:8');
      await page.waitForFunction(() => window.test.controller.snapshot().cursor.line === 119);
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().cursor.character), 7);
      await start(); await choose(':5:3');
      await page.waitForFunction(() => window.test.controller.snapshot().cursor.line === 4);
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().cursor.character), 2);
      await start(); await choose('b.ts:999:999');
      await page.waitForFunction(() => window.test.controller.snapshot().file === 'b.ts');
      assert.equal(await page.evaluate(() => window.test.controller.view().state.selection.main.head), await page.evaluate(() => window.test.controller.view().state.doc.length));
      await start(); await input(page).fill('b.ts:0'); await results(page).waitFor({ state: 'detached' });
      await input(page).press('Escape');
    });
    await t.test('取消符号导航保持选区与滚动位置，键盘选结果不会预先跳转', async () => {
      await page.evaluate(() => window.test.controller.visit({ file: 'a.ts', line: 100, character: 2, length: 5 }));
      await page.waitForFunction(() => window.test.controller.view().scrollDOM.scrollTop > 1000);
      const before = await page.evaluate(() => { const v=window.test.controller.view();return {selection:v.state.selection.toJSON(),scroll:v.scrollDOM.scrollTop}; });
      await start(); await page.getByRole('button', { name: '项目符号', exact: true }).click();
      await results(page).first().waitFor(); await input(page).press('ArrowDown');
      await input(page).press('Escape');
      assert.deepEqual(await page.evaluate(() => {const v=window.test.controller.view();return {selection:v.state.selection.toJSON(),scroll:v.scrollDOM.scrollTop};}), before);
    });
    await t.test('项目同名符号显示来源，按路径缩小范围并跳到其他文件', async () => {
      await start(); await page.getByRole('button', { name: '项目符号', exact: true }).click();
      await input(page).fill('#add'); await page.waitForFunction(() => document.querySelectorAll('.sc-wb-navigator-list [role=option]').length === 2);
      assert.match(await page.locator('.sc-wb-symbol-source').innerText(), /项目声明索引.*3 个文件.*索引完成/);
      assert.match(await results(page).nth(1).innerText(), /b.ts:2:17/);
      await capture(page, 'project-symbols-light'); await page.evaluate(() => window.test.theme('idea', true)); await capture(page, 'project-symbols-dark');
      await choose('#add b.ts'); await page.waitForFunction(() => window.test.controller.snapshot().file === 'b.ts');
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().cursor.line), 1);
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().cursor.character), 16);
    });
    await t.test('索引过程中显示状态，完成后和未保存编辑后更新项目符号', async () => {
      await page.evaluate(() => {window.test.holdRead('b.ts');void window.test.controller.refresh();});
      await page.waitForFunction(() => window.test.controller.snapshot().indexing);
      await start(); await input(page).fill('#add');
      await page.locator('.sc-wb-symbol-source').filter({ hasText: '正在索引' }).waitFor();
      await page.evaluate(() => { window.test.progressTimer = setInterval(() => window.test.controller.index.progress(), 24); });
      try { await results(page).filter({ hasText: 'a.ts' }).first().waitFor(); }
      finally { await page.evaluate(() => clearInterval(window.test.progressTimer)); }
      await page.evaluate(() => window.test.releaseReads());
      await page.locator('.sc-wb-symbol-source').filter({ hasText: '索引完成' }).waitFor();
      await page.evaluate(() => window.test.controller.view().dispatch({ changes: { from: 0, insert: 'export const newlyAdded = 1;\n' } }));
      await input(page).fill('#newlyAdded'); await results(page).filter({ hasText: 'newlyAdded' }).waitFor();
    });
    await t.test('符号结果达到1000项时提示，过期请求和新查询互不覆盖', async () => {
      await page.evaluate(async () => {
        await window.test.controller.index.change('many.ts', Array.from({length:1010},(_,i)=>'export const symbol'+i+' = '+i+';').join('\n'));
      });
      await start(); await input(page).fill('#symbol');
      await page.getByText('显示前 1000 个符号，请增加名称或路径关键词缩小范围').waitFor();
      assert.equal(await results(page).first().getAttribute('aria-setsize'), '1000'); assert.ok(await results(page).count() < 30);
      await page.evaluate(() => {
        const index=window.test.controller.index,original=index.symbols.bind(index);let release;
        window.test.symbolStarted=false;window.test.releaseSymbols=()=>release();
        index.symbols=async (query,...rest)=>{if(query==='hold'){window.test.symbolStarted=true;await new Promise(resolve=>{release=resolve});return{matches:[{file:'stale.ts',name:'stale',offset:0,line:0,character:0}],truncated:false}}return original(query,...rest)};
      });
      await input(page).fill('#hold'); await page.waitForFunction(() => window.test.symbolStarted);
      await input(page).fill('#example'); await results(page).filter({ hasText: 'example' }).waitFor();
      await page.evaluate(() => window.test.releaseSymbols());
      assert.equal(await results(page).filter({ hasText: 'stale' }).count(), 0);
    });
    await t.test('独立窗口通过命令入口查项目符号与文件行列，原页面位置保留', async () => {
      const before = await page.evaluate(() => window.test.controller.snapshot().cursor);
      const opened = page.waitForEvent('popup'); await page.locator('[data-toolbar-action=window]').click(); const popup = await opened;
      popup.setDefaultTimeout(6000); popup.on('pageerror', error => errors.push(error.message));
      try {
        await popup.locator('[data-toolbar-action=commandPalette]').click(); await choose('>项目符号', popup);
        await input(popup).fill('#example'); await results(popup).filter({ hasText: 'example' }).waitFor(); await input(popup).press('Enter');
        await popup.locator('[data-file-tab="folder/test.py"]').waitFor();
        await start(popup); await choose('b.ts:2:17', popup); await popup.locator('[data-file-tab="b.ts"]').waitFor();
        assert.deepEqual(await page.evaluate(() => window.test.controller.snapshot().cursor), before);
        await capture(popup, 'navigation-window');
      } finally { await popup.close(); }
    });
    await t.test('英文200%下模式和来源可读，查询仍可操作', async () => {
      await page.evaluate(() => {window.test.locale();document.body.style.zoom='2';});
      await start(); await page.getByRole('button', { name: 'Project symbols', exact: true }).click();
      await input(page).fill('#add'); await results(page).first().waitFor();
      await capture(page, 'navigation-english-200');
      const box=await results(page).first().boundingBox(); assert.ok(box.y>=0 && box.y+box.height<=920);
      await input(page).press('Escape');
    });
  });
} finally { await browser.close(); await windows.dispose(); await new Promise(resolve => server.close(resolve)); }
