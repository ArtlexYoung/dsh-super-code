import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fixture } from './fixture.mjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text', '.woff2': 'dataurl' } });
const server = createServer((request, response) => {
  if (request.url === '/app.js') {
    response.setHeader('content-type', 'text/javascript');
    response.end(app.outputFiles[0].contents);
    return;
  }
  response.setHeader('content-type', 'text/html');
  response.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.SC_TEST_EXECUTABLE });

async function ready(page, url) {
  if (url) await page.goto(url);
  await page.locator('.sc-wb-status').waitFor();
  await page.evaluate(() => window.test.controller.visit({ file: 'b.ts' }));
}

async function panel(page, name) {
  const button = page.locator('.sc-wb-side-rail-right').getByRole('button', { name, exact: true });
  if (await button.getAttribute('aria-pressed') === 'false') await button.click();
}

async function ask(page, text, pinned, replacement) {
  await page.evaluate(async () => {
    const controller = window.test.controller;
    await controller.visit({ file: 'a.ts' });
    controller.view().dispatch({ selection: { anchor: 17, head: 23 } });
  });
  await page.locator('.selection-actions').getByRole('button', { name: '提问 / 修改' }).click();
  const dialog = page.locator('.sc-wb-assistant');
  if (replacement) await dialog.getByRole('button', { name: '修改', exact: true }).click();
  await dialog.getByRole('textbox', { name: '输入问题或修改要求…' }).fill(text);
  const requests = await page.evaluate(() => window.studyTest.requests);
  await dialog.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(requests => window.studyTest.requests > requests, requests);
  await page.evaluate(replacement => window.test.answer(replacement ? { kind: 'edit', replacement } : undefined), replacement);
  if (replacement) await dialog.getByRole('button', { name: '应用修改', exact: true }).waitFor();
  else await dialog.getByText('选区返回加法的结果。', { exact: true }).waitFor();
  if (pinned) await dialog.getByRole('button', { name: '固定对话', exact: true }).click();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
}

async function saved(page, kind, revision = 1) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const record = await page.evaluate(kind => window.studyTest.store('/demo', kind).read(), kind);
    if (record?.revision >= revision) return record.data;
    await delay(25);
  }
  assert.fail(`Missing study record ${kind} at revision ${revision}: ${await page.locator('.sc-wb-status').innerText()}`);
}

