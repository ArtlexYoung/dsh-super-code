import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { tsImport } from 'tsx/esm/api';

const candidate = process.env.SC_TEST_PACKAGE;
const { WorkbenchWindows } = candidate ? await import(pathToFileURL(join(candidate, 'lib/workbench/window.js')))
  : await tsImport('../../../../src/workbench/window.ts', import.meta.url);

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';
import {Workbench} from './builtin/workbench/components/Workbench.jsx';import {createWorkbench} from './builtin/workbench/controller.js';
import {SafeMarkdown} from './builtin/workbench/windows/markdown.jsx';import {zh,en} from './builtin/workbench/locales.js';import style from './builtin/workbench/style.css';
import {locationBatches} from './src/workbench/search-query.ts';
import {foldCode,foldedRanges,syntaxTreeAvailable} from '@codemirror/language';
const sheet=document.createElement('style');sheet.textContent=style;document.head.append(sheet);
let language='zh',blocked=false,shown=true,projectGate,releaseProject,modelCalls=0,conflictMode=false;const t=key=>(language==='zh'?zh:en)[key]||key;
const texts=new Map([['a.ts','export function add(value: number) { return value + 1; }\\n'],['b.ts','export const second = 2;\\n'],['docs/guide.md','# 阅读指南\\n\\n## 开始\\n\\n**重点**与 \`inline\`。\\n\\n| 名称 | 状态 |\\n| --- | --- |\\n| Editor | Ready |\\n\\n<script>window.markdownAttacked=true</script><img src=x onerror="window.markdownAttacked=true">\\n<a href="javascript:window.markdownAttacked=true">unsafe</a>'],['src/main.ts','export const main = 1;'],['src/nested/end.ts','export function end() { return 3; }']]);
const roots=[{name:'src',path:'src',type:'directory'},{name:'docs',path:'docs',type:'directory'},...Array.from({length:1200},(_,i)=>({name:'row-'+i+'.ts',path:'row-'+i+'.ts',type:'file'})),{name:'a.ts',path:'a.ts',type:'file'},{name:'b.ts',path:'b.ts',type:'file'}];
const extraDirectories=new Map();
texts.set(' 空白 名称 ', '不同后缀和无后缀文件都可以比较');roots.push({name:' 空白 名称 ',path:' 空白 名称 ',type:'file'});
function state(){return {kind:'state',state:{exists:true,writable:true,backend:'native',version:'demo',head:'a'.repeat(40),branch:'main',author:{name:'Demo',email:'demo@example.invalid'},changes:[{path:'a.ts',head:1,stage:1,worktree:2},...(conflictMode?[{path:'conflict.txt',head:1,stage:2,worktree:3,conflict:true}]:[])],history:[],branches:['main'],remoteBranches:[],remotes:[]},sources:[]}}
function difference(){return {path:'a.ts',binary:false,before:'export function add(value: number) { return value; }\\n',after:texts.get('a.ts'),lines:[{kind:'removed',text:'export function add(value: number) { return value; }',before:1,after:null},{kind:'added',text:'export function add(value: number) { return value + 1; }',before:null,after:1}]}}
function git(input){
 if(input.action==='conflict')return {kind:'conflict',conflict:{path:input.path,ours:'current\\n',theirs:'incoming\\n',result:'<<<<<<< ours\\ncurrent\\n=======\\nincoming\\n>>>>>>> theirs\\n',version:'demo'}};
 if(input.action==='resolveConflict'){texts.set(input.path,input.text);conflictMode=false;return state()}
 if(input.action==='stats')return {version:'demo',stats:input.paths.map(path=>({path,added:1,removed:0}))};
 if(input.action==='lineHistory')return {kind:'lineHistory',history:{head:'a'.repeat(40),target:input.target,uncommitted:false,warnings:[],entries:[{oid:'a'.repeat(40),parent:'b'.repeat(40),message:'Update add',author:'Demo Developer',timestamp:1700000000,before:{path:'a.ts',start:1,end:1},after:{path:'a.ts',start:1,end:1}}]}};
 if(input.action==='lineHistoryDiff')return {kind:'diff',diff:difference()};
 return state();
}
async function request(path,body,signal){const response=await fetch(path,{method:'POST',body:JSON.stringify(body),signal});if(!response.ok)throw new Error('transport unavailable');return response.json()}
const windows={open:async(native,signal)=>{if(blocked)throw new Error('WORKBENCH_WINDOW_COMPONENT');return request('/open',{native},signal)},close:id=>request('/close',{id}),send:(id,content,signal)=>request('/send',{id,content},signal),async *events(id,signal){const response=await fetch('/host-events?id='+id,{signal}),reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';for(;;){const result=await reader.read();if(result.done)return;buffer+=decoder.decode(result.value,{stream:true});let at;while((at=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(line)yield JSON.parse(line)}}}};
const api={windows,list:async path=>({entries:path==='src'?[{name:'nested',path:'src/nested',type:'directory'},{name:'main.ts',path:'src/main.ts',type:'file'}]:path==='src/nested'?[{name:'end.ts',path:'src/nested/end.ts',type:'file'}]:path==='docs'?[{name:'guide.md',path:'docs/guide.md',type:'file'}]:roots,truncated:false}),project:async()=>({files:[...texts.keys()],truncated:false}),read:async path=>({path,text:texts.get(path)||'export const row = 1;',version:'v1'}),save:async input=>{texts.set(input.path,input.text);return {...input,version:'v2'}},fileOperation:async()=>({path:'/demo'}),models:async()=>[],assist:async()=>{modelCalls++;return {kind:'text',text:'演示回答'}},async *reading(){modelCalls++;yield {kind:'done'}},git:async input=>git(input),async *searchProject(query){await projectGate;if(query.locations){for(const [path,text]of texts){if(query.buffers?.includes(path))yield{kind:'matches',path,version:'v1',matches:[]};else for(const matches of locationBatches(text,query.search,query.caseSensitive))yield{kind:'matches',path,version:'v1',matches}}yield{kind:'done',scanned:texts.size,skipped:0};return}yield {kind:'file',path:'a.ts',count:1,sample:'export function add',version:'v1'};yield {kind:'done',scanned:1,skipped:0}}};
const controller=createWorkbench(api,t),root=createRoot(document.getElementById('root'));
function Button({children,...props}){return <button type='button' {...props}>{children}</button>}
function Select({label,value,choices,onChange}){return <select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{choices.map(([v,label])=><option key={v} value={v}>{label}</option>)}</select>}
function Conversation(){return <div className='sc-wb-conversation'><p>在工作台中阅读、编辑和核对修改。</p><textarea aria-label='对话草稿'/></div>}
const list=api.list;api.list=async path=>extraDirectories.has(path)?{entries:extraDirectories.get(path),truncated:false}:list(path);
const HostMarkdown=new URLSearchParams(location.search).has('plain-host-markdown')?({text})=><p>{text}</p>:SafeMarkdown;
function render(){root.render(shown?<Workbench workbench={controller} Button={Button} Select={Select} Conversation={Conversation} MarkdownText={HostMarkdown} sessionId='demo' fileContext={()=>({cwd:'/demo'})} t={t}/>:<div>对话页面</div>)}render();
window.test={controller,texts,roots,extraDirectories,difference,show:value=>{shown=value;render()},readingReady:()=>syntaxTreeAvailable(controller.view().state,controller.view().viewport.to),fold:()=>foldCode(controller.view()),folds:()=>{let count=0;foldedRanges(controller.view().state).between(0,controller.view().state.doc.length,()=>count++);return count},conflict:value=>{conflictMode=value},modelCalls:()=>modelCalls,language:value=>{language=value;render()},blocked:value=>{blocked=value},holdSearch:()=>{projectGate=new Promise(resolve=>{releaseProject=resolve})},releaseSearch:()=>{releaseProject();projectGate=null},dispose:()=>{root.unmount();controller.dispose()}};`;
const worker = await build({ entryPoints: [join(repo, 'builtin/workbench/analysis/worker.js')], bundle: true, write: false, format: 'iife', platform: 'browser' });
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text' }, define: { __WORKBENCH_ANALYSIS_WORKER__: JSON.stringify(worker.outputFiles[0].text) } });
const windowScript = await readFile(process.env.SC_TEST_WINDOW_SCRIPT || join(candidate || repo, 'dist/window.js'));
const windows = new WorkbenchWindows(undefined, async () => windowScript), activity = [];
const html = script => `<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="${script}"></script>`;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost'), parts = [];
    activity.push(path.pathname);
    for await (const chunk of req) parts.push(chunk);
    const body = Buffer.concat(parts).toString();
    const json = () => JSON.parse(body), reply = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
    if (path.pathname === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(app.outputFiles[0].contents); }
    else if (path.pathname === '/open') {
      const { native } = json();
      reply(await windows.open('demo', native && process.env.SC_TEST_NATIVE_WINDOW === '1'));
    } else if (path.pathname === '/host-events') {
      const abort = new AbortController(); res.once('close', () => abort.abort());
      res.setHeader('content-type', 'application/x-ndjson'); res.flushHeaders();
      for await (const event of windows.events('demo', path.searchParams.get('id'), abort.signal)) res.write(JSON.stringify(event) + '\n');
      res.end();
    } else if (path.pathname === '/send') {
      const { id, content } = json(); windows.send('demo', id, content);
      reply({});
    } else if (path.pathname === '/close') {
      windows.close('demo', json().id); reply({});
    } else { res.setHeader('content-type', 'text/html'); res.end(html('/app.js')); }
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('工作台目录、标签、侧栏和定向独立窗口', { timeout: 180000 }, async t => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 940 } }), errors = [];
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    const controller = expression => page.evaluate(expression);
    const visit = file => page.evaluate(file => window.test.controller.visit({ file }), file);
    const closePanel = () => controller(() => window.test.controller.panel(null));
    const leftRail = page.locator('.sc-wb-side-rail:not(.sc-wb-side-rail-right)'), rightRail = page.locator('.sc-wb-side-rail-right');
    const popup = async click => {
      const opened = page.waitForEvent('popup'); await click(); const peer = await opened;
      peer.on('pageerror', error => errors.push(error.message));
      try { await peer.locator('.sc-wb-focused-toolbar,.sc-wb-toolbar-fixed').getByRole('button', { name: '返回 DSH', exact: true }).waitFor({ timeout: 8000 }); }
      catch {
        const detail = await peer.evaluate(() => ({ text: document.body?.innerText, initialized: typeof globalThis.__superCodeCloseWindow, origin: location.pathname })).catch(() => ({}));
        throw new Error(JSON.stringify({ detail, errors, activity: activity.slice(-14) }));
      }
      await page.waitForFunction(() => window.test.controller.snapshot().window?.state === 'active'); return peer;
    };
    const back = async peer => { await peer.locator('.sc-wb-focused-toolbar,.sc-wb-toolbar-fixed').getByRole('button', { name: '返回 DSH', exact: true }).click(); await page.waitForFunction(() => !window.test.controller.snapshot().window); };
    const capture = async name => { if (process.env.SC_TEST_ARTIFACTS) { await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, `${process.env.SC_TEST_BROWSER || 'chromium'}-${name}.png`) }); } };
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
      await t.test('左右竖栏逐项提供六个入口，顶栏保留常用操作和所有操作入口', async () => {
        assert.deepEqual(await leftRail.getByRole('button').allTextContents(), ['文件', '文件结构']);
        assert.deepEqual(await rightRail.getByRole('button').allTextContents(), ['对话', '快速对话', '修改文件', '学习']);
        assert.deepEqual(await page.locator('.sc-wb-toolbar-fixed button').evaluateAll(nodes => nodes.map(node => node.dataset.toolbarAction)), ['save', 'git', 'refresh', 'window', 'settings', 'commandPalette']);
        assert.equal(await page.locator('.sc-wb-toolbar').getByRole('button', { name: '学习', exact: true }).count(), 0);
        assert.equal(await rightRail.getByRole('button', { name: '对话', exact: true }).getAttribute('aria-pressed'), 'true');
        for (const label of ['快速对话', '修改文件', '学习']) assert.equal(await rightRail.getByRole('button', { name: label, exact: true }).getAttribute('aria-pressed'), 'false');
        assert.equal(await rightRail.getByRole('button').evaluateAll(nodes => nodes.every(node => document.getElementById(node.getAttribute('aria-controls')))), true);
        assert.equal(await rightRail.getByRole('button').evaluateAll(nodes => nodes.every(node => document.getElementById(node.getAttribute('aria-controls')))), true);
      });
      await t.test('三级目录图标按层级对齐，当前文件自动展开定位', async () => {
        await visit('src/nested/end.ts');
        await page.locator('[data-tree-path="src/nested/end.ts"]').waitFor();
        const x = await page.locator('[data-tree-path] .sc-wb-file-icon').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.closest('[data-tree-path]').dataset.treePath, node.getBoundingClientRect().left])));
        assert.equal(x['src/main.ts'], x['src/nested']); assert.equal(x['src/nested/end.ts'] - x['src/nested'], 16);
        await visit('b.ts'); await page.locator('.sc-wb-file-tree button[aria-current=page]').waitFor();
        assert.equal(await page.locator('.sc-wb-file-tree button[aria-current=page]').getAttribute('title'), 'b.ts');
        assert.ok(await page.locator('.sc-wb-file-tree button').count() < 70);
      });
      await t.test('新文件预览替换，双击和修改保留普通标签', async () => {
        await visit('a.ts'); assert.equal(await page.locator('.sc-wb-tab').count(), 1);
        await page.locator('.sc-wb-tab').dblclick(); await visit('b.ts');
        assert.equal(await page.locator('.sc-wb-tab').count(), 2);
        await controller(() => { const view = window.test.controller.view(); view.dispatch({ changes: { from: 0, insert: '// edited\n' } }); });
        assert.equal(await page.locator('[data-file-tab="b.ts"]').getAttribute('data-preview'), 'false');
        await visit('src/main.ts'); assert.equal(await page.locator('.sc-wb-tab').count(), 3);
      });
      await t.test('两个默认设置可关闭，关闭跟随后不抢目录位置，关闭预览后保留新标签', async () => {
        await controller(() => window.test.controller.panel({ kind: 'settings' }));
        assert.equal(await page.getByRole('checkbox', { name: '在目录树中跟随当前文件' }).isChecked(), true);
        assert.equal(await page.getByRole('checkbox', { name: '以预览标签打开文件' }).isChecked(), true);
        await page.getByRole('checkbox', { name: '在目录树中跟随当前文件' }).uncheck();
        await page.getByRole('checkbox', { name: '以预览标签打开文件' }).uncheck(); await closePanel();
        await page.locator('.sc-wb-file-tree').evaluate(node => { node.scrollTop = 0; }); await visit('b.ts');
        assert.equal(await page.locator('.sc-wb-file-tree').evaluate(node => node.scrollTop), 0);
        await visit('docs/guide.md'); await visit('src/nested/end.ts');
        assert.equal(await page.locator('.sc-wb-tab').count(), 5);
        await controller(() => window.test.controller.settings({ ...window.test.controller.snapshot().preferences, followFile: true, previewTabs: true }));
      });
      await t.test('快速对话和修改文件之间可鼠标与键盘调高，关闭主对话后仍可调', async () => {
        await rightRail.getByRole('button', { name: '快速对话', exact: true }).click();
        await rightRail.getByRole('button', { name: '修改文件', exact: true }).click();
        const quick = page.locator('.sc-wb-right-pane[data-pane=quick]'), changed = page.locator('.sc-wb-right-pane[data-pane=changes]');
        const separator = page.getByRole('separator', { name: '调整区域高度 · 快速对话', exact: true });
        const before = await quick.boundingBox(), rect = await separator.boundingBox();
        await page.mouse.move(rect.x + rect.width / 2, rect.y + 2); await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2, rect.y + 72, { steps: 8 }); await page.mouse.up();
        assert.ok((await quick.boundingBox()).height > before.height + 45);
        await rightRail.getByRole('button', { name: '对话', exact: true }).click();
        const prior = (await changed.boundingBox()).height; await separator.focus(); await page.keyboard.press('ArrowDown');
        assert.ok((await changed.boundingBox()).height < prior - 5);
        await rightRail.getByRole('button', { name: '对话', exact: true }).click();
        await capture('sidebars');
      });
      await t.test('学习与三个右栏可同时展开，竖栏与标题同步，保留草稿且不调用模型', async () => {
        await page.getByRole('textbox', { name: '对话草稿', exact: true }).fill('保留当前对话草稿');
        const calls = await controller(() => window.test.modelCalls());
        await rightRail.getByRole('button', { name: '学习', exact: true }).focus();
        await page.keyboard.press('Space');
        assert.equal(await page.locator('.sc-wb-right-pane[data-open=true]').count(), 4);
        assert.equal(await page.locator('.sc-wb-conversation').isVisible(), true);
        await page.getByRole('textbox', { name: '阅读目标', exact: true }).fill('弄懂文件读取流程');
        const separator = page.getByRole('separator', { name: '调整区域高度 · 修改文件', exact: true });
        const weight = await separator.getAttribute('aria-valuenow');
        await separator.focus(); await page.keyboard.press('ArrowDown');
        assert.ok(Number(await separator.getAttribute('aria-valuenow')) > Number(weight));
        await page.locator('[data-pane=learning]>.sc-wb-section').click();
        assert.equal(await rightRail.getByRole('button', { name: '学习', exact: true }).getAttribute('aria-pressed'), 'false');
        await rightRail.getByRole('button', { name: '学习', exact: true }).click();
        assert.equal(await page.getByRole('textbox', { name: '阅读目标', exact: true }).inputValue(), '弄懂文件读取流程');
        assert.equal(await page.getByRole('textbox', { name: '对话草稿', exact: true }).inputValue(), '保留当前对话草稿');
        assert.equal(await controller(() => window.test.modelCalls()), calls);
        await capture('all-panes');
        await rightRail.getByRole('button', { name: '学习', exact: true }).click();
      });
      await t.test('左右竖栏收起恢复，保留代码、宽度和高度记忆', async () => {
        const width = (await page.locator('.sc-wb-code').boundingBox()).width;
        const layout = await controller(() => JSON.parse(localStorage.getItem('dsh-super-code-workbench-layout')));
        await leftRail.getByRole('button', { name: '文件', exact: true }).click();
        assert.equal(await page.locator('.sc-wb-explorer').isVisible(), true);
        assert.equal(await page.locator('.sc-wb-outline').isVisible(), true);
        await leftRail.getByRole('button', { name: '文件结构', exact: true }).click();
        for (const label of ['对话', '快速对话', '修改文件']) await rightRail.getByRole('button', { name: label, exact: true }).click();
        assert.equal(await page.locator('.sc-wb-explorer').isVisible(), false); assert.equal(await page.locator('.sc-wb-right').isVisible(), false);
        assert.ok((await page.locator('.sc-wb-code').boundingBox()).width > width + 300);
        await leftRail.getByRole('button', { name: '文件', exact: true }).click();
        assert.equal(await page.locator('.sc-wb-explorer-outline').getAttribute('data-open'), 'false');
        await leftRail.getByRole('button', { name: '文件结构', exact: true }).click();
        for (const label of ['对话', '快速对话', '修改文件']) await rightRail.getByRole('button', { name: label, exact: true }).click();
        assert.ok(Math.abs((await page.locator('.sc-wb-code').boundingBox()).width - width) < 2);
        const restored = await controller(() => JSON.parse(localStorage.getItem('dsh-super-code-workbench-layout')));
        for (const key of ['explorer', 'reading', 'files', 'right']) assert.deepEqual(restored[key], layout[key]);
        assert.equal(await page.getByRole('textbox', { name: '对话草稿', exact: true }).inputValue(), '保留当前对话草稿');
      });
      await t.test('旧版整侧收起配置可逐项恢复，刷新后保留宽度和左栏选择', async () => {
        const legacy = await browser.newPage({ viewport: { width: 1100, height: 780 } });
        legacy.on('pageerror', error => errors.push(error.message));
        try {
          await legacy.addInitScript(() => {
            if (!localStorage.getItem('legacy-ready')) {
              localStorage.setItem('dsh-super-code-workbench-layout', JSON.stringify({ explorer: 285, reading: 420, files: 190, filesOpen: true, outlineOpen: true, explorerOpen: false, rightOpen: false, right: { conversation: 4, quick: 3, changes: 2 } }));
              localStorage.setItem('legacy-ready', 'true');
            }
          });
          await legacy.goto(`http://127.0.0.1:${server.address().port}/`);
          await legacy.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
          assert.equal(await legacy.locator('.sc-wb-explorer').isVisible(), false);
          assert.equal(await legacy.locator('.sc-wb-right').isVisible(), false);
          await legacy.locator('.sc-wb-side-rail').getByRole('button', { name: '文件结构', exact: true }).click();
          assert.equal(await legacy.locator('.sc-wb-explorer-files').getAttribute('data-open'), 'false');
          assert.equal(await legacy.locator('.sc-wb-explorer-outline').getAttribute('data-open'), 'true');
          await legacy.locator('.sc-wb-side-rail-right').getByRole('button', { name: '学习', exact: true }).click();
          assert.equal(await legacy.locator('.sc-wb-right-pane[data-open=true]').count(), 1);
          assert.equal(await legacy.locator('.sc-wb-right-pane[data-pane=learning]').getAttribute('data-open'), 'true');
          assert.equal(await legacy.evaluate(() => window.test.modelCalls()), 0);
          await legacy.locator('.sc-wb-side-rail-right').getByRole('button', { name: '学习', exact: true }).click();
          await legacy.reload();
          await legacy.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
          assert.equal(await legacy.locator('.sc-wb-right').isVisible(), false);
          assert.equal(await legacy.locator('.sc-wb-explorer-files').getAttribute('data-open'), 'false');
          assert.equal(await legacy.locator('.sc-wb-explorer-outline').getAttribute('data-open'), 'true');
          assert.ok(Math.abs((await legacy.locator('.sc-wb-explorer').boundingBox()).width - 285) < 1);
          const stored = await legacy.evaluate(() => JSON.parse(localStorage.getItem('dsh-super-code-workbench-layout')));
          assert.equal(stored.reading, 420); assert.equal(stored.files, 190);
          assert.deepEqual(stored.right, { conversation: 4, quick: 3, changes: 2, learning: 6 });
        } finally { await legacy.evaluate(() => window.test?.dispose()).catch(() => {}); await legacy.close(); }
      });
      await t.test('全局搜索可独立打开且保留查询，窗口只展示搜索结果', async currentTest => {
        let peer;
        currentTest.after(async () => { if (peer && !peer.isClosed()) await back(peer); await closePanel(); });
        await visit('b.ts');
        await controller(() => window.test.controller.panel({ kind: 'search' }));
        const search = page.getByRole('combobox', { name: '全局搜索', exact: true });
        await search.fill('function'); await page.locator('.sc-wb-results [aria-selected=true]').waitFor();
        await search.press('ArrowDown');
        assert.equal(await page.getByRole('listbox', { name: '定位结果' }).getByRole('option', { selected: true }).getAttribute('title'), 'src/nested/end.ts:1');
        for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
          await page.evaluate(({ palette, dark }) => { const c=window.test.controller; c.settings({ ...c.snapshot().preferences, palette }); document.body.toggleAttribute('data-ds-dark-theme', dark); }, { palette, dark });
          await capture('search-' + palette + (dark ? '-dark' : '-light'));
        }
        await page.evaluate(() => { const c=window.test.controller; c.settings({ ...c.snapshot().preferences, palette: 'idea' }); document.body.removeAttribute('data-ds-dark-theme'); });
        peer = await popup(() => page.locator('.sc-wb-dialog').getByRole('button', { name: '独立窗口', exact: true }).click());
        assert.equal(await peer.getByRole('combobox', { name: '全局搜索', exact: true }).inputValue(), 'function');
        assert.equal(await peer.locator('.sc-wb-toolbar').count(), 0); assert.equal(await peer.locator('.sc-wb-right').count(), 0);
        assert.equal(await peer.locator('.sc-wb-body').isVisible(), false);
        await peer.getByRole('listbox', { name: '定位结果' }).getByRole('option', { selected: true }).waitFor();
        assert.equal(await peer.getByRole('listbox', { name: '定位结果' }).getByRole('option', { selected: true }).locator('.sc-wb-result-path').textContent(), 'a.ts1');
        assert.equal(await page.getByRole('listbox', { name: '定位结果' }).getByRole('option', { selected: true }).getAttribute('title'), 'src/nested/end.ts:1');
        await peer.getByRole('combobox', { name: '全局搜索', exact: true }).press('ArrowDown');
        await peer.getByRole('combobox', { name: '全局搜索', exact: true }).press('Enter');
        await page.waitForFunction(() => { const c=window.test.controller, view=c.view(); return c.snapshot().file === 'src/nested/end.ts' && view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) === 'function'; });
        assert.equal(await controller(() => { const view=window.test.controller.view(); return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to); }), 'function');
        if (process.env.SC_TEST_ARTIFACTS) await peer.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, 'search-standalone.png') });
        await back(peer); peer=null; await search.focus(); await search.press('Escape');
        await page.waitForFunction(() => window.test.controller.snapshot().panel === null);
      });
      await t.test('真实语法索引的用法和同名定义可通过键盘定位源码', async () => {
        const target = await browser.newPage({ viewport: { width: 1200, height: 820 } }); target.on('pageerror', error => errors.push(error.message));
        try {
          await target.goto('http://127.0.0.1:' + server.address().port + '/');
          await target.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
          await target.evaluate(async () => {
            const { controller: c, texts }=window.test;
            texts.set('b.ts', 'export const answer = add(1);'); texts.set('src/main.ts', 'export function add(value: number) { return value + 2; }'); texts.set('src/nested/end.ts', 'export const end = add(2);');
            await c.refresh(); await c.visit({ file: 'a.ts' }); const view=c.view(); view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('add') + 1 } }); view.focus();
          });
          await target.keyboard.press('F12'); const list=target.getByRole('listbox', { name: '定位结果' });
          await list.waitFor(); assert.equal(await list.getByRole('option', { selected: true }).getAttribute('title'), 'b.ts:1');
          assert.equal(await list.evaluate(node => node === document.activeElement), true);
          await list.press('ArrowDown'); assert.equal(await list.getByRole('option', { selected: true }).getAttribute('title'), 'src/nested/end.ts:1'); await list.press('Enter');
          await target.waitForFunction(() => window.test.controller.snapshot().file === 'src/nested/end.ts');
          assert.equal(await target.evaluate(() => { const view=window.test.controller.view(); return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to); }), 'add');
          await target.evaluate(async () => { const c=window.test.controller; c.panel(null); await c.visit({ file: 'b.ts' }); const view=c.view(); view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('add') + 1 } }); view.focus(); });
          await target.keyboard.press('F12'); await list.waitFor();
          assert.equal(await list.getByRole('option', { selected: true }).getAttribute('title'), 'a.ts:1');
          await list.press('ArrowDown'); assert.equal(await list.getByRole('option', { selected: true }).getAttribute('title'), 'src/main.ts:1'); await list.press('Enter');
          await target.waitForFunction(() => window.test.controller.snapshot().file === 'src/main.ts');
          assert.equal(await target.evaluate(() => { const c=window.test.controller; return c.view().state.doc.lineAt(c.view().state.selection.main.head).text; }), 'export function add(value: number) { return value + 2; }');
        } finally { await target.evaluate(() => window.test?.dispose()).catch(() => {}); await target.close(); }
      });
      await t.test('全局替换字段对齐，独立窗口保留查找与替换草稿', async () => {
        await controller(() => window.test.controller.panel({ kind: 'projectReplace' }));
        await page.getByRole('textbox', { name: '查找文本', exact: true }).fill('value');
        await page.getByRole('textbox', { name: '替换为', exact: true }).fill('amount');
        const boxes = await page.locator('.sc-wb-search-row>:is(input,textarea)').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().left));
        assert.equal(boxes[0], boxes[1]); await capture('replace');
        const peer = await popup(() => page.locator('.sc-wb-dialog').getByRole('button', { name: '独立窗口', exact: true }).click());
        assert.equal(await peer.getByRole('textbox', { name: '查找文本', exact: true }).inputValue(), 'value');
        assert.equal(await peer.getByRole('textbox', { name: '替换为', exact: true }).inputValue(), 'amount');
        await back(peer); await closePanel();
      });
      await t.test('Git独立窗口只展示Git并保留当前标签', async () => {
        await controller(() => window.test.controller.panel({ kind: 'git' }));
        await page.getByRole('textbox', { name: '描述本次修改…', exact: true }).fill('Preserve summary');
        await page.getByRole('textbox', { name: '作者姓名', exact: true }).fill('Demo Author');
        await page.getByRole('textbox', { name: '作者邮箱', exact: true }).fill('editor@example.invalid');
        await page.getByRole('button', { name: '分支', exact: true }).click();
        await page.getByRole('textbox', { name: '新分支名称', exact: true }).fill('demo-branch');
        const peer = await popup(() => page.locator('.sc-wb-dialog').getByRole('button', { name: '独立窗口', exact: true }).click());
        assert.equal(await peer.getByRole('button', { name: '分支', exact: true }).getAttribute('aria-pressed'), 'true');
        assert.equal(await peer.locator('.sc-wb-body').isVisible(), false); assert.equal(await peer.locator('.sc-wb-git').isVisible(), true);
        assert.equal(await peer.getByRole('textbox', { name: '新分支名称', exact: true }).inputValue(), 'demo-branch');
        await peer.getByRole('button', { name: /^工作区/ }).click();
        assert.equal(await peer.getByRole('textbox', { name: '描述本次修改…', exact: true }).inputValue(), 'Preserve summary');
        assert.equal(await peer.getByRole('textbox', { name: '作者姓名', exact: true }).inputValue(), 'Demo Author');
        assert.equal(await peer.getByRole('textbox', { name: '作者邮箱', exact: true }).inputValue(), 'editor@example.invalid');
        await back(peer);
        await page.getByRole('button', { name: '远程', exact: true }).click();
        await page.getByRole('textbox', { name: '远程地址', exact: true }).fill('https://example.invalid/demo.git');
        const remote = await popup(() => page.locator('.sc-wb-dialog').getByRole('button', { name: '独立窗口', exact: true }).click());
        assert.equal(await remote.getByRole('textbox', { name: '远程地址', exact: true }).inputValue(), 'https://example.invalid/demo.git');
        await back(remote); await closePanel();
      });
      await t.test('文本差异独立窗口展示前后代码和变更块，不展示完整工作台', async () => {
        await controller(() => window.test.controller.panel({ kind: 'diff', path: 'a.ts', exists: true, diff: window.test.difference() }));
        const peer = await popup(() => page.locator('.sc-wb-dialog').getByRole('button', { name: '独立窗口', exact: true }).click());
        assert.equal(await peer.locator('.sc-wb-git-compare .cm-content').count(), 2);
        await peer.locator('.sc-wb-git-removed').filter({ hasText: 'return value;' }).waitFor();
        await peer.locator('.sc-wb-git-added').filter({ hasText: 'return value + 1;' }).waitFor();
        assert.equal(await peer.locator('.sc-wb-toolbar,.sc-wb-explorer,.sc-wb-right').count(), 0);
        await peer.locator('.sc-wb-git-diff button[data-tooltip-name="下一处差异"]').click();
        await back(peer); await closePanel();
      });
      await t.test('目录树右键对比允许不同后缀，使用未保存内容并保留独立窗口状态', async () => {
        await visit('a.ts');
        await page.locator('[data-tree-path="a.ts"] button').click({ button: 'right' });
        await page.getByRole('menuitem', { name: '对比', exact: true }).click();
        const picker = page.getByRole('textbox', { name: '搜索文件或输入相对路径', exact: true });
        await picker.fill('guide.md');
        await page.locator('.sc-wb-compare-files').getByRole('button', { name: 'docs/guide.md', exact: true }).click();
        await page.locator('.sc-wb-file-compare .cm-content').nth(1).getByText('# 阅读指南', { exact: true }).waitFor();
        assert.equal(await controller(() => window.test.controller.snapshot().file), 'a.ts');
        assert.equal(await page.locator('.sc-wb-file-compare .sc-wb-git-compare label').nth(1).textContent(), 'docs/guide.md');
        await capture('file-compare');
        const peer = await popup(() => page.locator('.sc-wb-dialog').getByRole('button', { name: '独立窗口', exact: true }).click());
        assert.equal(await peer.getByRole('textbox', { name: '搜索文件或输入相对路径', exact: true }).inputValue(), 'docs/guide.md');
        await peer.locator('.sc-wb-file-compare .cm-content').nth(1).getByText('# 阅读指南', { exact: true }).waitFor();
        assert.equal(await peer.locator('.sc-wb-toolbar,.sc-wb-explorer,.sc-wb-right').count(), 0);
        await back(peer); await closePanel();
        await visit('b.ts');
        await controller(() => window.test.controller.view().dispatch({ changes: { from: 0, insert: '// compare draft\n' } }));
        await visit('a.ts');
        await page.locator('[data-tree-path="a.ts"] button').click({ button: 'right' });
        await page.getByRole('menuitem', { name: '对比', exact: true }).click();
        await picker.fill('b.ts'); await page.locator('.sc-wb-compare-picker').getByRole('button', { name: '对比', exact: true }).click();
        await page.locator('.sc-wb-file-compare .cm-content').nth(1).getByText('// compare draft', { exact: true }).waitFor();
        assert.doesNotMatch(await controller(() => window.test.texts.get('b.ts')), /compare draft/);
        assert.equal(await controller(() => window.test.controller.snapshot().file), 'a.ts');
        await picker.fill('a.ts');
        assert.equal(await page.locator('.sc-wb-compare-picker').getByRole('button', { name: '对比', exact: true }).isDisabled(), true);
        await picker.fill(' 空白 名称 ');
        await page.locator('.sc-wb-compare-picker').getByRole('button', { name: '对比', exact: true }).click();
        await page.locator('.sc-wb-file-compare .cm-content').nth(1).getByText('不同后缀和无后缀文件都可以比较', { exact: true }).waitFor();
        assert.equal(await page.locator('.sc-wb-file-compare .sc-wb-git-compare label').nth(1).textContent(), ' 空白 名称 ');
        await closePanel();
        await page.locator('.sc-wb-file-tree').evaluate(node => { node.scrollTop = 0; });
        await page.locator('[data-tree-path="src"] button').click({ button: 'right' });
        assert.equal(await page.getByRole('menuitem', { name: '对比', exact: true }).isDisabled(), true);
        await page.keyboard.press('Escape');
      });
      await t.test('内嵌窗口关闭按钮至少32像素，明暗主题和窄窗口边缘均可点击', async () => {
        for (const dark of [false, true]) {
          await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), dark);
          await controller(() => window.test.controller.panel({ kind: 'fileCompare', path: 'a.ts', title: '对比' }));
          const button = page.locator('.sc-wb-window-close'), bounds = await button.boundingBox();
          assert.ok(bounds.width >= 32 && bounds.height >= 32);
          await button.click({ position: { x: 3, y: 3 } });
          assert.equal(await page.locator('.sc-wb-dialog').count(), 0);
        }
        await page.setViewportSize({ width: 700, height: 760 });
        await controller(() => window.test.controller.panel({ kind: 'fileCompare', path: 'a.ts', title: '对比' }));
        const button = page.locator('.sc-wb-window-close'), bounds = await button.boundingBox();
        assert.ok(bounds.width >= 32 && bounds.height >= 32 && bounds.x + bounds.width <= 700);
        await button.click({ position: { x: bounds.width - 3, y: bounds.height - 3 } });
        assert.equal(await page.locator('.sc-wb-dialog').count(), 0);
        await page.setViewportSize({ width: 1440, height: 940 });
        await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'));
      });
      await t.test('三栏冲突在独立窗口往返时保留中间编辑草稿，保存由主控制器执行', async () => {
        await controller(async () => { window.test.conflict(true); await window.test.controller.changes.refresh(); window.test.controller.panel({ kind: 'git', title: 'Git' }); });
        await page.locator('.sc-wb-git-file>button[title="conflict.txt"]').click();
        await page.getByRole('button', { name: '采用当前段', exact: true }).click();
        let final = page.getByRole('textbox', { name: '最终结果', exact: true });
        await final.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type('retained draft');
        const peer = await popup(() => page.locator('.sc-wb-dialog').getByRole('button', { name: '独立窗口', exact: true }).click());
        final = peer.getByRole('textbox', { name: '最终结果', exact: true });
        await final.getByText('retained draft', { exact: true }).waitFor();
        assert.deepEqual(await peer.locator('.sc-wb-conflict-columns>section>header>span').allTextContents(), ['当前版本（旧）', '最终结果', '传入版本（新）']);
        await final.click(); await peer.keyboard.press('ControlOrMeta+End'); await peer.keyboard.type(' from window');
        await back(peer);
        await page.getByRole('textbox', { name: '最终结果', exact: true }).getByText('retained draft from window', { exact: true }).waitFor();
        await page.getByRole('button', { name: '保存并标记为已解决', exact: true }).click();
        await page.locator('.sc-wb-conflict').waitFor({ state: 'detached' });
        assert.equal(await controller(() => window.test.texts.get('conflict.txt')), 'current\nretained draft from window');
        await closePanel();
      });
      await t.test('函数历史独立窗口可加载记录、查看差异和刷新，返回保留原面板', async () => {
        await controller(() => window.test.controller.panel({ kind: 'lineHistory', title: '函数历史', target: { path: 'a.ts', start: 1, end: 1 }, text: window.test.texts.get('a.ts') }));
        await page.locator('.sc-wb-code-history-list button').first().waitFor();
        const peer = await popup(() => page.locator('.sc-wb-dialog').getByRole('button', { name: '独立窗口', exact: true }).click());
        await peer.locator('.sc-wb-code-history-list button').first().click();
        await peer.locator('.sc-wb-git-added').filter({ hasText: 'return value + 1;' }).waitFor();
        assert.equal(await peer.locator('.sc-wb-toolbar,.sc-wb-explorer,.sc-wb-right').count(), 0);
        await peer.locator('.sc-wb-code-history button[data-tooltip-name="刷新文件与索引"]').click();
        await peer.locator('.sc-wb-code-history-list button').first().waitFor();
        await back(peer); await page.locator('.sc-wb-code-history-list button').first().waitFor(); await closePanel();
      });
      await t.test('设置、文件操作、用法和差异弹窗均可定向打开，保留原输入', async () => {
        const panels = [
          { kind: 'settings' },
          { kind: 'fileAction', action: 'createFile', title: '创建文件', name: 'demo.ts', parent: 'src', busy: false, error: '' },
          { kind: 'locations', title: '用法', matches: [{ file: 'a.ts', line: 0, character: 0, name: 'add' }] },
          { kind: 'diff', path: 'a.ts', error: '演示文件暂不可比较' },
        ];
        for (const panel of panels) {
          if (panel.kind === 'locations') await visit('b.ts');
          await page.evaluate(panel => window.test.controller.panel(panel), panel);
          const peer = await popup(() => page.locator('.sc-wb-dialog').getByRole('button', { name: '独立窗口', exact: true }).click());
          assert.equal(await peer.locator('.sc-wb-focused-panel').isVisible(), true);
          assert.equal(await peer.locator('.sc-wb-dialog,.sc-wb-explorer,.sc-wb-right').count(), 0);
          if (panel.kind === 'fileAction') assert.equal(await peer.getByRole('textbox', { name: '名称', exact: true }).inputValue(), 'demo.ts');
          if (panel.kind === 'settings') assert.equal(await peer.getByRole('checkbox', { name: '以预览标签打开文件' }).isChecked(), true);
          if (panel.kind === 'locations') {
            assert.equal(await peer.locator('.sc-wb-results button').count(), 1);
            await peer.getByRole('listbox', { name: '定位结果' }).press('Enter');
            await page.waitForFunction(() => window.test.controller.snapshot().file === 'a.ts');
          }
          if (panel.kind === 'diff') assert.match(await peer.getByRole('alert').textContent(), /演示文件暂不可比较/);
          if (panel.kind === 'settings') {
            await peer.keyboard.press('Escape');
            await page.waitForFunction(() => !window.test.controller.snapshot().window);
            assert.equal(await controller(() => window.test.controller.snapshot().panel), null);
          } else { await back(peer); await closePanel(); }
        }
      });
      await t.test('关闭后重新打开同类面板，旧扫描晚到不会填进新的替换面板', async () => {
        await controller(() => { window.test.holdSearch(); window.test.controller.panel({ kind: 'projectReplace' }); });
        await page.getByRole('textbox', { name: '查找文本', exact: true }).fill('old');
        await page.getByRole('button', { name: '预览匹配', exact: true }).click();
        const id = await controller(() => window.test.controller.snapshot().panel.id);
        await closePanel(); await controller(() => window.test.controller.panel({ kind: 'projectReplace' }));
        assert.notEqual(await controller(() => window.test.controller.snapshot().panel.id), id);
        await controller(() => window.test.releaseSearch());
        await page.waitForFunction(() => window.test.controller.snapshot().panel.state === undefined);
        assert.equal(await page.getByRole('textbox', { name: '查找文本', exact: true }).inputValue(), 'old');
        assert.equal(await page.locator('.sc-wb-replace-row').count(), 0); await closePanel();
      });
      await t.test('拖出文件标签只显示该文件，编辑保存返回后内容一致', async () => {
        await visit('a.ts');
        const tab = page.locator('.sc-wb-tab[data-file-tab="a.ts"][data-kind=file] button').first(), rect = await tab.boundingBox();
        const peer = await popup(async () => { await page.mouse.move(rect.x + rect.width / 2, rect.y + 12); await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2, rect.y + 120, { steps: 10 }); await page.mouse.up(); });
        assert.equal(await peer.locator('.sc-wb-explorer').count(), 0); assert.equal(await peer.locator('.sc-wb-toolbar').count(), 0);
        assert.equal(await peer.locator('.sc-wb-tab').count(), 1);
        await peer.locator('.cm-content[contenteditable=true]').click(); await peer.keyboard.press('Control+End'); await peer.keyboard.type('// external edit');
        await peer.getByRole('button', { name: '保存', exact: true }).click(); await back(peer);
        assert.match(await controller(() => window.test.texts.get('a.ts')), /external edit/);
        assert.match(await controller(() => window.test.controller.view().state.doc.toString()), /external edit/);
      });
      await t.test('未保存文件关闭确认可独立打开，取消和保留关闭均不丢草稿', async () => {
        await visit('b.ts');
        const original = await controller(() => window.test.controller.view().state.doc.toString());
        await controller(() => window.test.controller.view().dispatch({ changes: { from: 0, insert: '// retained draft\n' } }));
        await page.locator('.sc-wb-tab[data-file-tab="b.ts"] .sc-wb-tab-close').click();
        let peer = await popup(() => page.locator('.sc-wb-close-file').getByRole('button', { name: '独立窗口', exact: true }).click());
        assert.equal(await peer.locator('.sc-wb-focused-toolbar strong').textContent(), '关闭文件');
        assert.equal(await peer.locator('.sc-wb-dialog,.sc-wb-tabs,.sc-wb-explorer,.sc-wb-right').count(), 0);
        await peer.getByRole('button', { name: '取消', exact: true }).click(); await back(peer);
        assert.equal(await page.locator('.sc-wb-tab[data-file-tab="b.ts"]').count(), 1);
        await page.locator('.sc-wb-tab[data-file-tab="b.ts"] .sc-wb-tab-close').click();
        peer = await popup(() => page.locator('.sc-wb-close-file').getByRole('button', { name: '独立窗口', exact: true }).click());
        await peer.getByRole('button', { name: '保留修改并关闭', exact: true }).click(); await back(peer);
        assert.equal(await page.locator('.sc-wb-tab[data-file-tab="b.ts"]').count(), 0);
        await visit('b.ts');
        assert.equal(await controller(() => window.test.controller.view().state.doc.toString()), '// retained draft\n' + original);
        await controller(() => window.test.controller.save());
      });
      await t.test('选区对话独立窗口仅展示对应会话且保留未发送草稿', async () => {
        await controller(() => { const c = window.test.controller; c.view().dispatch({ selection: { anchor: 0, head: 6 } }); c.assistant.select(); c.assistant.draft('解释这段代码'); });
        const peer = await popup(() => page.locator('.sc-wb-assistant').getByRole('button', { name: '独立窗口', exact: true }).click());
        assert.equal(await peer.locator('.sc-wb-assistant-inline').isVisible(), true);
        assert.equal(await peer.getByRole('textbox', { name: '输入问题或修改要求…', exact: true }).inputValue(), '解释这段代码');
        await back(peer); await controller(() => window.test.controller.assistant.close());
      });
      await t.test('独立窗口失败保留内部弹窗、查询及代码', async () => {
        await controller(() => { window.test.blocked(true); window.test.controller.panel({ kind: 'search' }); });
        await page.getByRole('combobox', { name: '全局搜索', exact: true }).fill('add');
        await page.locator('.sc-wb-dialog').getByRole('button', { name: '独立窗口', exact: true }).click();
        await page.waitForFunction(() => !window.test.controller.snapshot().window && !!window.test.controller.snapshot().error);
        assert.equal(await page.getByRole('combobox', { name: '全局搜索', exact: true }).inputValue(), 'add');
        await controller(() => window.test.blocked(false)); await closePanel();
      });
      await t.test('Markdown源码与渲染是不同标签，独立文件窗口也可渲染且不执行HTML脚本', async () => {
        await visit('docs/guide.md'); await page.getByRole('button', { name: '渲染预览', exact: true }).click();
        assert.equal(await page.locator('.sc-wb-markdown h1').textContent(), '阅读指南');
        assert.equal(await page.locator('.sc-wb-tab[data-file-tab="docs/guide.md"]').count(), 2);
        assert.equal(await page.locator('.sc-wb-editor').isVisible(), false); assert.equal(await controller(() => window.markdownAttacked), undefined);
        assert.equal(await page.locator('.sc-wb-markdown [href^="javascript:"]').count(), 0);
        await capture('markdown');
        const peer = await popup(() => controller(() => { void window.test.controller.openWindow({ kind: 'file', file: 'docs/guide.md', editorKind: 'markdown' }); }));
        await peer.locator('.sc-wb-markdown h1').waitFor(); assert.equal(await peer.locator('.sc-wb-markdown h1').textContent(), '阅读指南');
        assert.equal(await peer.evaluate(() => window.markdownAttacked), undefined); await back(peer);
        await page.locator('.sc-wb-tab[data-file-tab="docs/guide.md"][data-kind=markdown] .sc-wb-tab-close').click();
        assert.equal(await page.locator('.sc-wb-tab[data-file-tab="docs/guide.md"]').count(), 1);
        assert.equal(await page.locator('.sc-wb-editor').isVisible(), true);
        await page.locator('.sc-wb-tab[data-file-tab="docs/guide.md"][data-kind=file] button').first().click();
        await page.getByRole('button', { name: '渲染预览', exact: true }).click();
        await page.locator('.sc-wb-tab[data-file-tab="docs/guide.md"][data-kind=file] .sc-wb-tab-close').click();
        assert.equal(await page.locator('.sc-wb-tab[data-file-tab="docs/guide.md"][data-kind=file]').count(), 0);
        await page.getByRole('button', { name: '查看源码', exact: true }).click();
        assert.equal(await page.locator('.sc-wb-tab[data-file-tab="docs/guide.md"][data-kind=file]').count(), 1);
        assert.equal(await page.locator('.sc-wb-editor').isVisible(), true);
      });
      await t.test('独立文件窗口的标签右键菜单仍可关闭预览，主页面标签保留', async () => {
        await visit('docs/guide.md');
        await controller(() => window.test.controller.visit({ file: 'docs/guide.md', kind: 'markdown' }));
        const peer = await popup(() => controller(() => { void window.test.controller.openWindow({ kind: 'file', file: 'docs/guide.md', editorKind: 'markdown' }); }));
        try {
          await peer.locator('.sc-wb-tab[data-file-tab="docs/guide.md"][data-kind=markdown]').click({ button: 'right' });
          await peer.getByRole('menuitem', { name: '关闭文件', exact: true }).click();
          await peer.locator('.sc-wb-tab[data-file-tab="docs/guide.md"][data-kind=markdown]').waitFor({ state: 'detached' });
          assert.equal(await peer.locator('.sc-wb-tab[data-file-tab="docs/guide.md"][data-kind=file]').count(), 1);
          assert.equal(await page.locator('.sc-wb-tab[data-file-tab="docs/guide.md"][data-kind=markdown]').count(), 1);
        } finally { await back(peer); }
      });
      for (const language of ['zh', 'en']) for (const scenario of [
        { kind: 'markdown', active: 'markdown', dirty: false },
        { kind: 'markdown', active: 'file', dirty: true },
        { kind: 'file', active: 'markdown', dirty: false },
        { kind: 'file', active: 'file', dirty: true },
      ]) await t.test(`右键关闭${scenario.kind}标签只作用于目标视图，当前为${scenario.active}，未保存=${scenario.dirty}，语言=${language}`, async () => {
        const target = await browser.newPage({ viewport: { width: 1440, height: 940 } });
        target.on('pageerror', error => errors.push(error.message));
        try {
          await target.goto(`http://127.0.0.1:${server.address().port}/`);
          await target.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
          await target.evaluate(async ({ language, active, dirty }) => {
            const { controller } = window.test, file = 'docs/guide.md';
            window.test.language(language);
            await controller.visit({ file }); controller.keepTab(file);
            if (dirty) controller.view().dispatch({ changes: { from: 0, insert: 'unsaved ' } });
            await controller.visit({ file, kind: 'markdown' });
            if (active === 'file') await controller.visit({ file });
          }, { ...scenario, language });
          await target.locator(`.sc-wb-tab[data-file-tab="docs/guide.md"][data-kind="${scenario.kind}"]`).click({ button: 'right' });
          await target.getByRole('menuitem', { name: language === 'zh' ? '关闭文件' : 'Close file', exact: true }).click();
          const remaining = await target.evaluate(() => window.test.controller.snapshot().tabs.map(tab => tab.kind));
          if (scenario.kind === 'file' && scenario.dirty) {
            assert.deepEqual(remaining, ['file', 'markdown']);
            assert.equal(await target.evaluate(() => window.test.controller.snapshot().closingFile), 'docs/guide.md');
          } else {
            assert.deepEqual(remaining, [scenario.kind === 'file' ? 'markdown' : 'file']);
            assert.equal(await target.evaluate(() => window.test.controller.snapshot().closingFile), null);
            assert.equal(await target.evaluate(() => window.test.controller.snapshot().editorKind), scenario.kind === 'file' ? 'markdown' : 'file');
          }
          assert.equal(await target.evaluate(() => window.test.controller.documents.get('docs/guide.md').dirty), scenario.dirty);
        } finally { await target.evaluate(() => window.test?.dispose()).catch(() => {}); await target.close(); }
      });
      await t.test('正式独立工作台的文件搜索保留本地候选，Enter 只定位发起窗口', async () => {
        await closePanel(); await visit('a.ts');
        const layout = await controller(() => window.test.controller.layout.snapshot());
        await controller(() => window.test.controller.layout.change({ explorerOpen: true, filesOpen: true, outlineOpen: false }));
        const main = page.getByRole('combobox', { name: '搜索文件', exact: true });
        await main.fill('row-'); await page.locator('.sc-wb-file-matches [role=option]').first().waitFor();
        await main.press('ArrowDown');
        assert.equal(await page.locator('.sc-wb-file-matches [aria-selected=true] .sc-wb-file-match>small').textContent(), 'row-1.ts');
        let peer;
        try {
          peer = await popup(() => controller(() => { void window.test.controller.openWindow(); }));
          const remote = peer.getByRole('combobox', { name: '搜索文件', exact: true });
          assert.equal(await remote.inputValue(), '');
          await remote.fill('row-'); await peer.locator('.sc-wb-file-matches [role=option]').first().waitFor();
          await remote.press('ArrowDown'); await remote.press('ArrowDown');
          assert.equal(await peer.locator('.sc-wb-file-matches [aria-selected=true] .sc-wb-file-match>small').textContent(), 'row-2.ts');
          await remote.press('Enter'); await peer.locator('.sc-wb-tab[data-file-tab="row-2.ts"]').waitFor();
          assert.equal(await controller(() => window.test.controller.snapshot().file), 'a.ts');
          assert.equal(await main.inputValue(), 'row-');
          assert.equal(await page.locator('.sc-wb-file-matches [aria-selected=true] .sc-wb-file-match>small').textContent(), 'row-1.ts');
          await main.press('Enter'); await page.waitForFunction(() => window.test.controller.snapshot().file === 'row-1.ts');
          assert.equal(await peer.locator('.sc-wb-tab[data-active=true]').getAttribute('data-file-tab'), 'row-2.ts');
          if (process.env.SC_TEST_ARTIFACTS) await peer.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, 'file-search-standalone.png') });
          await back(peer); peer = null;
        } finally { if (peer && !peer.isClosed()) await back(peer); await main.fill(''); await page.evaluate(layout => window.test.controller.layout.change(layout), layout); }
      });
      await t.test('阅读器软换行实时同步正式独立文件窗口，保留各自选区且差异仍对齐', async () => {
        await visit('a.ts');
        const original = await controller(() => window.test.controller.view().state.doc.toString());
        await controller(() => {
          const c = window.test.controller;
          c.view().dispatch({ changes: { from: 0, insert: '// 中英混排 long source line '.repeat(80) + '\n' }, selection: { anchor: 0 } });
        });
        await page.getByRole('button', { name: '阅读器模式', exact: true }).click();
        const peer = await popup(() => controller(() => { void window.test.controller.openWindow({ kind: 'file', file: 'a.ts', editorKind: 'file' }); }));
        try {
          await peer.setViewportSize({ width: 720, height: 760 });
          await peer.locator('.cm-content.cm-lineWrapping').waitFor();
          await peer.waitForFunction(() => { const s = document.querySelector('.cm-scroller'); return s.scrollWidth <= s.clientWidth + 1; });
          await peer.locator('.cm-content').click(); await peer.keyboard.press('Control+End');
          assert.equal(await controller(() => window.test.controller.view().state.selection.main.head), 0);
          for (const [editor, readerMode] of [[peer, false], [page, true]]) {
            await editor.getByRole('button', { name: '阅读器模式', exact: true }).click();
            await peer.waitForFunction(value => document.querySelector('.cm-content').classList.contains('cm-lineWrapping') === value, readerMode);
            await page.waitForFunction(value => document.querySelector('.sc-wb-code .cm-content').classList.contains('cm-lineWrapping') === value, readerMode);
            assert.equal(await editor.getByRole('button', { name: '阅读器模式', exact: true }).getAttribute('aria-pressed'), String(readerMode));
          }
          await peer.keyboard.press('Control+Home');
          await peer.waitForFunction(() => { const s = document.querySelector('.cm-scroller'); return s.scrollWidth <= s.clientWidth + 1; });
          if (process.env.SC_TEST_ARTIFACTS) await peer.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, 'wrapped-standalone.png') });
          await peer.locator('.cm-content').press('Control+f');
          const peerFind = peer.locator('.sc-wb-find'), query = peerFind.locator('input[name=search]');
          await query.fill('中英混排');
          assert.equal(await peerFind.getByRole('status').textContent(), '80 处');
          assert.equal(await peerFind.locator('input[name=replace]').isVisible(), false);
          assert.equal(await page.locator('.sc-wb-find').count(), 0);
          if (process.env.SC_TEST_ARTIFACTS) await peer.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, 'find-standalone.png') });
          await query.press('Escape');
          assert.equal(await peerFind.count(), 0);
          await back(peer);
          await controller(() => window.test.controller.panel({ kind: 'diff', path: 'a.ts', exists: true, diff: window.test.difference() }));
          await page.locator('.sc-wb-git-compare .cm-content').first().waitFor();
          assert.equal(await page.locator('.sc-wb-git-compare .cm-content').count(), 2);
          assert.equal(await page.locator('.sc-wb-git-compare .cm-content.cm-lineWrapping').count(), 0);
          await closePanel();
        } finally {
          if (!peer.isClosed()) await back(peer);
          await page.evaluate(original => { const c = window.test.controller, v = c.view(); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: original } }); return c.settings({ ...c.snapshot().preferences, readerMode: false }); }, original);
        }
      });
      await t.test('设置实时同步正式独立工作台，不重建阅读文档或移走焦点与滚动', async () => {
        const target = await browser.newPage({ viewport: { width: 1440, height: 940 } });
        target.on('pageerror', error => errors.push(error.message)); let peer;
        const remember = async () => {
          const scroller = document.querySelector('.sc-wb-main .cm-scroller'), box = scroller.getBoundingClientRect();
          const control = [...scroller.querySelectorAll('.cm-reader-source')].find(node => { const rect=node.getBoundingClientRect(); return rect.top>=box.top && rect.bottom<=box.bottom; });
          if (!control) throw new Error('滚动后的可见区域应包含文档按钮');
          control.focus();
          let top = scroller.scrollTop, stable = 0;
          const deadline = performance.now() + 2000;
          while (stable < 4) {
            if (performance.now() > deadline) throw new Error('开始设置更新前，阅读布局应完成测量');
            await new Promise(requestAnimationFrame);
            const next = scroller.scrollTop;
            stable = Math.abs(next - top) < 1 ? stable + 1 : 0; top = next;
          }
          window.readingBefore = { control, card: control.closest('.cm-reader-document'), sticky: scroller.closest('.cm-editor').querySelector('.cm-sticky'), scroller, top: scroller.scrollTop };
        };
        const preserved = () => {
          const { control, card, sticky, scroller, top } = window.readingBefore;
          return { document: card.isConnected, sticky: sticky.isConnected, focused: document.activeElement === control, scroll: top > 500 && Math.abs(top - scroller.scrollTop) < 1 };
        };
        try {
          await target.goto(`http://127.0.0.1:${server.address().port}/`);
          await target.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
          await target.evaluate(async () => {
            const { controller: c, texts } = window.test;
            texts.set('a.ts', Array.from({ length: 120 }, (_, i) => '/**\n * 读取 **任务列表**。\n * @param value 任务编号。\n */\nfunction read' + i + '(value: number) { return value; }').join('\n'));
            await c.settings({ ...c.snapshot().preferences, readerMode: true, showToolbarShortcuts: true });
            await c.visit({ file: 'a.ts', line: 250 });
          });
          const opened = target.waitForEvent('popup');
          await target.evaluate(() => { void window.test.controller.openWindow(); });
          peer = await opened; peer.on('pageerror', error => errors.push(error.message));
          await peer.locator('.sc-wb-toolbar kbd').first().waitFor();
          for (const surface of [target, peer]) {
            await surface.locator('.sc-wb-main .cm-reader-source').first().waitFor();
            await surface.locator('.sc-wb-main .cm-scroller').evaluate(node => { node.scrollTop = 600; });
            await surface.waitForFunction(() => {
              const scroller = document.querySelector('.sc-wb-main .cm-scroller'), box = scroller.getBoundingClientRect();
              return scroller.scrollTop > 500 && [...scroller.querySelectorAll('.cm-reader-source')].some(node => { const rect=node.getBoundingClientRect(); return rect.top>=box.top && rect.bottom<=box.bottom; });
            });
            await surface.evaluate(remember);
          }
          const before = await target.evaluate(() => { const v=window.test.controller.view(); return { text: v.state.doc.toString(), selection: v.state.selection.toJSON() }; });
          await target.evaluate(() => { const c=window.test.controller; return c.settings({ ...c.snapshot().preferences, autoSave: '30', quickReasoning: 'low', showToolbarShortcuts: false }); });
          await peer.locator('.sc-wb-toolbar kbd').first().waitFor({ state: 'detached' });
          for (const surface of [target, peer]) assert.deepEqual(await surface.evaluate(preserved), { document: true, sticky: true, focused: true, scroll: true }, surface === target ? '主工作台' : '独立工作台');
          assert.deepEqual(await target.evaluate(() => { const v=window.test.controller.view(); return { text: v.state.doc.toString(), selection: v.state.selection.toJSON() }; }), before);
        } finally {
          if (peer && !peer.isClosed()) await peer.locator('.sc-wb-toolbar-fixed').getByRole('button', { name: '返回 DSH', exact: true }).click();
          await target.evaluate(() => window.test?.dispose()).catch(() => {}); await target.close();
        }
      });
      await t.test('IDEA和VSCode明暗主题、中英及窄屏仍可操作', async () => {
        for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
          await page.evaluate(palette => window.test.controller.settings({ ...window.test.controller.snapshot().preferences, palette }), palette);
          await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), dark);
          await visit('docs/guide.md'); await page.getByRole('button', { name: '渲染预览', exact: true }).click(); await capture('markdown-' + palette + (dark ? '-dark' : '-light'));
        }
        await controller(() => window.test.language('en'));
        await leftRail.getByRole('button', { name: 'Files', exact: true }).click();
        await leftRail.getByRole('button', { name: 'Outline', exact: true }).click();
        await page.setViewportSize({ width: 700, height: 760 });
        assert.equal(await leftRail.getByRole('button', { name: 'Files', exact: true }).isVisible(), true);
        for (const button of await rightRail.getByRole('button').all()) if (await button.getAttribute('aria-pressed') === 'true') await button.click();
        assert.ok((await page.locator('.sc-wb-code').boundingBox()).width > 600);
      });
      assert.deepEqual(errors, []);
    } finally { await page.evaluate(() => window.test?.dispose()).catch(() => {}); await page.close(); }
  });
  await test('跨文件阅读保留各自的视口', { timeout: 90000 }, async t => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      if(process.env.SC_TEST_ARTIFACTS)await mkdir(process.env.SC_TEST_ARTIFACTS,{recursive:true});
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
      await page.evaluate(async () => {
        const { controller: c, texts } = window.test;
        for (const file of ['a.ts', 'b.ts']) texts.set(file, Array.from({ length: 1600 }, (_, i) => '// ' + file + ' line ' + i + ' ' + 'reading '.repeat(50)).join('\n'));
        await c.settings({ ...c.snapshot().preferences, previewTabs: false });
        await c.visit({ file: 'a.ts' });
      });
      const scroller = page.locator('.sc-wb-main .cm-scroller');
      const settle = async surface => surface.evaluate(async () => {
        const node = document.querySelector('.sc-wb-main .cm-scroller');
        let previous, stable = 0; const deadline = performance.now() + 3000;
        while (stable < 4) {
          if (performance.now() > deadline) throw new Error('编辑器布局应在开始测量前完成');
          await new Promise(requestAnimationFrame);
          const current = [node.scrollTop, node.scrollLeft, node.scrollHeight, node.clientHeight].join(',');
          stable = current === previous ? stable + 1 : 0; previous = current;
        }
      });
      const scroll = async (surface, top, left = 0) => {
        await surface.locator('.sc-wb-main .cm-scroller').evaluate((node, { top, left }) => { node.scrollTop = top; node.scrollLeft = left; }, { top, left });
        await settle(surface);
        return surface.locator('.sc-wb-main .cm-scroller').evaluate(node => ({ top: node.scrollTop, left: node.scrollLeft }));
      };
      const position = surface => surface.locator('.sc-wb-main .cm-scroller').evaluate(node => ({ top: node.scrollTop, left: node.scrollLeft }));
      const anchor = surface => surface.locator('.sc-wb-main .cm-scroller').evaluate(node => {
        const box=node.getBoundingClientRect(),line=[...node.querySelectorAll('.cm-line')].find(line=>line.getBoundingClientRect().bottom>box.top+2);
        return {text:line.textContent,offset:line.getBoundingClientRect().top-box.top,left:node.scrollLeft};
      });
      const visit = async (surface, file) => {
        await surface.locator(`[data-file-tab="${file}"] .sc-wb-tab-name`).click();
        await surface.locator(`[data-file-tab="${file}"][data-active=true]`).waitFor();
        await settle(surface);
      };
      await t.test('普通标签切换恢复垂直和水平位置，不被另一文件带走', async () => {
        const before = await scroll(page, 12000, 600);
        await page.evaluate(() => window.test.controller.visit({ file: 'b.ts' }));
        await settle(page); assert.deepEqual(await position(page), { top: 0, left: 0 }, '新文件从开头显示');
        const second = await scroll(page, 3000, 300);
        await visit(page, 'a.ts'); assert.deepEqual(await position(page), before, '返回文件应恢复其阅读位置');
        await visit(page, 'b.ts'); assert.deepEqual(await position(page), second);
      });
      await t.test('明确行号与前进后退优先定位选区，普通切换继续恢复手动滚动', async () => {
        await page.evaluate(() => window.test.controller.visit({ file: 'a.ts', line: 1200, character: 20, length: 7 }));
        await settle(page);
        const check = () => { const v = window.test.controller.view(), range = v.state.selection.main, rect = v.coordsAtPos(range.head), box = v.scrollDOM.getBoundingClientRect(); return { line: v.state.doc.lineAt(range.from).number - 1, length: range.to - range.from, visible: rect.top >= box.top && rect.bottom <= box.bottom }; };
        assert.deepEqual(await page.evaluate(check), { line: 1200, length: 7, visible: true });
        const selection = await page.evaluate(() => window.test.controller.view().state.selection.toJSON());
        const before = await scroll(page, 5000, 250);
        await visit(page, 'b.ts'); await visit(page, 'a.ts');
        assert.deepEqual(await position(page), before);
        assert.deepEqual(await page.evaluate(() => window.test.controller.view().state.selection.toJSON()), selection);
        await page.evaluate(() => window.test.controller.visit({ file: 'b.ts', line: 400, character: 30 }));
        await scroll(page, 25000);
        await page.evaluate(() => window.test.controller.move(-1)); await settle(page);
        assert.deepEqual(await page.evaluate(check), { line: 1200, length: 7, visible: true });
        await page.evaluate(() => window.test.controller.move(1)); await settle(page);
        assert.deepEqual(await page.evaluate(check), { line: 400, length: 0, visible: true });
      });
      await t.test('重新挂载和关闭后重开保留阅读视口，所有标签关闭时也可恢复', async () => {
        await visit(page, 'a.ts'); const before = await scroll(page, 16000, 650);
        await page.evaluate(async () => { const c=window.test.controller, parent=c.view().dom.parentElement; c.detach(); await c.attach(parent,document.body); });
        await settle(page); assert.deepEqual(await position(page), before, '重新挂载');
        await page.evaluate(() => window.test.controller.closeFile('b.ts'));
        await page.evaluate(() => window.test.controller.closeFile('a.ts'));
        await page.waitForFunction(() => window.test.controller.snapshot().tabs.length === 0);
        await page.evaluate(() => window.test.controller.visit({ file: 'a.ts' }));
        await settle(page); assert.deepEqual(await position(page), before, '关闭最后标签后重开');
        await page.evaluate(() => window.test.controller.visit({ file: 'b.ts' }));
      });
      await t.test('折叠和反向选区与视口一起保留，编辑与撤销仍正常', async () => {
        await page.evaluate(async () => {
          const {controller:c,texts}=window.test;
          texts.set('fold.ts','function folded() {\n  return 1;\n}\n'+texts.get('a.ts'));
          await c.visit({file:'fold.ts'}); c.keepTab('fold.ts');
        });
        await page.waitForFunction(() => window.test.controller.snapshot().symbols.some(item=>item.name==='folded'));
        assert.equal(await page.evaluate(() => window.test.fold()), true);
        const before=await scroll(page,10000,450);
        await page.evaluate(()=>{const v=window.test.controller.view(),at=v.state.doc.line(501).from;v.dispatch({selection:{anchor:at+14,head:at+4}})});
        const saved=await page.evaluate(()=>({selection:window.test.controller.view().state.selection.toJSON(),text:window.test.controller.view().state.doc.toString(),folds:window.test.folds()}));
        assert.equal(saved.folds,1);
        await visit(page,'b.ts');await visit(page,'fold.ts');
        assert.deepEqual(await position(page),before);
        assert.deepEqual(await page.evaluate(()=>({selection:window.test.controller.view().state.selection.toJSON(),text:window.test.controller.view().state.doc.toString(),folds:window.test.folds()})),saved);
        await page.evaluate(()=>window.test.controller.view().dispatch({changes:{from:0,insert:'// added\n'}}));
        await page.evaluate(()=>window.test.controller.undo());
        assert.equal(await page.evaluate(()=>window.test.controller.view().state.doc.toString()),saved.text);
      });
      await t.test('正式独立工作台按文件记住位置，且不影响主工作台', async () => {
        await visit(page,'a.ts');const main=await scroll(page,18000,500);
        const opened=page.waitForEvent('popup');await page.evaluate(()=>{void window.test.controller.openWindow()});const peer=await opened;
        peer.on('pageerror',error=>errors.push(error.message));
        try {
          await peer.locator('.sc-wb-toolbar-fixed').waitFor();
          await peer.locator('[data-file-tab="a.ts"][data-active=true]').waitFor();
          const first=await scroll(peer,9000,350);
          await visit(peer,'b.ts');const second=await scroll(peer,4000,200);
          await visit(peer,'a.ts');assert.deepEqual(await position(peer),first,'独立窗口的文件 A');
          await visit(peer,'b.ts');assert.deepEqual(await position(peer),second,'独立窗口的文件 B');
          assert.deepEqual(await position(page),main,'主工作台保持自己的位置');
          await peer.locator('[data-toolbar-action="back"]').click();
          await peer.locator('[data-file-tab="a.ts"][data-active=true]').waitFor();await settle(peer);
          const beforeJump=await position(peer);assert.ok(Math.abs(beforeJump.top-first.top)>2000,'前进后退应显示光标，而非强行恢复手动阅读位置');
          assert.ok(await peer.locator('.sc-wb-main .cm-selectionBackground').count()>0,'历史中的选区应进入可见区域');
          assert.deepEqual(await position(page),main,'独立窗口前进后退不改变主工作台');
          await peer.locator('.sc-wb-toolbar-fixed').getByRole('button',{name:'返回 DSH',exact:true}).click();
        } finally { if(!peer.isClosed())await peer.close(); }
      });
      await t.test('单文件窗口没有后退记录时，快捷键不移动阅读位置',async()=>{
        const opened=page.waitForEvent('popup');await page.evaluate(()=>{void window.test.controller.openWindow({kind:'file',file:'b.ts'})});const peer=await opened;
        peer.on('pageerror',error=>errors.push(error.message));
        try{
          await peer.locator('.sc-wb-main .cm-content').waitFor();await peer.locator('.sc-wb-main .cm-content').focus();
          const before=await scroll(peer,3500,200);
          await peer.keyboard.press('Alt+ArrowLeft');await settle(peer);assert.deepEqual(await position(peer),before);
          await peer.locator('.sc-wb-focused-toolbar').getByRole('button',{name:'返回 DSH',exact:true}).click();
        }finally{if(!peer.isClosed())await peer.close()}
      });
      await t.test('非当前文件被另一视图插入或删空后，阅读锚点映射且不会越界',async()=>{
        await visit(page,'a.ts');await scroll(page,12500,420);
        const before=await anchor(page);
        const opened=page.waitForEvent('popup');await page.evaluate(()=>{void window.test.controller.openWindow()});const peer=await opened;
        peer.on('pageerror',error=>errors.push(error.message));
        try{
          await peer.locator('[data-file-tab="a.ts"][data-active=true]').waitFor();
          await peer.locator('.sc-wb-main .cm-content').waitFor();
          await visit(page,'b.ts');
          await peer.locator('.sc-wb-main .cm-content').press(process.platform==='darwin'?'Meta+ArrowUp':'Control+Home');await peer.keyboard.insertText('// inserted 1\n// inserted 2\n// inserted 3\n');
          await page.waitForFunction(()=>window.test.controller.documents.get('a.ts').text.startsWith('// inserted 1\n'));
          await visit(page,'a.ts');const after=await anchor(page);
          assert.equal(after.text,before.text);assert.equal(after.left,before.left);assert.ok(Math.abs(after.offset-before.offset)<1,'插入后的同一行保持相对位置');
          await visit(page,'b.ts');
          await peer.locator('.sc-wb-main .cm-content').press(process.platform==='darwin'?'Meta+a':'Control+a');await peer.keyboard.press('Backspace');
          await page.waitForFunction(()=>window.test.controller.documents.get('a.ts').text==='');
          await visit(page,'a.ts');assert.deepEqual(await position(page),{top:0,left:0});
          await peer.locator('.sc-wb-toolbar-fixed').getByRole('button',{name:'返回 DSH',exact:true}).click();
        }finally{if(!peer.isClosed())await peer.close()}
      });
      await t.test('独立窗口缓存旧文件后，再打开使用最新内容且可继续编辑',async()=>{
        await page.evaluate(async()=>{const {controller:c,texts}=window.test;texts.set('fresh.ts','const original = 1;\n');await c.visit({file:'fresh.ts'});c.keepTab('fresh.ts')});
        const opened=page.waitForEvent('popup');await page.evaluate(()=>{void window.test.controller.openWindow()});const peer=await opened;
        peer.on('pageerror',error=>errors.push(error.message));
        try{
          await peer.locator('[data-file-tab="fresh.ts"][data-active=true]').waitFor();await peer.locator('.sc-wb-main .cm-content').waitFor();
          await visit(peer,'b.ts');
          await page.evaluate(()=>{const v=window.test.controller.view();v.dispatch({changes:{from:0,to:v.state.doc.length,insert:'const latest = 42;\n// latest version\n'}})});
          await visit(peer,'fresh.ts');
          assert.deepEqual(await peer.locator('.sc-wb-main .cm-line').allTextContents(),['const latest = 42;','// latest version','']);
          await peer.locator('.sc-wb-main .cm-content').press(process.platform==='darwin'?'Meta+ArrowUp':'Control+Home');await peer.keyboard.insertText('// peer\n');
          await page.waitForFunction(()=>window.test.controller.documents.get('fresh.ts').text.startsWith('// peer\nconst latest = 42;'));
          await peer.locator('.sc-wb-toolbar-fixed').getByRole('button',{name:'返回 DSH',exact:true}).click();
        }finally{if(!peer.isClosed())await peer.close()}
      });
      await t.test('独立窗口从调用跳到同文件远处定义，定义进入可见区域',async()=>{
        await page.evaluate(async()=>{
          const {controller:c,texts}=window.test;
          texts.set('jump.ts','function jumpTarget() { return 1; }\n'+'// filler\n'.repeat(1000)+'jumpTarget();');
          await c.visit({file:'jump.ts'});c.keepTab('jump.ts');
        });
        await page.waitForFunction(()=>window.test.controller.snapshot().symbols.some(item=>item.name==='jumpTarget'));
        const opened=page.waitForEvent('popup');await page.evaluate(()=>{void window.test.controller.openWindow()});const peer=await opened;
        peer.on('pageerror',error=>errors.push(error.message));
        const calls=[];peer.on('request',request=>{if(new URL(request.url()).pathname==='/message'){const value=request.postDataJSON();if(value?.kind==='call')calls.push({method:value.method,selection:value.method==='edit'?value.args[0].selection:undefined})}});
        try{
          await peer.locator('.sc-wb-main .cm-content').waitFor();await peer.locator('.sc-wb-main .cm-content').focus();
          await peer.keyboard.press(process.platform==='darwin'?'Meta+ArrowDown':'Control+End');
          for(let i=0;i<4;i++)await peer.keyboard.press('ArrowLeft');
          await settle(peer);assert.ok((await position(peer)).top>10000);
          await peer.locator('[data-toolbar-action=commandPalette]').click();
          await peer.locator('.sc-wb-navigator input').fill('>定义与用法');
          await peer.getByRole('option').filter({ hasText: '定义与用法' }).click();
          try{await peer.waitForFunction(()=>[...document.querySelectorAll('.sc-wb-main .cm-line')].some(node=>node.textContent.startsWith('function jumpTarget')&&node.getBoundingClientRect().bottom>document.querySelector('.sc-wb-main .cm-scroller').getBoundingClientRect().top),null,{timeout:5000})}
          catch(error){t.diagnostic(JSON.stringify({calls,position:await position(peer),notices:await peer.locator('[role="alert"],.sc-wb-status').allTextContents()}));throw error}
          await settle(peer);assert.ok((await position(peer)).top<100);
          assert.equal(calls.some(item=>item.method==='fail'),false,'定义查询不应收到旧导航的取消错误');
          await page.evaluate(()=>{
            const index=window.test.controller.index,navigate=index.navigate.bind(index);
            window.test.definitionStarted=false;let release;const gate=new Promise(resolve=>{release=resolve});
            window.test.releaseDefinition=()=>{index.navigate=navigate;release()};
            index.navigate=async(...args)=>{window.test.definitionStarted=true;await gate;return navigate(...args)};
          });
          await peer.locator('[data-toolbar-action=commandPalette]').click();
          await peer.locator('.sc-wb-navigator input').fill('>定义与用法');
          await peer.getByRole('option').filter({ hasText: '定义与用法' }).click();
          await page.waitForFunction(()=>window.test.definitionStarted);
          await visit(peer,'b.ts');
          const continued=await scroll(peer,7000,300);
          await page.evaluate(()=>window.test.releaseDefinition());await settle(peer);
          assert.equal(calls.some(item=>item.method==='fail'),false,'切换文件取消旧定义查询时，不应显示过期错误');
          assert.equal(await peer.locator('[role="alert"]').count(),0);
          assert.deepEqual(await position(peer),continued,'已取消的定义查询不能移动新文件的阅读位置');
          await peer.locator('.sc-wb-toolbar-fixed').getByRole('button',{name:'返回 DSH',exact:true}).click();
        }finally{if(!peer.isClosed())await peer.close()}
      });
      await t.test('阅读器文档、软换行和保活页面重新挂载继续保持阅读位置',async()=>{
        await page.evaluate(async()=>{
          const {controller:c,texts}=window.test;
          texts.set('reader.ts',Array.from({length:200},(_,i)=>'/**\n * 第 '+i+' 节，阅读 **任务代码**。\n * @param value 当前编号。\n */\nfunction read'+i+'(value: number) { return value; }').join('\n'));
          await c.settings({...c.snapshot().preferences,readerMode:true});await c.visit({file:'reader.ts'});c.keepTab('reader.ts');
        });
        await page.locator('.sc-wb-main .cm-reader-document').first().waitFor();
        try{
          const ready=async()=>{
            await page.waitForFunction(()=>{
              if(!window.test.readingReady())return false;
              const scroller=document.querySelector('.sc-wb-main .cm-scroller'),box=scroller.getBoundingClientRect();
              return [...scroller.querySelectorAll('.cm-line')].every(node=>{const rect=node.getBoundingClientRect();return rect.bottom<=box.top||rect.top>=box.bottom||!/^\s*(?:\/\*\*|\*)/.test(node.textContent)});
            });
            await settle(page);
          };
          for(const preferences of [{fontSize:14,lineHeight:1.5,top:5000},{fontSize:15,lineHeight:1.5,top:7500},{fontSize:17,lineHeight:1.7,top:9500}]){
          await page.evaluate(({top,...preferences})=>{const c=window.test.controller;return c.settings({...c.snapshot().preferences,...preferences})},preferences);
          await scroll(page,preferences.top);await ready();const before=await position(page);
          const heights=await page.evaluate(()=>{
            const scroller=document.querySelector('.sc-wb-main .cm-scroller');
            return [...scroller.querySelectorAll('.cm-line,.cm-reader-document')].map(node=>parseFloat(getComputedStyle(node).lineHeight));
          });
          assert.ok(heights.length>0&&heights.every(height=>Number.isInteger(height)&&height===heights[0]),'代码与文档块使用相同整像素行高');
          const reference=await anchor(page);
          await visit(page,'b.ts');await visit(page,'reader.ts');await ready();const returned=await anchor(page);
          t.diagnostic(JSON.stringify({phase:'reader-file',before,after:await position(page),reference,restored:returned}));
          assert.equal(returned.text,reference.text,'阅读器切换文件');assert.ok(Math.abs(returned.offset-reference.offset)<1,'阅读器返回后同一行保持相对位置');
          for(const kept of [false,true,false,true]){
            await page.evaluate(kept=>{window.test.controller.keepAlive(kept);window.test.show(false)},kept);
            await page.locator('.sc-wb-main').waitFor({state:'detached'});
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            await page.evaluate(()=>window.test.show(true));await page.locator('.sc-wb-main .cm-reader-document').first().waitFor();
            await ready();const restored=await anchor(page);t.diagnostic(JSON.stringify({kept,before,after:await position(page),reference,restored}));
            assert.equal(restored.text,reference.text,kept?'保活页面重新挂载':'普通页面重新挂载');assert.ok(Math.abs(restored.offset-reference.offset)<1,'虚拟文档重新测量后，同一行保持相对位置');
          }
          }
          assert.ok(await page.locator('.sc-wb-main .cm-reader-document').count()>0);
          assert.equal(await page.locator('.sc-wb-main .cm-content.cm-lineWrapping').count(),1);
          if(process.env.SC_TEST_ARTIFACTS)await page.screenshot({path:join(process.env.SC_TEST_ARTIFACTS,'scroll-reader-restored.png')});
        }finally{await page.evaluate(()=>{const c=window.test.controller;c.keepAlive(false);return c.settings({...c.snapshot().preferences,fontSize:14,lineHeight:1.5,readerMode:false})})}
      });
      await t.test('两万行长文件切换仍只渲染可见行',async()=>{
        await page.evaluate(async()=>{
          const {controller:c,texts}=window.test;
          texts.set('large.ts',Array.from({length:20000},(_,i)=>'// distant row '+i+' '+ 'long '.repeat(40)).join('\n'));
          await c.visit({file:'large.ts'});c.keepTab('large.ts');
        });
        const before=await scroll(page,200000,300);
        const reference=await anchor(page);
        await visit(page,'reader.ts');await visit(page,'large.ts');const restored=await anchor(page);
        assert.equal(restored.text,reference.text);assert.equal(restored.left,reference.left);assert.ok(Math.abs(restored.offset-reference.offset)<1,'虚拟行重新估高后，同一行仍保持相对位置');
        const capacity=await page.evaluate(()=>({lines:window.test.controller.view().state.doc.lines,rendered:window.test.controller.view().dom.querySelectorAll('.cm-line').length}));
        assert.equal(capacity.lines,20000);assert.ok(capacity.rendered<200,JSON.stringify(capacity));
        if(process.env.SC_TEST_ARTIFACTS){await mkdir(process.env.SC_TEST_ARTIFACTS,{recursive:true});await writeFile(join(process.env.SC_TEST_ARTIFACTS,'scroll-capacity.json'),JSON.stringify({before,after:await position(page),reference,restored,...capacity},null,2));await page.screenshot({path:join(process.env.SC_TEST_ARTIFACTS,'scroll-large-restored.png')});}
      });
      assert.deepEqual(errors, []);
    } finally { await page.evaluate(() => window.test?.dispose()).catch(() => {}); await context.close(); }
  });
  await test('编辑器分栏与 Markdown 链接交互', { timeout: 90000 }, async t => {
    const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;
    const newPage = async (query = '') => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
      page.setDefaultTimeout(7000);
      await page.goto(fixtureUrl + query);
      await page.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing);
      return page;
    };
    const group = (page, id) => page.locator(`[data-editor-group="${id}"]`);
    const tab = (pane, file) => pane.locator(`[data-file-tab="${file}"]`).filter({ visible: true }).locator('button').first();
    const visit = (page, file, kind) => page.evaluate(({ file, kind }) => window.test.controller.visit({ file, kind }), { file, kind });
    const split = async (page, pane, file, label) => {
      await tab(pane, file).click({ button: 'right' });
      await page.getByRole('menuitem', { name: label, exact: true }).click();
    };
    const drag = async (page, source, destination) => {
      const from = await source.boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(destination.x, destination.y, { steps: 12 });
      await page.mouse.up();
    };
    const edit = (pane, text) => pane.evaluate((element, insert) => {
      const id = Number(element.dataset.editorGroup);
      const view = window.test.controller.groups.snapshot().panes.find(({ pane }) => pane.id === id).pane.workbench.view();
      view.dispatch({ changes: { from: 0, insert } });
    }, text);
    const capture = async (page, name) => {
      const output = process.env.SC_TEST_ARTIFACTS;
      if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, `${process.env.SC_TEST_BROWSER || 'chromium'}-${name}.png`) }); }
    };
    await t.test('左右分栏独立保留标签和光标，共享草稿、保存和撤销', async () => {
      const page = await newPage();
      try {
        await visit(page, 'a.ts');
        const first = group(page, 0), second = group(page, 1), source = tab(first, 'a.ts');
        await split(page, first, 'a.ts', '向右分栏');
        await tab(second, 'a.ts').waitFor();
        assert.ok((await second.boundingBox()).x > (await first.boundingBox()).x + 150);
        await second.locator('.cm-content').press('End');
        await edit(second, '// shared\n');
        await first.getByText('// shared', { exact: true }).waitFor();
        const content = await page.evaluate(() => window.test.controller.groups.snapshot().panes.map(({ pane }) => pane.workbench.snapshot().cursor));
        assert.notDeepEqual(content[0], content[1]);
        await page.locator('[data-toolbar-action=save]').click();
        await page.waitForFunction(() => window.test.texts.get('a.ts').startsWith('// shared'));
        await page.evaluate(() => window.test.controller.groups.snapshot().active.workbench.undo());
        await page.waitForFunction(() => window.test.controller.groups.snapshot().panes.every(({ pane }) => !pane.workbench.view().state.doc.toString().startsWith('// shared')));
        assert.equal(await source.count(), 1);
        await page.evaluate(() => window.test.show(false)); await page.getByText('对话页面').waitFor();
        await page.evaluate(() => window.test.show(true)); await tab(second, 'a.ts').waitFor();
        await capture(page, 'editor-split-right');
      } finally { await page.close(); }
    });
    await t.test('可拖到下方分栏、跨栏移动并调尺寸，关闭空分栏后恢复布局', async () => {
      const page = await newPage();
      try {
        await visit(page, 'a.ts');
        const first = group(page, 0), second = group(page, 1), third = group(page, 2);
        await tab(first, 'a.ts').dblclick(); await visit(page, 'b.ts');
        const body = await first.locator('.sc-wb-editor-area').boundingBox();
        await drag(page, tab(first, 'b.ts'), { x: body.x + body.width / 2, y: body.y + body.height * .9 });
        await tab(second, 'b.ts').waitFor();
        await tab(first, 'b.ts').waitFor({ state: 'detached' });
        assert.ok((await second.boundingBox()).y > (await first.boundingBox()).y + 150);
        const divider = page.getByRole('separator', { name: '调整编辑器分栏高度' });
        await divider.press('ArrowDown'); assert.equal(await divider.getAttribute('aria-valuenow'), '55');
        const before = await first.boundingBox(), line = await divider.boundingBox();
        await drag(page, divider, { x: line.x + line.width / 2, y: line.y + 50 });
        assert.ok((await first.boundingBox()).height > before.height + 25);
        await split(page, second, 'b.ts', '向右分栏'); await tab(third, 'b.ts').waitFor();
        const right = await third.locator('.sc-wb-editor-area').boundingBox();
        await drag(page, tab(first, 'a.ts'), { x: right.x + right.width / 2, y: right.y + right.height / 2 });
        await tab(third, 'a.ts').waitFor(); await tab(first, 'a.ts').waitFor({ state: 'detached' });
        await first.waitFor({ state: 'hidden' });
        await capture(page, 'editor-split-mixed');
        await second.getByRole('button', { name: '关闭文件 b.ts', exact: true }).click();
        await second.waitFor({ state: 'detached' });
        assert.ok(await third.isVisible());
      } finally { await page.close(); }
    });
    await t.test('关闭最后一个带草稿的分栏后仍提示保存并能重新打开草稿', async () => {
      const page = await newPage();
      try {
        const first = group(page, 0), second = group(page, 1);
        await visit(page, 'a.ts'); await split(page, first, 'a.ts', '向右分栏'); await tab(second, 'a.ts').waitFor();
        await page.evaluate(() => window.test.controller.groups.snapshot().active.workbench.visit({ file: 'b.ts' }));
        await edit(second, '// draft from second pane\n');
        await second.getByRole('button', { name: '关闭文件 a.ts', exact: true }).click();
        await second.getByRole('button', { name: '关闭文件 b.ts', exact: true }).click();
        await page.getByRole('button', { name: '保留修改并关闭', exact: true }).click();
        await second.waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), true);
        await visit(page, 'b.ts'); await first.getByText('// draft from second pane', { exact: true }).waitFor();
      } finally { await page.close(); }
    });
    await t.test('从分栏拖出视口打开单文件窗口，外窗依然可分栏和同步', async () => {
      const page = await newPage(), peers = [];
      try {
        await visit(page, 'a.ts');
        const first = group(page, 0), second = group(page, 1);
        await split(page, first, 'a.ts', '向右分栏'); await tab(second, 'a.ts').waitFor();
        let opened = page.waitForEvent('popup'); const source = tab(second, 'a.ts'), box = await source.boundingBox();
        await drag(page, source, { x: box.x + box.width / 2, y: -20 });
        const fileWindow = await opened; peers.push(fileWindow);
        await fileWindow.getByRole('button', { name: '返回 DSH', exact: true }).waitFor({ timeout: 7000 });
        assert.equal(await fileWindow.locator('[data-editor-group]').count(), 1);
        assert.equal(await fileWindow.locator('.sc-wb-tab').count(), 1);
        assert.equal(await fileWindow.locator('.sc-wb-explorer').count(), 0);
        await fileWindow.getByRole('button', { name: '返回 DSH', exact: true }).click();
        await page.waitForFunction(() => !window.test.controller.snapshot().window);
        opened = page.waitForEvent('popup');
        await page.evaluate(() => { void window.test.controller.openWindow(); });
        const peer = await opened; peers.push(peer);
        const errors = []; peer.on('pageerror', error => errors.push(error.message));
        peer.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
        const root = group(peer, 0), lower = group(peer, 1);
        await tab(root, 'a.ts').waitFor({ timeout: 7000 });
        await split(peer, root, 'a.ts', '向下分栏');
        try { await tab(lower, 'a.ts').waitFor({ timeout: 7000 }); }
        catch (error) {
          const status = peer.isClosed() ? 'window closed' : await peer.locator('[role=status],[role=alert]').allTextContents();
          throw new Error(JSON.stringify({ status, errors, groups: await peer.locator('[data-editor-group]').count() }), { cause: error });
        }
        await lower.locator('.cm-content').press('Home'); await lower.locator('.cm-content').press('X');
        await page.waitForFunction(() => window.test.controller.view().state.doc.toString().startsWith('X'));
        await peer.waitForFunction(() => document.querySelector('[data-editor-group="0"] .cm-content')?.textContent.startsWith('X'));
        await peer.locator('.sc-wb-toolbar-fixed').getByRole('button', { name: '返回 DSH', exact: true }).click();
        await page.waitForFunction(() => !window.test.controller.snapshot().window);
      } finally { for (const peer of peers) await peer.close(); await page.close(); }
    });
    await t.test('浏览器弹窗句柄无效时拖出标签转交系统窗口', async () => {
      const page = await newPage();
      try {
        await visit(page, 'a.ts');
        await page.evaluate(() => { window.open = () => ({ closed: true }); });
        const request = page.waitForRequest(value => new URL(value.url()).pathname === '/open');
        const source = tab(group(page, 0), 'a.ts'), box = await source.boundingBox();
        await drag(page, source, { x: box.x + box.width / 2, y: -20 });
        assert.equal((await request).postDataJSON().native, true);
        if (process.env.SC_TEST_NATIVE_WINDOW === '1') {
          await page.waitForFunction(() => window.test.controller.snapshot().window?.state === 'active', {}, { timeout: 12000 });
          assert.equal(await page.evaluate(() => window.test.controller.snapshot().window.presentation.file), 'a.ts');
        }
        assert.equal(await source.isVisible(), true);
      } finally { await page.evaluate(() => window.test.dispose()).catch(() => {}); await page.close(); }
    });
    await t.test('Markdown 并排实时渲染，宿主渲染器缺少链接时仍能打开项目文件和目录', async () => {
      const page = await newPage('?plain-host-markdown'); let peer;
      try {
        await page.evaluate(() => {
          const path = '验证记录/20261117_cpu/preprocessed_sample.json', work = '验证记录', inner = '验证记录/20261117_cpu';
          window.test.roots.unshift({ path: work, name: work, type: 'directory' });
          window.test.extraDirectories.set(work, [{ path: inner, name: '20261117_cpu', type: 'directory' }]);
          window.test.extraDirectories.set(inner, [{ path, name: 'preprocessed_sample.json', type: 'file' }]);
          window.test.extraDirectories.set('docs/验证记录/20261117_cpu', []);
          window.test.texts.set(path, '{\n  "result": "ready"\n}\n');
          window.test.texts.set('docs/guide.md', '# Guide\n\n[真实预处理结果](验证记录/20261117_cpu/preprocessed_sample.json#L2)\n\n[记录目录](../验证记录/20261117_cpu/)\n\n[缺失](./missing.txt)\n\n[章节](#章节)\n\n## 章节');
        });
        await visit(page, 'docs/guide.md');
        await page.getByRole('button', { name: '编辑并预览', exact: true }).click();
        const editor = group(page, 0).locator('.sc-wb-editor'), preview = page.locator('.sc-wb-markdown');
        assert.ok((await preview.boundingBox()).x > (await editor.boundingBox()).x);
        await edit(group(page, 0), '# Live heading\n\n');
        await preview.getByRole('heading', { name: 'Live heading' }).waitFor();
        const before = page.url(); await preview.getByRole('link', { name: '记录目录' }).click();
        await page.locator('[data-tree-path="验证记录/20261117_cpu"] button[aria-expanded=true]').waitFor();
        assert.equal(page.url(), before);
        await preview.getByRole('link', { name: '缺失' }).click();
        await page.getByText('项目中找不到此链接指向的文件或目录。', { exact: true }).waitFor();
        await capture(page, 'markdown-live-preview');
        const opened = page.waitForEvent('popup');
        await tab(group(page, 0), 'docs/guide.md').click({ button: 'right' });
        await page.getByRole('menuitem', { name: '在独立窗口打开', exact: true }).click();
        peer = await opened; await peer.locator('.sc-wb-markdown').getByRole('heading', { name: 'Live heading' }).waitFor({ timeout: 7000 });
        const originalWindowUrl = peer.url();
        await peer.getByRole('link', { name: '章节' }).click(); assert.equal(peer.url(), originalWindowUrl);
        await peer.getByRole('link', { name: '真实预处理结果' }).click();
        await peer.locator('.cm-content').getByText('"ready"', { exact: true }).waitFor({ timeout: 7000 });
        await preview.getByRole('link', { name: '真实预处理结果' }).click();
        await page.waitForFunction(() => window.test.controller.snapshot().file === '验证记录/20261117_cpu/preprocessed_sample.json');
        assert.equal(await page.evaluate(() => window.test.controller.snapshot().cursor.line), 1);
      } finally { await peer?.close(); await page.close(); }
    });
  });
} finally { await browser.close(); windows.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
