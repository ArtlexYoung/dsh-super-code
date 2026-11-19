import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const text = Array.from({ length: 128 }, (_, i) => `class Entry${i} {\n/**\n * 执行任务 ${i}。\n * @param value 输入值 ${i}\n */\nexecute(value: number): number { return value; }\n}`).join('\n');
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';
import{Workbench}from'./builtin/workbench/components/Workbench.jsx';import{createWorkbench}from'./builtin/workbench/controller.js';
import{zh}from'./builtin/workbench/locales.js';import{EditorView}from'@codemirror/view';
import css from'./builtin/workbench/style.css';import fonts from'./builtin/workbench/fonts/style.js';
const texts={'methods.ts':${JSON.stringify(text)},'caller.ts':${JSON.stringify('const entry = new Entry127();\nentry.execute(1);')}};
const style=document.createElement('style');style.textContent=fonts+css;document.head.append(style);
const api={fileOperation:async()=>({path:'/sample-project'}),list:async()=>({entries:Object.keys(texts).map(path=>({name:path,path,type:'file'})),truncated:false}),read:async path=>({path,text:texts[path],version:'v1'}),project:async()=>({files:Object.keys(texts),truncated:false}),models:async()=>[],fonts:async()=>[]};
const t=key=>zh[key]||key,c=createWorkbench(api,t),root=createRoot(document.getElementById('root'));
function Button({children,...props}){return <button type='button' {...props}>{children}</button>}
function Select(){return null}
c.layout.change({outlineOpen:false,panes:{conversation:false,quick:false,changes:false,learning:false}});
root.render(<Workbench workbench={c} Button={Button} Select={Select} Conversation={()=>null} sessionId='descriptions' t={t}/>);
window.test={c,texts,select:()=>{const view=c.view(),at=view.state.doc.toString().lastIndexOf('execute');view.dispatch({selection:{anchor:at},effects:EditorView.scrollIntoView(at,{y:'center'})});view.focus()},
theme:async(palette,dark)=>{document.body.toggleAttribute('data-ds-dark-theme',dark);await c.settings({...c.snapshot().preferences,palette})},dispose(){root.unmount();c.dispose()}};`;
const worker = await build({ entryPoints: [join(repo, 'builtin/workbench/analysis/worker.js')], bundle: true, write: false, format: 'iife', platform: 'browser' });
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text', '.woff2': 'dataurl' }, define: { __WORKBENCH_ANALYSIS_WORKER__: JSON.stringify(worker.outputFiles[0].text) } });
const server = createServer((req, res) => { res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? app.outputFiles[0].contents : '<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('同名方法的说明、参数与定义完整覆盖', async t => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }), errors = [];
    page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.test?.c.snapshot().indexed === 2 && !window.test.c.snapshot().indexing);
      await page.evaluate(() => window.test.c.visit({ file: 'caller.ts' })); await page.evaluate(() => document.fonts.ready);
      const hover = async () => {
        await page.mouse.move(5, 5); await page.evaluate(() => window.test.select());
        await page.waitForFunction(() => { const view=window.test.c.view(),at=view.state.doc.toString().lastIndexOf('execute')+2,box=view.coordsAtPos(at),root=view.scrollDOM.getBoundingClientRect();return box&&box.top>=root.top&&box.bottom<=root.bottom; });
        const point=await page.evaluate(()=>{const view=window.test.c.view(),box=view.coordsAtPos(view.state.doc.toString().lastIndexOf('execute')+2);return{x:box.left+1,y:(box.top+box.bottom)/2}});
        await page.mouse.move(point.x,point.y);await page.locator('.signature-tooltip .documentation-signature').first().waitFor();
      };
      await t.test('悬浮保留128个同名候选的完整签名、文档与顺序', async () => {
        await hover();
        assert.equal(await page.locator('.signature-tooltip .documentation-card').count(),128);
        assert.deepEqual(await page.locator('.signature-tooltip .documentation-signature').allTextContents(),Array(128).fill('execute(value: number): number'));
        assert.match(await page.locator('.signature-tooltip .documentation-card').first().textContent(),/执行任务 0。/);
        assert.match(await page.locator('.signature-tooltip .documentation-card').last().textContent(),/执行任务 127。/);
      });
      await t.test('参数提示保留全部候选及当前参数类型和文档', async () => {
        await page.mouse.move(5,5);await page.evaluate(()=>{const view=window.test.c.view();view.dispatch({selection:{anchor:view.state.doc.length-2}});view.focus()});
        await page.keyboard.press('Control+p');await page.locator('.parameter-tooltip .documentation-signature').nth(127).waitFor();
        assert.equal(await page.locator('.parameter-tooltip .documentation-card').count(),128);
        assert.equal(await page.locator('.parameter-tooltip .documentation-active-parameter').count(),128);
        assert.equal(await page.locator('.parameter-tooltip .documentation-active-parameter').last().textContent(),'value: number');
        assert.match(await page.locator('.parameter-tooltip .documentation-card').last().textContent(),/输入值 127/);
        await page.keyboard.press('Escape');
      });
      await t.test('同名定义列表可选择最后一项并跳到真实文件偏移', async () => {
        await page.evaluate(()=>window.test.select());await page.keyboard.press('Control+b');
        const list=page.locator('.sc-wb-location-list');await list.waitFor();await list.focus();await page.keyboard.press('End');
        await page.locator('.sc-wb-location-list [role=option][aria-posinset="128"]').waitFor();await page.keyboard.press('Enter');
        await page.waitForFunction(()=>window.test.c.snapshot().file==='methods.ts'&&window.test.c.view().state.selection.main.head===window.test.texts['methods.ts'].lastIndexOf('execute'));
        assert.equal(await page.evaluate(()=>window.test.c.view().state.doc.toString()),text);
        await page.evaluate(()=>window.test.c.visit({file:'caller.ts'}));
      });
      await t.test('IDEA明色与VS Code暗色保留候选数量和可滚动说明', async () => {
        for(const[palette,dark]of[['idea',false],['vscode',true]]){
          await page.evaluate(({palette,dark})=>window.test.theme(palette,dark),{palette,dark});await hover();
          assert.equal(await page.locator('.signature-tooltip .documentation-card').count(),128);
          const tooltip=page.locator('.signature-tooltip').locator('..'),rect=await tooltip.boundingBox();
          assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=1400&&rect.y+rect.height<=900);
          const overflow=await tooltip.evaluate(dom=>dom.scrollHeight>dom.clientHeight);assert.equal(overflow,true);
          if(process.env.SC_TEST_ARTIFACTS){await mkdir(process.env.SC_TEST_ARTIFACTS,{recursive:true});await page.screenshot({path:join(process.env.SC_TEST_ARTIFACTS,`descriptions-${palette}-${dark?'dark':'light'}.png`)});}
          await page.mouse.move(rect.x+rect.width-12,rect.y+80);await page.mouse.wheel(0,99999);
          await page.waitForFunction(()=>{const dom=document.querySelector('.signature-tooltip')?.parentElement;return dom&&dom.scrollTop>0&&dom.scrollTop+dom.clientHeight>=dom.scrollHeight-1});
          const last=await page.locator('.signature-tooltip .documentation-card').last().boundingBox();assert.ok(last.y>=rect.y&&last.y+last.height<=rect.y+rect.height);
        }
      });
      await t.test('源码更新后说明不返回旧类型，跨文件切换清理气泡', async () => {
        await page.mouse.move(5,5);await page.evaluate(async()=>{const text=window.test.texts['methods.ts'].replaceAll('number','string');window.test.texts['methods.ts']=text;await window.test.c.index.change('methods.ts',text)});await hover();
        assert.deepEqual(await page.locator('.signature-tooltip .documentation-signature').allTextContents(),Array(128).fill('execute(value: string): string'));
        await page.evaluate(()=>window.test.c.visit({file:'methods.ts'}));await page.locator('.signature-tooltip').waitFor({state:'detached'});
      });
      assert.deepEqual(errors,[]);
    } finally { await page.evaluate(()=>window.test?.dispose()).catch(()=>{}); await page.close(); }
  });
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
