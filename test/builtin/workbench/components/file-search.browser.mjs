import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = `import React,{useSyncExternalStore}from'react';import{createRoot}from'react-dom/client';
import{createWorkbench}from'./builtin/workbench/controller.js';import{Files}from'./builtin/workbench/components/Files.jsx';
import{zh,en}from'./builtin/workbench/locales.js';import style from'./builtin/workbench/style.css';
const sheet=document.createElement('style');sheet.textContent=style;document.head.append(sheet);
const projects=new Map(),files=['account/config.ts','src/my-account.ts','src/accounting.ts','tests/account.ts','src/account.ts','src/中文 目录/测试 File.ts','src/later/another-account.ts','docs/README.md',...Array.from({length:1500},(_,i)=>'items/item-'+String(i).padStart(4,'0')+'.txt')];
let language='zh',failing=false,delayed=false,release,reads=[],listed=[];const t=key=>(language==='zh'?zh:en)[key]||key;
const api={async list(path){listed.push(path);if(delayed&&path==='src')await new Promise(resolve=>setTimeout(resolve,140));if(delayed&&path==='src/later')await new Promise(resolve=>{release=resolve});const entries=new Map();for(const file of files){if(path&&!file.startsWith(path+'/'))continue;const rest=path?file.slice(path.length+1):file,name=rest.split('/')[0];entries.set(name,{name,path:path?path+'/'+name:name,type:rest.includes('/')?'directory':'file'})}return{entries:[...entries.values()],truncated:false}},
async read(path){reads.push(path);if(failing)throw new Error('read unavailable');return{path,text:'export const ready = true;',version:'v1'}},project:async()=>({files:[],truncated:false}),fileOperation:async()=>({path:'/demo'})};
const a=createWorkbench(api,t,{projects}),b=createWorkbench(api,t,{projects});
function Button({children,...props}){return <button type='button' {...props}>{children}</button>}
function Tree({c,id}){const snapshot=useSyncExternalStore(c.subscribe,c.snapshot);return <section className='sc-workbench' data-view={id} data-palette={snapshot.preferences.palette}><header>{id==='a'?'主窗口':'另一窗口'}</header><Files snapshot={snapshot} workbench={c} Button={Button} t={t} visible/>{snapshot.error&&<p role='alert'>{snapshot.error}</p>}</section>}
const root=createRoot(document.getElementById('root'));function render(){root.render(<><Tree c={a} id='a'/><Tree c={b} id='b'/></>)}render();
window.test={a,b,reads,listed,files,language:value=>{language=value;render()},failing:value=>{failing=value},delay(many=false){delayed=true;if(many)files.push(...Array.from({length:500},(_,i)=>'src/later/account-'+i+'.ts'));a.files.reset()},release(){delayed=false;release?.()},reset(){a.files.reset()},async ready(){await a.attach(document.getElementById('editor-a'),document.body);await b.attach(document.getElementById('editor-b'),document.body)},dispose(){release?.();root.unmount();a.dispose();b.dispose();for(const p of projects.values())p.dispose()}};`;
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text' } });
const server = createServer((req, res) => { res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? app.outputFiles[0].contents : '<!doctype html><meta charset="utf-8"><style>body{margin:0}#root{height:680px;display:flex;gap:20px;padding:20px}section[data-view]{width:320px;display:flex;flex-direction:column;background:var(--wb-surface);color:var(--wb-text);border:1px solid var(--wb-line)}section>header{padding:8px;font:12px sans-serif}.sc-wb-files{height:100%}</style><div id="root"></div><div id="editor-a" hidden></div><div id="editor-b" hidden></div><script type="module" src="/app.js"></script>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('文件搜索的匹配与键盘选择', { timeout: 30000 }, async t => {
    let page, errors;
    t.beforeEach(async () => {
      page = await browser.newPage({ viewport: { width: 900, height: 760 } }); page.setDefaultTimeout(3500); errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => !!window.test); await page.evaluate(() => window.test.ready());
    });
    t.afterEach(async () => { await page.evaluate(() => window.test.dispose()); await page.close(); assert.deepEqual(errors, []); });
    const tree = id => page.locator('[data-view="' + id + '"]');
    const input = id => tree(id).getByRole('combobox', { name: '搜索文件', exact: true });
    const list = id => tree(id).getByRole('listbox', { name: '搜索文件', exact: true });
    const chosen = id => list(id).getByRole('option', { selected: true });
    const ready = id => page.waitForFunction(id => !window.test[id].files.snapshot().searching, id);
    await t.test('方向键选择第二项并用 Enter 打开，查询框保留焦点直到定位', async () => {
      await input('a').fill('item-'); await tree('a').locator('.sc-wb-file-matches button').first().waitFor(); await ready('a');
      await input('a').press('ArrowDown');
      assert.ok(await input('a').getAttribute('aria-activedescendant'));
      assert.equal(await tree('a').getByRole('option', { selected: true }).getAttribute('title'), 'items/item-0001.txt');
      assert.equal(await input('a').evaluate(n => n === document.activeElement), true);
      await input('a').press('Enter'); await page.waitForFunction(() => window.test.a.snapshot().file === 'items/item-0001.txt');
      assert.deepEqual(await page.evaluate(() => window.test.reads), ['items/item-0001.txt']);
    });
    await t.test('文件名优先并支持分散路径词、中文、空格及 Windows 分隔符', async () => {
      await input('a').fill('account.ts'); await chosen('a').waitFor(); await ready('a');
      assert.equal(await chosen('a').getAttribute('title'), 'src/account.ts');
      await input('a').fill('account src'); await ready('a');
      await page.waitForFunction(() => document.querySelector('[data-view=a] [role=option]')?.getAttribute('aria-setsize') === '4');
      const paths = await list('a').getByRole('option').evaluateAll(nodes => nodes.map(n => n.title));
      assert.equal(paths.length, 4); assert.ok(paths.every(path => path.startsWith('src/')));
      await input('a').fill('FILE 中文 测试'); await chosen('a').waitFor();
      assert.equal(await chosen('a').getAttribute('title'), 'src/中文 目录/测试 File.ts');
      await input('a').fill('SRC\\中文 目录\\测试'); await chosen('a').waitFor();
      assert.equal(await chosen('a').getAttribute('title'), 'src/中文 目录/测试 File.ts');
      assert.deepEqual(await page.evaluate(() => window.test.reads), []);
    });
    await t.test('1,500 项结果只渲染可见行，列表 Home、End 和边界方向键定位正确', async () => {
      await input('a').fill('item-'); await chosen('a').waitFor(); await ready('a');
      assert.equal(await chosen('a').getAttribute('aria-setsize'), '1500');
      assert.ok(await list('a').getByRole('option').count() < 30);
      await list('a').focus(); await list('a').press('End');
      await chosen('a').filter({ hasText: 'item-1499.txt' }).waitFor();
      assert.equal(await chosen('a').getAttribute('aria-posinset'), '1500');
      assert.ok(await tree('a').locator('.sc-wb-file-matches').evaluate(n => n.scrollTop) > 0);
      assert.equal(await list('a').evaluate(n => !!document.getElementById(n.getAttribute('aria-activedescendant'))), true);
      await list('a').press('ArrowDown'); assert.equal(await chosen('a').getAttribute('title'), 'items/item-1499.txt');
      await list('a').press('Home'); await chosen('a').filter({ hasText: 'item-0000.txt' }).waitFor();
      await list('a').press('ArrowUp'); assert.equal(await chosen('a').getAttribute('title'), 'items/item-0000.txt');
    });
    await t.test('输入法、修饰键和输入框 Home、End 不触发文件定位', async () => {
      await input('a').fill('item-'); await chosen('a').waitFor(); await ready('a');
      await input('a').press('ArrowDown');
      const path = await chosen('a').getAttribute('title');
      for (const key of ['Shift+ArrowDown', 'Control+ArrowDown', 'Alt+ArrowDown', 'Meta+ArrowDown']) await input('a').press(key);
      assert.equal(await chosen('a').getAttribute('title'), path);
      assert.equal(await input('a').evaluate(n => n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }))), true);
      await page.evaluate(() => { const n = document.createElement('input'); n.id = 'native-input-reference'; n.value = 'item-'; document.body.append(n); });
      const reference = page.locator('#native-input-reference');
      try {
        for (const key of ['Home', 'End']) {
          await reference.press(key); const expected = await reference.evaluate(n => n.selectionStart);
          await input('a').press(key); assert.equal(await input('a').evaluate(n => n.selectionStart), expected);
        }
      } finally { await reference.evaluate(n => n.remove()); }
      assert.deepEqual(await page.evaluate(() => window.test.reads), []);
    });
    await t.test('查询变化不打开旧候选，空结果及清空后无悬空的候选 id', async () => {
      await input('a').fill('item-'); await chosen('a').waitFor(); await ready('a'); await input('a').press('ArrowDown');
      await input('a').fill('not-a-real-file'); await input('a').press('Enter');
      await page.waitForFunction(() => !document.querySelector('[data-view=a] [role=option]'));
      assert.equal(await input('a').getAttribute('aria-activedescendant'), null);
      await input('a').press('ArrowDown'); await input('a').press('Enter');
      assert.deepEqual(await page.evaluate(() => window.test.reads), []);
      await input('a').press('Escape');
      assert.equal(await input('a').inputValue(), '');
      assert.equal(await input('a').getAttribute('aria-expanded'), 'false');
      assert.equal(await input('a').evaluate(n => n === document.activeElement), true);
      assert.equal(await tree('a').locator('.sc-wb-file-list').isVisible(), true);
      await input('a').fill('item-'); await chosen('a').waitFor();
      assert.equal(await chosen('a').getAttribute('title'), 'items/item-0000.txt');
      await tree('a').getByRole('button', { name: '清空文件搜索', exact: true }).click();
      assert.equal(await input('a').evaluate(n => n === document.activeElement), true);
    });
    await t.test('扫描中选择路径，后续匹配插到前面时仍保留该路径', async () => {
      await page.evaluate(() => window.test.delay()); await input('a').fill('account');
      await page.waitForFunction(() => window.test.a.files.snapshot().searching && window.test.a.files.snapshot().files.includes('src/account.ts'));
      await chosen('a').waitFor(); await list('a').focus(); await list('a').press('End');
      const before = await chosen('a').getAttribute('aria-posinset'), path = await chosen('a').getAttribute('title');
      await page.evaluate(() => window.test.release()); await ready('a');
      await page.waitForFunction(() => document.querySelector('[data-view=a] [role=option]')?.getAttribute('aria-setsize') === '6');
      assert.equal(await chosen('a').getAttribute('title'), path);
      assert.equal(Number(await chosen('a').getAttribute('aria-posinset')), Number(before) + 1);
    });
    await t.test('增量返回 500 个更优匹配后，虚拟列表仍显示原候选且可直接打开', async () => {
      await page.evaluate(() => window.test.delay(true)); await input('a').fill('account');
      await page.waitForFunction(() => window.test.a.files.snapshot().searching && window.test.a.files.snapshot().files.includes('src/account.ts'));
      await chosen('a').waitFor(); await list('a').focus(); await list('a').press('End');
      const path = await chosen('a').getAttribute('title');
      await page.evaluate(() => window.test.release()); await ready('a');
      await chosen('a').filter({ hasText: path }).waitFor();
      assert.equal(await chosen('a').getAttribute('aria-posinset'), '506');
      assert.equal(await list('a').evaluate(n => !!document.getElementById(n.getAttribute('aria-activedescendant'))), true);
      assert.equal(await chosen('a').evaluate(node => { const row = node.getBoundingClientRect(), view = node.closest('.sc-wb-file-matches').getBoundingClientRect(); return row.top >= view.top && row.bottom <= view.bottom; }), true);
      assert.ok(await list('a').getByRole('option').count() < 30);
      await list('a').press('Enter'); await page.waitForFunction(path => window.test.a.snapshot().file === path, path);
    });
    await t.test('候选位置未变化时，后续扫描不打断手动滚动', async () => {
      await page.evaluate(() => {
        window.test.files.push(...Array.from({ length: 1500 }, (_, i) => 'tests/queued-' + String(i).padStart(4, '0') + '.txt'));
        window.test.delay();
      }); await input('a').fill('queued-');
      await page.waitForFunction(() => window.test.a.files.snapshot().searching && window.test.a.files.snapshot().files.includes('tests/queued-1499.txt'));
      await chosen('a').waitFor();
      const viewport = tree('a').locator('.sc-wb-file-matches');
      await viewport.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await list('a').getByRole('option').filter({ hasText: 'queued-1499.txt' }).waitFor();
      await page.waitForFunction(() => !document.querySelector('[data-view=a] input').hasAttribute('aria-activedescendant'));
      const top = await viewport.evaluate(node => node.scrollTop);
      await page.evaluate(() => window.test.release()); await ready('a');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await viewport.evaluate(node => node.scrollTop), top);
      assert.equal(await input('a').getAttribute('aria-activedescendant'), null);
      await input('a').press('ArrowDown');
      await chosen('a').filter({ hasText: 'queued-0001.txt' }).waitFor();
      assert.ok(await viewport.evaluate(node => node.scrollTop) < top);
    });
    await t.test('清空会暂停扫描，晚到目录不恢复搜索，重开后可继续', async () => {
      await page.evaluate(() => window.test.delay()); await input('a').fill('account');
      await page.waitForFunction(() => window.test.a.files.snapshot().searching && window.test.a.files.snapshot().files.includes('src/account.ts'));
      await input('a').press('Escape'); await page.evaluate(() => window.test.release());
      assert.equal(await list('a').count(), 0);
      assert.equal(await input('a').getAttribute('aria-activedescendant'), null);
      await input('a').fill('another-account'); await chosen('a').waitFor(); await ready('a');
      assert.equal(await chosen('a').getAttribute('title'), 'src/later/another-account.ts');
    });
    await t.test('两个实际视图各自保留查询和候选，刷新不误打开已删除结果', async () => {
      for (const id of ['a', 'b']) { await input(id).fill('item-'); await chosen(id).waitFor(); await ready(id); }
      await input('a').press('ArrowDown'); await input('b').press('ArrowDown'); await input('b').press('ArrowDown');
      assert.equal(await chosen('a').getAttribute('title'), 'items/item-0001.txt');
      assert.equal(await chosen('b').getAttribute('title'), 'items/item-0002.txt');
      await page.evaluate(() => { const i = window.test.files.indexOf('items/item-0001.txt'); window.test.files.splice(i, 1); window.test.reset(); });
      await ready('a'); await chosen('a').waitFor();
      assert.equal(await chosen('a').getAttribute('title'), 'items/item-0000.txt');
      assert.equal(await chosen('b').getAttribute('title'), 'items/item-0002.txt');
      assert.equal(await input('a').inputValue(), 'item-'); assert.equal(await input('b').inputValue(), 'item-');
      assert.deepEqual(await page.evaluate(() => window.test.reads), []);
    });
    await t.test('文件读取失败保留搜索和候选，恢复后可用同一输入重试', async () => {
      await input('a').fill('account.ts'); await chosen('a').waitFor(); await ready('a');
      await page.evaluate(() => window.test.failing(true)); await input('a').press('Enter');
      await tree('a').getByRole('alert').filter({ hasText: 'read unavailable' }).waitFor();
      assert.equal(await input('a').inputValue(), 'account.ts');
      assert.equal(await chosen('a').getAttribute('title'), 'src/account.ts');
      await page.evaluate(() => window.test.failing(false)); await input('a').press('Enter');
      await page.waitForFunction(() => window.test.a.snapshot().file === 'src/account.ts');
      assert.deepEqual(await page.evaluate(() => window.test.reads), ['src/account.ts', 'src/account.ts']);
    });
    await t.test('四套主题及英文页面的候选、当前文件标记和键盘提示正常', async () => {
      await input('a').fill('account'); await chosen('a').waitFor(); await ready('a');
      await input('a').press('Enter'); await page.waitForFunction(() => window.test.a.snapshot().file === 'src/accounting.ts');
      await input('a').press('ArrowDown');
      for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
        await page.evaluate(({ palette, dark }) => { document.body.toggleAttribute('data-ds-dark-theme', dark); for (const c of [window.test.a, window.test.b]) c.settings({ ...c.snapshot().preferences, palette }); }, { palette, dark });
        assert.notEqual(await chosen('a').evaluate(n => getComputedStyle(n).backgroundColor), 'rgba(0, 0, 0, 0)');
        assert.match(await tree('a').locator('[aria-current=page]').evaluate(n => getComputedStyle(n).boxShadow), /inset/);
        if (process.env.SC_TEST_ARTIFACTS) { await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true }); await tree('a').screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, 'file-search-' + palette + (dark ? '-dark' : '-light') + '.png') }); }
      }
      await page.evaluate(() => window.test.language('en'));
      const english = tree('a').getByRole('combobox', { name: 'Search files', exact: true });
      await english.fill('README'); await tree('a').getByRole('option', { selected: true }).filter({ hasText: 'README.md' }).waitFor();
      assert.match(await tree('a').locator('.sc-wb-file-search-info').textContent(), /Up|↑/);
      if (process.env.SC_TEST_ARTIFACTS) await tree('a').screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, 'file-search-english.png') });
    });
  });
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
