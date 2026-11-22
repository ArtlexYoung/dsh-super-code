import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';
import{Replace}from'./builtin/workbench/components/Replace.jsx';
let state={panel:{id:'shared',kind:'projectReplace'}},waiting=[],held=true,holdApply=false,applying=[],stream='normal';const listeners=new Set(),applied=[],scanned=[];
const workbench={snapshot:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},panel(panel){state={...state,panel};for(const listener of listeners)listener()},
async *searchProject(query,signal){const version='v'+scanned.push(query);if(held)await new Promise((resolve,reject)=>waiting.push({resolve,reject}));signal.throwIfAborted();yield{kind:'file',path:query.search+'.ts',count:1,version,sample:query.search+' '+version};if(stream==='no-done')return;yield{kind:'done',scanned:1,skipped:0};if(stream==='after-done')throw new Error('stream failed')},
async replaceProject(rows,query,progress){applied.push({rows,query});if(holdApply)await new Promise((resolve,reject)=>applying.push({resolve,reject}));const result={changed:rows.map(row=>row.path),failed:[]};progress(result);return result}};
function Button({children,...props}){return <button {...props}>{children}</button>}
const roots=['a','b'].map(id=>{const root=createRoot(document.getElementById(id));root.render(<Replace workbench={workbench} Button={Button} t={key=>key}/>);return root});
window.test={waiting:()=>waiting.length,release(){for(const item of waiting.splice(0))item.resolve()},fail(){for(const item of waiting.splice(0))item.reject(new Error('scan failed'))},fast(){held=false},stream(value){stream=value},holdApply(){holdApply=true},applying:()=>applying.length,releaseApply(){for(const item of applying.splice(0))item.resolve()},failApply(){for(const item of applying.splice(0))item.reject(new Error('apply failed'))},clone(){state=structuredClone(state);for(const listener of listeners)listener()},state:()=>state,applied,scanned,dispose(){for(const item of applying.splice(0))item.resolve();roots.forEach(root=>root.unmount())}};`;
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser' });
const server = createServer((req, res) => { res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? app.outputFiles[0].contents : '<!doctype html><div id="a"></div><div id="b"></div><script type="module" src="/app.js"></script>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('共享替换窗口的预览必须对应当前查询', { timeout: 30000 }, async t => {
    let page, errors;
    t.beforeEach(async () => { page = await browser.newPage(); page.setDefaultTimeout(2500); errors = []; page.on('pageerror', error => errors.push(error.message)); await page.goto('http://127.0.0.1:' + server.address().port); await page.locator('#a input[aria-label=replaceSearch]').waitFor(); });
    t.afterEach(async () => { await page.evaluate(() => { window.test.release(); window.test.dispose(); }); await page.close(); assert.deepEqual(errors, []); });
    const field = side => page.locator('#' + side).getByRole('textbox', { name: 'replaceSearch' });
    const preview = side => page.locator('#' + side).getByRole('button', { name: 'replacePreview', exact: true });
    await t.test('另一个视图改查询后，晚到的旧预览不可应用', async () => {
      await field('a').fill('old'); await preview('a').click(); await page.waitForFunction(() => window.test.waiting() === 1);
      await field('b').fill('new'); await page.evaluate(() => window.test.release()); await preview('a').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.querySelector('#a button[type=submit]').disabled);
      assert.equal(await page.locator('.sc-wb-replace-row').count(), 0);
      assert.equal(await page.locator('#b').getByRole('button', { name: 'replaceApply', exact: true }).isDisabled(), true);
      assert.equal(await page.evaluate(() => window.test.applied.length), 0);
    });
    await t.test('新预览已完成时，晚到旧预览不能替换新结果', async () => {
      await field('a').fill('old'); await preview('a').click(); await page.waitForFunction(() => window.test.waiting() === 1);
      await field('b').fill('new'); await page.evaluate(() => window.test.fast()); await preview('b').click();
      await page.locator('#b .sc-wb-replace-row').getByText('new.ts', { exact: false }).waitFor();
      await page.evaluate(() => window.test.release()); await page.waitForFunction(() => !document.querySelector('#a button[type=submit]').disabled);
      assert.match(await page.locator('#b .sc-wb-replace-row').textContent(), /new\.ts/);
    });
    for (const changed of ['replacement', 'case']) await t.test(`另一个视图修改${changed === 'replacement' ? '替换内容' : '大小写条件'}后，旧预览不能复活`, async () => {
      await field('a').fill('same'); await preview('a').click(); await page.waitForFunction(() => window.test.waiting() === 1);
      if (changed === 'replacement') await page.locator('#b textarea').fill('different');
      else await page.locator('#b input[type=checkbox]').uncheck();
      await page.evaluate(() => window.test.release()); await page.waitForFunction(() => !document.querySelector('#a button[type=submit]').disabled);
      assert.equal(await page.locator('.sc-wb-replace-row').count(), 0);
      assert.equal(await page.locator('#b').getByRole('button', { name: 'replaceApply', exact: true }).isDisabled(), true);
    });
    await t.test('停止扫描后，晚到的结果不会重新出现', async () => {
      await field('a').fill('stopped'); await preview('a').click(); await page.waitForFunction(() => window.test.waiting() === 1);
      await page.locator('#a').getByRole('button', { name: 'stop', exact: true }).click(); await page.evaluate(() => window.test.release());
      await page.waitForFunction(() => !document.querySelector('#a button[type=submit]').disabled);
      assert.equal(await page.locator('.sc-wb-replace-row').count(), 0);
      assert.equal(await page.locator('[role=alert]').count(), 0);
      assert.equal(await page.evaluate(() => window.test.scanned.length), 1);
    });
    for (const applying of [false, true]) await t.test(`停止旧${applying ? '替换' : '扫描'}不能清空另一视图的新预览`, async () => {
      if (applying) await page.evaluate(() => { window.test.fast(); window.test.holdApply(); });
      await field('a').fill('same'); await preview('a').click();
      if (applying) {
        await page.locator('#a .sc-wb-replace-row').waitFor();
        await page.locator('#a').getByRole('button', { name: 'replaceApply', exact: true }).click();
        await page.waitForFunction(() => window.test.applying() === 1);
      } else await page.waitForFunction(() => window.test.waiting() === 1);
      await page.evaluate(() => window.test.fast()); await preview('b').click();
      await page.waitForFunction(() => document.querySelector('#b .sc-wb-replace-row code')?.textContent.endsWith('v2'));
      await page.locator('#a').getByRole('button', { name: 'stop', exact: true }).click();
      await page.evaluate(applying => applying ? window.test.releaseApply() : window.test.release(), applying);
      await page.waitForFunction(() => !document.querySelector('#a button[type=submit]').disabled);
      assert.equal(await page.locator('.sc-wb-replace-row').count(), 2);
      assert.match(await page.locator('#b .sc-wb-replace-row').textContent(), /v2$/);
      assert.equal(await page.locator('#b').getByRole('button', { name: 'replaceApply', exact: true }).isDisabled(), false);
    });
    await t.test('停止本次替换仍清理本次预览，不显示取消错误', async () => {
      await page.evaluate(() => { window.test.fast(); window.test.holdApply(); });
      await field('a').fill('current'); await preview('a').click(); await page.locator('#a .sc-wb-replace-row').waitFor();
      await page.locator('#a').getByRole('button', { name: 'replaceApply', exact: true }).click(); await page.waitForFunction(() => window.test.applying() === 1);
      await page.locator('#a').getByRole('button', { name: 'stop', exact: true }).click(); await page.evaluate(() => window.test.releaseApply());
      await page.waitForFunction(() => !document.querySelector('#a button[type=submit]').disabled);
      assert.equal(await page.locator('.sc-wb-replace-row').count(), 0);
      assert.equal(await page.locator('[role=alert]').count(), 0);
    });
    await t.test('当前有效预览仍可应用且使用对应查询和文件', async () => {
      await page.evaluate(() => window.test.fast()); await field('a').fill('current'); await preview('a').click();
      const apply = page.locator('#b').getByRole('button', { name: 'replaceApply', exact: true }); await apply.waitFor(); await page.locator('#b .sc-wb-replace-row').waitFor();
      await apply.click();
      assert.deepEqual(await page.evaluate(() => window.test.applied.map(item => ({ search: item.query.search, paths: item.rows.map(row => row.path) }))), [{ search: 'current', paths: ['current.ts'] }]);
      assert.equal(await page.evaluate(() => window.test.scanned.length), 1);
    });
    await t.test('两个视图扫描同一查询时，晚到的旧版本不能覆盖较新预览', async () => {
      await field('a').fill('same'); await preview('a').click(); await page.waitForFunction(() => window.test.waiting() === 1);
      await page.evaluate(() => window.test.fast()); await preview('b').click(); await page.locator('#b .sc-wb-replace-row').waitFor();
      assert.match(await page.locator('#b .sc-wb-replace-row').textContent(), /v2$/);
      await page.evaluate(() => window.test.release()); await page.waitForFunction(() => !document.querySelector('#a button[type=submit]').disabled);
      assert.match(await page.locator('#b .sc-wb-replace-row').textContent(), /v2$/);
    });
    await t.test('旧扫描失败不在另一个视图的新查询下显示过期错误', async () => {
      await field('a').fill('old'); await preview('a').click(); await page.waitForFunction(() => window.test.waiting() === 1);
      await field('b').fill('new'); await page.evaluate(() => window.test.fast()); await preview('b').click(); await page.locator('#b .sc-wb-replace-row').waitFor();
      await page.evaluate(() => window.test.fail()); await page.waitForFunction(() => !document.querySelector('#a button[type=submit]').disabled);
      assert.equal(await page.locator('[role=alert]').count(), 0);
      assert.match(await page.locator('#a .sc-wb-replace-row').textContent(), /new\.ts/);
    });
    await t.test('另一视图完成新扫描后，旧查询已经显示的错误也应消失', async () => {
      await field('a').fill('old'); await preview('a').click(); await page.waitForFunction(() => window.test.waiting() === 1);
      await page.evaluate(() => window.test.fail()); await page.locator('#a [role=alert]').waitFor();
      await field('b').fill('new'); await page.evaluate(() => window.test.fast()); await preview('b').click(); await page.locator('#b .sc-wb-replace-row').waitFor();
      assert.equal(await page.locator('[role=alert]').count(), 0);
    });
    for (const changeQuery of [false, true]) await t.test(`旧替换完成保留另一视图${changeQuery ? '新查询' : '同查询新扫描'}的预览`, async () => {
      await page.evaluate(() => { window.test.fast(); window.test.holdApply(); });
      await field('a').fill('first'); await preview('a').click(); await page.locator('#a .sc-wb-replace-row').waitFor();
      await page.locator('#a').getByRole('button', { name: 'replaceApply', exact: true }).click(); await page.waitForFunction(() => window.test.applying() === 1);
      if (changeQuery) await field('b').fill('next');
      await preview('b').click(); await page.waitForFunction(() => document.querySelector('#b .sc-wb-replace-row code')?.textContent.endsWith('v2'));
      await page.evaluate(() => { window.test.clone(); window.test.releaseApply(); }); await page.waitForFunction(() => !document.querySelector('#a button[type=submit]').disabled);
      assert.match(await page.locator('#b .sc-wb-replace-row').textContent(), /v2$/);
      assert.equal(await page.locator('.sc-wb-replace-row').count(), 2);
    });
    for (const failure of [false, true]) await t.test(failure ? '替换失败保留当前预览以便重试' : '外窗状态复制后，成功替换仍清理原预览', async () => {
      await page.evaluate(() => { window.test.fast(); window.test.holdApply(); });
      await field('a').fill('current'); await preview('a').click(); await page.locator('#a .sc-wb-replace-row').waitFor();
      await page.locator('#a').getByRole('button', { name: 'replaceApply', exact: true }).click(); await page.waitForFunction(() => window.test.applying() === 1);
      await page.evaluate(() => window.test.clone());
      await page.evaluate(failure => failure ? window.test.failApply() : window.test.releaseApply(), failure);
      await page.waitForFunction(() => !document.querySelector('#a button[type=submit]').disabled);
      assert.equal(await page.locator('.sc-wb-replace-row').count(), failure ? 2 : 0);
      assert.equal(await page.locator('#a [role=alert]').count(), failure ? 1 : 0);
    });
    for (const stream of ['no-done', 'after-done']) await t.test(`替换扫描${stream === 'no-done' ? '缺少完成事件' : '流结束失败'}不能应用部分结果，并可重试`, async () => {
      await page.evaluate(stream => { window.test.fast(); window.test.stream(stream); }, stream);
      await field('a').fill('current'); await preview('a').click(); await page.locator('#a [role=alert]').waitFor();
      assert.equal(await page.locator('.sc-wb-replace-row').count(), 0);
      assert.equal(await page.locator('#b').getByRole('button', { name: 'replaceApply', exact: true }).isDisabled(), true);
      await page.evaluate(() => window.test.stream('normal')); await preview('a').click(); await page.locator('#a .sc-wb-replace-row').waitFor();
      assert.equal(await page.locator('[role=alert]').count(), 0);
    });
  });
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
