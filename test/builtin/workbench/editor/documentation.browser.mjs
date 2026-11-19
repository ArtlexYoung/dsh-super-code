import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const source = [
  '/**',
  ' * 汇总任务，**保留原始列表**，并返回 `Summary`。',
  ' *',
  ' * - 忽略已完成的任务。',
  ' * - 按项目统计待处理数量。',
  ' *',
  ' * @param {Task[]} tasks 待处理的 **任务列表**。',
  ' * @returns {Summary} 统计结果与 `pending` 列表。',
  ' */',
  'export function summarize(tasks: Task[]): Summary {',
  '  return { count: tasks.length };',
  '}',
  '',
  ...Array.from({ length: 5 }, () => '// 阅读任务的输入和输出'),
  'const result = summarize([]);',
].join('\n');
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';
import{Workbench}from'./builtin/workbench/components/Workbench.jsx';import{createWorkbench}from'./builtin/workbench/controller.js';
import{zh}from'./builtin/workbench/locales.js';import css from'./builtin/workbench/style.css';import fonts from'./builtin/workbench/fonts/style.js';
import{EditorView}from'@codemirror/view';
const text=${JSON.stringify(source)},style=document.createElement('style');style.textContent=fonts+css;document.head.append(style);
const api={fileOperation:async()=>({path:'/sample-project'}),list:async()=>({entries:[{name:'tasks.ts',path:'tasks.ts',type:'file'}],truncated:false}),read:async path=>({path,text,version:'v1'}),project:async()=>({files:['tasks.ts'],truncated:false}),models:async()=>[],fonts:async()=>[]};
const t=k=>zh[k]||k,c=createWorkbench(api,t),root=createRoot(document.getElementById('root'));
const counts={fingerprints:0,analyses:0,descriptions:0},fingerprint=c.index.fingerprint.bind(c.index),analyze=c.index.analyzer,describe=c.index.describe.bind(c.index);
c.index.fingerprint=(...args)=>{counts.fingerprints++;return fingerprint(...args)};c.index.analyzer=(...args)=>{counts.analyses++;return analyze(...args)};c.index.describe=(...args)=>{counts.descriptions++;return describe(...args)};
function Button({children,...props}){return <button type='button' {...props}>{children}</button>}
function Select({label,value,choices,onChange}){return <select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{choices.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}
c.layout.change({outlineOpen:false,panes:{conversation:false,quick:false,changes:false,learning:false}});
root.render(<Workbench workbench={c} Button={Button} Select={Select} Conversation={()=>null} sessionId='documentation' t={t}/>);
window.test={c,text,counts,resetCounts:()=>Object.assign(counts,{fingerprints:0,analyses:0,descriptions:0}),scroll:position=>c.view().dispatch({effects:EditorView.scrollIntoView(position,{y:'center'})}),
theme:async(palette,dark)=>{document.body.toggleAttribute('data-ds-dark-theme',dark);await c.settings({...c.snapshot().preferences,palette})},
unsafe:async()=>{const text='/** **安全文档** [危险链接](javascript:alert(1)) <img src="/unexpected-image" onerror="alert(1)"> */\\nfunction unsafe() { return 1; }\\nunsafe();';const v=c.view();v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text}});await c.index.change('tasks.ts',text)},
long:async()=>{const text='/** 参数说明。\\n * @param tasksWithAnExtremelyLongNameThatMustNotOverflow 此参数用于验证窄窗口中的中文说明以及非常长的不可断开英文标识符。\\n */\\nfunction narrow(tasksWithAnExtremelyLongNameThatMustNotOverflow: string): string { return tasksWithAnExtremelyLongNameThatMustNotOverflow; }\\nnarrow("value");';const v=c.view();v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text}});await c.index.change('tasks.ts',text)},
dispose(){root.unmount();c.dispose()}};`;
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, platform: 'browser', format: 'esm', loader: { '.css': 'text', '.woff2': 'dataurl' } });
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(app.outputFiles[0].contents); }
  else { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('阅读中的文档与函数签名', async t => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [], requests = [];
    page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
    await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.test?.c.snapshot().indexed === 1);
    await page.evaluate(() => window.test.c.visit({ file: 'tasks.ts' })); await page.evaluate(() => document.fonts.ready);
    const hover = async word => {
      await page.mouse.move(10, 10);
      await page.evaluate(word => { const v=window.test.c.view();window.test.scroll(v.state.doc.toString().lastIndexOf(word)); }, word);
      await page.waitForFunction(word=>{const v=window.test.c.view(),box=v.scrollDOM.getBoundingClientRect(),at=v.state.doc.toString().lastIndexOf(word)+2,point=v.coordsAtPos(at);if(!point||point.top<box.top||point.bottom>box.bottom)return false;const mapped=v.posAtCoords({x:point.left+2,y:(point.top+point.bottom)/2});return Math.abs(mapped-at)<=1},word);
      const coords = await page.evaluate(word => {const v=window.test.c.view(),at=v.state.doc.toString().lastIndexOf(word),box=v.coordsAtPos(at+2);return{x:box.left+2,y:(box.top+box.bottom)/2}}, word);
      await page.mouse.move(coords.x, coords.y);
      try { await page.locator('.signature-tooltip').waitFor(); }
      catch(error) {
        t.diagnostic(JSON.stringify(await page.evaluate(({word,coords})=>{const v=window.test.c.view(),at=v.state.doc.toString().lastIndexOf(word)+2;return{word,coords,at,actual:v.posAtCoords(coords),selection:v.state.selection.toJSON(),viewport:v.viewport,scroll:v.scrollDOM.scrollTop,hit:document.elementFromPoint(coords.x,coords.y)?.outerHTML}}, {word,coords})));
        if(process.env.SC_TEST_ARTIFACTS)await page.screenshot({path:join(process.env.SC_TEST_ARTIFACTS,`hover-failure-${word}.png`)});
        throw error;
      }
    };
    const capture = async name => { if (process.env.SC_TEST_ARTIFACTS) { await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, name + '.png'), animations: 'disabled' }); } };
    await t.test('保留真实主题首屏和文档内容', async () => {
      for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
        await page.evaluate(({palette,dark})=>window.test.theme(palette,dark),{palette,dark}); await hover('summarize');
        await capture(`documentation-${palette}-${dark?'dark':'light'}`);
        assert.match(await page.locator('.signature-tooltip').textContent(), /任务列表/);
      }
    });
    await t.test('重复查看签名和跳转定义复用未修改源码，无 WebCrypto 时同样不重复解析', async () => {
      for (const cryptoAvailable of [true,false]) {
        if (!cryptoAvailable) await page.evaluate(()=>{
          window.test.cryptoDescriptor=Object.getOwnPropertyDescriptor(crypto,'subtle');
          Object.defineProperty(crypto,'subtle',{configurable:true,value:undefined});
          window.test.c.index.clear();
        });
        try {
          await page.evaluate(()=>window.test.c.index.change('tasks.ts',window.test.text));await hover('summarize');
          await page.evaluate(()=>window.test.resetCounts());
          for (let i=0;i<3;i++) {
            await page.mouse.move(10,10);await page.locator('.signature-tooltip').waitFor({state:'detached'});
            await hover('summarize');assert.match(await page.locator('.signature-tooltip').textContent(),/任务列表/);
            await page.evaluate(async()=>{const {c}=window.test,v=c.view();v.dispatch({selection:{anchor:v.state.doc.toString().lastIndexOf('summarize')+2}});await c.definition()});
            assert.equal(await page.evaluate(()=>window.test.c.view().state.selection.main.head),source.indexOf('summarize'));
          }
          const counts=await page.evaluate(()=>window.test.counts);
          assert.ok(counts.descriptions>=3,JSON.stringify(counts));
          assert.equal(counts.fingerprints,0,JSON.stringify({cryptoAvailable,counts}));
          assert.equal(counts.analyses,0,JSON.stringify({cryptoAvailable,counts}));
          assert.equal(await page.evaluate(()=>window.test.c.view().state.doc.toString()),source);
        } finally {
          if (!cryptoAvailable) await page.evaluate(()=>{
            const descriptor=window.test.cryptoDescriptor;
            if(descriptor)Object.defineProperty(crypto,'subtle',descriptor);else Reflect.deleteProperty(crypto,'subtle');
          });
        }
      }
    });
    await t.test('签名关键字、函数名与类型使用当前编辑器的颜色', async () => {
      for (const palette of ['idea','vscode']) for (const dark of [false,true]) {
        await page.evaluate(({palette,dark})=>window.test.theme(palette,dark),{palette,dark}); await hover('summarize');
        const colors = await page.locator('.signature-tooltip').evaluate(dom => {
          const find=word=>[...dom.querySelectorAll('.documentation-signature span')].find(n=>n.textContent===word);
          const probe=document.createElement('span');dom.append(probe);
          const expected=name=>{probe.style.color='var('+name+')';return getComputedStyle(probe).color};
          const result={keyword:getComputedStyle(find('function')).color,fn:getComputedStyle(find('summarize')).color,type:getComputedStyle(find('Task')).color,keywordExpected:expected('--wb-keyword'),functionExpected:expected('--wb-function'),typeExpected:expected('--wb-type')};probe.remove();return result;
        });
        assert.equal(colors.keyword,colors.keywordExpected);assert.equal(colors.fn,colors.functionExpected);assert.equal(colors.type,colors.typeExpected);
      }
    });
    await t.test('说明、参数、返回值支持可读的段落、列表和行内代码', async () => {
      await hover('summarize'); const card=page.locator('.signature-tooltip .documentation-card');
      assert.equal(await card.locator('.documentation-description strong').textContent(), '保留原始列表');
      assert.equal(await card.locator('.documentation-description li').count(), 2);
      assert.equal(await card.locator('.documentation-description code').textContent(), 'Summary');
      assert.equal(await card.locator('dd strong').textContent(), '任务列表');
      assert.equal(await card.locator('.documentation-return code').last().textContent(), 'pending');
      assert.equal(await page.evaluate(()=>window.test.c.view().state.doc.toString()), source);
    });
    await t.test('气泡随代码字体字号变化，窄窗长参数不撑宽', async () => {
      await page.evaluate(()=>window.test.c.settings({...window.test.c.snapshot().preferences,fontSize:18,readerMode:true,fontFamily:'menlo'})); await hover('summarize');
      const font=await page.evaluate(()=>({editor:getComputedStyle(window.test.c.view().dom).fontSize,tooltip:getComputedStyle(document.querySelector('.signature-tooltip')).fontSize,signature:getComputedStyle(document.querySelector('.documentation-signature')).fontFamily}));
      assert.equal(font.tooltip,font.editor);assert.match(font.signature,/Menlo/);
      await page.setViewportSize({width:480,height:750});await page.evaluate(()=>window.test.long());await hover('narrow');
      const box=await page.locator('.cm-tooltip-hover').evaluate(n=>({left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right,scroll:n.scrollWidth,width:n.clientWidth}));
      assert.ok(box.left>=0&&box.right<=480,JSON.stringify(box));assert.ok(box.scroll<=box.width+1,JSON.stringify(box));await capture('documentation-narrow');
      await page.setViewportSize({width:1440,height:900});
    });
    await t.test('文档不加载图片、不执行HTML和危险链接', async () => {
      await page.evaluate(()=>window.test.unsafe());await hover('unsafe');const card=page.locator('.signature-tooltip .documentation-card');
      assert.equal(await card.locator('img,svg,script,iframe').count(),0);assert.equal(await card.locator('a[href^="javascript:"]').count(),0);
      assert.equal(requests.some(url=>url.includes('unexpected-image')),false);assert.match(await card.textContent(),/安全文档/);
    });
    await t.test('普通注释不触发签名，选区和修改后不残留旧气泡', async () => {
      await page.mouse.move(10,10);
      await page.evaluate(()=>{const v=window.test.c.view();v.dispatch({changes:{from:0,to:v.state.doc.length,insert:window.test.text}});});
      const point=await page.evaluate(()=>{const v=window.test.c.view(),at=v.state.doc.toString().indexOf('汇总任务'),box=v.coordsAtPos(at+1);return{x:box.left+2,y:(box.top+box.bottom)/2}});
      await page.mouse.move(point.x,point.y);await page.waitForTimeout(300);assert.equal(await page.locator('.signature-tooltip').count(),0);
      await hover('summarize');
      await page.evaluate(()=>{const v=window.test.c.view(),from=v.state.doc.toString().lastIndexOf('summarize');v.dispatch({selection:{anchor:from,head:from+9}})});
      await page.locator('.signature-tooltip').waitFor({state:'detached'});
      assert.equal(await page.evaluate(()=>{const v=window.test.c.view(),r=v.state.selection.main;return v.state.doc.sliceString(r.from,r.to)}),'summarize');
      await page.evaluate(()=>{const v=window.test.c.view();v.dispatch({selection:{anchor:0}})});await hover('summarize');
      await page.evaluate(()=>{const v=window.test.c.view();v.dispatch({changes:{from:0,insert:'// 已更新\n'}})});
      await page.locator('.signature-tooltip').waitFor({state:'detached'});await page.evaluate(()=>window.test.c.undo());
      assert.equal(await page.evaluate(()=>window.test.c.view().state.doc.toString()),source);
    });
    await page.evaluate(()=>window.test.dispose());await page.close();assert.deepEqual(errors,[]);
  });
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
