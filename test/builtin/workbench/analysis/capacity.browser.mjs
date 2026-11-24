import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';
import {Workbench} from './builtin/workbench/components/Workbench.jsx';
import {createWorkbench} from './builtin/workbench/controller.js';
import {currentCompletions,completionStatus} from '@codemirror/autocomplete';
import {locationBatches} from './src/workbench/search-query.ts';
import {zh} from './builtin/workbench/locales.js';import stylesheet from './builtin/workbench/style.css';
const style=document.createElement('style');style.textContent=stylesheet;document.head.append(style);
const count=2205,files=Array.from({length:count},(_,i)=>'source-'+i+'.ts');let hold=false,waiting=[],reads=0,folder=false;
function source(path){if(path==='empty.ts')return '';if(path==='dense.ts')return Array.from({length:10000},(_,i)=>'export const value'+String(i).padStart(5,'0')+' = '+i+';').join('\\n')+'\\nval';if(path==='nested/inside.ts')return 'export function inside() {}';const i=files.indexOf(path);return '// '+'.'.repeat(8500)+'\\n'+(i===0?'/** 计算合计。\\n * @param value 输入金额\\n */\\n':'')+'export function compute'+i+'(value: number): number { return value + '+i+'; }\\n'+(i===count-1?'compute0(1); // unique last target\\n':'');}
const api={list:async path=>({entries:path==='nested'?[{name:'inside.ts',path:'nested/inside.ts',type:'file'}]:[...(folder?[{name:'nested',path:'nested',type:'directory'}]:[]),...files.map(path=>({name:path,path,type:'file'}))],truncated:false}),project:async()=>({files,truncated:false}),
 async read(path,signal){reads++;signal?.throwIfAborted();if(hold)await new Promise(resolve=>waiting.push(resolve));signal?.throwIfAborted();return {path,text:source(path),version:'demo'}},
 async *searchProject(query,signal){for(const path of files){const file=await api.read(path,signal);if(query.buffers?.includes(path))yield{kind:'matches',path,version:file.version,matches:[]};else for(const matches of locationBatches(file.text,query.search,query.caseSensitive)){signal.throwIfAborted();yield{kind:'matches',path,version:file.version,matches}}}yield{kind:'done',scanned:files.length,skipped:0}},
 fileOperation:async input=>({path:'/demo'}),models:async()=>[],git:async()=>({kind:'state',state:{exists:false,backend:'native',version:'demo',changes:[],history:[],branches:[],remotes:[]},sources:[]})};
