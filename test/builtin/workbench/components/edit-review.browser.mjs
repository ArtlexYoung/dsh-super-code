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
  await test('选区修改审阅流程（可控模型结果，真实编辑器与窗口传输）', { timeout: 60000 }, async t => {
    let page, errors;
    const review = target => target.locator('.sc-wb-edit-review');
    const text = () => page.evaluate(() => window.test.controller.view().state.doc.toString());
    const propose = async (replacement = 'count') => {
      await page.locator('.selection-actions').getByRole('button', { name: '提问 / 修改', exact: true }).click();
      const dialog = page.locator('.sc-wb-assistant');
      await dialog.getByRole('button', { name: '修改', exact: true }).click();
      await dialog.getByRole('textbox', { name: '输入问题或修改要求…', exact: true }).fill('将 value 改为 count');
      await dialog.getByRole('button', { name: '发送', exact: true }).click();
      await page.evaluate(replacement => window.test.answer({ kind: 'edit', replacement }), replacement);
      await review(page).getByRole('button', { name: '应用修改', exact: true }).waitFor();
    };
    t.beforeEach(async () => {
      page = await browser.newPage({ viewport: { width: 1280, height: 920 } }); errors = [];
      page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
      await page.evaluate(async () => { const c = window.test.controller; window.test.external('review.ts', 'const value = 1;'); await c.visit({ file: 'review.ts' }); c.view().dispatch({ selection: { anchor: 6, head: 11 } }); });
    });
    t.afterEach(async () => { await page.evaluate(() => window.test.dispose()); await page.close(); assert.deepEqual(errors, []); });
    await t.test('收到提案不改正文也不自动保存，应用与撤回沿用已有自动保存策略', async () => {
      await page.evaluate(() => { const c = window.test.controller; return c.settings({ ...c.snapshot().preferences, autoSave: 'immediate' }); });
      await propose();
      assert.equal(await text(), 'const value = 1;');
      assert.equal(await page.evaluate(() => window.test.controller.documents.get('review.ts').dirty), false);
      assert.equal(await page.evaluate(() => window.test.texts['review.ts']), 'const value = 1;');
      assert.equal(await review(page).getByRole('textbox', { name: '修改前 review.ts', exact: true }).innerText(), 'value');
      assert.equal(await review(page).getByRole('textbox', { name: '修改后 review.ts', exact: true }).innerText(), 'count');
      await capture(page, 'edit-review-light');
      await page.evaluate(() => window.test.theme('idea', true)); await capture(page, 'edit-review-dark');
      await review(page).getByRole('button', { name: '应用修改', exact: true }).click();
      await page.waitForFunction(() => window.test.texts['review.ts'] === 'const count = 1;');
      await review(page).getByRole('button', { name: '撤销本次修改', exact: true }).click();
      await page.waitForFunction(() => window.test.texts['review.ts'] === 'const value = 1;');
      assert.equal(await text(), 'const value = 1;');
    });
    await t.test('关闭气泡保留提案，放弃后正文与磁盘保持原值', async () => {
      await propose();
      await page.locator('.sc-wb-assistant>header').getByRole('button', { name: '关闭', exact: true }).click();
      await page.locator('.selection-mark').getByRole('button').click();
      await review(page).getByRole('button', { name: '放弃修改', exact: true }).click();
      assert.equal(await text(), 'const value = 1;');
      assert.equal(await page.evaluate(() => window.test.texts['review.ts']), 'const value = 1;');
      assert.equal(await review(page).getByText('已放弃', { exact: true }).isVisible(), true);
    });
    await t.test('外部编辑需要重新核对，选区内的新代码不能被提案覆盖', async () => {
      await propose();
      await page.evaluate(() => window.test.controller.view().dispatch({ changes: { from: 0, insert: '// newer\n' } }));
      assert.equal(await review(page).getByRole('button', { name: '应用修改', exact: true }).isDisabled(), true);
      await review(page).getByRole('button', { name: '重新核对', exact: true }).click();
      assert.equal(await review(page).getByRole('button', { name: '应用修改', exact: true }).isEnabled(), true);
      await page.evaluate(() => { const c = window.test.controller, thread = c.snapshot().assistant.thread; c.view().dispatch({ changes: { from: thread.from, to: thread.to, insert: 'newValue' } }); });
      assert.equal(await review(page).getByRole('button', { name: '应用修改', exact: true }).isDisabled(), true);
      assert.equal(await text(), '// newer\nconst newValue = 1;'); await capture(page, 'edit-review-stale');
    });
    await t.test('独立窗口应用结果同步主页面，另一窗口可撤回同一提案', async () => {
      await propose();
      const opened = page.waitForEvent('popup'); await page.locator('.sc-wb-assistant>header').getByRole('button', { name: '独立窗口', exact: true }).click(); const popup = await opened;
      popup.setDefaultTimeout(5000); popup.on('pageerror', error => errors.push(error.message));
      try {
        await review(popup).getByRole('button', { name: '应用修改', exact: true }).click();
        await page.waitForFunction(() => window.test.controller.view().state.doc.toString() === 'const count = 1;');
        await review(page).getByRole('button', { name: '撤销本次修改', exact: true }).click();
        await review(popup).getByText('已撤回', { exact: true }).waitFor();
        assert.equal(await text(), 'const value = 1;'); await capture(popup, 'edit-review-window');
      } finally { if (!popup.isClosed()) await popup.close(); }
    });
    await t.test('切换文件后的应用失败在审阅区说明原因并保留提案', async () => {
      await propose();
      await page.evaluate(async () => {
        const c = window.test.controller, id = c.snapshot().assistant.thread.id;
        await c.visit({ file: 'b.ts' }); c.assistant.open(id);
      });
      await review(page).getByRole('button', { name: '应用修改', exact: true }).click();
      await review(page).getByText('请先打开这段代码所在的文件', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().assistant.thread.proposal.state), 'pending');
      assert.equal(await page.evaluate(() => window.test.texts['review.ts']), 'const value = 1;');
    });
    await t.test('英文两倍显示仍能阅读差异并放弃', async () => {
      await propose(); await page.evaluate(() => { window.test.locale(); document.body.style.zoom = '2'; });
      const rect = await page.locator('.sc-wb-assistant').boundingBox();
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1280 && rect.y + rect.height <= 920, JSON.stringify(rect));
      await review(page).getByRole('textbox', { name: 'After review.ts', exact: true }).waitFor();
      await capture(page, 'edit-review-english-zoom');
      assert.equal(await review(page).evaluate(node => {
        const visible = node.closest('.sc-wb-messages').getBoundingClientRect();
        // cm-content 包含编辑器的空白高度；检查实际代码行和应用、放弃按钮。
        return [...node.querySelectorAll('.cm-line,.sc-wb-edit-actions button')].every(item => {
          const box = item.getBoundingClientRect();
          return box.top >= visible.top && box.bottom <= visible.bottom && box.left >= visible.left && box.right <= visible.right;
        });
      }), true, '待审阅代码与操作按钮应出现在可见区域，不能被下一轮输入框挤出视口');
      await review(page).getByRole('button', { name: 'Discard edit', exact: true }).click(); assert.equal(await text(), 'const value = 1;');
    });
  });
} finally { await browser.close(); await windows.dispose(); await new Promise(resolve => server.close(resolve)); }