try {
  await test('恢复固定对话与学习进度（真实 IndexedDB）', { timeout: 60000 }, async t => {
    const context = await browser.newContext({ viewport: { width: 1380, height: 920 } });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    const url = `${origin}/?study=demo`;
    const quick = page.locator('.sc-wb-quick');
    const reading = page.locator('.sc-reading-panel');
    const dialog = page.locator('.sc-wb-assistant');
    try {
      await ready(page, url);
      await t.test('重开后恢复已固定问答和已读步骤，原地切换步骤不重新请求模型', async () => {
        await ask(page, '需要保存的问题', true);
        await page.evaluate(async () => {
          const { controller } = window.test;
          await controller.visit({ file: 'b.ts' });
          controller.view().dispatch({ selection: { anchor: 4, head: 11 } });
          await controller.assistant.select();
          controller.assistant.draft('临时问题');
        });
        await dialog.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => window.studyTest.requests === 2);
        await page.evaluate(() => window.test.answer());
        await dialog.getByText('选区返回加法的结果。', { exact: true }).waitFor();
        await dialog.getByRole('button', { name: '关闭', exact: true }).click();
        await panel(page, '学习');
        await reading.getByRole('textbox', { name: '阅读目标' }).fill('了解项目入口');
        await reading.getByRole('button', { name: '生成阅读路径', exact: true }).click();
        await saved(page, 'reading');
        await reading.getByRole('button', { name: /入口/ }).click();
        await reading.getByText('入口为 add 函数。', { exact: true }).waitFor();
        const records = await saved(page, 'pins');
        assert.equal(records.length, 1);
        assert.equal(records[0].messages[0].text, '需要保存的问题');
        assert.deepEqual((await saved(page, 'reading', 2)).completed, [0]);
        await page.reload(); await ready(page);
        await panel(page, '快速对话'); await panel(page, '学习');
        await reading.getByText('入口为 add 函数。', { exact: true }).waitFor();
        assert.equal(await reading.getByRole('textbox', { name: '阅读目标' }).inputValue(), '了解项目入口');
        assert.equal(await reading.getByText('已读', { exact: true }).count(), 1);
        assert.equal(await quick.getByText('临时问题', { exact: true }).count(), 0);
        assert.equal(await quick.getByLabel('已固定').count(), 1);
        await quick.getByText('需要保存的问题', { exact: true }).click();
        await dialog.getByText('选区返回加法的结果。', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.test.controller.view().state.selection.main.to - window.test.controller.view().state.selection.main.from), 6);
        await dialog.getByRole('button', { name: '关闭', exact: true }).click();
        await reading.getByRole('button', { name: /入口 已读/ }).click();
        await reading.getByText('入口为 add 函数。', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.studyTest.requests), 0);
        if (process.env.SC_TEST_ARTIFACTS) {
          await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true });
          await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, 'restored-conversation-and-reading.png') });
        }
      });
      await t.test('同客户端的其他会话与项目没有原记录', async () => {
        for (const location of ['?study=other', '?study=demo&root=/other']) {
          await ready(page, origin + '/' + location);
          await panel(page, '快速对话'); await panel(page, '学习');
          await quick.getByText('暂无快速对话', { exact: true }).waitFor();
          assert.equal(await reading.getByRole('textbox', { name: '阅读目标' }).inputValue(), '');
          assert.equal(await page.evaluate(() => window.studyTest.requests), 0);
        }
      });
      await t.test('源码缩短或删除后仍可打开历史，旧引用显示过期', async () => {
        await ready(page, url);
        for (const text of ['// new', null]) {
          await page.evaluate(text => sessionStorage.setItem('study-test-disk', JSON.stringify({ 'a.ts': text })), text);
          await page.reload(); await ready(page);
          await panel(page, '快速对话'); await panel(page, '学习');
          await reading.getByText(/引用的代码已变化/).waitFor();
          await reading.getByText('入口为 add 函数。', { exact: true }).waitFor();
          await quick.getByText('需要保存的问题', { exact: true }).click();
          await dialog.getByText('原选区已变化，请重新选择代码', { exact: true }).waitFor();
          await dialog.getByText('选区返回加法的结果。', { exact: true }).waitFor();
          await dialog.getByRole('button', { name: '关闭', exact: true }).click();
          if (text) await page.evaluate(() => window.test.controller.view().dispatch({ changes: { from: 0, insert: ' ' } }));
          assert.equal(await page.evaluate(() => window.studyTest.requests), 0);
        }
        await page.evaluate(() => sessionStorage.removeItem('study-test-disk'));
      });
      await t.test('取消固定不会复活；保存的历史不包含待应用提案', async () => {
        await page.reload(); await ready(page);
        await panel(page, '快速对话');
        await quick.getByText('需要保存的问题', { exact: true }).click();
        const revision = await page.evaluate(async () => (await window.studyTest.store('/demo', 'pins').read()).revision);
        await dialog.getByRole('button', { name: '取消固定对话', exact: true }).click();
        assert.deepEqual(await saved(page, 'pins', revision + 1), []);
        await page.reload(); await ready(page);
        await panel(page, '快速对话');
        await quick.getByText('暂无快速对话', { exact: true }).waitFor();
        await ask(page, '请修改固定选区', true, 'privateReplacement');
        const [record] = await saved(page, 'pins', revision + 2);
        assert.deepEqual(record.messages.map(item => item.role), ['user']);
        assert.equal(JSON.stringify(record).includes('privateReplacement'), false);
      });
      await t.test('同一记录的旧窗口无法覆盖新版本，底栏保留冲突提示', async () => {
        const other = await context.newPage();
        other.setDefaultTimeout(5000);
        await ready(other, url);
        const before = await page.evaluate(async () => (await window.studyTest.store('/demo', 'pins').read()).revision);
        await panel(other, '快速对话');
        await other.locator('.sc-wb-quick').getByText('请修改固定选区', { exact: true }).click();
        await other.locator('.sc-wb-assistant').getByRole('button', { name: '取消固定对话', exact: true }).click();
        assert.deepEqual(await saved(other, 'pins', before + 1), []);
        await quick.getByText('请修改固定选区', { exact: true }).click();
        await dialog.getByRole('button', { name: '取消固定对话', exact: true }).click();
        await page.locator('.sc-wb-status').getByText(/另一窗口已更新本地记录/).waitFor();
        assert.deepEqual(await saved(page, 'pins', before + 1), []);
        await page.evaluate(() => {
          const { groups } = window.test.controller;
          groups.activate(groups.split(groups.snapshot().active, 'right'));
        });
        await page.locator('.sc-wb-status').getByText(/另一窗口已更新本地记录/).waitFor();
        await other.close();
      });
    } finally { await context.close(); assert.deepEqual(errors, []); }
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
