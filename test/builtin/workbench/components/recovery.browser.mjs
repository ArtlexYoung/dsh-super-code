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
const evidence = process.env.SC_TEST_ARTIFACTS;
const capture = async (page, name) => { if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, name + '.png'), animations: 'disabled' }); } };
try {
  await test('刷新后继续项目工作', { timeout: 90000 }, async t => {
    let page, errors;
    const check = (name, run) => t.test(name, { skip: Boolean(process.env.SC_TEST_CASE && !name.includes(process.env.SC_TEST_CASE)) }, run);
    const start = async query => {
      await page.goto(`http://127.0.0.1:${server.address().port}/?recovery=demo${query || ''}`);
      await page.waitForFunction(() => window.test?.controller.recovery && !window.test.controller.snapshot().indexing);
    };
    const visit = file => page.evaluate(file => window.test.controller.visit({ file }), file);
    const records = () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('dsh-super-code-workbench-session:')).map(key => JSON.parse(localStorage.getItem(key))));
    const saved = () => page.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith('dsh-super-code-workbench-session:')));
    const resume = async () => {
      await page.getByRole('button', { name: /^继续上次工作/ }).click();
      await page.waitForFunction(() => !window.test.controller.snapshot().recovery.busy);
    };
    t.beforeEach(async () => {
      page = await browser.newPage({ viewport: { width: 1160, height: 840 } }); errors = [];
      page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
      await start();
    });
    t.afterEach(async () => { await page.evaluate(() => window.test?.dispose()); await page.close(); assert.deepEqual(errors, []); });

    await check('刷新后恢复固定标签、顺序、当前文件和阅读位置，空白页可直接打开文件', async () => {
      await page.locator('.sc-wb-start').getByRole('button', { name: '快速打开文件', exact: true }).click();
      await page.getByRole('combobox', { name: '快速导航', exact: true }).fill('a.ts'); await page.getByRole('combobox', { name: '快速导航', exact: true }).press('Enter');
      await page.evaluate(async () => { const c = window.test.controller; await c.pinFile('a.ts'); await c.visit({ file: 'b.ts' }); c.keepTab('b.ts'); await c.visit({ file: 'a.ts', line: 110, character: 5 }); });
      await page.locator('.sc-wb-editor-group .cm-scroller').evaluate(node => { node.scrollTop = 1600; node.scrollLeft = 120; });
      await page.waitForFunction(() => document.querySelector('.sc-wb-editor-group .cm-scroller').scrollTop === 1600);
      const before = await page.evaluate(() => window.test.controller.captureSession());
      await page.reload(); await page.getByRole('button', { name: /^继续上次工作/ }).waitFor();
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().file), null);
      await capture(page, 'resume-light');
      await page.evaluate(() => window.test.theme('idea', true)); await capture(page, 'resume-dark');
      await page.setViewportSize({ width: 900, height: 740 }); await page.evaluate(() => { document.body.style.zoom = '2'; });
      assert.equal(await page.getByRole('button', { name: /^继续上次工作/ }).isVisible(), true);
      const size = await page.getByRole('button', { name: /^继续上次工作/ }).evaluate(node => ({ height: node.clientHeight, content: node.scrollHeight }));
      assert.equal(size.height, size.content, '两倍缩放后恢复按钮必须容纳完整文字');
      await page.getByText('恢复时读取最新文件内容；此记录不包含未保存的正文。', { exact: true }).scrollIntoViewIfNeeded();
      await capture(page, 'resume-zoom'); await page.evaluate(() => { document.body.style.zoom = ''; }); await page.setViewportSize({ width: 1160, height: 840 });
      await resume();
      const after = await page.evaluate(() => window.test.controller.captureSession());
      assert.deepEqual(after.tabs.map(tab => [tab.path, tab.pinned]), [['a.ts', true], ['b.ts', false]]);
      assert.deepEqual(after.current, before.current);
      assert.equal(after.tabs[0].location.line, before.tabs[0].location.line);
      assert.equal(after.tabs[0].location.character, before.tabs[0].location.character);
      await page.waitForFunction(() => Math.abs(document.querySelector('.sc-wb-editor-group .cm-scroller').scrollTop - 1600) < 3);
      assert.equal(await page.locator('.sc-wb-editor-group .cm-scroller').evaluate(node => node.scrollLeft), 120);
    });

    await check('分栏结构、比例和激活栏恢复，正文草稿不写入工作记录或磁盘', async () => {
      await visit('a.ts');
      await page.evaluate(() => { const c = window.test.controller; c.keepTab('a.ts'); c.groups.split(c.groups.snapshot().active, 'right'); });
      await page.waitForFunction(() => window.test.controller.groups.snapshot().panes[1]?.pane.ready);
      await page.evaluate(async () => {
        const c = window.test.controller, groups = c.groups, peer = groups.snapshot().panes[1].pane;
        await peer.ready; await peer.workbench.visit({ file: 'b.ts' }); peer.workbench.keepTab('b.ts');
        c.view().dispatch({ changes: { from: 0, insert: '// unsaved private draft\n' } });
        groups.resize(groups.snapshot().dividers[0].node, .62); groups.activate(peer);
      });
      await saved(); const before = (await records())[0];
      assert.doesNotMatch(JSON.stringify(before), /unsaved private draft/);
      await page.evaluate(() => { window.addEventListener('beforeunload', event => { event.returnValue = ''; }); });
      page.on('dialog', dialog => dialog.accept());
      await page.reload(); await resume();
      const after = await page.evaluate(() => window.test.controller.groups.capture());
      assert.deepEqual(after.tree, before.tree); assert.equal(after.active, 1);
      assert.deepEqual(after.panes.map(pane => pane.current.file), ['a.ts', 'b.ts']);
      assert.equal(await page.evaluate(() => window.test.controller.documents.get('a.ts').dirty), false);
      assert.doesNotMatch(await page.evaluate(() => window.test.texts['a.ts']), /unsaved private draft/);
      await capture(page, 'resume-split');
    });

    await check('已删除文件显示原因，其他文件读取最新磁盘并恢复最近访问', async () => {
      await page.evaluate(async () => { const c = window.test.controller; await c.visit({ file: 'a.ts', line: 110 }); c.keepTab('a.ts'); await c.visit({ file: 'b.ts' }); c.keepTab('b.ts'); });
      await page.evaluate(() => sessionStorage.setItem('recovery-test-disk', JSON.stringify({ 'a.ts': 'const latest = 9;', 'b.ts': null })));
      await page.reload(); await resume();
      await page.locator('.sc-wb-recovery-notice').getByText(/b.ts/).waitFor();
      assert.equal(await page.evaluate(() => window.test.controller.view().state.doc.toString()), 'const latest = 9;');
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().file), 'a.ts');
      assert.equal(await page.locator('[data-file-tab="b.ts"]').count(), 0);
      await capture(page, 'resume-missing');
    });

    await check('不同会话和目录记录隔离，主动打开文件不会自动恢复旧标签', async () => {
      await visit('a.ts'); await saved();
      await start('&root=/other'); assert.equal(await page.getByRole('button', { name: /^继续上次工作/ }).count(), 0);
      await page.goto(`http://127.0.0.1:${server.address().port}/?recovery=other`); await page.waitForFunction(() => window.test?.controller.recovery);
      assert.equal(await page.getByRole('button', { name: /^继续上次工作/ }).count(), 0);
      await start(); await page.getByRole('button', { name: /^继续上次工作/ }).waitFor();
      await visit('b.ts'); await saved();
      assert.deepEqual(await page.evaluate(() => window.test.controller.snapshot().tabs.map(tab => tab.path)), ['b.ts']);
      assert.equal(await page.getByRole('button', { name: /^继续上次工作/ }).count(), 0);
    });

    await check('存储失败可重试，损坏记录不阻止打开文件', async () => {
      await page.evaluate(() => { window.originalStorageWrite = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (key.startsWith('dsh-super-code-workbench-session:')) throw new Error('quota'); return window.originalStorageWrite.call(this, key, value); }; });
      await visit('a.ts'); await page.getByRole('alert').filter({ hasText: '未能记住' }).waitFor();
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().file), 'a.ts');
      await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageWrite; });
      await page.locator('.sc-wb-recovery-notice').getByRole('button', { name: '重试', exact: true }).click(); await saved();
      await page.evaluate(() => { const key = Object.keys(localStorage).find(key => key.startsWith('dsh-super-code-workbench-session:')); localStorage.setItem(key, '{broken'); window.test.controller.recovery.dispose(); });
      await page.reload(); await page.getByRole('alert').filter({ hasText: '无法识别' }).waitFor();
      await page.locator('.sc-wb-start').getByRole('button', { name: '快速打开文件', exact: true }).click();
      await page.getByRole('combobox', { name: '快速导航', exact: true }).fill('b.ts'); await page.getByRole('combobox', { name: '快速导航', exact: true }).press('Enter');
      await page.waitForFunction(() => window.test.controller.snapshot().file === 'b.ts');
    });

    await check('独立窗口导航不覆盖主工作台恢复记录', async () => {
      await visit('a.ts'); await saved();
      const opened = page.waitForEvent('popup'); await page.locator('[data-toolbar-action=window]').click(); const popup = await opened;
      popup.on('pageerror', error => errors.push(error.message));
      try {
        await popup.locator('[data-toolbar-action=navigateFiles]').click();
        await popup.getByRole('combobox', { name: '快速导航', exact: true }).fill('b.ts'); await popup.getByRole('option').filter({ hasText: 'b.ts' }).waitFor(); await popup.getByRole('combobox', { name: '快速导航', exact: true }).press('Enter');
        await popup.getByRole('button', { name: '浏览 b.ts 的同级项', exact: true }).waitFor();
        await popup.locator('[data-toolbar-action=window]').click();
        await page.waitForFunction(() => !window.test.controller.snapshot().window);
        await page.reload(); await resume();
        assert.equal(await page.evaluate(() => window.test.controller.snapshot().file), 'a.ts');
      } finally { if (!popup.isClosed()) await popup.close(); }
    });
    await check('恢复读取中改开其他文件，晚到结果不抢位置', async () => {
      await page.evaluate(async () => { const c = window.test.controller; await c.visit({ file: 'a.ts' }); c.keepTab('a.ts'); await c.visit({ file: 'b.ts' }); c.keepTab('b.ts'); });
      await page.reload(); await page.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
      await page.evaluate(() => window.test.holdRead('a.ts'));
      await page.getByRole('button', { name: /^继续上次工作/ }).click();
      await page.getByText('正在恢复文件和阅读位置…', { exact: true }).waitFor();
      await page.locator('.sc-wb-start').getByRole('button', { name: '快速打开文件', exact: true }).click();
      await page.getByRole('combobox', { name: '快速导航', exact: true }).fill('folder/test.py');
      await page.getByRole('option').filter({ hasText: 'test.py' }).click();
      await page.waitForFunction(() => window.test.controller.snapshot().file === 'folder/test.py' && !window.test.controller.snapshot().recovery.busy);
      await page.evaluate(() => window.test.releaseReads());
      assert.equal(await page.locator('[data-file-tab="b.ts"]').count(), 0);
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().file), 'folder/test.py');
    });
    await check('停止恢复立即结束等待，未返回的读取不能继续打开文件', async () => {
      await visit('a.ts'); await page.reload();
      await page.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
      await page.evaluate(() => window.test.holdRead('a.ts'));
      await page.getByRole('button', { name: /^继续上次工作/ }).click();
      await page.locator('.sc-wb-recovery-notice').getByRole('button', { name: '停止', exact: true }).click();
      await page.waitForFunction(() => !window.test.controller.snapshot().recovery.busy);
      await page.evaluate(() => window.test.releaseReads());
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().file), null);
      assert.equal(await page.getByRole('button', { name: /^继续上次工作/ }).isVisible(), true);
    });
    await check('分栏恢复中主动打开文件，保留用户选择的分栏与文件', async () => {
      await visit('a.ts');
      await page.evaluate(() => { const c = window.test.controller; c.keepTab('a.ts'); c.groups.split(c.groups.snapshot().active, 'right'); });
      await page.waitForFunction(() => window.test.controller.groups.snapshot().panes[1]?.pane.ready);
      await page.evaluate(async () => { const peer = window.test.controller.groups.snapshot().panes[1].pane; await peer.ready; await peer.workbench.visit({ file: 'b.ts' }); peer.workbench.keepTab('b.ts'); });
      await page.reload(); await page.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
      await page.evaluate(() => window.test.holdRead('b.ts'));
      await page.getByRole('button', { name: /^继续上次工作/ }).click();
      await page.waitForFunction(() => window.test.controller.groups.snapshot().panes[1]?.pane.ready);
      await page.evaluate(async () => { const peer = window.test.controller.groups.snapshot().panes[1].pane; await peer.ready; await peer.workbench.visit({ file: 'folder/test.py' }); });
      await page.waitForFunction(() => !window.test.controller.snapshot().recovery.busy);
      await page.evaluate(() => window.test.releaseReads());
      assert.deepEqual(await page.evaluate(() => window.test.controller.groups.snapshot().panes.map(({ pane }) => pane.workbench.snapshot().file)), ['a.ts', 'folder/test.py']);
    });
    await check('已恢复的分栏中打开文件会停止其他分栏的恢复', async () => {
      await visit('a.ts');
      await page.evaluate(() => { const c = window.test.controller; c.keepTab('a.ts'); c.groups.split(c.groups.snapshot().active, 'right'); });
      await page.waitForFunction(() => window.test.controller.groups.snapshot().panes[1]?.pane.ready);
      await page.evaluate(async () => { const peer = window.test.controller.groups.snapshot().panes[1].pane; await peer.ready; await peer.workbench.visit({ file: 'b.ts' }); peer.workbench.keepTab('b.ts'); });
      await page.reload(); await page.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
      await page.evaluate(() => window.test.holdRead('b.ts'));
      await page.getByRole('button', { name: /^继续上次工作/ }).click();
      await page.waitForFunction(() => window.test.controller.snapshot().file === 'a.ts');
      await visit('folder/test.py');
      await page.waitForFunction(() => !window.test.controller.snapshot().recovery.busy);
      await page.evaluate(() => window.test.releaseReads());
      assert.equal(await page.evaluate(() => window.test.controller.groups.snapshot().active.workbench.snapshot().file), 'folder/test.py');
      assert.equal(await page.locator('[data-file-tab="b.ts"]').count(), 0);
    });
  });
} finally { await browser.close(); windows.dispose(); await new Promise(resolve => server.close(resolve)); }
