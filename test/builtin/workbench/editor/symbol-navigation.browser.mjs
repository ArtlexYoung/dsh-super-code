import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = `import React from'react';import{createRoot}from'react-dom/client';
import{Workbench}from'./builtin/workbench/components/Workbench.jsx';import{createWorkbench}from'./builtin/workbench/controller.js';
import{zh}from'./builtin/workbench/locales.js';import css from'./builtin/workbench/style.css';
const style=document.createElement('style');style.textContent=css;document.head.append(style);
const texts={
'main.ts':"import {run as execute} from './right';\\nfunction outer(input: string) {\\n return execute(input);\\n}\\nduplicate();\\n",
'right.ts':"/** 正确模块。\\n * @param value 数量。\\n */\\nexport function run(value: number) {return value}\\n/** 第一实现的说明。 */\\nexport function duplicate() {return 1}",
'wrong.ts':"/** 其他模块。 */\\nexport function run(value: string) {return value}\\n/** 第二实现的说明。 */\\nexport function duplicate() {return 2}"
};
let gate,release,searchCalls=0;const api={fileOperation:async()=>({path:'/demo'}),list:async()=>({entries:Object.keys(texts).map(path=>({path,name:path,type:'file'})),truncated:false}),project:async()=>({files:Object.keys(texts),truncated:false}),read:async path=>({path,text:texts[path],version:'v1'}),models:async()=>[],fonts:async()=>[],
async *searchProject(query,signal){searchCalls++;yield{kind:'matches',path:'first.ts',version:'v1',matches:Array.from({length:256},(_,line)=>({line,character:0,length:5,lineText:'large source'}))};await gate;signal.throwIfAborted();for(let part=1;part<400;part++){signal.throwIfAborted();yield{kind:'matches',path:'file-'+part+'.ts',version:'v1',matches:Array.from({length:256},(_,line)=>({line,character:0,length:5,lineText:'large source'}))}}yield{kind:'done',scanned:400,skipped:0}}};
const c=createWorkbench(api,k=>zh[k]||k),root=createRoot(document.getElementById('root'));
function Button({children,...props}){return <button type='button' {...props}>{children}</button>}
c.layout.change({explorerOpen:false,panes:{conversation:false,quick:false,changes:false,learning:false}});
root.render(<Workbench workbench={c} Button={Button} Select={()=>null} Conversation={()=>null} sessionId='demo' t={k=>zh[k]||k}/>);
window.test={c,texts,searchCalls:()=>searchCalls,hold(){gate=new Promise(resolve=>{release=resolve})},release(){release();gate=null},
select(word,last=true){const view=c.view(),text=view.state.doc.toString(),at=last?text.lastIndexOf(word):text.indexOf(word);view.dispatch({selection:{anchor:at},userEvent:'select.pointer'});return view.coordsAtPos(at+1)},
theme:async(palette,dark=false)=>{document.body.toggleAttribute('data-ds-dark-theme',dark);await c.settings({...c.snapshot().preferences,palette})},dispose(){release?.();root.unmount();c.dispose()}};`;
const baseline = process.env.SC_TEST_BASELINE;
const overrides = baseline ? [{ name: 'before', setup(builder) {
  builder.onLoad({ filter: /builtin\/workbench\/(?:components\/PanelContent\.jsx|controller\.js)$/ }, async ({path}) => {
    const relative = path.slice(repo.length); return { contents: await readFile(join(baseline, relative),'utf8'), loader: path.endsWith('jsx')?'jsx':'js', resolveDir: path.slice(0,path.lastIndexOf('/')) };
  });
} }] : [];
const worker = await build({ entryPoints:[join(repo,'builtin/workbench/analysis/worker.js')],bundle:true,write:false,platform:'browser',format:'iife' });
const app = await build({ stdin:{contents:fixture,loader:'jsx',resolveDir:repo},bundle:true,write:false,platform:'browser',format:'esm',loader:{'.css':'text'},plugins:overrides,define:{__WORKBENCH_ANALYSIS_WORKER__:JSON.stringify(worker.outputFiles[0].text)} });
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?app.outputFiles[0].contents:'<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await(process.env.SC_TEST_BROWSER==='webkit'?webkit:chromium).launch({headless:true});
const evidence=process.env.SC_TEST_ARTIFACTS;
try {
  await test('位置导航、绑定解析、紧凑候选与流式搜索', {timeout:90000}, async t=>{
    let page,errors;
    t.beforeEach(async()=>{page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(4000);errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.test?.c.snapshot().indexed===3);await page.evaluate(()=>window.test.c.visit({file:'main.ts'}))});
    t.afterEach(async()=>{await page.evaluate(()=>window.test.dispose());await page.close();assert.deepEqual(errors,[])});
    await t.test('鼠标侧键返回同文件上一个光标位置，前进恢复并在新位置截断旧历史',async()=>{
      await page.evaluate(()=>{window.test.select('execute(input)');window.test.select('duplicate')});
      await page.locator('.sc-wb-main').dispatchEvent('pointerdown',{button:3});
      await page.waitForFunction(()=>window.test.c.view().state.selection.main.head===window.test.texts['main.ts'].indexOf('execute(input)'));
      assert.equal(await page.evaluate(()=>window.test.c.snapshot().file),'main.ts');
      await page.locator('.sc-wb-main').dispatchEvent('pointerdown',{button:4});
      await page.waitForFunction(()=>window.test.c.view().state.selection.main.head===window.test.texts['main.ts'].indexOf('duplicate'));
      await page.locator('.sc-wb-main').dispatchEvent('pointerdown',{button:3});
      await page.evaluate(()=>window.test.select('outer'));
      assert.equal(await page.evaluate(()=>window.test.c.snapshot().forward),false);
    });
    for(const palette of ['idea','vscode'])for(const dark of [false,true])await t.test(palette+(dark?' dark':' light')+'：参数和已导入函数不展示无关候选，多候选默认紧凑并可展开文档',async()=>{
      await page.evaluate(({palette,dark})=>window.test.theme(palette,dark),{palette,dark});
      let coords=await page.evaluate(()=>window.test.select('input)'));
      await page.mouse.move(coords.left,coords.top+6);await page.locator('.signature-tooltip').waitFor();
      assert.match(await page.locator('.signature-tooltip').textContent(),/input: string/);
      assert.doesNotMatch(await page.locator('.signature-tooltip').textContent(),/同名候选/);
      await page.mouse.move(2,2);await page.locator('.signature-tooltip').waitFor({state:'detached'});
      coords=await page.evaluate(()=>window.test.select('execute(input)'));
      await page.mouse.move(coords.left,coords.top+6);await page.locator('.signature-tooltip').waitFor();
      assert.match(await page.locator('.signature-tooltip').textContent(),/正确模块/);
      assert.doesNotMatch(await page.locator('.signature-tooltip').textContent(),/其他模块|同名候选/);
      await page.mouse.move(2,2);await page.locator('.signature-tooltip').waitFor({state:'detached'});
      coords=await page.evaluate(()=>window.test.select('duplicate'));
      await page.mouse.move(coords.left,coords.top+6);const candidates=page.locator('.documentation-options');await candidates.waitFor();
      assert.equal(await candidates.locator('details').count(),2);
      const signatures=await candidates.locator('summary pre').evaluateAll(nodes=>nodes.map(node=>({width:node.clientWidth,content:node.scrollWidth})));
      assert.ok(signatures.every(item=>item.width>=item.content),JSON.stringify(signatures));
      const heights=await candidates.locator('details').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
      assert.ok(heights.every(height=>height<74),JSON.stringify(heights));
      await candidates.locator('summary').first().click();assert.equal(await candidates.locator('details[open]').count(),1);
      if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:join(evidence,palette+(dark?'-dark':'-light')+'-candidates.png')})}
    });
    await t.test('窄窗口和页面缩放后候选气泡仍在视口内，展开能完整阅读长签名',async()=>{
      await page.setViewportSize({width:520,height:650});
      await page.evaluate(async()=>{
        document.body.style.zoom='1.25';
        const text='export function duplicate(longParameterName: Record<string, readonly number[]>, additionalSettings: Readonly<{enabled: boolean; retries: number}>): Promise<void> {}';
        await window.test.c.index.change('right.ts',text);
      });
      const coords=await page.evaluate(()=>window.test.select('duplicate'));
      await page.mouse.move(coords.left,coords.top+6);
      const candidates=page.locator('.documentation-options');await candidates.waitFor();
      await candidates.locator('summary').first().click();
      const box=await candidates.boundingBox();
      assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=521&&box.y+box.height<=651,JSON.stringify(box));
      const signature=candidates.locator('details[open] pre').first();
      assert.match(await signature.textContent(),/additionalSettings/);
      assert.ok(await signature.evaluate(node=>node.scrollWidth<=node.clientWidth+1));
    });
    await t.test('从函数候选点击目标后关闭弹窗，定位到目标源码',async()=>{
      await page.evaluate(async()=>{window.test.select('duplicate');await window.test.c.definition()});
      await page.locator('.sc-wb-results button').first().click();
      await page.waitForFunction(()=>window.test.c.snapshot().panel===null);
      assert.equal(await page.evaluate(()=>window.test.c.snapshot().file),'right.ts');
    });
    await t.test('整库扫描未完成就可查看和定位首批结果，十万结果保持虚拟列表',async()=>{
      await page.evaluate(()=>{window.test.hold();window.test.c.panel({kind:'search'})});
      const start=performance.now();await page.getByRole('combobox',{name:'全局搜索',exact:true}).fill('large');
      await page.locator('.sc-wb-results button').first().waitFor();
      const firstMs=performance.now()-start;
      assert.equal(await page.locator('.sc-wb-location-list').getAttribute('aria-busy'),'true');
      assert.equal(await page.evaluate(()=>window.test.searchCalls()),1);
      const finish=performance.now();await page.evaluate(()=>window.test.release());
      await page.waitForFunction(()=>document.querySelector('.sc-wb-locations footer')?.textContent.startsWith('102400'));
      const totalMs=performance.now()-finish;
      assert.ok(await page.locator('.sc-wb-results button').count()<60);
      await page.locator('.sc-wb-location-list').focus();await page.keyboard.press('End');
      await page.locator('.sc-wb-results [aria-posinset="102400"]').waitFor();
      assert.equal(await page.locator('.sc-wb-results [aria-selected=true]').getAttribute('title'),'file-399.ts:256');
      if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'search-'+(process.env.SC_TEST_BROWSER||'chromium')+'.json'),JSON.stringify({firstMs,totalMs,count:102400,rendered:await page.locator('.sc-wb-results button').count()},null,2))}
    });
  });
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
