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
  await test('全局替换逐文件审阅', { timeout: 90000 }, async t => {
    let page, errors;
    const check = (name, run) => t.test(name, { skip: Boolean(process.env.SC_TEST_CASE && !name.includes(process.env.SC_TEST_CASE)) }, run);
    const panel = target => target.locator('.sc-wb-replace');
    const choose = (target, path) => panel(target).getByRole('checkbox', { name: `选择 ${path}`, exact: true });
    const inspect = (target, path) => panel(target).getByRole('button', { name: `查看 ${path} 的替换预览`, exact: true }).click();
    const scan = async (replacement = 'new') => {
      await page.evaluate(() => window.test.controller.panel({ kind: 'projectReplace' }));
      await panel(page).getByRole('textbox', { name: '查找文本', exact: true }).fill('old');
      await panel(page).getByRole('textbox', { name: '替换为', exact: true }).fill(replacement);
      await panel(page).getByRole('button', { name: '预览匹配', exact: true }).click();
      await choose(page, 'b.ts').waitFor();
    };
    const apply = (target, count) => panel(target).getByRole('button', { name: `替换 ${count} 个文件`, exact: true });
    t.beforeEach(async () => {
      page = await browser.newPage({ viewport: { width: 1160, height: 840 } }); errors = [];
      page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
      await page.evaluate(() => { window.test.external('a.ts', 'old one\nold tail\n'); window.test.external('b.ts', 'old two\n'); });
    });
    t.afterEach(async () => { await page.evaluate(() => window.test?.dispose()); await page.close(); assert.deepEqual(errors, []); });

    await check('勾选决定写入范围，查看完整差异不写盘，未选文件可继续处理', async () => {
      await scan(); await choose(page, 'b.ts').uncheck(); await inspect(page, 'a.ts');
      await panel(page).getByRole('textbox', { name: '修改后 a.ts', exact: true }).waitFor();
      assert.match(await panel(page).getByRole('textbox', { name: '修改前 a.ts', exact: true }).textContent(), /old tail/);
      assert.match(await panel(page).getByRole('textbox', { name: '修改后 a.ts', exact: true }).textContent(), /new tail/);
      assert.equal(await page.evaluate(() => window.test.texts['a.ts']), 'old one\nold tail\n');
      await capture(page, 'replace-review-light');
      await page.evaluate(() => window.test.theme('idea', true)); await capture(page, 'replace-review-dark');
      await apply(page, 1).click(); await page.waitForFunction(() => window.test.texts['a.ts'] === 'new one\nnew tail\n');
      assert.equal(await page.evaluate(() => window.test.texts['b.ts']), 'old two\n');
      assert.equal(await choose(page, 'b.ts').isChecked(), false); assert.equal(await apply(page, 0).isDisabled(), true);
      await choose(page, 'b.ts').check(); await apply(page, 1).click();
      await page.waitForFunction(() => window.test.texts['b.ts'] === 'new two\n');
      assert.equal(await page.locator('.sc-wb-replace-row').count(), 0);
    });

    await check('部分失败保留剩余文件，重新检查不会再次替换已成功项', async () => {
      await scan('old new'); await page.evaluate(() => window.test.external('b.ts', 'old outside\n'));
      await apply(page, 2).click(); await panel(page).getByText(/已替换 1 个文件，1 个失败/).waitFor();
      assert.equal(await choose(page, 'a.ts').count(), 0); assert.equal(await choose(page, 'b.ts').isChecked(), true);
      await inspect(page, 'b.ts'); await panel(page).getByRole('alert').waitFor();
      await panel(page).getByRole('button', { name: '重新检查剩余文件', exact: true }).click();
      await apply(page, 1).waitFor(); await inspect(page, 'b.ts');
      await panel(page).getByRole('textbox', { name: '修改后 b.ts', exact: true }).waitFor();
      await capture(page, 'replace-review-retry'); await apply(page, 1).click();
      await page.waitForFunction(() => window.test.texts['b.ts'] === 'old new outside\n');
      assert.equal(await page.evaluate(() => window.test.texts['a.ts']), 'old new one\nold new tail\n');
    });

    await check('停止替换保留尚未完成文件，再次操作不重复成功项', async () => {
      await scan('old new'); await page.evaluate(() => window.test.holdRead('b.ts'));
      await apply(page, 2).click(); await page.waitForFunction(() => window.test.texts['a.ts'].startsWith('old new'));
      await panel(page).getByRole('button', { name: '停止', exact: true }).click();
      await page.evaluate(() => window.test.releaseReads());
      await page.waitForFunction(() => !document.querySelector('.sc-wb-replace button[type=submit]').disabled);
      assert.equal(await choose(page, 'a.ts').count(), 0); assert.equal(await choose(page, 'b.ts').isChecked(), true);
      await apply(page, 1).click(); await page.waitForFunction(() => window.test.texts['b.ts'] === 'old new two\n');
      assert.equal(await page.evaluate(() => window.test.texts['a.ts']), 'old new one\nold new tail\n');
    });

    await check('重新检查失败或停止后保留原范围和勾选，不重新加入成功文件', async () => {
      await scan('old new'); await choose(page, 'b.ts').uncheck(); await apply(page, 1).click();
      await page.waitForFunction(() => window.test.texts['a.ts'].startsWith('old new')); await choose(page, 'b.ts').check();
      await page.evaluate(() => {
        const c = window.test.controller, original = c.searchProject;
        c.searchProject = async function* () { c.searchProject = original; throw new Error('scan failed'); };
      });
      await panel(page).getByRole('button', { name: '重新检查剩余文件', exact: true }).click();
      await panel(page).getByRole('alert').waitFor();
      assert.equal(await choose(page, 'b.ts').isChecked(), true); assert.equal(await choose(page, 'a.ts').count(), 0);
      await page.evaluate(() => window.test.holdRead('b.ts'));
      await panel(page).getByRole('button', { name: '重新检查剩余文件', exact: true }).click();
      await panel(page).getByRole('button', { name: '停止', exact: true }).click(); await page.evaluate(() => window.test.releaseReads());
      await page.waitForFunction(() => !document.querySelector('.sc-wb-replace button[type=submit]').disabled);
      assert.equal(await choose(page, 'b.ts').isChecked(), true);
      await panel(page).getByRole('button', { name: '重新检查剩余文件', exact: true }).click(); await choose(page, 'b.ts').waitFor();
      await apply(page, 1).click(); await page.waitForFunction(() => window.test.texts['b.ts'] === 'old new two\n');
      assert.equal(await page.evaluate(() => window.test.texts['a.ts']), 'old new one\nold new tail\n');
    });

    await check('切换审阅文件和查询后，晚到的差异不覆盖当前内容', async () => {
      await scan(); await page.evaluate(() => window.test.holdRead('a.ts')); await inspect(page, 'a.ts');
      await inspect(page, 'b.ts'); await panel(page).getByRole('textbox', { name: '修改后 b.ts', exact: true }).waitFor();
      await page.evaluate(() => window.test.releaseReads());
      assert.equal(await panel(page).getByRole('textbox', { name: '修改后 a.ts', exact: true }).count(), 0);
      await panel(page).getByRole('textbox', { name: '替换为', exact: true }).fill('different');
      assert.equal(await page.locator('.sc-wb-replace-row').count(), 0); assert.equal(await apply(page, 0).isDisabled(), true);
    });

    await check('独立窗口共享勾选和审阅目标，只替换选中的文件', async () => {
      await scan(); await choose(page, 'b.ts').uncheck(); await inspect(page, 'a.ts');
      const opened = page.waitForEvent('popup'); await page.locator('.sc-wb-dialog-heading').getByRole('button', { name: '独立窗口', exact: true }).click(); const popup = await opened;
      popup.on('pageerror', error => errors.push(error.message));
      try {
        await panel(popup).getByRole('textbox', { name: '修改后 a.ts', exact: true }).waitFor();
        assert.equal(await choose(popup, 'b.ts').isChecked(), false);
        await choose(popup, 'a.ts').uncheck(); assert.equal(await apply(popup, 0).isDisabled(), true);
        await choose(popup, 'b.ts').check(); await inspect(popup, 'b.ts');
        await panel(popup).getByRole('textbox', { name: '修改后 b.ts', exact: true }).waitFor();
        await apply(popup, 1).click(); await page.waitForFunction(() => window.test.texts['b.ts'] === 'new two\n');
        assert.equal(await page.evaluate(() => window.test.texts['a.ts']), 'old one\nold tail\n');
        await popup.getByRole('button', { name: '返回 DSH', exact: true }).click(); await page.waitForFunction(() => !window.test.controller.snapshot().window);
        assert.equal(await choose(page, 'a.ts').isChecked(), false);
      } finally { if (!popup.isClosed()) await popup.close(); }
    });

    await check('独立窗口停止时等待当前写入完成，成功文件不再进入重试范围', async () => {
      await scan('old new');
      const opened = page.waitForEvent('popup'); await page.locator('.sc-wb-dialog-heading').getByRole('button', { name: '独立窗口', exact: true }).click(); const popup = await opened;
      popup.setDefaultTimeout(5000);
      popup.on('pageerror', error => errors.push(error.message));
      try {
        await choose(popup, 'b.ts').waitFor(); await page.evaluate(() => window.test.holdSave());
        await apply(popup, 2).click(); await page.waitForFunction(() => window.test.saveStarted());
        await panel(popup).getByRole('button', { name: '停止', exact: true }).click();
        await page.waitForFunction(() => window.test.readAborted('a.ts'));
        await page.evaluate(() => window.test.releaseSave()); await page.waitForFunction(() => window.test.texts['a.ts'].startsWith('old new'));
        await popup.waitForFunction(() => !document.querySelector('.sc-wb-replace button[type=submit]').disabled);
        assert.equal(await choose(popup, 'a.ts').count(), 0); assert.equal(await choose(popup, 'b.ts').isChecked(), true);
        await apply(popup, 1).click(); await page.waitForFunction(() => window.test.texts['b.ts'] === 'old new two\n');
        assert.equal(await page.evaluate(() => window.test.texts['a.ts']), 'old new one\nold new tail\n');
      } finally { await page.evaluate(() => window.test.releaseSave()); if (!popup.isClosed()) await popup.close(); }
    });

    await check('独立窗口写入中关闭后，主页面仍能继续剩余文件', async () => {
      await scan('old new');
      const opened = page.waitForEvent('popup'); await page.locator('.sc-wb-dialog-heading').getByRole('button', { name: '独立窗口', exact: true }).click(); const popup = await opened;
      popup.setDefaultTimeout(5000); popup.on('pageerror', error => errors.push(error.message));
      try {
        await choose(popup, 'b.ts').waitFor(); await page.evaluate(() => window.test.holdSave());
        await apply(popup, 2).click(); await page.waitForFunction(() => window.test.saveStarted());
        await popup.close(); await page.waitForFunction(() => window.test.readAborted('a.ts'));
        await page.evaluate(() => window.test.releaseSave()); await page.waitForFunction(() => window.test.texts['a.ts'].startsWith('old new'));
        await page.waitForFunction(() => !window.test.controller.snapshot().window);
        assert.equal(await choose(page, 'a.ts').count(), 0); assert.equal(await choose(page, 'b.ts').isChecked(), true);
        await apply(page, 1).click(); await page.waitForFunction(() => window.test.texts['b.ts'] === 'old new two\n');
        assert.equal(await page.evaluate(() => window.test.texts['a.ts']), 'old new one\nold new tail\n');
      } finally { await page.evaluate(() => window.test.releaseSave()); if (!popup.isClosed()) await popup.close(); }
    });

    await check('窄窗和两倍缩放下仍可勾选文件、查看差异和应用', async () => {
      await scan(); await inspect(page, 'b.ts'); await panel(page).getByRole('textbox', { name: '修改后 b.ts', exact: true }).waitFor();
      await page.setViewportSize({ width: 760, height: 740 }); await page.evaluate(() => { document.body.style.zoom = '2'; });
      await choose(page, 'a.ts').uncheck();
      await panel(page).getByRole('textbox', { name: '修改后 b.ts', exact: true }).scrollIntoViewIfNeeded();
      await capture(page, 'replace-review-zoom');
      await apply(page, 1).click(); await page.waitForFunction(() => window.test.texts['b.ts'] === 'new two\n');
      assert.equal(await page.evaluate(() => window.test.texts['a.ts']), 'old one\nold tail\n');
    });

    await check('全选和单文件勾选可用键盘操作，未勾选时无法应用', async () => {
      await scan();
      const all = panel(page).getByRole('checkbox', { name: '选择全部文件', exact: true });
      await all.focus(); await all.press('Space'); assert.equal(await apply(page, 0).isDisabled(), true);
      await choose(page, 'b.ts').focus(); await choose(page, 'b.ts').press('Space');
      assert.equal(await all.evaluate(node => node.indeterminate), true);
      const review = panel(page).getByRole('button', { name: '查看 b.ts 的替换预览', exact: true });
      await review.focus(); await review.press('Enter'); await panel(page).getByRole('textbox', { name: '修改后 b.ts', exact: true }).waitFor();
      await apply(page, 1).focus(); await apply(page, 1).press('Enter');
      await page.waitForFunction(() => window.test.texts['b.ts'] === 'new two\n');
      assert.equal(await page.evaluate(() => window.test.texts['a.ts']), 'old one\nold tail\n');
    });
  });
} finally { await browser.close(); windows.dispose(); await new Promise(resolve => server.close(resolve)); }
