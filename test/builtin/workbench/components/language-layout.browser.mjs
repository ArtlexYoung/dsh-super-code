import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
const fixture=`import React from'react';import{createRoot}from'react-dom/client';import{SafeMarkdown}from'./builtin/workbench/windows/markdown.jsx';import{Locations}from'./builtin/workbench/components/PanelContent.jsx';import{zh}from'./builtin/workbench/locales.js';import css from'./builtin/workbench/style.css';
const style=document.createElement('style');style.textContent=css;document.head.append(style);
const snapshot={panel:{id:'none',kind:'locations'}},workbench={subscribe:()=>()=>{},snapshot:()=>snapshot},t=k=>zh[k]||k;
const Button=({children,...p})=><button {...p}>{children}</button>;
const source=['# 文档','', '\\x60\\x60\\x60typescript','const amount: number = 42;','console.log("demo");','\\x60\\x60\\x60','', '\\x60\\x60\\x60yaml','# settings','name: "demo"','count: 42','\\x60\\x60\\x60','', '\\x60\\x60\\x60toml','[project]','name = "demo"','count = 42','\\x60\\x60\\x60','', '\\x60\\x60\\x60unknown','<script>window.bad=true</script>','\\x60\\x60\\x60','<img src=x onerror="window.bad=true">'].join('\\n');
window.render=(palette,dark)=>{document.body.toggleAttribute('data-ds-dark-theme',dark);root.render(<main className='sc-workbench' data-palette={palette} style={{height:'100vh',display:'grid',gridTemplateColumns:'minmax(0,1fr) 280px',gridTemplateRows:'minmax(0,1fr) 220px'}}><section className='sc-wb-markdown'><SafeMarkdown text={source}/></section><section className='sc-wb-conversation'><div className='dsh-super-code-detail-log'><div className='dsh-super-code-detail-message'><div className='dsh-super-code-detail-content'><p>{'very-long-unbroken-name'.repeat(10)}</p><pre style={{whiteSpace:'pre'}}><code style={{whiteSpace:'pre'}}>{'  const value = "'+ 'a'.repeat(240)+'";\\n    next(value);'}</code></pre></div></div></div></section><section className='sc-wb-dialog-body' style={{gridColumn:'1 / -1'}}><Locations data={{id:'none',kind:'locations',matches:[]}} search={false} workbench={workbench} Button={Button} t={t}/></section></main>)};
const root=createRoot(document.getElementById('root'));window.render('idea',false);`;
const baseline=process.env.SC_TEST_BASELINE;
const files=['builtin/workbench/windows/markdown.jsx','builtin/workbench/editor/languages.js','builtin/workbench/components/PanelContent.jsx','builtin/workbench/style.css'];
const app=await build({absWorkingDir:repo,stdin:{contents:fixture,resolveDir:repo,loader:'jsx'},bundle:true,write:false,format:'esm',loader:{'.css':'text','.woff2':'dataurl'},plugins:baseline?[{name:'baseline-source',setup(build){build.onLoad({filter:/\.(?:jsx?|css)$/},async args=>{const path=files.find(path=>join(repo,path)===args.path);if(path)return{contents:await readFile(join(baseline,path),'utf8'),loader:path.endsWith('.css')?'text':'jsx'}})}}]:[]});
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?app.outputFiles[0].contents:'<!doctype html><meta charset=utf-8><style>html,body,#root{height:100%;margin:0}</style><div id=root></div><script type=module src=/app.js></script>')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await(process.env.SC_TEST_BROWSER==='webkit'?webkit:chromium).launch({headless:true});
try{
 await test('Markdown语法配色、对话折行和定义空结果布局',{timeout:60000},async t=>{
  const page=await browser.newPage({viewport:{width:1100,height:850},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.sc-wb-locations').waitFor();
  for(const palette of ['idea','vscode'])for(const dark of [false,true])await t.test(palette+(dark?'暗色':'亮色'),async tt=>{
   await page.evaluate(({palette,dark})=>window.render(palette,dark),{palette,dark});
   await tt.test('已标记语言的代码块着色，未知语言及HTML保持文本安全',async()=>{
    await page.waitForFunction(()=>[...document.querySelectorAll('.sc-wb-markdown pre code')].slice(0,3).every(node=>node.querySelector('span[class*="tok-"]')),{},{timeout:2500});
    const values=await page.locator('.sc-wb-markdown pre code').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,colors:[...new Set([...node.querySelectorAll('span')].map(s=>getComputedStyle(s).color))]})));
    assert.equal(values.length,4);assert.ok(values.slice(0,3).every(v=>v.colors.length>=2),JSON.stringify(values));assert.match(values[3].text,/<script>/);assert.equal(await page.evaluate(()=>window.bad),undefined);
   });
   await tt.test('侧栏代码段保留缩进且长行不产生横向滚动',async()=>{
    const box=await page.locator('.sc-wb-conversation pre code').evaluate(n=>({whiteSpace:getComputedStyle(n).whiteSpace,overflowWrap:getComputedStyle(n).overflowWrap,text:n.textContent,width:n.clientWidth,scroll:n.scrollWidth,preWidth:n.parentElement.clientWidth,preScroll:n.parentElement.scrollWidth}));
    assert.equal(box.whiteSpace,'pre-wrap');assert.equal(box.overflowWrap,'anywhere');assert.ok(box.preScroll<=box.preWidth+1,JSON.stringify(box));assert.ok(box.text.startsWith('  const'));
   });
   await tt.test('没有找到结果位于结果区域中心，不挤在页脚',async()=>{
    assert.equal(await page.locator('.sc-wb-location-empty').count(),1);const list=await page.locator('.sc-wb-location-list').boundingBox(),empty=await page.locator('.sc-wb-location-empty').boundingBox();assert.ok(list&&empty);assert.ok(Math.abs(empty.y+empty.height/2-(list.y+list.height/2))<4,JSON.stringify({list,empty}));assert.ok(Math.abs(empty.x+empty.width/2-(list.x+list.width/2))<4,JSON.stringify({list,empty}));
   });
   if(process.env.SC_TEST_ARTIFACTS){await mkdir(process.env.SC_TEST_ARTIFACTS,{recursive:true});await page.screenshot({path:join(process.env.SC_TEST_ARTIFACTS,palette+(dark?'-dark':'-light')+'.png')})}
  });await page.close();assert.deepEqual(errors,[]);
 });
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
