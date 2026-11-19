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
  '/** 配置任务。支持 **分组设置**。', ' * @param name 项目名称。', ' * @param options 每个分组的重试次数。', ' * @param retries 重试次数。', ' * @returns 是否成功。',
  ' */', 'export function configure(name: string, options: Record<string, number>, retries: number = 3): boolean {', '  return name.length > 0;', '}',
  '/** 合并数值。 */', 'function nested(value: number, count: number): number { return value + count; }', '',
  'configure("demo,a", { first: 1, second: 2 }, nested(1, 2)); // outside', 'externalCall(1, 2);',
].join('\n');
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';
import{Workbench}from'./builtin/workbench/components/Workbench.jsx';import{createWorkbench}from'./builtin/workbench/controller.js';
import{SymbolIndex}from'./builtin/workbench/analysis/index.js';import{zh}from'./builtin/workbench/locales.js';
import css from'./builtin/workbench/style.css';import fonts from'./builtin/workbench/fonts/style.js';import{EditorView}from'@codemirror/view';
const style=document.createElement('style');style.textContent=fonts+css;document.head.append(style);
const texts={'calls.ts':${JSON.stringify(source)},'other.ts':'export function configure(name: number, settings: boolean): number { return name; }',
'calls.py':'def configure(first: int, second: str):\\n    return first\\nconfigure(second="label", first=1)',
'calls.php':'<?php function configure(int $first, string $second) { return $first; } configure(second:"label", first:1);'};
let gate=null,releaseGate,failNext=false,lookups=0;
const describe=SymbolIndex.prototype.describe;
SymbolIndex.prototype.describe=async function(items,signal){lookups++;const waiting=gate;if(failNext){failNext=false;throw Error('读取签名失败');}const result=await describe.call(this,items,signal);if(waiting)await waiting;return result;};
const api={list:async()=>({entries:Object.keys(texts).map(path=>({name:path,path,type:'file'})),truncated:false}),read:async path=>({path,text:texts[path],version:'v1'}),project:async()=>({files:Object.keys(texts),truncated:false}),fileOperation:async()=>({path:'/sample-project'}),models:async()=>[],fonts:async()=>[]};
const t=k=>zh[k]||k,c=createWorkbench(api,t),root=createRoot(document.getElementById('root'));
const analyze=c.index.analyzer;let analysisCalls=0,analysisGate=null,releaseAnalysisGate;
c.index.analyzer=async(...args)=>{if(args[2]!==false){analysisCalls++;const waiting=analysisGate;if(waiting)await waiting}return analyze(...args)};
function Button({children,...props}){return <button type='button' {...props}>{children}</button>}
function Select({label,value,choices,onChange}){return <select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{choices.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>}
c.layout.change({outlineOpen:false,panes:{conversation:false,quick:false,changes:false,learning:false}});
root.render(<Workbench workbench={c} Button={Button} Select={Select} Conversation={()=>null} sessionId='parameters' t={t}/>);
window.test={c,texts,lookups:()=>lookups,hold:()=>{gate=new Promise(resolve=>releaseGate=resolve)},release:()=>{gate=null;releaseGate?.()},fail:()=>{failNext=true},
analysisCalls:()=>analysisCalls,holdAnalysis:()=>{analysisGate=new Promise(resolve=>releaseAnalysisGate=resolve)},releaseAnalysis:()=>{analysisGate=null;releaseAnalysisGate?.()},
select:(text,offset=0)=>{const v=c.view(),at=v.state.doc.toString().lastIndexOf(text);if(at<0)throw Error('未找到测试位置');v.dispatch({selection:{anchor:at+offset},effects:EditorView.scrollIntoView(at+offset,{y:'center'})});v.focus()},
theme:async(palette,dark)=>{document.body.toggleAttribute('data-ds-dark-theme',dark);await c.settings({...c.snapshot().preferences,palette})},dispose(){root.unmount();c.dispose()}};`;
const worker = await build({ entryPoints: [join(repo, 'builtin/workbench/analysis/worker.js')], bundle: true, write: false, format: 'iife', platform: 'browser' });
const built = await build({ stdin: { contents: fixture, resolveDir: repo, loader: 'jsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text', '.woff2': 'dataurl' }, define: { __WORKBENCH_ANALYSIS_WORKER__: JSON.stringify(worker.outputFiles[0].text) } });
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(built.outputFiles[0].contents); }
  else res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
const evidence = process.env.SC_TEST_ARTIFACTS;
try {
  await test('函数调用参数信息', async t => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
    page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.test?.c.snapshot().indexed === 4);
    const visit = file => page.evaluate(file => window.test.c.visit({ file }), file);
    const select = (text, offset = 0) => page.evaluate(({ text, offset }) => window.test.select(text, offset), { text, offset });
    const tooltip = page.locator('.parameter-tooltip'), active = tooltip.locator('.documentation-active-parameter');
    const bounded = selector => page.waitForFunction(selector => {
      const node = document.querySelector(selector);
      if (!node) return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
    }, selector);
    const capture = async name => { if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, name + '.png'), animations: 'disabled' }); } };
    await visit('calls.ts'); await page.evaluate(() => document.fonts.ready);
    t.beforeEach(async () => {
      await page.evaluate(() => window.test.release()); await visit('calls.ts');
      await page.evaluate(() => window.test.c.settings({...window.test.c.snapshot().preferences,keymap:'idea',shortcuts:{}}));
      await page.keyboard.press('Escape'); await select('"demo,a"', 2);
    });
    await t.test('悬浮、参数提示与定义并发查询共用生产 Worker 的详细解析', async () => {
      await select('nested(1, 2)',10);
      const before = await page.evaluate(() => {window.test.holdAnalysis();return window.test.analysisCalls()});
      const point = await page.evaluate(() => {const v=window.test.c.view(),at=v.state.doc.toString().lastIndexOf('nested(')+3,box=v.coordsAtPos(at);return{x:box.left,y:(box.top+box.bottom)/2}});
      try {
        await page.mouse.move(point.x,point.y);
        await page.waitForFunction(before => window.test.analysisCalls()>before,before);
        await page.keyboard.press('Control+p'); await tooltip.getByRole('status').waitFor();
        await page.evaluate(() => {
          const index=window.test.c.index,items=index.candidates('calls.ts','nested');
          window.concurrentDetails=Promise.all([index.describe(items),index.navigate('calls.ts','nested',window.test.texts['calls.ts'].lastIndexOf('nested(')+3)]);
        });
        await page.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.equal(await page.evaluate(() => window.test.analysisCalls()),before+1);
      } finally {
        await page.evaluate(() => window.test.releaseAnalysis());
        await page.evaluate(() => window.concurrentDetails);
      }
      await active.first().waitFor();
      assert.equal(await active.first().textContent(),'count: number');
      const [details,definition]=await page.evaluate(() => window.concurrentDetails);
      assert.match(details[0].documentation.description,/合并数值/);
      assert.equal(definition.kind,'definitions');assert.ok(definition.matches.some(item=>item.file==='calls.ts'));
      await page.mouse.move(10,10);
    });
    await t.test('Ctrl+P 从真实快捷键打开签名、类型和文档，并保留源码与光标', async () => {
      const before = await page.evaluate(() => window.test.c.view().state.selection.toJSON());
      await page.keyboard.press('Control+p'); await active.first().waitFor();
      assert.equal(await active.first().textContent(), 'name: string');
      assert.match(await tooltip.textContent(), /项目名称/);
      assert.doesNotMatch(await tooltip.textContent(), /每个分组的重试次数/);
      assert.equal(await tooltip.locator('.documentation-card').count(), 1);
      assert.doesNotMatch(await tooltip.textContent(), /settings: boolean|同名候选/);
      assert.deepEqual(await page.evaluate(() => window.test.c.view().state.selection.toJSON()), before);
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), source);
    });
    await t.test('同一调用内移动到第二个参数更新强调，并复用一次签名读取', async () => {
      const before = await page.evaluate(() => window.test.lookups());
      await page.keyboard.press('Control+p'); await active.first().waitFor();
      await select('{ first: 1, second: 2 }', 10);
      await page.waitForFunction(() => document.querySelector('.parameter-tooltip .documentation-active-parameter')?.textContent === 'options: Record<string, number>');
      assert.match(await tooltip.textContent(), /每个分组的重试次数/);
      assert.equal(await page.evaluate(() => window.test.lookups()), before + 1);
      await select('nested(1, 2)', 12);
      await page.waitForFunction(() => document.querySelector('.parameter-tooltip .documentation-active-parameter')?.textContent === 'retries: number = 3');
      assert.equal(await page.evaluate(() => window.test.lookups()), before + 1);
    });
    await t.test('进入嵌套调用切换签名，Esc 关闭后移动光标不会重新弹出', async () => {
      await page.keyboard.press('Control+p'); await active.first().waitFor();
      await select('nested(1, 2)', 10);
      await page.waitForFunction(() => document.querySelector('.parameter-tooltip .documentation-active-parameter')?.textContent === 'count: number');
      await page.keyboard.press('Escape'); await tooltip.waitFor({ state: 'detached' });
      await select('"demo,a"', 2); await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.equal(await tooltip.count(), 0);
    });
    await t.test('打开参数信息会关闭原悬浮气泡，避免重复遮挡', async () => {
      const point = await page.evaluate(() => { const v=window.test.c.view(),at=v.state.doc.toString().lastIndexOf('configure(')+3,box=v.coordsAtPos(at);return{x:box.left,y:(box.top+box.bottom)/2}; });
      await page.mouse.move(point.x,point.y); await page.locator('.signature-tooltip:not(.parameter-tooltip)').waitFor();
      await page.keyboard.press('Control+p'); await active.first().waitFor();
      assert.equal(await page.locator('.signature-tooltip:not(.parameter-tooltip)').count(),0);
      await page.mouse.move(10,10);
    });
    await t.test('离开调用、产生选区和切文件都关闭提示', async () => {
      for (const mode of ['outside', 'selection', 'file']) {
        await visit('calls.ts'); await select('"demo,a"', 2); await page.keyboard.press('Control+p'); await active.first().waitFor();
        if (mode === 'outside') await select('// outside', 4);
        else if (mode === 'selection') await page.evaluate(() => { const v=window.test.c.view(),head=v.state.selection.main.head;v.dispatch({selection:{anchor:head,head:head+2}}); });
        else await visit('other.ts');
        await tooltip.waitFor({ state: 'detached' });
      }
    });
    await t.test('VS Code 和自定义快捷键，以及工具栏按钮都能打开', async () => {
      await page.evaluate(() => window.test.c.settings({...window.test.c.snapshot().preferences,keymap:'vscode'}));
      await page.keyboard.press('Control+Shift+Space'); await active.first().waitFor(); await page.keyboard.press('Escape');
      await page.evaluate(() => window.test.c.settings({...window.test.c.snapshot().preferences,shortcuts:{parameters:'Alt-p'}}));
      await page.keyboard.press('Alt+p'); await active.first().waitFor(); await page.keyboard.press('Escape');
      const button = page.locator('[data-toolbar-action=parameters]'); await button.scrollIntoViewIfNeeded(); await button.click(); await active.first().waitFor();
      assert.equal(await page.evaluate(() => window.test.c.view().hasFocus), true);
    });
    await t.test('命名参数按名称强调，PHP 声明不用 HTML 模式误读', async () => {
      for (const [file, text, offset, expected] of [['calls.py', 'second="label"', 9, 'second: str'], ['calls.php', 'second:"label"', 9, 'string $second']]) {
        await visit(file); await select(text, offset); await page.keyboard.press('Control+p'); await active.first().waitFor();
        assert.equal(await active.first().textContent(), expected, file); await page.keyboard.press('Escape');
      }
    });
    await t.test('请求进行中取消或切文件，迟到结果不会在新位置弹回', async () => {
      for (const cancel of ['escape', 'file']) {
        await visit('calls.ts'); await select('"demo,a"', 2); await page.evaluate(() => window.test.hold());
        await page.keyboard.press('Control+p'); await tooltip.getByRole('status').waitFor();
        if (cancel === 'escape') await page.keyboard.press('Escape'); else await visit('other.ts');
        await tooltip.waitFor({ state: 'detached' }); await page.evaluate(() => window.test.release());
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await tooltip.count(), 0, cancel);
      }
    });
    await t.test('读取期间改动声明后只显示新签名，撤销恢复原内容', async () => {
      await page.evaluate(() => window.test.hold()); await page.keyboard.press('Control+p'); await tooltip.getByRole('status').waitFor();
      await page.evaluate(() => { const v=window.test.c.view(),from=v.state.doc.toString().indexOf('name: string')+6;v.dispatch({changes:{from,to:from+6,insert:'number'}}); });
      await page.evaluate(() => window.test.release());
      await page.waitForFunction(() => document.querySelector('.parameter-tooltip .documentation-active-parameter')?.textContent === 'name: number');
      await page.evaluate(() => window.test.c.undo());
      await page.waitForFunction(() => document.querySelector('.parameter-tooltip .documentation-active-parameter')?.textContent === 'name: string');
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), source);
    });
    await t.test('未索引的函数和读取错误有反馈，原位置可以重试', async () => {
      await select('externalCall(1, 2)', 14); await page.keyboard.press('Control+p');
      await tooltip.getByText('当前项目中没有找到对应的签名。', { exact: true }).waitFor();
      await page.keyboard.press('Escape'); await select('"demo,a"', 2); await page.evaluate(() => window.test.fail());
      await page.keyboard.press('Control+p'); await tooltip.getByText(/签名读取失败/).waitFor();
      await page.keyboard.press('Control+p'); await active.first().waitFor();
      assert.equal(await active.first().textContent(), 'name: string');
    });
    await t.test('四主题、窄窗和两倍缩放中有正确的配色和气泡边界', async () => {
      await page.keyboard.press('Control+p'); await active.first().waitFor();
      for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
        await page.evaluate(({palette,dark}) => window.test.theme(palette,dark), {palette,dark});
        await active.first().waitFor(); await capture(`parameters-${palette}-${dark?'dark':'light'}`);
        const color = await active.first().evaluate(node => ({background:getComputedStyle(node).backgroundColor,weight:getComputedStyle(node).fontWeight}));
        assert.notEqual(color.background, 'rgba(0, 0, 0, 0)'); assert.equal(color.weight, '600');
      }
      try {
        await page.setViewportSize({width:650,height:650}); await bounded('.parameter-tooltip'); await capture('parameters-narrow');
        const box = await tooltip.evaluate(node => {const box=node.getBoundingClientRect();return{left:box.left,right:box.right,scroll:node.scrollWidth,width:node.clientWidth}});
        assert.ok(box.left>=0 && box.right<=650 && box.scroll<=box.width+1, JSON.stringify(box));
        await page.setViewportSize({width:1440,height:900}); await page.evaluate(() => document.body.style.zoom='2'); await select('"demo,a"',2);
        await active.first().waitFor(); await bounded('.parameter-tooltip'); await capture('parameters-zoom');
        const zoom = await tooltip.boundingBox();
        assert.ok(zoom.x>=0 && zoom.y>=0 && zoom.x+zoom.width<=1441 && zoom.y+zoom.height<=901,JSON.stringify(zoom));
        assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), source);
      } finally {
        await page.evaluate(() => document.body.style.zoom='1'); await page.setViewportSize({width:1440,height:900});
      }
    });
    await t.test('两倍缩放的悬浮说明、选区按钮和底层编辑器仍可操作', async () => {
      await page.evaluate(() => document.body.style.zoom='2'); await select('"demo,a"',2);
      try {
        const point = await page.evaluate(() => {const v=window.test.c.view(),at=v.state.doc.toString().lastIndexOf('configure(')+3,box=v.coordsAtPos(at);return{at,x:box.left,y:(box.top+box.bottom)/2}});
        await page.mouse.move(point.x,point.y); await page.locator('.signature-tooltip:not(.parameter-tooltip)').waitFor();
        await bounded('.cm-tooltip-hover'); await capture('parameters-hover-zoom');
        await page.mouse.click(point.x,point.y);
        await page.waitForFunction(at => Math.abs(window.test.c.view().state.selection.main.head-at)<=1,point.at);
        await page.mouse.move(10,10);
        await page.evaluate(() => {const v=window.test.c.view(),from=v.state.doc.toString().lastIndexOf('"demo,a"');v.dispatch({selection:{anchor:from,head:from+8}})});
        const actions = page.locator('.selection-actions'); await actions.waitFor(); await bounded('.selection-actions');
        await actions.getByRole('button').first().click(); await page.locator('.sc-wb-assistant textarea').waitFor();
        await bounded('.sc-wb-assistant');
        await page.locator('.sc-wb-assistant textarea').click();
        assert.equal(await page.locator('.sc-wb-assistant textarea').evaluate(node => document.activeElement===node),true);
        await page.evaluate(() => document.body.style.zoom='1'); await bounded('.sc-wb-assistant');
        await page.evaluate(() => document.body.style.zoom='2'); await bounded('.sc-wb-assistant');
        await capture('parameters-selection-zoom');
        await page.evaluate(() => window.test.c.assistant.close());
      } finally { await page.evaluate(() => document.body.style.zoom='1'); }
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()),source);
    });
    await t.test('长参数说明在切换参数、缩放和调整窗口后仍能完整滚动', async () => {
      await page.evaluate(() => {const v=window.test.c.view(),from=v.state.doc.toString().indexOf('项目名称。');v.dispatch({changes:{from,to:from+5,insert:'项目名称。'.repeat(300)}})});
      try {
        await select('"demo,a"',2); await page.keyboard.press('Control+p'); await active.first().waitFor(); await bounded('.parameter-tooltip');
        await select('{ first: 1, second: 2 }',10);
        await page.waitForFunction(() => document.querySelector('.documentation-active-parameter')?.textContent === 'options: Record<string, number>');
        await bounded('.parameter-tooltip');
        await select('"demo,a"',2); await page.evaluate(() => document.body.style.zoom='2'); await select('"demo,a"',2);
        await bounded('.parameter-tooltip');
        const overflow = await tooltip.evaluate(node => ({height:node.clientHeight,scroll:node.scrollHeight}));
        assert.ok(overflow.scroll>overflow.height,JSON.stringify(overflow));
        await tooltip.hover(); await page.mouse.wheel(0,600);
        await page.waitForFunction(() => document.querySelector('.parameter-tooltip').scrollTop>0);
        await page.setViewportSize({width:1100,height:780}); await select('"demo,a"',2); await bounded('.parameter-tooltip');
        await capture('parameters-long-zoom');
      } finally {
        await page.evaluate(() => {document.body.style.zoom='1';window.test.c.undo()}); await page.setViewportSize({width:1440,height:900});
      }
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()),source);
    });
    if (evidence) await writeFile(join(evidence,'runtime-errors.json'),JSON.stringify(errors,null,2));
    assert.deepEqual(errors, []); await page.evaluate(() => window.test.dispose()); await page.close();
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
