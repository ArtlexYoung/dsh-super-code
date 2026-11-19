import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const source = [
  '/** 项目任务。 */', 'class Store {', '  load(value: number) {',
  '    const normalize = (entry: number) => {', '      const result = entry + 1;', '      return result;', '    };',
  '    return normalize(value);', '  }', '  close() { return 0; }', '}',
  'class Cache {', '  load(value: number) { return value; }', '}',
  'const item = 1;', 'const itemTotal = item + item;', 'const label = "item";',
  'const 输入 = item;', 'const 输出 = 输入 + 输入;',
].join('\n');
const fixture = `import React from'react';import{createRoot}from'react-dom/client';
import{Workbench}from'./builtin/workbench/components/Workbench.jsx';import{createWorkbench}from'./builtin/workbench/controller.js';
import{zh}from'./builtin/workbench/locales.js';import{readScope}from'./builtin/workbench/editor/scope.js';
import{EditorSelection}from'@codemirror/state';import{EditorView}from'@codemirror/view';import{openSearchPanel}from'@codemirror/search';
import css from'./builtin/workbench/style.css';import fonts from'./builtin/workbench/fonts/style.js';
const style=document.createElement('style');style.textContent=fonts+css;document.head.append(style);
const texts={'tasks.ts':${JSON.stringify(source)},'empty.txt':'','legacy.sh':'function legacy() {\\n echo ready\\n}',
'large.ts':Array.from({length:4096},(_,i)=>'function task'+String(i).padStart(4,'0')+'() { const value = '+i+'; return value; }').join('\\n'),
'dense.ts':'const word = 1;\\n'+Array.from({length:350},()=> 'word;').join(' ')};
let reads=0;
const api={fileOperation:async()=>({path:'/sample-project'}),list:async()=>({entries:Object.keys(texts).map(path=>({name:path,path,type:'file'})),truncated:false}),read:async path=>{reads++;return{path,text:texts[path],version:'v1'}},project:async()=>({files:Object.keys(texts),truncated:false}),models:async()=>[],fonts:async()=>[]};
const c=createWorkbench(api,k=>zh[k]||k),root=createRoot(document.getElementById('root'));
function Button({children,...props}){return <button type='button' {...props}>{children}</button>}
c.layout.change({explorerOpen:true,filesOpen:false,outlineOpen:true,panes:{conversation:false,quick:false,changes:false,learning:false}});
root.render(<Workbench workbench={c} Button={Button} Select={()=>null} Conversation={()=>null} sessionId='location' t={k=>zh[k]||k}/>);
window.test={c,texts,reads:()=>reads,search:()=>openSearchPanel(c.view()),
select(word,offset=1){const v=c.view(),found=v.state.doc.toString().indexOf(word);if(found<0)throw new Error('测试代码中没有目标文字：'+word);const at=found+offset;v.dispatch({selection:{anchor:at},effects:EditorView.scrollIntoView(at,{y:'center'})});v.focus()},
multiple(){const v=c.view();v.dispatch({selection:EditorSelection.create([EditorSelection.cursor(6),EditorSelection.cursor(15)])})},
theme:async(palette,dark)=>{document.body.toggleAttribute('data-ds-dark-theme',dark);await c.settings({...c.snapshot().preferences,palette})},
ready:()=>readScope(c.view().state).ready,dispose(){root.unmount();c.dispose()}};`;
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, platform: 'browser', format: 'esm', loader: { '.css': 'text', '.woff2': 'dataurl' } });
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(app.outputFiles[0].contents); }
  else { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
const evidence = process.env.SC_TEST_ARTIFACTS;
if (evidence) await mkdir(evidence, { recursive: true });
try {
  await test('结构栏当前位置与光标同名词', { timeout: 90000 }, async t => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
    page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
    page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
    const outline = page.locator('#sc-wb-outline'), current = outline.locator('[aria-current=location]');
    const selected = outline.locator('[aria-selected=true]'), query = outline.getByRole('combobox');
    const visit = async file => { await page.evaluate(file => window.test.c.visit({ file }), file); await page.waitForFunction(file => window.test.c.snapshot().file === file && (file === 'empty.txt' || window.test.c.snapshot().symbols.some(item => item.file === file)), file); };
    const select = async (word, offset = 1) => { await page.evaluate(({ word, offset }) => window.test.select(word, offset), { word, offset }); await page.waitForFunction(() => window.test.ready()); };
    const capture = async name => { if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, name + '.png'), animations: 'disabled' }); } };
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.test?.c.snapshot().indexed === 5);
    await visit('tasks.ts'); await page.evaluate(() => document.fonts.ready);
    t.beforeEach(async () => { await visit('tasks.ts'); await query.fill(''); });

    await t.test('源码定位跟随嵌套函数、同名方法及类，变量不冒充所在函数', async () => {
      await select('return result');
      await current.waitFor(); assert.equal(await current.locator('span').textContent(), 'normalize');
      assert.equal(await selected.locator('span').textContent(), 'normalize');
      await select('return normalize'); assert.equal(await current.locator('span').textContent(), 'load');
      assert.equal(await current.locator('.sc-wb-outline-line').textContent(), '3');
      await select('return value'); assert.equal(await current.locator('span').textContent(), 'load');
      assert.equal(await current.locator('.sc-wb-outline-line').textContent(), '13');
      await select('class Store', 6); assert.equal(await current.locator('span').textContent(), 'Store');
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), source);
    });
    await t.test('反向选区跟随活动端，顶层及旧词法语言不标错函数', async () => {
      await page.evaluate(() => { const v=window.test.c.view(),text=v.state.doc.toString();v.dispatch({selection:{anchor:text.indexOf('return value'),head:text.indexOf('return result')}}); });
      assert.equal(await current.locator('span').textContent(), 'normalize');
      await select('const item'); assert.equal(await current.count(), 0);
      await visit('empty.txt'); assert.equal(await current.count(), 0);
      await visit('legacy.sh'); await select('echo'); assert.equal(await current.count(), 0);
      await visit('tasks.ts');
    });
    await t.test('符号查询与键盘候选不被位置提示打断，也不抢搜索焦点', async () => {
      await select('return value'); await query.fill('load'); await query.press('ArrowDown');
      assert.equal(await selected.locator('.sc-wb-outline-line').textContent(), '13');
      assert.equal(await selected.locator('.sc-wb-outline-context').textContent(), 'Cache');
      await page.evaluate(() => { const v=window.test.c.view(),at=v.state.doc.toString().indexOf('return normalize');v.dispatch({selection:{anchor:at}}); });
      assert.equal(await current.locator('.sc-wb-outline-line').textContent(), '3');
      assert.equal(await current.locator('.sc-wb-outline-context').textContent(), 'Store');
      assert.equal(await selected.locator('.sc-wb-outline-line').textContent(), '13');
      assert.equal(await query.evaluate(node => node === document.activeElement), true);
      await query.press('Enter'); await page.waitForFunction(() => window.test.c.snapshot().cursor?.line === 12);
      await query.fill('close'); assert.equal(await current.count(), 0);
      await query.fill(''); await select('return result'); assert.equal(await current.locator('span').textContent(), 'normalize');
    });
    await t.test('收起再展开无需读取文件，修改及撤销后仍跟随实际位置', async () => {
      const reads = await page.evaluate(() => window.test.reads());
      await page.evaluate(() => window.test.c.layout.change({ outlineOpen: false }));
      await select('return value'); await page.evaluate(() => window.test.c.layout.change({ outlineOpen: true }));
      await current.waitFor(); assert.equal(await current.locator('.sc-wb-outline-line').textContent(), '13');
      assert.equal(await page.evaluate(() => window.test.reads()), reads);
      await page.evaluate(() => { const v=window.test.c.view(),at=v.state.doc.toString().indexOf('class Cache');v.dispatch({changes:{from:at,insert:'\n\n'}}); });
      await page.waitForFunction(() => document.querySelector('#sc-wb-outline [aria-current=location] .sc-wb-outline-line')?.textContent === '15');
      await page.evaluate(() => window.test.c.undo());
      await page.waitForFunction(() => document.querySelector('#sc-wb-outline [aria-current=location] .sc-wb-outline-line')?.textContent === '13');
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), source);
    });
    await t.test('4096 函数定位最后一项仍保持虚拟列表，键盘候选可返回源码位置', async () => {
      await visit('large.ts'); await page.evaluate(() => window.test.c.visit({file:'large.ts',line:4095,character:45}));
      await current.waitFor(); await page.waitForFunction(() => document.querySelector('#sc-wb-outline [aria-current=location] span')?.textContent === 'task4095');
      await outline.getByRole('button', { name: '只看函数', exact: true }).click();
      assert.ok(await outline.getByRole('option').count() < 60);
      const list = outline.locator('.sc-wb-outline'), before = await list.evaluate(node => node.scrollTop);
      await page.evaluate(() => window.test.c.view().dispatch({changes:{from:0,insert:'\n'}}));
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const pending = await list.evaluate(node => node.scrollTop);
      assert.ok(Math.abs(pending-before)<=27, `索引更新期间不应滚回首项：${before} -> ${pending}`);
      await page.waitForFunction(() => document.querySelector('#sc-wb-outline [aria-current=location] span')?.textContent === 'task4095');
      await page.evaluate(() => window.test.c.undo());
      await page.waitForFunction(() => window.test.c.snapshot().symbols[0]?.offset === 9);
      await query.focus(); await query.press('ArrowUp');
      assert.equal(await selected.locator('span').textContent(), 'task4094');
      await select('const value = 0');
      await page.waitForFunction(() => document.querySelector('#sc-wb-outline [aria-selected=true] span')?.textContent === 'task0000');
      if (evidence) await writeFile(join(evidence,'capacity.json'),JSON.stringify(await page.evaluate(() => ({total:window.test.c.snapshot().symbols.length,functions:window.test.c.snapshot().symbols.filter(item=>item.kind==='function').length,rendered:document.querySelectorAll('#sc-wb-outline [role=option]').length,codeLines:document.querySelectorAll('.cm-line').length})),null,2));
      await visit('tasks.ts');
    });
    await t.test('光标单词自动显示同名文本，完整词边界和中文保持正确', async () => {
      await select('const item =', 7);
      await page.locator('.cm-selectionMatch-main').waitFor();
      assert.deepEqual(await page.locator('.cm-selectionMatch').allTextContents(), ['item','item','item','item','item']);
      assert.equal(await page.evaluate(() => window.test.c.view().state.selection.main.empty), true);
      await select('const 输入', 7);
      assert.deepEqual(await page.locator('.cm-selectionMatch').allTextContents(), ['输入','输入','输入']);
      await select('const item =', 0); assert.equal(await page.locator('.cm-selectionMatch').count() > 0, true);
      await page.evaluate(() => { const v=window.test.c.view();v.dispatch({selection:{anchor:v.state.doc.toString().indexOf('  load')+1}}); });
      assert.equal(await page.locator('.cm-selectionMatch').count(), 0);
    });
    await t.test('手动选区继续高亮子串，多光标不混淆，内建搜索与撤销保留', async () => {
      await page.evaluate(() => { const v=window.test.c.view(),at=v.state.doc.toString().indexOf('itemTotal');v.dispatch({selection:{anchor:at,head:at+4}}); });
      assert.ok(await page.locator('.cm-selectionMatch').count() >= 4);
      await page.evaluate(() => window.test.multiple()); assert.equal(await page.locator('.cm-selectionMatch').count(), 0);
      await select('const item =', 7); const original=await page.evaluate(() => window.test.c.view().state.doc.toString());
      await page.keyboard.type('s'); await page.evaluate(() => window.test.c.undo());
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), original);
      await page.evaluate(() => window.test.search());
      await page.locator('.cm-search input[name=search]').fill('');
      await page.locator('.cm-search input[name=search]').pressSequentially('itemTotal');
      await page.locator('.cm-searchMatch').waitFor();
      await page.locator('.cm-search input[name=search]').press('Escape');
      assert.equal(await page.locator('.cm-search').count(), 0);
    });
    await t.test('密集同名单词只处理可见范围，不导致高亮整体消失', async () => {
      await visit('dense.ts'); await select('const word', 7);
      await page.locator('.cm-selectionMatch-main').waitFor();
      assert.ok(await page.locator('.cm-selectionMatch').count() > 100);
      assert.ok(await page.locator('.cm-line').count() < 20);
      await page.evaluate(() => { window.test.texts['long.ts']='const word = 1;\n'+'word;'.repeat(200000); });
      await visit('long.ts'); await select('const word',7); await page.locator('.cm-selectionMatch-main').waitFor();
      const capacity=await page.evaluate(()=>{const v=window.test.c.view();return{length:v.state.doc.length,visible:v.visibleRanges.reduce((total,range)=>total+range.to-range.from,0),matches:v.dom.querySelectorAll('.cm-selectionMatch').length}});
      assert.ok(capacity.visible<capacity.length/10,JSON.stringify(capacity));
      assert.ok(capacity.matches>0&&capacity.matches<=capacity.visible,JSON.stringify(capacity));
      if(evidence)await writeFile(join(evidence,'dense-capacity.json'),JSON.stringify(capacity,null,2));
      await visit('tasks.ts');
    });
    await t.test('四主题、窄栏和两倍缩放中当前位置、候选及匹配仍可区分', async () => {
      await select('return result', 9);
      for (const palette of ['idea','vscode']) for (const dark of [false,true]) {
        await page.evaluate(({palette,dark}) => window.test.theme(palette,dark), {palette,dark});
        await capture(`location-${palette}-${dark?'dark':'light'}`);
        assert.equal(await current.locator('span').textContent(),'normalize');
        const colors=await page.locator('.cm-selectionMatch-main').evaluate(node=>({background:getComputedStyle(node).backgroundColor,outline:getComputedStyle(node).outlineStyle}));
        assert.notEqual(colors.background,'rgba(0, 0, 0, 0)'); assert.notEqual(colors.outline,'none');
      }
      await query.fill('load'); await capture('location-search');
      assert.equal(await current.count(),0);
      await query.fill(''); await page.setViewportSize({width:650,height:650}); await capture('location-narrow');
      await page.evaluate(()=>document.body.style.zoom='2'); await capture('location-zoom');
      assert.ok(await outline.evaluate(node=>node.scrollWidth<=node.clientWidth));
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()),source);
    });
    assert.deepEqual(errors, []); await page.evaluate(() => window.test.dispose()); await page.close();
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
