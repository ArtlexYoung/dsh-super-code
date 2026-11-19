import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = `import React,{useSyncExternalStore}from'react';import{createRoot}from'react-dom/client';
import{createWorkbench}from'./builtin/workbench/controller.js';import{Files}from'./builtin/workbench/components/Files.jsx';
import{FileAction,FileActions}from'./builtin/workbench/components/FileActions.jsx';import{zh}from'./builtin/workbench/locales.js';import style from'./builtin/workbench/style.css';
const sheet=document.createElement('style');sheet.textContent=style;document.head.append(sheet);
const entries=new Map([['folder',{type:'directory'}],['folder/main.ts',{type:'file',text:'export const original = 1;'}]]),history=new Map(),projects=new Map(),t=key=>zh[key]||key;
let token=0;const api={
 async list(path){return{entries:[...entries].filter(([name])=>name.split('/').slice(0,-1).join('/')===path).map(([path,item])=>({path,name:path.split('/').at(-1),type:item.type})),truncated:false}},
 async read(path){const item=entries.get(path);if(!item||item.type!=='file')throw new Error('WORKBENCH_NOT_FILE');return{path,text:item.text,version:'v1'}},
 project:async()=>({files:[],truncated:false}),
 async fileOperation(input){if(input.action==='absolutePath')return{path:'/demo'};if(input.action==='releaseHistory')return{path:''};
 if(input.action==='undo'||input.action==='redo'){const record=history.get(input.token);for(const[path]of record.entries)if(input.action==='undo')entries.set(path,record.entries.get(path));else entries.delete(path);return{path:record.path,token:input.token}}
 const path=input.action==='copy'?input.destination:input.path;
 const saved=input.action==='trash'?new Map([...entries].filter(([name])=>name===path||name.startsWith(path+'/'))):new Map();
 if(input.action==='trash')for(const[name]of saved)entries.delete(name);else entries.set(path,input.action==='createDirectory'?{type:'directory'}:input.action==='copy'?{...entries.get(input.path)}:{type:'file',text:''});
 const id=String(++token);history.set(id,{path,entries:saved});return{path,token:id}}};
const a=createWorkbench(api,t,{projects}),b=createWorkbench(api,t,{projects});
function Button({children,...props}){return <button {...props}>{children}</button>}
function Tree({workbench,id}){const snapshot=useSyncExternalStore(workbench.subscribe,workbench.snapshot);return <section className='sc-workbench' data-view={id} data-palette={snapshot.preferences.palette}><h2>{id==='a'?'主窗口':'另一窗口'}</h2><Files snapshot={snapshot} workbench={workbench} Button={Button} t={t} visible/><FileActions snapshot={snapshot} workbench={workbench} Button={Button} t={t}/>{snapshot.panel?.kind==='fileAction'&&<FileAction dialog={snapshot.panel} workbench={workbench} Button={Button} t={t}/>}</section>}
const root=createRoot(document.getElementById('root'));root.render(<><Tree id='a' workbench={a}/><Tree id='b' workbench={b}/></>);
window.test={a,b,async ready(){await a.attach(document.querySelector('#editor-a'),document.body);await b.attach(document.querySelector('#editor-b'),document.body)},dispose(){root.unmount();a.dispose();b.dispose();for(const project of projects.values())project.dispose()}};`;
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text' } });
const server = createServer((req, res) => { res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? app.outputFiles[0].contents : '<!doctype html><meta charset="utf-8"><style>body{margin:0}#root{height:650px;display:flex;gap:16px;padding:12px}section[data-view]{width:45%;display:flex;flex-direction:column;padding:12px;background:var(--wb-bg);color:var(--wb-text);border:1px solid var(--wb-line)}.sc-wb-files{height:100%}</style><div id="root"></div><div id="editor-a" hidden></div><div id="editor-b" hidden></div><script type="module" src="/app.js"></script>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('两个实际文件树的文件操作同步和恢复', { timeout: 30000 }, async t => {
    let page, errors;
    t.beforeEach(async () => {
      page = await browser.newPage({ viewport: { width: 1200, height: 760 } }); page.setDefaultTimeout(2500); errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => !!window.test); await page.evaluate(() => window.test.ready());
    });
    t.afterEach(async () => { await page.evaluate(() => window.test.dispose()); await page.close(); assert.deepEqual(errors, []); });
    const tree = id => page.locator(`[data-view="${id}"]`);
    const folder = id => tree(id).locator('[data-tree-path="folder"] button');
    const expand = async id => { await folder(id).click(); await tree(id).locator('[data-tree-path="folder/main.ts"]').waitFor(); };
    await t.test('真实右键创建后另一目录树立即显示，另一视图的文件名搜索随之更新', async () => {
      await expand('a'); await expand('b');
      await folder('a').click({ button: 'right' }); await page.getByRole('menuitem', { name: '新建文件', exact: true }).click();
      await tree('a').getByRole('textbox', { name: '名称', exact: true }).fill('new.ts');
      await tree('a').getByRole('button', { name: '确定', exact: true }).click();
      await tree('b').locator('[data-tree-path="folder/new.ts"]').waitFor();
      await tree('b').getByRole('combobox', { name: '搜索文件', exact: true }).fill('new.ts');
      await tree('b').locator('.sc-wb-file-matches button[title="folder/new.ts"]').waitFor();
      await page.evaluate(() => window.test.a.fileOperation({ action: 'copy', path: 'folder/main.ts', destination: 'folder/copied.ts' }));
      await tree('b').getByRole('combobox', { name: '搜索文件', exact: true }).fill('copied.ts');
      await tree('b').locator('.sc-wb-file-matches button[title="folder/copied.ts"]').waitFor();
    });
    for (const id of ['a', 'b']) await t.test(`${id === 'a' ? '原' : '另一'}窗口回收目录并撤销后不会显示空的展开文件夹`, async () => {
      await expand('a'); await expand('b');
      await page.evaluate(() => window.test.a.fileOperation({ action: 'trash', path: 'folder' }));
      await page.waitForFunction(() => !document.querySelector('[data-view="b"] [data-tree-path="folder"]'));
      await page.evaluate(() => window.test.a.undo());
      await folder(id).waitFor();
      const isExpanded = await folder(id).getAttribute('aria-expanded');
      if (isExpanded === 'false') await folder(id).click();
      await tree(id).locator('[data-tree-path="folder/main.ts"]').waitFor();
    });
    await t.test('亮色和暗色目录操作演示无页面异常', async () => {
      for (const [palette, colorScheme] of [['idea', 'light'], ['vscode', 'dark']]) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate(({palette,colorScheme}) => { document.body.toggleAttribute('data-ds-dark-theme', colorScheme === 'dark'); for (const c of [window.test.a,window.test.b]) c.settings({ ...c.snapshot().preferences, palette }); }, {palette,colorScheme});
        assert.equal(await tree('a').evaluate(node => getComputedStyle(node).backgroundColor), colorScheme === 'dark' ? 'rgb(31, 31, 31)' : 'rgb(255, 255, 255)');
        await expand('a'); await expand('b');
        await page.evaluate(() => window.test.a.fileOperation({ action: 'createFile', path: 'folder/created.ts' }));
        await tree('b').locator('[data-tree-path="folder/created.ts"]').waitFor();
        if (process.env.SC_TEST_ARTIFACTS) { await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, `files-sync-${palette}-${colorScheme}.png`) }); }
        // 下一主题使用新页面，保持同一操作的初始状态。
        if (palette === 'idea') { await page.evaluate(() => window.test.dispose()); await page.reload(); await page.waitForFunction(() => !!window.test); await page.evaluate(() => window.test.ready()); }
      }
    });
  });
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
