import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { tsImport } from 'tsx/esm/api';
import { fixture } from './fixture.mjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const { WorkbenchWindows } = await tsImport('../../../../src/workbench/window.ts', import.meta.url);
const windows = new WorkbenchWindows(undefined, () => readFile(join(repo, 'dist/window.js')));
const moveFixture = fixture.replace('const controller=createWorkbench', `
const moves=new Map();
api.fileOperation=async input=>{
  if(input.action==='absolutePath')return{path:query.get('root')||'/demo'};
  if(input.action==='releaseHistory'){for(const token of input.tokens)moves.delete(token);return{path:''}}
  const record=input.token?moves.get(input.token):null;
  const from=record?(record.undone?record.from:record.to):input.path,to=record?(record.undone?record.to:record.from):input.destination;
  if(!(from in texts))throw Error('WORKBENCH_NOT_FILE');
  if(to in texts)throw Error('WORKBENCH_FILE_EXISTS');
  if(input.version&&input.version!==versionOf(from))throw Error('WORKBENCH_CONFLICT');
  if(!to||to.startsWith('/')||to.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('WORKBENCH_PATH');
  if(to.includes('/')&&!to.startsWith('folder/'))throw Error('WORKBENCH_PATH');
  const previousVersion=versionOf(from);
  texts[to]=texts[from];delete texts[from];versions[to]='v'+(++revision);delete versions[from];
  if(query.has('recovery')){const disk=JSON.parse(sessionStorage.getItem('recovery-test-disk')||'{}');disk[from]=null;disk[to]=texts[to];sessionStorage.setItem('recovery-test-disk',JSON.stringify(disk))}
  const token=input.token||crypto.randomUUID();if(record)record.undone=!record.undone;else moves.set(token,{from,to,undone:false});
  return{path:to,previousPath:from,previousVersion,version:versionOf(to),token};
};
api.list=async path=>{const prefix=path?path+'/':'',entries=new Map();for(const file of Object.keys(texts)){if(!file.startsWith(prefix))continue;const tail=file.slice(prefix.length),name=tail.split('/')[0];entries.set(name,{name,path:prefix+name,type:tail.includes('/')?'directory':'file'})}return{entries:[...entries.values()],truncated:false}};
const controller=createWorkbench`).replace('window.test={controller', 'window.test={grammar:()=>syntaxTree(controller.view().state).type.name,controller');
const app = await build({ stdin: { contents: "import {syntaxTree} from '@codemirror/language';\n" + moveFixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text', '.woff2': 'dataurl' } });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (url.pathname === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(app.outputFiles[0].contents); return; }
    if (url.pathname === '/events') {
      const abort = new AbortController(); res.on('close', () => abort.abort()); res.setHeader('content-type', 'application/x-ndjson'); res.flushHeaders();
      for await (const event of windows.events('demo', url.searchParams.get('id'), abort.signal)) res.write(JSON.stringify(event) + '\n');
      res.end(); return;
    }
    const reply = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
    if (url.pathname === '/open') { reply(await windows.open('demo', false)); return; }
    if (url.pathname === '/send') { windows.send('demo', body.id, body.content); reply({}); return; }
    if (url.pathname === '/close') { windows.close('demo', body.id); reply({}); return; }
    res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>');
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
const evidence = process.env.SC_TEST_ARTIFACTS;
const capture = async (page, name) => { if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, name + '.png'), animations: 'disabled' }); } };
try {
  await test('普通文件改名与移动（真实界面、可控文件 API）', { timeout: 90000 }, async t => {
    let page, errors;
    const tab = (target, path) => target.locator(`[data-file-tab="${path}"][data-kind="file"]`);
    const menu = async (target, path, name) => { await tab(target, path).click({ button: 'right' }); await target.getByRole('menuitem', { name, exact: true }).click(); };
    const ready = () => page.waitForFunction(() => window.test && !window.test.controller.snapshot().indexing && !window.test.controller.snapshot().drafts.loading);
    const open = path => page.evaluate(async path => { const c = window.test.controller; await c.visit({ file: path }); c.keepTab(path); }, path);
    const confirm = async (target, name) => { await target.locator('.sc-wb-file-dialog input').fill(name); await target.locator('.sc-wb-file-dialog').getByRole('button', { name: /^(确定|Confirm)$/ }).click(); };
    const stored = async paths => {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        const value = await page.evaluate(() => window.test.draftStore.read('/demo'));
        if (JSON.stringify(value?.entries.map(item => item.path).sort()) === JSON.stringify([...paths].sort())) return value;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.fail('恢复副本路径没有及时更新');
    };
    t.beforeEach(async () => {
      page = await browser.newPage({ viewport: { width: 1280, height: 920 } }); errors = [];
      page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/?drafts=move&recovery=move`); await ready();
      await page.evaluate(() => { const c = window.test.controller; return c.settings({ ...c.snapshot().preferences, previewTabs: false }); });
    });
    t.afterEach(async () => { await page.evaluate(() => window.test.dispose()); await page.close(); assert.deepEqual(errors, []); });

    await t.test('文件树改名保留固定标签、选择和未保存内容，恢复副本跟随路径', async () => {
      await open('b.ts');
      const before = await page.evaluate(async () => {
        const c = window.test.controller; await c.pinFile('b.ts');
        c.view().dispatch({ changes: { from: 0, insert: '// draft\n' }, selection: { anchor: 10, head: 16 } });
        return { text: c.view().state.doc.toString(), from: c.view().state.selection.main.from };
      });
      await stored(['b.ts']);
      await page.locator('[data-tree-path="b.ts"] button').click({ button: 'right' });
      await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
      assert.equal(await page.locator('.sc-wb-file-dialog input').inputValue(), 'b.ts');
      await capture(page, 'rename-light'); await confirm(page, '中文 新名.ts');
      await tab(page, '中文 新名.ts').waitFor();
      assert.deepEqual(await page.evaluate(() => { const c=window.test.controller; return {text:c.view().state.doc.toString(),from:c.view().state.selection.main.from}; }), before);
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().tabs[0].pinned), true);
      assert.doesNotMatch(await page.evaluate(() => window.test.texts['中文 新名.ts']), /draft/);
      const record = await stored(['中文 新名.ts']); assert.equal(record.entries[0].text, before.text);
      await page.locator('[data-toolbar-action=save]').click(); await stored([]);
      assert.equal(await page.evaluate(() => window.test.texts['中文 新名.ts']), before.text);
    });
    await t.test('移动到已有目录，拒绝同名和越界目标，输入仍保留', async () => {
      await open('b.ts'); await page.evaluate(() => window.test.theme('idea', true));
      await menu(page, 'b.ts', '移动到…'); await confirm(page, 'a.ts');
      await page.locator('.sc-wb-file-dialog [role=alert]').filter({ hasText: '目标已存在' }).waitFor();
      assert.equal(await page.locator('.sc-wb-file-dialog input').inputValue(), 'a.ts');
      await capture(page, 'move-dark-error');
      await confirm(page, '../outside.ts'); await page.locator('.sc-wb-file-dialog [role=alert]').filter({ hasText: '工作目录' }).waitFor();
      await confirm(page, 'folder/moved.ts'); await tab(page, 'folder/moved.ts').waitFor();
      assert.equal(await page.evaluate(() => 'b.ts' in window.test.texts), false);
      await page.locator('[data-tree-path="folder/moved.ts"]').waitFor();
      await page.evaluate(() => window.test.controller.undo()); await tab(page, 'b.ts').waitFor();
      await page.evaluate(() => window.test.controller.undo('redo')); await tab(page, 'folder/moved.ts').waitFor();
    });
    await t.test('改后缀重新载入语言并保留光标，后续输入仍写入新文件', async () => {
      await open('folder/test.py'); assert.equal(await page.evaluate(() => window.test.grammar()), 'Script');
      await page.evaluate(() => window.test.controller.view().dispatch({ selection: { anchor: 4, head: 11 } }));
      await menu(page, 'folder/test.py', '重命名'); await confirm(page, 'test.json');
      await page.waitForFunction(() => window.test.controller.snapshot().file === 'folder/test.json' && window.test.grammar() === 'JsonText');
      assert.equal(await page.evaluate(() => window.test.controller.view().state.selection.main.from), 4);
      await page.evaluate(() => window.test.controller.view().dispatch({ changes: { from: 0, to: window.test.controller.view().state.doc.length, insert: '{"answer":42}' } }));
      await page.locator('[data-toolbar-action=save]').click();
      assert.equal(await page.evaluate(() => window.test.texts['folder/test.json']), '{"answer":42}');
    });
    await t.test('独立窗口改名同步原页面和分栏，窗口可继续编辑及撤销', async () => {
      await open('b.ts'); await menu(page, 'b.ts', '向右分栏');
      await page.waitForFunction(() => document.querySelectorAll('.sc-wb-editor-group:not([hidden])').length === 2);
      const opened = page.waitForEvent('popup'); await page.locator('[data-toolbar-action=window]').click(); const popup = await opened;
      popup.setDefaultTimeout(6000); popup.on('pageerror', error => errors.push(error.message));
      try {
        await tab(popup, 'b.ts').waitFor(); await menu(popup, 'b.ts', '重命名'); await confirm(popup, 'window.ts');
        await tab(popup, 'window.ts').waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll('.sc-wb-editor-group:not([hidden])')].every(group => group.querySelector('[data-file-tab="window.ts"]')));
        const content = popup.locator('.sc-wb-editor .cm-content').first();
        await content.click(); await popup.keyboard.press('ControlOrMeta+Home'); await popup.keyboard.type('// window ');
        await page.waitForFunction(() => window.test.controller.documents.get('window.ts').text.includes('// window'));
        await capture(popup, 'move-window');
        await page.evaluate(async () => { const c = window.test.controller; await c.undo(); await c.undo(); });
        await tab(popup, 'b.ts').waitFor();
      } finally { await popup.close(); }
    });
    await t.test('刷新后的待恢复副本随移动更新路径，可在新路径恢复', async () => {
      await open('b.ts'); await page.evaluate(() => window.test.controller.view().dispatch({ changes: { from: 0, insert: '// recovery\n' } }));
      await stored(['b.ts']); await page.reload(); await ready();
      await open('b.ts'); await menu(page, 'b.ts', '移动到…'); await confirm(page, 'folder/recovery.ts');
      await tab(page, 'folder/recovery.ts').waitFor(); await stored(['folder/recovery.ts']);
      await page.locator('.sc-wb-status').getByRole('button', { name: /未保存文件/ }).click();
      await page.locator('.sc-wb-drafts').getByRole('button', { name: '恢复为草稿', exact: true }).click();
      await page.waitForFunction(() => window.test.controller.documents.get('folder/recovery.ts').dirty);
      assert.match(await page.evaluate(() => window.test.controller.view().state.doc.toString()), /^\/\/ recovery/);
    });
    await t.test('英文 200% 显示完整路径、提示和操作，取消不改变文件', async () => {
      await open('b.ts'); await page.evaluate(() => { window.test.locale(); document.body.style.zoom = '2'; });
      await menu(page, 'b.ts', 'Move to…');
      await page.locator('.sc-wb-file-dialog input').fill('folder/a-long-destination-file-name.ts');
      const dialog = page.locator('.sc-wb-file-dialog');
      for (const button of await dialog.getByRole('button', { name: /^(Cancel|Confirm)$/ }).all()) {
        const box = await button.boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= 920);
      }
      await capture(page, 'move-english-200');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().file), 'b.ts');
    });
  });
} finally { await browser.close(); await windows.dispose(); await new Promise(resolve => server.close(resolve)); }