const controller=createWorkbench(api,key=>zh[key]||key),root=createRoot(document.getElementById('root'));
function Button({children,...props}){return <button {...props}>{children}</button>}
function Select(){return null}function Conversation(){return <div/>}
root.render(<Workbench workbench={controller} Button={Button} Select={Select} Conversation={Conversation} MarkdownText={({text})=><p>{text}</p>} sessionId='demo' fileContext={()=>({cwd:'/demo'})} t={key=>zh[key]||key}/>);
window.test={controller,count,completions:()=>currentCompletions(controller.view().state),completionStatus:()=>completionStatus(controller.view().state),addFolder:async()=>{folder=true;await controller.list('')},reads:()=>reads,hold:value=>{hold=value},release:()=>{for(const resolve of waiting.splice(0))resolve()},pending:()=>waiting.length,visit:path=>controller.visit({file:path}),dispose:()=>{root.unmount();controller.dispose()}};`;
const worker = await build({ entryPoints: [join(repo, 'builtin/workbench/analysis/worker.js')], bundle: true, write: false, format: 'iife', platform: 'browser' });
const built = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text' }, define: { __WORKBENCH_ANALYSIS_WORKER__: JSON.stringify(worker.outputFiles[0].text) } });
const server = createServer((req, res) => { res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? built.outputFiles[0].contents : '<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('大项目完整索引与按需查询真实浏览器交互', { timeout: 120000 }, async t => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const failure = new Promise((_resolve, reject) => page.once('pageerror', reject));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await Promise.race([failure, page.waitForFunction(() => window.test?.controller.snapshot().indexed === window.test.count && !window.test.controller.snapshot().indexing, null, { timeout: 90000 })]);
      await t.test('超过2000项的目录只渲染可见行，滚动到末尾仍可打开文件', async () => {
        assert.ok(await page.locator('.sc-wb-file-tree button').count()<60);
        await page.locator('.sc-wb-file-tree').evaluate(element=>{element.scrollTop=element.scrollHeight});
        const last=page.locator('.sc-wb-file-tree button[title="source-2204.ts"]');await last.waitFor();await last.click();
        assert.equal(await page.evaluate(()=>window.test.controller.snapshot().file),'source-2204.ts');
      });
      await t.test('超过文件数和文本预算后完整保留定义，缓存释放后仍有签名与文档', async () => {
        const result = await page.evaluate(async () => {
          const index = window.test.controller.index, items = index.candidates('source-2204.ts', 'compute0'), details = await index.describe(items);
          return { indexed: index.files.size, cache: index.cacheSize, sourceStored: typeof index.files.get('source-0.ts').text, signature: details[0].declaration, doc: details[0].documentation.description };
        });
        assert.equal(result.indexed, 2205); assert.ok(result.cache <= 16 * 1024 * 1024); assert.equal(result.sourceStored, 'undefined');
        assert.match(result.signature, /value: number/); assert.match(result.doc, /计算合计/);
        await page.evaluate(() => window.test.visit('source-0.ts'));
        const at=await page.evaluate(()=>{const view=window.test.controller.view();return view.coordsAtPos(view.state.doc.toString().indexOf('compute0')+3)});
        await page.mouse.move(at.left,at.top+5);
        await page.locator('.signature-tooltip').filter({hasText:'计算合计'}).waitFor();
        await page.mouse.move(5,5);
        await page.evaluate(() => window.test.visit('source-2204.ts'));
        await page.waitForFunction(() => window.test.controller.snapshot().symbols.every(symbol => symbol.file === 'source-2204.ts'));
        await page.locator('.sc-wb-outline button').first().click();
        assert.equal(await page.evaluate(() => window.test.controller.snapshot().file), 'source-2204.ts');
      });
      await t.test('全局搜索覆盖末尾文件，结果使用虚拟滚动且可打开原代码', async () => {
        await page.evaluate(() => window.test.controller.panel({kind:'search'}));
        const input=page.getByRole('combobox', {name:'全局搜索',exact:true});await input.fill('unique last target');
        const match=page.locator('.sc-wb-results button').filter({hasText:'source-2204.ts'});await match.waitFor();await match.click();
        assert.equal(await page.evaluate(() => window.test.controller.snapshot().file), 'source-2204.ts');
        if(process.env.SC_TEST_ARTIFACTS){await mkdir(process.env.SC_TEST_ARTIFACTS,{recursive:true});await page.screenshot({path:join(process.env.SC_TEST_ARTIFACTS,`${process.env.SC_TEST_BROWSER||'chromium'}-capacity.png`)});}
      });
      await t.test('大量匹配只渲染可见行，全部2205处都可定位且不再截断到500项', async () => {
        await page.getByRole('combobox',{name:'全局搜索',exact:true}).fill('export function');
        await page.getByRole('status').filter({hasText:/^2205 项匹配$/}).waitFor();
        assert.equal(await page.getByText('仅显示前 500 项结果，请缩小搜索范围',{exact:true}).count(),0);
        assert.ok(await page.locator('.sc-wb-results button').count()<60);
        await page.locator('.sc-wb-results').evaluate(element=>{element.scrollTop=element.scrollHeight});
        const last=page.locator('.sc-wb-results button').filter({hasText:'source-2204.ts'});await last.waitFor();await last.click();
        assert.equal(await page.evaluate(()=>window.test.controller.snapshot().file),'source-2204.ts');
        assert.equal(await page.evaluate(()=>window.test.controller.index.files.size),2205);
      });
      await t.test('慢搜索关闭及晚到返回不复活界面，重新搜索仍可使用', async () => {
        await page.evaluate(() => {window.test.controller.index.cacheBytes=0;for(const key of [...window.test.controller.index.cache.keys()])window.test.controller.index.forget(key);window.test.hold(true);});
        // 已打开文件优先使用共享缓冲，慢读取场景必须查询尚未打开的文件。
        await page.getByRole('combobox',{name:'全局搜索',exact:true}).fill('compute1001');
        await page.waitForFunction(()=>window.test.pending()>0);
        await page.keyboard.press('Escape');await page.evaluate(()=>{window.test.hold(false);window.test.release()});
        await page.locator('.sc-wb-locations').waitFor({state:'detached'});
        await page.evaluate(()=>window.test.controller.panel({kind:'search'}));
        await page.getByRole('combobox',{name:'全局搜索',exact:true}).fill('unique last target');
        await page.locator('.sc-wb-results button').filter({hasText:'source-2204.ts'}).waitFor();
      });
      await t.test('虚拟目录仍可展开折叠、打开子文件及使用目录右键菜单', async () => {
        await page.keyboard.press('Escape');await page.evaluate(()=>window.test.addFolder());
        await page.locator('.sc-wb-file-tree').evaluate(element=>{element.scrollTop=0});
        const folder=page.locator('.sc-wb-file-tree button[title="nested"]'),file=page.locator('.sc-wb-file-tree button[title="nested/inside.ts"]');
        await folder.click();await file.waitFor();await file.click();
        assert.equal(await page.evaluate(()=>window.test.controller.snapshot().file),'nested/inside.ts');
        await folder.click();await file.waitFor({state:'detached'});await folder.click();await file.waitFor();
        await folder.click({button:'right'});
        assert.equal(await page.evaluate(()=>window.test.controller.snapshot().fileMenu.path),'nested');
        await page.keyboard.press('Escape');
        await folder.click();await file.waitFor({state:'detached'});
        await page.evaluate(()=>window.test.visit('source-2204.ts'));
        await page.evaluate(()=>window.test.visit('nested/inside.ts'));
        await file.waitFor();
        assert.equal(await folder.getAttribute('aria-expanded'),'true','切换文件后恢复目录跟随');
        assert.ok(await page.locator('.sc-wb-file-tree').evaluate(element=>element.scrollTop<60),'当前子文件应重新进入可见区域');
      });
      await t.test('一万个声明全部参与补全，只渲染可见候选，缩小前缀后可接受末尾声明', async () => {
        await page.evaluate(async()=>{
          await window.test.visit('dense.ts');
          const view=window.test.controller.view();
          await window.test.controller.index.change('dense.ts',view.state.doc.toString());
          view.dispatch({selection:{anchor:view.state.doc.length},scrollIntoView:true});view.focus();
        });
        await page.keyboard.press('Control+Space');
        await page.waitForFunction(()=>window.test.completionStatus()==='active'&&window.test.completions().filter(item=>item.boost===10).length===10000);
        assert.deepEqual(await page.evaluate(()=>window.test.completions().filter(item=>item.boost===10).map(item=>item.label).sort()),Array.from({length:10000},(_,i)=>'value'+String(i).padStart(5,'0')));
        assert.ok(await page.locator('.cm-tooltip-autocomplete li').count()<200,'补全列表不得为每个声明创建一行');
        await page.keyboard.type('ue09999');
        await page.waitForFunction(()=>window.test.completions().length===1&&window.test.completions()[0].label==='value09999');
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(()=>window.test.controller.view().state.doc.line(10001).text),'value09999');
        assert.equal(await page.evaluate(()=>window.test.controller.view().state.doc.lines),10001);
        await page.locator('.cm-tooltip-autocomplete').waitFor({state:'detached'});
      });
      await t.test('空文件显式补全可使用项目声明，Esc和切换文件不会插入旧候选', async () => {
        await page.evaluate(async()=>{await window.test.visit('empty.ts');window.test.controller.view().focus()});
        await page.keyboard.press('Control+Space');
        await page.waitForFunction(()=>window.test.completionStatus()==='active'&&window.test.completions().some(item=>item.label==='value09999'));
        await page.keyboard.press('Escape');await page.locator('.cm-tooltip-autocomplete').waitFor({state:'detached'});
        assert.equal(await page.evaluate(()=>window.test.controller.view().state.doc.toString()),'');
        await page.keyboard.press('Control+Space');
        await page.waitForFunction(()=>window.test.completionStatus()==='active');
        await page.evaluate(()=>window.test.visit('nested/inside.ts'));
        await page.locator('.cm-tooltip-autocomplete').waitFor({state:'detached'});
        assert.equal(await page.evaluate(()=>window.test.controller.view().state.doc.toString()),'export function inside() {}');
        if(process.env.SC_TEST_ARTIFACTS){
          await page.evaluate(async()=>{await window.test.visit('dense.ts');const view=window.test.controller.view();view.dispatch({selection:{anchor:view.state.doc.length},scrollIntoView:true});view.focus()});
          for(const [palette,dark] of [['idea',false],['vscode',true]]){
            await page.evaluate(async({palette,dark})=>{document.body.toggleAttribute('data-ds-dark-theme',dark);await window.test.controller.settings({...window.test.controller.snapshot().preferences,palette})},{palette,dark});
            await page.keyboard.press('Control+Space');await page.locator('.cm-tooltip-autocomplete').waitFor();
            await page.screenshot({path:join(process.env.SC_TEST_ARTIFACTS,`${process.env.SC_TEST_BROWSER||'chromium'}-completion-${palette}-${dark?'dark':'light'}.png`)});
            await page.keyboard.press('Escape');
          }
        }
      });
      assert.deepEqual(errors, []);
    } finally {await page.evaluate(()=>window.test?.dispose()).catch(()=>{});await page.close();}
  });
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
