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
  await test('未保存文件与客户端恢复副本（真实 IndexedDB、编辑器和窗口传输）', { timeout: 90000 }, async t => {
    let page, errors;
    const start = query => page.goto(`http://127.0.0.1:${server.address().port}/?drafts=demo&recovery=demo${query || ''}`);
    const ready = () => page.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing && window.test.controller.snapshot().drafts?.loading === false);
    const record = () => page.evaluate(() => window.test.draftStore.read('/demo'));
    const stored = async check => {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) { if (check(await record())) return; await new Promise(resolve => setTimeout(resolve, 25)); }
      assert.fail('恢复副本未在期限内写入 IndexedDB');
    };
    const backup = text => stored(value => value?.entries.some(entry => entry.text.includes(text)));
    const edit = async (path, value) => page.evaluate(async ({ path, value }) => { const c = window.test.controller; await c.visit({ file: path }); c.view().dispatch({ changes: { from: 0, insert: value } }); }, { path, value });
    const open = () => page.locator('.sc-wb-status').getByRole('button', { name: /未保存文件|unsaved files/ }).click();
    const panel = () => page.locator('.sc-wb-drafts');
    t.beforeEach(async () => {
      page = await browser.newPage({ viewport: { width: 1280, height: 920 }, acceptDownloads: true }); errors = [];
      page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
      await start(); await ready();
    });
    t.afterEach(async () => { await page.evaluate(() => window.test.dispose()); await page.close(); assert.deepEqual(errors, []); });
    await t.test('全项目列表含已关闭标签，保存全部保留冲突并保存其余文件', async () => {
      await edit('a.ts', '// first\n');
      await page.evaluate(() => window.test.controller.closeFile('a.ts', 'keep'));
      await edit('b.ts', '// second\n');
      await page.evaluate(() => window.test.external('a.ts', '// external'));
      await open(); assert.equal(await panel().locator('li').count(), 2);
      await panel().getByRole('button', { name: '保存全部', exact: true }).click();
      await panel().getByRole('alert').filter({ hasText: 'a.ts' }).waitFor();
      assert.equal(await page.evaluate(() => window.test.texts['a.ts']), '// external');
      assert.ok((await page.evaluate(() => window.test.texts['b.ts'])).startsWith('// second'));
      assert.deepEqual(await page.evaluate(() => window.test.controller.snapshot().unsaved.map(item => item.path)), ['a.ts']);
      await capture(page, 'drafts-conflict');
    });
    await t.test('保存期间的新输入仍在未保存列表，重复保存全部不重复启动', async () => {
      await edit('b.ts', '// first\n'); await open(); await page.evaluate(() => window.test.holdSave());
      await panel().getByRole('button', { name: '保存全部', exact: true }).click();
      await page.waitForFunction(() => window.test.saveStarted());
      assert.equal(await panel().getByRole('button', { name: '保存全部', exact: true }).isDisabled(), true);
      await page.evaluate(() => { window.test.controller.view().dispatch({ changes: { from: 0, insert: '// later\n' } }); window.test.releaseSave(); });
      await page.waitForFunction(() => !window.test.controller.snapshot().saveBatch.busy);
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().unsaved.length), 1);
      assert.ok(!(await page.evaluate(() => window.test.texts['b.ts'])).startsWith('// later'));
      await panel().getByRole('button', { name: '保存全部', exact: true }).focus();
      await page.keyboard.press('ControlOrMeta+Alt+s');
      await page.waitForFunction(() => !window.test.controller.snapshot().unsaved.length);
      assert.ok((await page.evaluate(() => window.test.texts['b.ts'])).startsWith('// later'));
    });
    await t.test('刷新后恢复为草稿，立即自动保存也不会越过手动确认', async () => {
      await edit('b.ts', '// recovered\n'); await backup('// recovered');
      await page.reload(); await ready();
      await page.evaluate(() => { const c = window.test.controller; return c.settings({ ...c.snapshot().preferences, autoSave: 'immediate' }); });
      await open(); await panel().getByRole('button', { name: '恢复为草稿', exact: true }).click();
      await page.waitForFunction(() => window.test.controller.snapshot().unsaved[0]?.review === true);
      assert.ok((await page.evaluate(() => window.test.controller.view().state.doc.toString())).startsWith('// recovered'));
      assert.ok(!(await page.evaluate(() => window.test.texts['b.ts'])).startsWith('// recovered'));
      await panel().getByRole('button', { name: '保存全部', exact: true }).click();
      await stored(value => value?.entries.length === 0);
      assert.ok((await page.evaluate(() => window.test.texts['b.ts'])).startsWith('// recovered'));
    });
    await t.test('恢复保留原磁盘版本，新磁盘内容进入保存冲突比较', async () => {
      await edit('b.ts', '// recovered\n'); await backup('// recovered'); await page.reload(); await ready();
      await page.evaluate(() => window.test.external('b.ts', '// newer on disk'));
      await open(); await panel().getByRole('button', { name: '恢复为草稿', exact: true }).click();
      await panel().getByRole('button', { name: '保存全部', exact: true }).click();
      await panel().getByRole('alert').filter({ hasText: 'b.ts' }).waitFor();
      assert.equal(await page.evaluate(() => window.test.texts['b.ts']), '// newer on disk');
      await panel().getByRole('button', { name: '比较并合并', exact: true }).click();
      await page.getByRole('textbox', { name: /磁盘/ }).first().waitFor();
    });
    await t.test('当前新草稿不能被旧副本覆盖，旧副本仍可下载', async () => {
      await edit('b.ts', '// earlier\n'); await backup('// earlier'); const before = (await record()).entries[0].text;
      await page.reload(); await ready(); await edit('b.ts', '// current\n'); await open();
      await panel().getByRole('button', { name: '恢复为草稿', exact: true }).click();
      await panel().getByRole('alert').filter({ hasText: '当前文件已有未保存编辑' }).waitFor();
      assert.ok((await page.evaluate(() => window.test.controller.view().state.doc.toString())).startsWith('// current'));
      const downloaded = page.waitForEvent('download'); await panel().getByRole('button', { name: '下载副本', exact: true }).click();
      const download = await downloaded; assert.equal(await readFile(await download.path(), 'utf8'), before);
      assert.equal((await record()).entries[0].text, before);
      await capture(page, 'drafts-light'); await page.evaluate(() => window.test.theme('idea', true)); await capture(page, 'drafts-dark');
    });
    await t.test('写入失败保留原副本，重试后备份最新输入', async () => {
      await edit('b.ts', '// old\n'); await backup('// old');
      await page.evaluate(() => { window.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
      await edit('b.ts', '// latest\n'); await open();
      await panel().getByRole('alert').filter({ hasText: /副本/ }).waitFor();
      assert.ok(!(await record()).entries[0].text.startsWith('// latest'));
      await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; });
      await panel().getByRole('button', { name: '重试', exact: true }).click(); await backup('// latest');
      assert.equal(await panel().getByRole('alert').count(), 0);
    });
    await t.test('会话与项目隔离，多页面旧版本不能覆盖新副本', async () => {
      await edit('b.ts', '// private\n'); await backup('// private');
      const original = await record();
      await start('&root=/other'); await ready(); assert.equal(await page.evaluate(() => window.test.controller.snapshot().drafts.candidates.length), 0);
      await page.goto(`http://127.0.0.1:${server.address().port}/?drafts=other`); await ready();
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().drafts.candidates.length), 0);
      await start(); await ready();
      const result = await page.evaluate(async record => {
        const store = window.test.draftStore;
        const next = await store.save('/demo', [{ ...record.entries[0], text: 'newer copy' }], record.revision);
        try { await store.save('/demo', record.entries, record.revision); return 'unexpected'; } catch (error) { return error.message; }
      }, original);
      assert.equal(result, 'WORKBENCH_RECOVERY_CHANGED'); assert.equal((await record()).entries[0].text, 'newer copy');
    });
    await t.test('缺失文件保留副本可下载，确认删除仅移除该副本', async () => {
      await edit('b.ts', '// missing\n'); await backup('// missing');
      await page.evaluate(() => sessionStorage.setItem('recovery-test-disk', JSON.stringify({ 'b.ts': null })));
      await page.reload(); await ready(); await open(); await panel().getByRole('button', { name: '恢复为草稿', exact: true }).click();
      await panel().getByRole('alert').waitFor(); assert.equal((await record()).entries.length, 1);
      await panel().getByRole('button', { name: '删除副本', exact: true }).click(); assert.equal((await record()).entries.length, 1);
      await panel().getByRole('button', { name: '确认删除副本', exact: true }).click();
      await stored(value => value?.entries.length === 0);
    });
    await t.test('损坏恢复记录保留并说明原因，仍能正常打开文件', async () => {
      await edit('b.ts', '// invalid later\n'); await backup('// invalid later');
      await page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open('dsh-super-code-workbench-recovery', 1);
        request.onsuccess = () => {
          const db = request.result, transaction = db.transaction('drafts', 'readwrite');
          transaction.objectStore('drafts').put({ invalid: true }, JSON.stringify(['demo', '/demo']));
          transaction.oncomplete = () => { db.close(); resolve(); }; transaction.onabort = reject;
        };
      }));
      await page.reload(); await ready(); await open();
      await panel().getByRole('alert').filter({ hasText: '格式无法识别' }).waitFor();
      await page.keyboard.press('Escape'); await page.evaluate(() => window.test.controller.visit({ file: 'b.ts' }));
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().file), 'b.ts');
      assert.equal(await page.evaluate(() => window.test.draftStore.read('/demo').then(() => 'unexpected', error => error.message)), 'WORKBENCH_DRAFT_INVALID');
    });
    await t.test('恢复库总容量限制拒绝额外写入并保留已存副本', async () => {
      const result = await page.evaluate(async () => {
        const store = window.test.draftStore, entry = { path: 'large.txt', text: 'x'.repeat(15 * 1024 * 1024), original: '', diskVersion: 'v1' };
        for (let index = 0; index < 4; index++) await store.save(`/capacity-${index}`, [entry], 0);
        try { await store.save('/capacity-over', [entry], 0); return { error: 'unexpected' }; }
        catch (error) { return { error: error.message, retained: (await store.read('/capacity-0')).entries[0].text.length, rejected: await store.read('/capacity-over') }; }
      });
      assert.equal(result.error, 'WORKBENCH_DRAFT_SIZE'); assert.equal(result.retained, 15 * 1024 * 1024); assert.equal(result.rejected, null);
    });
    await t.test('独立窗口编辑也进入恢复记录，英文双倍缩放可操作', async () => {
      await page.evaluate(() => window.test.controller.visit({ file: 'b.ts' }));
      const opened = page.waitForEvent('popup'); await page.locator('[data-toolbar-action=window]').click(); const popup = await opened;
      popup.on('pageerror', error => errors.push(error.message)); popup.setDefaultTimeout(5000);
      try {
        const editor = popup.locator('.sc-wb-editor-group .cm-content').first(); await editor.click(); await editor.press('ControlOrMeta+Home'); await editor.press('Home'); await editor.press('x');
        await stored(value => value?.entries.length === 1);
        await popup.locator('[data-toolbar-action=window]').click();
        await page.waitForFunction(() => !window.test.controller.snapshot().window);
      } finally { if (!popup.isClosed()) await popup.close(); }
      await open(); await page.evaluate(() => { window.test.locale(); document.body.style.zoom = '2'; });
      await panel().getByRole('button', { name: 'Save all', exact: true }).waitFor();
      await capture(page, 'drafts-english-zoom');
      await panel().getByRole('button', { name: 'Save all', exact: true }).click();
      await page.waitForFunction(() => !window.test.controller.snapshot().unsaved.length);
    });
  });
} finally { await browser.close(); await windows.dispose(); await new Promise(resolve => server.close(resolve)); }
