import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { Context } from '@deepseek-ai/cordis';
import LocalFS from '@deepseek-ai/dsh-fs-local';
import { register } from 'tsx/esm/api';

const candidate = process.env.SC_TEST_PACKAGE;
const unregister = candidate ? null : register();
test.after(() => unregister?.());
const load = file => candidate ? import(pathToFileURL(join(candidate, 'lib/workbench', file + '.js'))) : import(new URL('../../../../src/workbench/' + file + '.ts', import.meta.url));
const { GitRepository } = await load('git/repository'), { WorkbenchFiles } = await load('files'), { library } = await load('git/library');

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const validation = process.env.SUPER_CODE_TEST_ROOT || fileURLToPath(new URL('../../../../../source/validation/dsh-super-code/unit/', import.meta.url));
await mkdir(validation, { recursive: true });
const directory = await mkdtemp(join(validation, 'git-edits-browser-')), projects = new Map();
const author = { name: 'Demo Developer', email: 'demo@example.invalid' }, signal = new AbortController().signal;
const base = 'export const first = 1;\n\nexport function sum(value: number) {\n  return value + 1;\n}\n\nexport const last = 1;\n';
const changed = base.replace('first = 1', 'first = 2').replace('last = 1', 'last = 2');
for (const backend of ['native', 'builtin']) {
  const root = join(directory, backend); await mkdir(root);
  const git = new GitRepository(root, backend === 'native' ? 'git' : join(root, 'absent-git'));
  const state = async () => (await git.execute({ action: 'status' }, undefined, signal)).state;
  const act = async input => git.execute({ ...input, version: (await state()).version }, undefined, signal);
  const commit = async message => { await act({ action: 'stage', paths: (await state()).changes.map(file => file.path) }); await act({ action: 'commit', message, author }); };
  await git.execute({ action: 'init', branch: 'main' }, undefined, signal);
  await library.git.setConfig({ fs: await import('node:fs/promises'), dir: root, path: 'user.name', value: author.name });
  await library.git.setConfig({ fs: await import('node:fs/promises'), dir: root, path: 'user.email', value: author.email });
  await writeFile(join(root, 'a.ts'), base); await writeFile(join(root, 'conflict.txt'), 'base\n'); await writeFile(join(root, 'other.txt'), 'base\n'); await commit('base');
  await act({ action: 'branch', branch: 'feature' }); await act({ action: 'checkout', branch: 'feature' });
  await writeFile(join(root, 'conflict.txt'), 'incoming\n'); await writeFile(join(root, 'other.txt'), 'incoming\n'); await commit('incoming');
  await act({ action: 'checkout', branch: 'main' });
  await writeFile(join(root, 'conflict.txt'), 'current\n'); await writeFile(join(root, 'other.txt'), 'current\n'); await commit('current');
  await writeFile(join(root, 'a.ts'), changed);
  const ctx = new Context(); await ctx.plugin(LocalFS, { cwd: root, diffBasisMaxBytes: 1024 });
  projects.set(backend, { root, git, ctx, files: new WorkbenchFiles(ctx.fs, async () => ({ cwd: root })), state, act });
}
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';
import {Workbench} from './builtin/workbench/components/Workbench.jsx';import {createWorkbench} from './builtin/workbench/controller.js';
import {zh,en} from './builtin/workbench/locales.js';import stylesheet from './builtin/workbench/style.css';
const query=new URLSearchParams(location.search),language=query.get('language'),t=key=>(language==='en'?en:zh)[key]||key;
const sheet=document.createElement('style');sheet.textContent=stylesheet;document.head.append(sheet);
if(query.has('dark'))document.body.setAttribute('data-ds-dark-theme','');
async function call(method,input,signal){const response=await fetch('/rpc',{method:'POST',signal,body:JSON.stringify({backend:query.get('backend'),method,input})}),value=await response.json();if(value.error)throw new Error(value.error);return value.result}
const api={git:(input,signal)=>call('git',input,signal),list:(path,signal)=>call('list',path,signal),read:(path,signal)=>call('read',path,signal),project:signal=>call('project',null,signal),save:(input,signal)=>call('save',input,signal),fileOperation:async()=>({path:'/demo'}),models:async()=>[]};
const controller=createWorkbench(api,t),root=createRoot(document.getElementById('root'));
function Button({children,...props}){return <button type='button' {...props}>{children}</button>}
function Select({label,value,choices,onChange}){return <select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{choices.map(([v,label])=><option key={v} value={v}>{label}</option>)}</select>}
function Conversation(){return <p>演示对话</p>}
root.render(<Workbench workbench={controller} Button={Button} Select={Select} Conversation={Conversation} sessionId='demo' fileContext={()=>({cwd:'/demo'})} t={t}/>);
window.test={controller,api,ready:()=>controller.snapshot().directories.has(''),dispose:()=>{root.unmount();controller.dispose()}};`;
const worker = await build({ entryPoints: [join(repo, 'builtin/workbench/analysis/worker.js')], bundle: true, write: false, format: 'iife', platform: 'browser' });
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text' }, define: { __WORKBENCH_ANALYSIS_WORKER__: JSON.stringify(worker.outputFiles[0].text) } });
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/rpc') {
      let body = ''; for await (const part of req) body += part;
      const { backend, method, input } = JSON.parse(body), project = projects.get(backend);
      const abort = new AbortController(); res.once('close', () => abort.abort());
      const result = method === 'git' ? await project.git.execute(input, undefined, abort.signal)
        : method === 'project' ? await project.files.project('demo', abort.signal)
        : await project.files[method]('demo', input, abort.signal);
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result }));
    } else {
      res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
      res.end(req.url === '/app.js' ? app.outputFiles[0].contents : '<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>');
    }
  } catch (error) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  for (const [backend, project] of projects) await test(`${backend}：真实仓库经工作台界面逐段还原与三栏解决冲突`, { timeout: 90000 }, async t => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 960 } }), errors = [];
    page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    const capture = async name => { if (process.env.SC_TEST_ARTIFACTS) { await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, `${backend}-${name}.png`) }); } };
    const refresh = async () => { await page.evaluate(() => window.test.controller.changes.refresh()); };
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/?backend=${backend}`); await page.waitForFunction(() => window.test?.ready());
      await page.evaluate(() => window.test.controller.visit({ file: 'a.ts' }));
      await page.evaluate(() => window.test.controller.panel({ kind: 'git', title: 'Git' }));
      await t.test('切换分支已写入后关闭Git面板，编辑器仍同步实际文件', async () => {
        await writeFile(join(project.root, 'a.ts'), base); await refresh();
        await page.evaluate(async () => {
          await window.test.controller.visit({ file: 'conflict.txt' });
          const execute = window.test.api.git;
          window.test.api.git = async (input, signal) => {
            const result = await execute(input, signal);
            if (input.action === 'checkout') {
              window.test.gitWritten = true;
              await new Promise(resolve => { window.test.releaseGit = () => { window.test.api.git = execute; resolve(); }; });
            }
            return result;
          };
        });
        await page.getByRole('button', { name: '分支', exact: true }).click();
        await page.locator('.sc-wb-git-branch').filter({ hasText: 'feature' }).getByRole('button', { name: '切换', exact: true }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: '确认操作', exact: true }).click();
        await page.waitForFunction(() => window.test.gitWritten);
        assert.equal(await readFile(join(project.root, 'conflict.txt'), 'utf8'), 'incoming\n');
        await page.evaluate(() => { window.test.controller.panel(null); window.test.releaseGit(); });
        await page.waitForFunction(() => window.test.controller.view().state.doc.toString() === 'incoming\n');
        assert.equal(await page.evaluate(() => window.test.controller.documents.get('conflict.txt').dirty), false);
        await page.evaluate(async () => {
          const controller = window.test.controller, state = await controller.git({ action: 'status' });
          await controller.git({ action: 'checkout', branch: 'main', version: state.state.version });
          await controller.visit({ file: 'a.ts' });
          controller.panel({ kind: 'git', title: 'Git' });
        });
        await writeFile(join(project.root, 'a.ts'), changed);
        await page.evaluate(() => window.test.controller.refresh()); await refresh();
      });
      await t.test('点击右箭头只还原选中段，编辑器共享文本立即同步', async () => {
        await page.locator('.sc-wb-git-file>button[title="a.ts"]').click();
        try { await page.getByRole('button', { name: '还原这段变化 2', exact: true }).waitFor(); }
        catch (failure) { await capture('failed-hunks'); throw new Error(JSON.stringify({ error: failure.message, body: await page.locator('.sc-wb-git').innerText(), errors })); }
        await capture('hunks');
        await page.getByRole('button', { name: '还原这段变化 1', exact: true }).click();
        await page.waitForFunction(() => window.test.controller.view().state.doc.toString().includes('first = 1;'));
        assert.equal(await readFile(join(project.root, 'a.ts'), 'utf8'), base.replace('last = 1', 'last = 2'));
        await page.getByRole('button', { name: '还原这段变化 1', exact: true }).click();
        await page.locator('.sc-wb-git-file>button[title="a.ts"]').waitFor({ state: 'detached' });
        assert.equal(await readFile(join(project.root, 'a.ts'), 'utf8'), base);
      });
      await t.test('已暂存的右箭头只修改索引，工作区文本保留', async () => {
        await writeFile(join(project.root, 'a.ts'), changed); await project.act({ action: 'stage', paths: ['a.ts'] }); await refresh();
        await page.locator('.sc-wb-git-file>button[title="a.ts"]').click();
        await page.getByRole('button', { name: '还原这段变化 2', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('.sc-wb-hunk-restore').length === 1);
        const options = { fs: await import('node:fs/promises'), dir: project.root };
        const [oid] = await library.git.walk({ ...options, trees: [library.git.STAGE()], map: async (path, [entry]) => path === 'a.ts' ? entry.oid() : undefined });
        const { blob } = await library.git.readBlob({ ...options, oid });
        assert.equal(Buffer.from(blob).toString(), changed.replace('last = 2', 'last = 1'));
        assert.equal(await readFile(join(project.root, 'a.ts'), 'utf8'), changed);
        await page.getByRole('button', { name: '还原这段变化 1', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.sc-wb-git').getAttribute('aria-busy') === 'false');
        await writeFile(join(project.root, 'a.ts'), base); await refresh();
      });
      await t.test('三栏编辑在占用及外部变动时保留草稿，重新加载后保存只暂存不提交', async () => {
        const head = (await project.state()).head;
        await project.act({ action: 'merge', branch: 'feature', author }); await refresh();
        await page.locator('.sc-wb-git-file>button[title="conflict.txt"]').click();
        try { await page.getByRole('textbox', { name: '最终结果', exact: true }).waitFor(); }
        catch (failure) { await capture('failed-conflict'); throw new Error(JSON.stringify({ error: failure.message, body: await page.locator('.sc-wb-git').innerText(), errors, panel: await page.evaluate(() => window.test.controller.snapshot().panel) })); }
        assert.deepEqual(await page.locator('.sc-wb-conflict-columns>section>header>span').allTextContents(), ['当前版本（旧）', '最终结果', '传入版本（新）']);
        assert.equal(await page.getByRole('button', { name: '保存并标记为已解决', exact: true }).isDisabled(), true);
        assert.equal(await page.getByRole('textbox', { name: '当前版本（旧）', exact: true }).getAttribute('contenteditable'), 'false');
        await capture('conflict');
        await page.getByRole('button', { name: '采用传入段', exact: true }).click();
        const final = page.getByRole('textbox', { name: '最终结果', exact: true });
        await final.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type('edited final');
        const original = await readFile(join(project.root, 'conflict.txt'), 'utf8');
        await writeFile(join(project.root, '.git/index.lock'), 'external');
        try {
          await page.getByRole('button', { name: '保存并标记为已解决', exact: true }).click();
          await page.locator('.sc-wb-conflict [role="alert"]').waitFor();
          assert.match(await final.innerText(), /edited final/);
          assert.equal(await readFile(join(project.root, 'conflict.txt'), 'utf8'), original);
        } finally { await rm(join(project.root, '.git/index.lock')); }
        await writeFile(join(project.root, 'a.ts'), '// external change\n' + base);
        await page.getByRole('button', { name: '保存并标记为已解决', exact: true }).click();
        await page.locator('.sc-wb-conflict [role="alert"]').filter({ hasText: '仓库已变化' }).waitFor();
        assert.match(await final.innerText(), /edited final/);
        assert.equal(await readFile(join(project.root, 'conflict.txt'), 'utf8'), original);
        await page.getByRole('button', { name: '放弃草稿并重新加载', exact: true }).click();
        await final.getByText('<<<<<<<', { exact: false }).waitFor();
        await page.getByRole('button', { name: '采用传入段', exact: true }).click();
        await final.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type('edited final');
        await page.getByRole('button', { name: '保存并标记为已解决', exact: true }).click();
        await page.locator('.sc-wb-conflict').waitFor({ state: 'detached' });
        assert.equal(await readFile(join(project.root, 'conflict.txt'), 'utf8'), 'incoming\nedited final');
        assert.equal((await project.state()).head, head); assert.equal((await project.state()).changes.find(file => file.path === 'other.txt').conflict, true);
        assert.equal((await project.state()).changes.some(file => file.path === 'conflict.txt' && file.conflict), false);
      });
      await t.test('侧栏冲突入口与普通差异共用能力，两种主题均可操作', async () => {
        await page.evaluate(() => { window.test.controller.panel(null); });
        await page.locator('.sc-wb-side-rail-right').getByRole('button', { name: '修改文件', exact: true }).click();
        await page.locator('.sc-wb-changes-list button').filter({ hasText: 'other.txt' }).click();
        await page.getByRole('textbox', { name: '最终结果', exact: true }).waitFor();
        for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
          await page.evaluate(({palette,dark}) => { window.test.controller.settings({ ...window.test.controller.snapshot().preferences, palette }); document.body.toggleAttribute('data-ds-dark-theme', dark); }, { palette, dark });
          await page.getByRole('textbox', { name: '最终结果', exact: true }).waitFor(); await capture(`conflict-${palette}-${dark ? 'dark' : 'light'}`);
        }
        await page.getByRole('button', { name: '全部采用当前版本', exact: true }).click();
        await page.getByRole('button', { name: '保存并标记为已解决', exact: true }).click();
        await page.locator('.sc-wb-conflict').waitFor({ state: 'detached' });
        assert.equal(await readFile(join(project.root, 'other.txt'), 'utf8'), 'current\n');
        assert.equal((await project.state()).changes.some(file => file.conflict), false);
        assert.equal((await project.state()).merging, true);
      });
      assert.deepEqual(errors, []);
    } finally { await page.evaluate(() => window.test?.dispose()).catch(() => {}); await page.close(); }
  });
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  for (const project of projects.values()) await project.ctx.fiber.dispose();
  await rm(directory, { recursive: true, force: true });
}
