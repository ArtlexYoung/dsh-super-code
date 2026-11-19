import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const files = {
  'contract.ts': '/** 项目接口。 */\ninterface Contract {\n' + Array.from({ length: 2000 }, (_, i) => `method${i}(value: number): number;`).join('\n') + '\n}',
  'values.c': 'int result[] = {' + Array.from({ length: 2000 }, (_, i) => `seed${i}`).join(',') + '};\nvoid run() { consume(result); }',
  'Store.java': 'class Store {\n' + Array.from({ length: 1000 }, (_, i) => `int method${i}(int value) { return value; }`).join('\n') + '\n}',
  'caller.ts': 'const contract: Contract = null;',
  'broken.ts': 'interface { member(value: number): number; }\nconst after = 1;',
};
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';
import{Workbench}from'./builtin/workbench/components/Workbench.jsx';import{createWorkbench}from'./builtin/workbench/controller.js';
import{zh}from'./builtin/workbench/locales.js';import{EditorView}from'@codemirror/view';
import css from'./builtin/workbench/style.css';import fonts from'./builtin/workbench/fonts/style.js';
const texts=${JSON.stringify(files)};const style=document.createElement('style');style.textContent=fonts+css;document.head.append(style);
const api={fileOperation:async()=>({path:'/sample-project'}),list:async()=>({entries:Object.keys(texts).map(path=>({name:path,path,type:'file'})),truncated:false}),read:async path=>({path,text:texts[path],version:'v1'}),project:async()=>({files:Object.keys(texts),truncated:false}),models:async()=>[],fonts:async()=>[]};
const t=key=>zh[key]||key,c=createWorkbench(api,t),root=createRoot(document.getElementById('root'));
function Button({children,...props}){return <button type='button' {...props}>{children}</button>}function Select(){return null}
c.layout.change({explorerOpen:true,filesOpen:false,outlineOpen:true,panes:{conversation:false,quick:false,changes:false,learning:false}});
root.render(<Workbench workbench={c} Button={Button} Select={Select} Conversation={()=>null} sessionId='declaration-scan' t={t}/>);
window.test={c,texts,select:pos=>{const view=c.view();view.dispatch({selection:{anchor:pos},effects:EditorView.scrollIntoView(pos,{y:'center'})});view.focus()},theme:async(palette,dark)=>{document.body.toggleAttribute('data-ds-dark-theme',dark);await c.settings({...c.snapshot().preferences,palette})},dispose(){root.unmount();c.dispose()}};`;
const worker = await build({ entryPoints: [join(repo, 'builtin/workbench/analysis/worker.js')], bundle: true, write: false, format: 'iife', platform: 'browser' });
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text', '.woff2': 'dataurl' }, define: { __WORKBENCH_ANALYSIS_WORKER__: JSON.stringify(worker.outputFiles[0].text) } });
const server = createServer((req, res) => { res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? app.outputFiles[0].contents : '<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('声明扫描保留实际工作台的结构、说明与导航', async t => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } }), errors = [];
    page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.test?.c.snapshot().indexed === 5 && !window.test.c.snapshot().indexing);
      await t.test('不完整接口不出现空白结构项', async () => {
        await page.evaluate(() => window.test.c.visit({ file: 'broken.ts' }));
        await page.waitForFunction(() => window.test.c.snapshot().symbols.length === 1);
        assert.deepEqual(await page.evaluate(() => window.test.c.snapshot().symbols.map(item => item.name)), ['after']);
        assert.equal(await page.locator('.sc-wb-outline [role=option]').count(), 1);
        assert.match(await page.locator('.sc-wb-outline [role=option]').textContent(), /after/);
      });
      await t.test('输入缺少的名称后即时出现真实声明并保持文档与选区', async () => {
        await page.evaluate(() => { const view = window.test.c.view(); view.dispatch({ changes: { from: 10, insert: 'Draft ' }, selection: { anchor: 15 } }); });
        await page.waitForFunction(() => window.test.c.snapshot().symbols.length === 2);
        assert.deepEqual(await page.evaluate(() => window.test.c.snapshot().symbols.map(item => item.name)), ['Draft', 'after']);
        assert.equal(await page.evaluate(() => window.test.c.view().state.selection.main.head), 15);
        assert.match(await page.evaluate(() => window.test.c.view().state.doc.toString()), /^interface Draft /);
      });
      await t.test('大数组初始化只保留真实声明，引用可跳回定义', async () => {
        await page.evaluate(async () => { await window.test.c.visit({ file: 'values.c' }); window.test.select(window.test.texts['values.c'].lastIndexOf('result') + 1); });
        assert.deepEqual(await page.evaluate(() => window.test.c.snapshot().symbols.map(item => item.name)), ['result', 'run']);
        await page.keyboard.press('Control+b');
        await page.waitForFunction(() => window.test.c.view().state.selection.main.head === window.test.texts['values.c'].indexOf('result'));
      });
      await t.test('一千个方法完整保留，结构列表虚拟显示并可搜索跳到末项', async () => {
        await page.evaluate(() => window.test.c.visit({ file: 'Store.java' }));
        await page.waitForFunction(() => window.test.c.snapshot().symbols.length === 1001);
        assert.ok(await page.locator('.sc-wb-outline [role=option]').count() < 40);
        const search = page.locator('.sc-wb-outline-tools input'); await search.fill('method999');
        await page.locator('.sc-wb-outline [role=option]').filter({ hasText: 'method999' }).waitFor(); await search.press('Enter');
        await page.waitForFunction(() => window.test.c.view().state.selection.main.head === window.test.texts['Store.java'].indexOf('method999'));
        await search.fill('');
      });
      await t.test('大型接口的名称保留源码说明和定义位置', async () => {
        await page.evaluate(async () => { await window.test.c.visit({ file: 'caller.ts' }); window.test.select(window.test.texts['caller.ts'].indexOf('Contract') + 2); });
        const point = await page.evaluate(() => { const box = window.test.c.view().coordsAtPos(window.test.texts['caller.ts'].indexOf('Contract') + 2); return { x: box.left + 1, y: (box.top + box.bottom) / 2 }; });
        await page.mouse.move(point.x, point.y); await page.locator('.signature-tooltip .documentation-signature').waitFor();
        assert.equal(await page.locator('.signature-tooltip .documentation-signature').textContent(), 'interface Contract');
        assert.match(await page.locator('.signature-tooltip').textContent(), /项目接口/);
        await page.mouse.move(5, 5); await page.keyboard.press('Control+b');
        await page.waitForFunction(() => window.test.c.snapshot().file === 'contract.ts' && window.test.c.view().state.selection.main.head === window.test.texts['contract.ts'].indexOf('Contract'));
      });
      await t.test('IDEA明色与VS Code暗色下结构和末尾源码保持可读', async () => {
        for (const [palette, dark] of [['idea', false], ['vscode', true]]) {
          await page.evaluate(async ({ palette, dark }) => { await window.test.theme(palette, dark); await window.test.c.visit({ file: 'Store.java' }); window.test.select(window.test.texts['Store.java'].indexOf('method999')); }, { palette, dark });
          await page.waitForFunction(() => document.querySelector('.sc-wb-outline [aria-current=location]')?.textContent.includes('method999'));
          const rect = await page.locator('.sc-wb-outline [aria-current=location]').boundingBox(); assert.ok(rect.y > 0 && rect.y + rect.height < 800);
          if (process.env.SC_TEST_ARTIFACTS) { await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, `declarations-${palette}-${dark ? 'dark' : 'light'}.png`) }); }
        }
      });
      assert.deepEqual(errors, []);
    } finally { await page.evaluate(() => window.test?.dispose()).catch(() => {}); await page.close(); }
  });
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
