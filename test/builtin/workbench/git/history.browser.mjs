// 先运行 npm run build，再运行 node --test test/builtin/workbench/git/history.browser.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Context } from '@deepseek-ai/cordis';
import LocalFS from '@deepseek-ai/dsh-fs-local';
import { register } from 'tsx/esm/api';

const candidate = process.env.SC_TEST_PACKAGE;
const unregister = candidate ? null : register();
test.after(() => unregister?.());
const load = file => candidate ? import(pathToFileURL(join(candidate, 'lib/workbench', file + '.js'))) : import(new URL('../../../../src/workbench/' + file + '.ts', import.meta.url));
const { GitRepository } = await load('git/repository'), { library } = await load('git/library'), { WorkbenchFiles } = await load('files');

const repo = fileURLToPath(new URL('../../../../', import.meta.url)), require = createRequire(import.meta.url);
const { build } = require('esbuild'), playwright = require('playwright');
const validation = process.env.SUPER_CODE_TEST_ROOT || fileURLToPath(new URL('../../../../../source/validation/dsh-super-code/unit/', import.meta.url));
await mkdir(validation, { recursive: true });
const root = await mkdtemp(join(validation, 'history-browser-')), options = { fs: await import('node:fs/promises'), dir: root };
const author = { name: 'Demo Developer', email: 'demo@example.invalid' };
const code = n => `/** Calculate a total. */\nexport function total(value: number): number {\n  return value + ${n};\n}\n`;
await library.git.init({ ...options, defaultBranch: 'main' });
for (let i = 0; i < 36; i++) {
  await writeFile(join(root, 'main.ts'), code(i)); await library.git.add({ ...options, filepath: 'main.ts' });
  await library.git.commit({ ...options, author, message: `Update total ${i}` });
}
const native = new GitRepository(root), builtin = new GitRepository(root, join(root, 'no-git'));
const ctx = new Context(); await ctx.plugin(LocalFS, { cwd: root, diffBasisMaxBytes: 1024 });
const files = new WorkbenchFiles(ctx.fs, async () => ({ cwd: root }));
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {createWorkbench} from './builtin/workbench/controller.js';
import {Workbench} from './builtin/workbench/components/Workbench.jsx';
import {zh,en} from './builtin/workbench/locales.js';
import stylesheet from './builtin/workbench/style.css';
const query=new URLSearchParams(location.search),dict=query.get('language')==='en'?en:zh,t=key=>dict[key]||key;
const style=document.createElement('style');style.textContent=stylesheet;document.head.append(style);
if(query.has('dark'))document.body.setAttribute('data-ds-dark-theme','');
let gate=false,fail=false,historyCalls=0;const pending=[];
async function post(method,input,signal){const res=await fetch('/rpc',{method:'POST',signal,headers:{'content-type':'application/json'},body:JSON.stringify({method,input,backend:query.get('backend')})});const out=await res.json();if(out.error)throw new Error(out.error);return out.value}
const api={list:(path,signal)=>post('list',path,signal),project:signal=>post('project',null,signal),read:(path,signal)=>post('read',path,signal),
 fileOperation:async input=>input.action==='absolutePath'?{path:'/demo'}:{},models:async()=>[],
 async git(input,signal){if(input.action==='lineHistory')historyCalls++;if(fail&&input.action==='lineHistory')throw new Error('WORKBENCH_GIT_STALE');const result=await post('git',input,signal);if(gate&&['lineHistory','lineHistoryDiff'].includes(input.action))await new Promise(resolve=>pending.push(resolve));return result},
};
const controller=createWorkbench(api,t),mount=createRoot(document.getElementById('root'));
function Button({children,...props}){return <button {...props}>{children}</button>}
function Select({label,value,choices,onChange}){return <select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{choices.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}
function Conversation({openFile}){return <div className="sc-wb-conversation"><div className="dsh-super-code-detail-entry"><div className="dsh-super-code-detail-content markdown"><p>查看 <code><button title="Open demo file" onClick={()=>openFile('main.ts',{line:3})}><svg viewBox="0 0 16 16"><path d="M3 2h10v12H3z"/></svg>main.ts</button></code> 与 <a href="#demo-link" onClick={event=>{event.preventDefault();window.links++}}>文档链接</a>。</p><div className="demo-code-toolbar"><button title="Copy demo code">Copy</button></div><pre><code>total(2)</code></pre></div></div></div>}
mount.render(<Workbench workbench={controller} Button={Button} Select={Select} MarkdownText={({text})=><div>{text}</div>} Conversation={Conversation} sessionId="demo" fileContext={()=>({cwd:'/demo'})} t={t}/>);
window.links=0;window.test={controller,ready:()=>controller.snapshot().directories.has(''),visit:()=>controller.visit({file:'main.ts'}),
 select:(from,to=from)=>controller.view().dispatch({selection:{anchor:from,head:to}}),panel:()=>controller.snapshot().panel,
 prefs:palette=>controller.settings({...controller.snapshot().preferences,palette}),gate:value=>{gate=value},fail:value=>{fail=value},count:()=>pending.length,calls:()=>historyCalls,
 release:()=>{for(const resolve of pending.splice(0))resolve()},dispose:()=>{mount.unmount();controller.dispose()}};
`;
const worker = await build({ entryPoints: [join(repo, 'builtin/workbench/analysis/worker.js')], bundle: true, write: false, format: 'iife', platform: 'browser' });
const built = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text' }, define: { __WORKBENCH_ANALYSIS_WORKER__: JSON.stringify(worker.outputFiles[0].text) } });
const html = '<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}.markdown{font:14px/1.6 sans-serif}.markdown :not(pre)>code{font-size:.875em!important;padding:0 5px}.dsh-super-code-detail-entry button{border:1px solid #ddd;padding:5px 8px;margin:0 8px 10px 0;font-size:12px}</style><div id="root"></div><script type="module" src="/app.js"></script>';
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/rpc') {
      const abort = new AbortController(); res.once('close', () => abort.abort());
      let text = ''; for await (const part of req) text += part;
      const { method, input, backend } = JSON.parse(text);
      let value;
      if (method === 'git') value = await (backend === 'builtin' ? builtin : native).execute(input, undefined, abort.signal);
      else if (method === 'project') value = await files.project('demo', abort.signal);
      else if (method === 'read') value = await files.read('demo', input, abort.signal);
      else if (method === 'list') value = await files.list('demo', input, abort.signal);
      else throw new Error('Unsupported test method');
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ value })); return;
    }
    res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/app.js' ? built.outputFiles[0].contents : html);
  } catch (error) { if (!res.destroyed) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: error.message })); } }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await playwright[process.env.SC_TEST_BROWSER || 'chromium'].launch({ headless: true, executablePath: process.env.SC_TEST_EXECUTABLE || undefined });
try {
  await test('代码历史与紧凑对话真实浏览器交互', async t => {
    async function run(name, query, action) {
      await t.test(name, async () => {
        const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }), errors = [];
        page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000);
        try {
          await page.goto(`http://127.0.0.1:${server.address().port}/?${query}`);
          await page.waitForFunction(() => window.test?.ready()); await page.evaluate(() => window.test.visit());
          await page.evaluate(() => window.test.select(window.test.controller.view().state.doc.toString().indexOf('return')));
          await action(page); assert.deepEqual(errors, []);
        } finally { await page.evaluate(() => window.test.dispose()); await page.close(); }
      });
    }
    for (const backend of ['native', 'builtin']) await run(`${backend}：从函数入口追踪36次修改、虚拟滚动和按需对比`, `backend=${backend}`, async page => {
      await page.locator('[data-toolbar-action="codeHistory"]').click();
      await page.locator('.sc-wb-code-history-list button').first().waitFor();
      assert.equal((await page.evaluate(() => window.test.panel())).title, '函数历史');
      assert.match(await page.locator('.sc-wb-code-history .sc-wb-git-toolbar').textContent(), /36/);
      assert.ok(await page.locator('.sc-wb-code-history-list button').count() < 25);
      await page.locator('.sc-wb-code-history-list button').first().click();
      await page.locator('.sc-wb-code-history .cm-content').filter({ hasText: 'return value + 35' }).waitFor();
      const numbers = await page.locator('.sc-wb-code-history .cm-lineNumbers').evaluateAll(elements => elements.map(element => [...element.querySelectorAll('.cm-gutterElement')].filter(line => getComputedStyle(line).visibility !== 'hidden').map(line => line.textContent)));
      assert.deepEqual(numbers.map(lines => lines[0]), ['2', '2']);
      await page.locator('.sc-wb-code-history-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
      await page.locator('.sc-wb-code-history-list button').last().click();
      await page.locator('.sc-wb-code-history .cm-content').filter({ hasText: 'return value + 0' }).waitFor();
      if (process.env.SC_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, `${process.env.SC_TEST_BROWSER || 'chromium'}-${backend}-history.png`) });
      await page.keyboard.press('Escape'); await page.locator('.sc-wb-code-history').waitFor({ state: 'detached' });
    });
    await run('显式选区优先，停止后晚到结果不能覆盖重新查询，关闭也取消读取', 'backend=builtin', async page => {
      await page.evaluate(() => { const doc=window.test.controller.view().state.doc;window.test.select(doc.line(3).from,doc.line(3).to);window.test.gate(true); });
      await page.locator('[data-toolbar-action="codeHistory"]').click();
      await page.waitForFunction(() => window.test.count() === 1);
      await page.getByRole('button', { name: '停止', exact: true }).click();
      await page.evaluate(() => { window.test.gate(false); });
      await page.locator('.sc-wb-code-history button[title="刷新文件与索引"]').click();
      await page.locator('.sc-wb-code-history-list button').first().waitFor();
      await page.evaluate(() => window.test.release());
      assert.equal((await page.evaluate(() => window.test.panel())).title, '选区历史');
      await page.evaluate(() => window.test.gate(true));
      await page.locator('.sc-wb-code-history-list button').first().click();
      await page.waitForFunction(() => window.test.count() === 1);
      await page.keyboard.press('Escape'); await page.evaluate(() => window.test.release());
      await page.locator('.sc-wb-code-history').waitFor({ state: 'detached' });
    });
    await run('历史查询失败显示错误并可重试', 'backend=builtin&language=en', async page => {
      await page.evaluate(() => window.test.fail(true)); await page.locator('[data-toolbar-action="codeHistory"]').click();
      await page.getByRole('alert').filter({ hasText: 'repository changed' }).waitFor();
      await page.evaluate(() => window.test.fail(false)); await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.locator('.sc-wb-code-history-list button').first().waitFor();
    });
    await run('独立窗口打开后内嵌历史仍可完成，关窗不重复查询', 'backend=builtin', async page => {
      await page.evaluate(() => window.test.gate(true));
      await page.locator('[data-toolbar-action="codeHistory"]').click();
      await page.waitForFunction(() => window.test.count() === 1);
      await page.evaluate(() => window.test.controller.windowState({ state: 'active' }));
      assert.equal(await page.locator('.sc-wb-code-history').isVisible(),true);
      await page.evaluate(() => { window.test.gate(false); window.test.release(); });
      await page.locator('.sc-wb-code-history-list button').first().waitFor();
      assert.match(await page.locator('.sc-wb-code-history .sc-wb-git-toolbar').textContent(), /36/);
      await page.evaluate(() => window.test.controller.windowState(null));
      assert.equal(await page.evaluate(() => window.test.calls()),1);
    });
    for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) await run(`${palette} ${dark ? '暗色' : '亮色'}：文件链接、文字与图标紧凑，点击保持有效`, `backend=builtin${dark ? '&dark=1' : ''}`, async page => {
      await page.evaluate(palette => window.test.prefs(palette), palette);
      const measured = await page.locator('.sc-wb-conversation').evaluate(element => {
        const button=element.querySelector('code button'),link=element.querySelector('a'),icon=button.querySelector('svg'),copy=element.querySelector('.demo-code-toolbar button');
        return {body:parseFloat(getComputedStyle(element.querySelector('p')).fontSize),link:parseFloat(getComputedStyle(link).fontSize),button:button.getBoundingClientRect().height,padding:getComputedStyle(button).padding,margin:getComputedStyle(button).margin,icon:icon.getBoundingClientRect().width,copy:getComputedStyle(copy).padding};
      });
      assert.equal(measured.link, measured.body); assert.ok(measured.button < 24); assert.equal(measured.padding, '0px'); assert.equal(measured.margin, '0px'); assert.ok(measured.icon <= 12); assert.notEqual(measured.copy, '0px');
      await page.getByRole('link', { name: '文档链接' }).click(); assert.equal(await page.evaluate(() => window.links), 1);
      await page.locator('button[title="Open demo file"]').click();
      await page.waitForFunction(() => window.test.controller.snapshot().cursor?.line === 2);
      if (process.env.SC_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, `${process.env.SC_TEST_BROWSER || 'chromium'}-${palette}-${dark ? 'dark' : 'light'}.png`) });
    });
  });
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
