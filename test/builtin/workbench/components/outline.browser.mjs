import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';
import{Workbench}from'./builtin/workbench/components/Workbench.jsx';import{createWorkbench}from'./builtin/workbench/controller.js';
import{zh,en}from'./builtin/workbench/locales.js';import css from'./builtin/workbench/style.css';import fonts from'./builtin/workbench/fonts/style.js';
const style=document.createElement('style');style.textContent=fonts+css;document.head.append(style);
const texts={'source.ts':[
'export function Load(value: number) {','  const local = value;','  return local;','}',
'class Store {','  load() { return 1; }','}','class Cache {','  load() { return 2; }','}',
'const limit = 3;','const loadLater = () => limit;','function 加载() { return limit; }'].join('\\n'),
'other.ts':'export const different = 1;','empty.txt':'','zero.py':'origin = 1\\nnext_value = 2',
'large.ts':Array.from({length:4096},(_,i)=>'function task'+String(i).padStart(4,'0')+'() { return '+i+'; }').join('\\n')};
const calls={read:0,project:0};const api={fileOperation:async()=>({path:'/sample-project'}),list:async()=>({entries:Object.keys(texts).map(path=>({name:path,path,type:'file'})),truncated:false}),
read:async path=>{calls.read++;return{path,text:texts[path],version:'v1'}},project:async()=>{calls.project++;return{files:Object.keys(texts),truncated:false}},models:async()=>[]};
let language='zh';const t=k=>(language==='zh'?zh:en)[k]||k,c=createWorkbench(api,t),root=createRoot(document.getElementById('root'));
function Button({children,...p}){return <button type='button' {...p}>{children}</button>}
function Select(){return null}function Conversation(){return null}
function render(){root.render(<Workbench workbench={c} Button={Button} Select={Select} Conversation={Conversation} sessionId='outline' t={t}/>)}render();
window.test={c,texts,calls,language:value=>{language=value;render()},theme:async(palette,dark)=>{document.body.toggleAttribute('data-ds-dark-theme',dark);await c.settings({...c.snapshot().preferences,palette})}};`;
const bundle = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, platform: 'browser', format: 'esm', loader: { '.css': 'text', '.woff2': 'dataurl' } });
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); }
  else { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
const evidence = process.env.SC_TEST_ARTIFACTS;
try {
  await test('文件结构查找与定位', { timeout: 90000 }, async t => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }), errors = [];
    page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
    const capture = async name => { if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, name + '.png'), animations: 'disabled' }); } };
    const visit = async file => { await page.evaluate(file => window.test.c.visit({ file }), file); await page.waitForFunction(file => window.test.c.snapshot().file === file && (file === 'empty.txt' || window.test.c.snapshot().symbols.some(item => item.file === file)), file); };
    const source = page.locator('#sc-wb-outline'), search = source.getByRole('combobox');
    const options = source.getByRole('option'), selected = source.locator('[aria-selected=true]');
    const names = () => options.locator('span').allTextContents();
    const query = async text => { await search.fill(text); await page.waitForFunction(text => document.querySelector('#sc-wb-outline input').value === text, text); };
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.test?.c.snapshot().indexed === 5 || window.test?.c.snapshot().error);
    assert.equal(await page.evaluate(() => window.test.c.snapshot().error), '');
    await page.evaluate(() => window.test.c.layout.change({ explorerOpen: true, filesOpen: false, outlineOpen: true }));
    await visit('source.ts'); await capture('symbols-start');
    assert.equal(await search.count(), 1, '文件结构应有符号搜索入口');
    await t.test('默认保留全部声明和源码顺序，定位不修改代码', async () => {
      assert.deepEqual(await names(), await page.evaluate(() => window.test.c.snapshot().symbols.map(item => item.name)));
      assert.equal(await options.count(), 9);
      assert.equal(await selected.locator('span').textContent(), 'Load');
      await options.filter({ hasText: '加载' }).click();
      await page.waitForFunction(() => window.test.c.snapshot().cursor?.line === 12);
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), await page.evaluate(() => window.test.texts['source.ts']));
    });
    await t.test('空白、大小写和中文搜索，并保留同名函数', async () => {
      await query('  LOAD  '); assert.deepEqual(await names(), ['Load', 'load', 'load', 'loadLater']);
      await query('加载'); assert.deepEqual(await names(), ['加载']);
      await query('missing'); assert.equal(await options.count(), 0); await source.getByText('没有找到结果', { exact: true }).waitFor();
      const cursor = await page.evaluate(() => window.test.c.snapshot().cursor);
      await search.press('Enter'); await search.press('ArrowDown');
      assert.deepEqual(await page.evaluate(() => window.test.c.snapshot().cursor), cursor);
      await query('   '); assert.equal(await options.count(), 9);
    });
    await t.test('函数筛选与查询组合，清空和 Esc 恢复查找及编辑焦点', async () => {
      const filter = source.getByRole('button', { name: '只看函数', exact: true });
      await filter.click(); assert.equal(await filter.getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await names(), ['Load', 'load', 'load', 'loadLater', '加载']);
      await query('limit'); assert.equal(await options.count(), 0);
      await source.getByRole('button', { name: '清空符号搜索', exact: true }).click();
      assert.equal(await search.inputValue(), ''); assert.equal(await search.evaluate(n => n === document.activeElement), true);
      await query('load'); await search.press('Escape'); assert.equal(await search.inputValue(), '');
      await search.press('Escape'); assert.equal(await page.evaluate(() => window.test.c.view().hasFocus), true);
      await filter.click();
    });
    await t.test('方向键选择和 Enter 定位保留前进后退，输入法不触发导航', async () => {
      await query('load'); await search.press('ArrowDown');
      assert.equal(await selected.locator('span').textContent(), 'load');
      assert.equal(await search.getAttribute('aria-activedescendant'), await selected.getAttribute('id'));
      await search.press('Enter'); await page.waitForFunction(() => window.test.c.snapshot().cursor?.line === 5);
      await page.evaluate(() => window.test.c.move(-1)); await page.waitForFunction(() => window.test.c.snapshot().cursor?.line === 12);
      await page.evaluate(() => window.test.c.move(1)); await page.waitForFunction(() => window.test.c.snapshot().cursor?.line === 5);
      await query('加载'); const before = await page.evaluate(() => window.test.c.snapshot().cursor);
      await search.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, isComposing: true });
      assert.deepEqual(await page.evaluate(() => window.test.c.snapshot().cursor), before);
      await query('load'); await search.press('ArrowUp'); assert.equal(await selected.locator('span').textContent(), 'Load');
      for (let i = 0; i < 6; i++) await search.press('ArrowDown');
      assert.equal(await selected.locator('span').textContent(), 'loadLater');
    });
    await t.test('编辑后使用更新的声明，切文件重置筛选，空文件不残留结果', async () => {
      const calls = await page.evaluate(() => ({ ...window.test.calls }));
      await query('added');
      await page.evaluate(() => { const v = window.test.c.view(); v.dispatch({ changes: { from: v.state.doc.length, insert: '\nfunction added() { return 4; }' } }); });
      await options.filter({ hasText: 'added' }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.test.calls), calls, '搜索和重新分析不读取文件系统');
      await page.evaluate(() => { const v = window.test.c.view(); v.dispatch({ changes: { from: v.state.doc.toString().indexOf('\nfunction added'), to: v.state.doc.length } }); });
      await source.getByText('没有找到结果', { exact: true }).waitFor();
      assert.equal(await search.getAttribute('aria-activedescendant'), null);
      await source.getByRole('button', { name: '只看函数', exact: true }).click();
      await visit('other.ts'); assert.equal(await search.inputValue(), '');
      assert.equal(await source.getByRole('button', { name: '只看函数', exact: true }).getAttribute('aria-pressed'), 'false');
      assert.deepEqual(await names(), ['different']);
      await visit('empty.txt'); assert.equal(await options.count(), 0); await source.getByText('当前文件没有可用符号', { exact: true }).waitFor();
      await visit('zero.py'); assert.match(await selected.getAttribute('id'), /-0$/);
      await query('origin'); await search.press('Enter'); await page.waitForFunction(() => window.test.c.snapshot().cursor?.character === 0);
    });
    await t.test('4096 个声明保持虚拟列表，键盘跟随及手动滚动后搜索有效', async () => {
      await visit('large.ts');
      assert.equal(await page.evaluate(() => window.test.c.snapshot().symbols.length), 4096);
      assert.ok(await options.count() < 60);
      await search.focus(); for (let i = 0; i < 45; i++) await search.press('ArrowDown');
      assert.equal(await selected.locator('span').textContent(), 'task0045');
      assert.equal(await search.getAttribute('aria-activedescendant'), await selected.getAttribute('id'));
      const list = source.locator('.sc-wb-outline');
      await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await options.filter({ hasText: 'task4095' }).waitFor();
      assert.equal(await search.getAttribute('aria-activedescendant'), null, '手动滚动后不指向已卸载的活动行');
      await query('task0000'); assert.deepEqual(await names(), ['task0000']);
      await query('task');
      await page.waitForFunction(() => document.querySelector('#sc-wb-outline [aria-selected=true]')?.textContent.includes('task0000'));
      assert.equal(await list.evaluate(node => node.scrollTop), 0);
      if (evidence) await writeFile(join(evidence, 'large.json'), JSON.stringify(await page.evaluate(() => ({ total: window.test.c.snapshot().symbols.length, rendered: document.querySelectorAll('#sc-wb-outline [role=option]').length })), null, 2));
    });
    await t.test('阅读器按类缩进成员并优先展示可导航的声明', async () => {
      await visit('source.ts');
      await page.evaluate(() => window.test.c.settings({ ...window.test.c.snapshot().preferences, readerMode: true }));
      const rows = [];
      try {
        for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
          await page.evaluate(({ palette, dark }) => window.test.theme(palette, dark), { palette, dark });
          await capture(`reader-${palette}-${dark ? 'dark' : 'light'}`);
          rows.push(await options.evaluateAll(nodes => nodes.map(row => ({
            name: row.querySelector('span').textContent, depth: Number(row.dataset.depth || 0),
            kind: row.querySelector('svg').dataset.icon,
            indent: parseFloat(getComputedStyle(row).paddingInlineStart),
          }))));
        }
        const expected = [['Load', 0, 'function'], ['Store', 0, 'type'], ['load', 1, 'method'], ['Cache', 0, 'type'], ['load', 1, 'method'], ['limit', 0, 'variable'], ['loadLater', 0, 'function'], ['加载', 0, 'function']];
        for (const group of rows) {
          assert.deepEqual(group.map(({ name, depth, kind }) => [name, depth, kind]), expected);
          assert.ok(group[2].indent > group[1].indent);
        }
      } finally {
        await page.evaluate(() => window.test.c.settings({ ...window.test.c.snapshot().preferences, readerMode: false }));
      }
      assert.equal(await options.filter({ hasText: 'local' }).count(), 1);
    });
    await t.test('按类名区分同名方法，搜索仍可跳转到普通局部变量', async () => {
      await visit('source.ts');
      await page.evaluate(() => window.test.c.settings({ ...window.test.c.snapshot().preferences, readerMode: true }));
      try {
        await query('load'); await capture('reader-search-owners');
        assert.deepEqual(await options.locator('.sc-wb-outline-context').allTextContents(), ['Store', 'Cache']);
        await query('cache.load');
        assert.deepEqual(await names(), ['load']);
        assert.equal(await options.locator('.sc-wb-outline-context').textContent(), 'Cache');
        await search.press('Enter'); await page.waitForFunction(() => window.test.c.snapshot().cursor?.line === 8);
        await query('local'); assert.deepEqual(await names(), ['local']);
        await search.press('Enter'); await page.waitForFunction(() => window.test.c.snapshot().cursor?.line === 1);
        await query(''); assert.equal(await options.filter({ hasText: 'local' }).count(), 0);
        assert.equal(await options.filter({ has: page.getByText('Load', { exact: true }) }).getAttribute('aria-current'), 'location');
      } finally {
        await query('');
        await page.evaluate(() => window.test.c.settings({ ...window.test.c.snapshot().preferences, readerMode: false }));
      }
    });
    await t.test('四主题、窄栏和两倍缩放布局不溢出，中英按钮有名称', async () => {
      await visit('source.ts'); await query('load');
      for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
        await page.evaluate(({ palette, dark }) => window.test.theme(palette, dark), { palette, dark });
        await capture(`symbols-${palette}-${dark ? 'dark' : 'light'}`);
        assert.ok(await source.evaluate(node => node.scrollWidth <= node.clientWidth));
        assert.equal(await source.getByRole('button', { name: '只看函数', exact: true }).getAttribute('title'), '只看函数');
      }
      await page.setViewportSize({ width: 650, height: 650 }); await page.evaluate(() => { window.test.c.layout.change({ explorer: 190 }); }); await capture('symbols-narrow');
      assert.ok(await source.evaluate(node => node.scrollWidth <= node.clientWidth));
      await page.evaluate(() => { window.test.c.layout.change({ explorerOpen: true, panes: { conversation: false } }); document.body.style.zoom = '2'; }); await capture('symbols-zoom');
      assert.ok(await source.evaluate(node => node.scrollWidth <= node.clientWidth));
      await page.evaluate(() => { document.body.style.zoom = ''; window.test.language('en'); });
      await source.getByRole('button', { name: 'Functions only', exact: true }).waitFor();
      await source.getByRole('combobox', { name: 'Search symbols', exact: true }).waitFor();
    });
    assert.deepEqual(errors, []); await page.close();
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
