import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const text = Array.from({ length: 1000 }, (_, i) => `export const item${String(i).padStart(5, '0')}: number = ${i};`).join('')
  + 'const normalize = (value: number): number => { return value; };\nitem00999;\nnormalize(1);';
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';
import{Workbench}from'./builtin/workbench/components/Workbench.jsx';import{createWorkbench}from'./builtin/workbench/controller.js';
import{zh}from'./builtin/workbench/locales.js';import{EditorView}from'@codemirror/view';
import css from'./builtin/workbench/style.css';import fonts from'./builtin/workbench/fonts/style.js';
const texts={'dense.ts':${JSON.stringify(text)},'other.ts':'export function other() { return 1; }'};
const style=document.createElement('style');style.textContent=fonts+css;document.head.append(style);
const api={fileOperation:async()=>({path:'/sample-project'}),list:async()=>({entries:Object.keys(texts).map(path=>({name:path,path,type:'file'})),truncated:false}),read:async path=>({path,text:texts[path],version:'v1'}),project:async()=>({files:Object.keys(texts),truncated:false}),models:async()=>[],fonts:async()=>[]};
const t=key=>zh[key]||key,c=createWorkbench(api,t),root=createRoot(document.getElementById('root'));
function Button({children,...props}){return <button type='button' {...props}>{children}</button>}
function Select(){return null}
c.layout.change({outlineOpen:false,panes:{conversation:false,quick:false,changes:false,learning:false}});
root.render(<Workbench workbench={c} Button={Button} Select={Select} Conversation={()=>null} sessionId='signatures' t={t}/>);
window.test={c,texts,select:word=>{const view=c.view(),at=view.state.doc.toString().lastIndexOf(word);view.dispatch({selection:{anchor:at},effects:EditorView.scrollIntoView(at,{x:'start',y:'center'})});view.focus()},
theme:async(palette,dark)=>{document.body.toggleAttribute('data-ds-dark-theme',dark);await c.settings({...c.snapshot().preferences,palette})},dispose(){root.unmount();c.dispose()}};`;
const worker = await build({ entryPoints: [join(repo, 'builtin/workbench/analysis/worker.js')], bundle: true, write: false, format: 'iife', platform: 'browser' });
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text', '.woff2': 'dataurl' }, define: { __WORKBENCH_ANALYSIS_WORKER__: JSON.stringify(worker.outputFiles[0].text) } });
const server = createServer((req, res) => { res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? app.outputFiles[0].contents : '<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('单行密集声明的源码说明与导航', async t => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }), errors = [];
    page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.test?.c.snapshot().indexed === 2 && !window.test.c.snapshot().indexing);
      await page.evaluate(() => window.test.c.visit({ file: 'dense.ts' })); await page.evaluate(() => document.fonts.ready);
      const hover = async word => {
        await page.mouse.move(5, 5); await page.evaluate(word => window.test.select(word), word);
        await page.waitForFunction(word => { const view=window.test.c.view(),at=view.state.doc.toString().lastIndexOf(word)+2,box=view.coordsAtPos(at),root=view.scrollDOM.getBoundingClientRect();return box&&box.top>=root.top&&box.bottom<=root.bottom&&box.left>=root.left&&box.right<=root.right; }, word);
        const at=await page.evaluate(word=>{const view=window.test.c.view(),box=view.coordsAtPos(view.state.doc.toString().lastIndexOf(word)+2);return{x:box.left+1,y:(box.top+box.bottom)/2}},word);
        await page.mouse.move(at.x,at.y); await page.locator('.signature-tooltip .documentation-signature').waitFor();
      };
      await t.test('末尾变量说明只显示本声明和类型，实际索引仍覆盖所有声明', async () => {
        await hover('item00999');
        assert.equal(await page.locator('.signature-tooltip .documentation-signature').textContent(), 'const item00999: number = 999');
        const result=await page.evaluate(async()=>{const index=window.test.c.index,items=index.declarations('dense.ts'),details=await index.describe(items);return{count:items.length,characters:details.reduce((sum,item)=>sum+item.declaration.length,0)}});
        assert.equal(result.count,1001);assert.ok(result.characters<40000);
      });
      await t.test('箭头函数说明和参数提示不带入前面的一千个声明', async () => {
        await hover('normalize');
        assert.equal(await page.locator('.signature-tooltip .documentation-signature').textContent(),'const normalize = (value: number): number =>');
        await page.mouse.move(5,5);
        await page.evaluate(()=>{const view=window.test.c.view();view.dispatch({selection:{anchor:view.state.doc.length-2}});view.focus()});
        await page.keyboard.press('Control+p');
        await page.locator('.parameter-tooltip').waitFor();
        assert.match(await page.locator('.parameter-tooltip').textContent(),/value: number/);
        assert.doesNotMatch(await page.locator('.parameter-tooltip').textContent(),/item00000/);
        await page.keyboard.press('Escape');
      });
      await t.test('签名范围缩小后定义位置与跨文件切换仍保持', async () => {
        await page.evaluate(()=>window.test.select('item00999'));
        await page.keyboard.press('Control+b');
        await page.waitForFunction(()=>window.test.c.view().state.selection.main.head===window.test.texts['dense.ts'].indexOf('item00999'));
        assert.equal(await page.evaluate(()=>window.test.c.view().state.doc.toString()),text);
        await page.evaluate(()=>window.test.c.visit({file:'other.ts'}));
        await page.locator('.signature-tooltip').waitFor({state:'detached'});
        assert.equal(await page.evaluate(()=>window.test.c.view().state.doc.toString()),'export function other() { return 1; }');
        await page.evaluate(()=>window.test.c.visit({file:'dense.ts'}));
      });
      await t.test('IDEA明色与VS Code暗色的紧凑签名均可完整阅读', async () => {
        for(const[palette,dark]of[['idea',false],['vscode',true]]){
          await page.evaluate(({palette,dark})=>window.test.theme(palette,dark),{palette,dark});await hover('item00999');
          const signature=page.locator('.signature-tooltip .documentation-signature');
          assert.equal(await signature.textContent(),'const item00999: number = 999');
          const box=await signature.boundingBox();assert.ok(box.width<600&&box.height<80);
          if(process.env.SC_TEST_ARTIFACTS){await mkdir(process.env.SC_TEST_ARTIFACTS,{recursive:true});await page.screenshot({path:join(process.env.SC_TEST_ARTIFACTS,`signature-${palette}-${dark?'dark':'light'}.png`)});}
        }
      });
      assert.deepEqual(errors,[]);
    } finally { await page.evaluate(()=>window.test?.dispose()).catch(()=>{}); await page.close(); }
  });
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
