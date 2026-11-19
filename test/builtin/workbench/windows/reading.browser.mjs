import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = `import {createWorkbench} from './builtin/workbench/controller.js';
import {createWindowView} from './builtin/workbench/windows/view.js';
import {createWindowHost} from './builtin/workbench/windows/host.js';
const projects=new Map(),requests=[],texts={'main.ts':'const main = 1;','window.ts':'const windowValue = 2;','step.ts':'const step = 3;'};
const reference={file:'step.ts',fromLine:1,toLine:1,quote:texts['step.ts']};
const api={fileOperation:async()=>({path:'/demo'}),list:async()=>({entries:[],truncated:false}),project:async()=>({files:[],truncated:false}),read:async path=>({path,text:texts[path],version:'v1'}),
async *reading(input){requests.push(input);yield{kind:'sources',sources:[{id:'S1',file:reference.file,fromLine:1,toLine:1,text:reference.quote,version:'v1'}],partial:false};if(input.kind==='plan')yield{kind:'plan',plan:{title:'Entry',summary:'Steps',steps:[{title:'Step',reason:'Read',refs:[reference]}]}};yield{kind:'done'}}};
const a=createWorkbench(api,key=>key,{projects}),b=createWorkbench(api,key=>key,{projects,sharedIndex:a.index});let windowView;
window.test={a,b,requests,reference,async ready(){await a.attach(document.querySelector('#a'),document.body);await a.visit({file:'main.ts'});windowView=await createWindowView(b,a,{kind:'workbench'});await windowView.workbench.visit({file:'window.ts'});this.window=windowView.workbench},async rpc(method,args=[]){const host=createWindowHost(windowView.workbench,async()=>{},error=>{throw error},{});try{await host.accept(JSON.stringify({kind:'hello'}));await host.accept(JSON.stringify({kind:'call',id:1,method,args}))}finally{host.dispose()}},dispose(){windowView?.dispose();a.dispose();for(const project of projects.values())project.dispose()}};`;
const app = await build({ stdin: { contents: fixture, loader: 'js', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser' });
const server = createServer((req, res) => { res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? app.outputFiles[0].contents : '<!doctype html><div id="a"></div><script type="module" src="/app.js"></script>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('独立窗口的学习状态共享，当前文件与导航属于发起窗口', { timeout: 30000 }, async t => {
    let page, errors;
    t.beforeEach(async () => {
      page = await browser.newPage(); errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => !!window.test); await page.evaluate(() => window.test.ready());
    });
    t.afterEach(async () => { await page.evaluate(() => window.test.dispose()); await page.close(); assert.deepEqual(errors, []); });
    await t.test('解释当前文件使用独立窗口中的文件', async () => {
      const state = await page.evaluate(async () => { const {a,window:w,requests}=window.test;await w.reading.file();return{file:requests.at(-1).file,main:a.snapshot().file,window:w.snapshot().file,shared:a.reading.snapshot()===w.reading.snapshot()}; });
      assert.deepEqual(state, { file: 'window.ts', main: 'main.ts', window: 'window.ts', shared: true });
    });
    await t.test('生成学习计划使用独立窗口文件作为可选入口', async () => {
      const file = await page.evaluate(async () => { const {window:w,requests}=window.test;w.reading.goal('Understand');await w.reading.plan();return requests.at(-1).file; });
      assert.equal(file, 'window.ts');
    });
    await t.test('点击阅读引用只导航发起窗口', async () => {
      const state = await page.evaluate(async () => { const {a,window:w,reference}=window.test;const opened=await w.reading.open(reference);return{opened,main:a.snapshot().file,window:w.snapshot().file}; });
      assert.deepEqual(state, { opened: true, main: 'main.ts', window: 'step.ts' });
    });
    await t.test('共享计划的步骤和缓存命中均导航发起窗口', async () => {
      const state = await page.evaluate(async () => { const {a,window:w,requests}=window.test;a.reading.goal('Understand');await a.reading.plan();await w.reading.step(0);await w.visit({file:'window.ts'});await w.reading.step(0);return{main:a.snapshot().file,window:w.snapshot().file,requests:requests.length,shared:a.reading.snapshot()===w.reading.snapshot()}; });
      assert.deepEqual(state, { main: 'main.ts', window: 'step.ts', requests: 2, shared: true });
    });
    await t.test('窗口通信入口同样使用外窗文件和导航', async () => {
      const state = await page.evaluate(async () => { const {a,window:w,requests,reference}=window.test;await window.test.rpc('reading.file');await window.test.rpc('reading.open',[reference]);return{file:requests.at(-1).file,main:a.snapshot().file,window:w.snapshot().file}; });
      assert.deepEqual(state, { file: 'window.ts', main: 'main.ts', window: 'step.ts' });
    });
  });
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
