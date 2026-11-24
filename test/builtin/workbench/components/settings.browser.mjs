import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = `import React,{useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';import {apply,createWorkbenchPreference} from './builtin/workbench/index.jsx';
import {Settings} from './builtin/workbench/components/Settings.jsx';import {zh,en} from './builtin/workbench/locales.js';
import { SelectControl } from './builtin/ui/controls.js';
const query=new URLSearchParams(location.search),t=key=>(query.has('en')?en:zh)[key]||key;
if(query.has('dark'))document.body.setAttribute('data-ds-dark-theme','');
Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'granted'})}});window.queryLocalFonts=async()=>[{family:'Menlo'},{family:'Songti SC'}];
let writeFailure=false;const write=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(writeFailure&&key==='dsh-super-code-workbench')throw Error('storage unavailable');return write.call(this,key,value)};
let failure=query.has('fail'),calls=0;const remote={async fonts(){return {ok:true,value:['Menlo','Songti SC']}},async models(_session,signal){calls++;signal.throwIfAborted();if(failure)throw Error('catalog unavailable');return {ok:true,value:[{provider:'demo',model:'fast',name:'Demo Fast',current:true,efforts:[{id:'off',name:'Off'},{id:'high',name:'High'}]},{provider:'demo',model:'plain',name:'Demo Plain',efforts:[]}]}}};
const contributions=new Map(),disposers=[],preference=createWorkbenchPreference(localStorage);preference.save({enabled:true});
const ctx={effect(run){const d=run();if(typeof d==='function')disposers.push(d)},inject(names,run){if(names.includes('remote.superCodeWorkbench'))run(ctx)},
 locale:{register:()=>()=>{},bind:()=>t,getLocale:()=>({active:'zh',locales:[{id:'zh',label:'中文'}]})},remote:{superCodeWorkbench:remote},
 sessions:{list:{getSnapshot:()=>({byId:{first:{cwd:'/demo/first'},second:{cwd:'/demo/second'}}})}},sidebarRightTabs:{register:()=>()=>{}},
 slots:{entries:()=>[],inject(_name,run){const d=run();if(typeof d==='function')disposers.push(d)},register(value,component){contributions.set(value.id,{value,component});return ()=>contributions.delete(value.id)}}};
function Button({children,...props}){return <button type='button' {...props}>{children}</button>}
const ui=apply(ctx,{Button,Select:SelectControl,MarkdownText:'div',Conversation:'div',preference});
const entry=contributions.get('super-code-workbench').value,first=entry.inject('first').workbench,second=entry.inject('second').workbench;
function Editor(){const snapshot=useSyncExternalStore(first.subscribe,first.snapshot);return <section className='sc-workbench' data-palette={snapshot.preferences.palette}><Settings workbench={first} preferences={snapshot.preferences} Button={Button} Select={SelectControl} t={t}/></section>}
const root=createRoot(document.getElementById('root'));root.render(<main><section id='global'><ui.Settings remote={remote}/></section><section id='editor'><Editor/></section></main>);
window.test={first,second,calls:()=>calls,failure:value=>{failure=value},writeFailure:value=>{writeFailure=value},dispose(){root.unmount();for(const d of disposers.reverse())d()}};`;
const bundle = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, platform: 'browser', format: 'esm', external: ['@deepseek-ai/*'], loader: { '.css': 'text', '.woff2': 'dataurl' } });
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); }
  else { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><style>body{margin:0}body[data-ds-dark-theme]{background:#1e1e1e}.sc-workbench{background:var(--wb-bg)}.dsh-super-code-select-trigger{display:inline-flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--wb-line);border-radius:4px;background:var(--wb-bg);color:var(--wb-text);padding:6px 8px;cursor:pointer}.dsh-super-code-select-trigger>svg{width:12px;height:12px}main{display:flex;gap:32px;padding:20px}main>section{flex:1;min-width:0}.dsh-super-code-select{position:relative}.dsh-super-code-select-menu{position:fixed;background:var(--wb-bg,#fff);color:var(--wb-text,#222);z-index:100;max-height:300px;overflow:auto;border:1px solid #888}.dsh-super-code-select-option{padding:6px;cursor:pointer}.dsh-super-code-select-option svg{width:12px}</style><div id="root"></div><script type="module" src="/app.js"></script>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('Super Code与编辑器设置共用全局偏好', async t => {
    const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } }), errors = [];
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    const global = page.locator('#global'), editor = page.locator('#editor');
    async function select(scope, label, choice) {
      await scope.getByRole('combobox', { name: label, exact: true }).click();
      await page.getByRole('option', { name: choice, exact: true }).click();
    }
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await global.getByRole('combobox', { name: '快速对话思考', exact: true }).waitFor();
    await t.test('默认均关闭思考，当前模型选择不改变主对话', async () => {
      for (const label of ['快速对话思考', '翻译思考']) for (const scope of [global, editor]) assert.match(await scope.getByRole('combobox', { name: label, exact: true }).innerText(), /关闭/);
      assert.equal(await global.getByText('自定义快捷键', { exact: true }).count(), 0);
      assert.equal(await global.getByText('语言环境', {exact:true}).count(),0);
      assert.equal(await editor.getByRole('heading',{name:'语言环境',exact:true}).count(),1);
      assert.equal(await editor.locator('.sc-wb-settings-group .sc-wb-section').getByText('自定义快捷键', { exact: true }).count(), 1);
      assert.equal(await editor.locator('.sc-wb-settings-nav').getByRole('button', { name: '自定义快捷键', exact: true }).count(), 1);
    });
    await t.test('工具文字默认显示，两个设置入口即时同步，文字不触发开关且刷新后保留', async () => {
      const checkbox = scope => scope.getByRole('checkbox', { name: '显示工具文字', exact: true });
      for (const scope of [global, editor]) assert.equal(await checkbox(scope).isChecked(), true);
      await global.locator('.sc-wb-setting > span').getByText('显示工具文字', { exact: true }).click();
      assert.equal(await checkbox(global).isChecked(), true, '点击文字不应切换开关');
      await checkbox(global).uncheck();
      assert.equal(await checkbox(editor).isChecked(), false);
      assert.equal(await page.evaluate(() => window.test.second.snapshot().preferences.showToolNames), false);
      await checkbox(editor).check();
      assert.equal(await checkbox(global).isChecked(), true);
      await checkbox(editor).uncheck();
      await page.reload(); await checkbox(global).waitFor();
      for (const scope of [global, editor]) assert.equal(await checkbox(scope).isChecked(), false);
      assert.equal(await page.evaluate(() => window.test.second.snapshot().preferences.showToolNames), false);
      await checkbox(global).check();
    });
    await t.test('阅读字体、字号、行距和开关在全局、编辑器与其他会话同步', async () => {
      await select(global, '英文代码字体', 'Menlo'); await select(editor, '中文回退字体', 'Songti SC'); await select(editor, '代码字号', '16 px'); await select(global, '代码行距', '1.7');
      await global.getByRole('checkbox', { name: '阅读器模式', exact: true }).check();
      await editor.getByRole('checkbox', { name: '滚动时保留作用域标题', exact: true }).uncheck();
      assert.match(await editor.getByRole('combobox', { name: '英文代码字体', exact: true }).innerText(), /Menlo/);
      assert.match(await global.getByRole('combobox', { name: '中文回退字体', exact: true }).innerText(), /Songti SC/);
      assert.equal(await editor.getByRole('checkbox', { name: '阅读器模式', exact: true }).isChecked(), true);
      const preferences = await page.evaluate(() => window.test.second.snapshot().preferences);
      assert.equal(preferences.fontFamily, 'menlo'); assert.equal(preferences.chineseFontFamily, 'local:Songti SC'); assert.equal(preferences.fontSize, 16); assert.equal(preferences.lineHeight, 1.7); assert.equal(preferences.readerMode, true); assert.equal(preferences.stickyScroll, false);
      await page.reload(); await global.getByRole('checkbox', { name: '阅读器模式', exact: true }).waitFor();
      assert.equal(await global.getByRole('checkbox', { name: '阅读器模式', exact: true }).isChecked(), true);
      assert.equal(await page.evaluate(() => window.test.second.snapshot().preferences.stickyScroll), false);
      assert.equal(await page.evaluate(() => window.test.second.snapshot().preferences.chineseFontFamily), 'local:Songti SC');
    });
    await t.test('全局入口修改模型及思考，编辑器和另一会话即时同步', async () => {
      await select(global, '快速对话模型', 'Demo Fast'); await select(global, '快速对话思考', 'High');
      assert.match(await editor.getByRole('combobox', { name: '快速对话思考', exact: true }).innerText(), /High/);
      assert.equal(await page.evaluate(() => window.test.second.snapshot().preferences.quickReasoning), 'high');
      await select(editor, '翻译模型', 'Demo Fast'); await select(editor, '翻译思考', 'High');
      assert.match(await global.getByRole('combobox', { name: '翻译思考', exact: true }).innerText(), /High/);
      assert.equal(await page.evaluate(() => window.test.second.snapshot().preferences.translationReasoning), 'high');
    });
    await t.test('主题、保存和快捷键显示等共用设置可反向更新，刷新后保留', async () => {
      await select(global, '工作台主题', 'VS Code'); await select(editor, '自动保存', '停止修改 15 秒后');
      await global.getByRole('checkbox', { name: '显示顶栏快捷键' }).uncheck();
      assert.equal(await editor.getByRole('checkbox', { name: '显示顶栏快捷键' }).isChecked(), false);
      await page.reload(); await global.getByRole('combobox', { name: '快速对话思考', exact: true }).waitFor();
      assert.match(await editor.getByRole('combobox', { name: '快速对话思考', exact: true }).innerText(), /High/);
      assert.match(await global.getByRole('combobox', { name: '工作台主题', exact: true }).innerText(), /VS Code/);
    });
    await t.test('模型目录失败保留已有选择，重试后可恢复，切换模型将思考重置为关闭', async () => {
      await page.goto(`http://127.0.0.1:${server.address().port}/?fail`);
      await global.getByRole('alert').waitFor();
      assert.equal(await page.evaluate(() => window.test.second.snapshot().preferences.quickModel.model), 'fast');
      assert.equal(await global.getByRole('combobox', { name: '快速对话思考', exact: true }).isDisabled(), true);
      await page.evaluate(() => window.test.failure(false));
      await global.getByRole('button', { name: '重新加载模型', exact: true }).click();
      await editor.getByRole('button', { name: '重新加载模型', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('#global .sc-wb-model-settings [role=alert]') && !document.querySelector('#editor .sc-wb-model-settings [role=alert]'));
      await select(global, '快速对话模型', 'Demo Plain');
      assert.equal(await page.evaluate(() => window.test.first.snapshot().preferences.quickReasoning), 'off');
      assert.equal(await page.evaluate(() => window.test.first.snapshot().preferences.translationReasoning), 'high');
    });
    await t.test('关键词筛选和高亮不重新挂载模型目录，清空与空结果可恢复', async () => {
      const search = editor.getByRole('searchbox', { name: '搜索设置', exact: true });
      assert.equal(await search.count(), 1);
      const calls = await page.evaluate(() => window.test.calls());
      await search.fill('自动 保存');
      assert.equal(await editor.locator('[data-setting]:visible').count(), 1);
      assert.equal(await editor.getByRole('combobox', { name: '自动保存', exact: true }).isVisible(), true);
      assert.equal(await editor.locator('[data-setting=autoSave] mark').allTextContents().then(parts => parts.join('')), '自动保存');
      assert.equal(await editor.locator('.sc-wb-settings-nav button:visible').count(), 1);
      await search.fill('FONT size');
      assert.equal(await editor.locator('[data-setting]:visible').count(), 1);
      assert.equal(await editor.getByRole('combobox', { name: '代码字号', exact: true }).isVisible(), true);
      await search.fill('no-such-setting');
      assert.equal(await editor.getByText('没有匹配的设置', { exact: true }).isVisible(), true);
      await editor.getByRole('button', { name: '清除筛选', exact: true }).click();
      assert.equal(await editor.getByRole('combobox', { name: '工作台主题', exact: true }).isVisible(), true);
      assert.equal(await page.evaluate(() => window.test.calls()), calls);
    });
    await t.test('只看修改项，逐项恢复保留其他值并同步到另一入口、会话和刷新后的页面', async () => {
      await select(global, '代码字号', '18 px');
      const before = await page.evaluate(() => window.test.first.snapshot().preferences);
      await editor.getByRole('checkbox', { name: '只看已修改', exact: true }).check();
      assert.equal(await editor.locator('[data-setting=fontSize]').getByText('已修改', { exact: true }).isVisible(), true);
      await editor.locator('[data-setting=fontSize]').getByRole('button', { name: '恢复默认：代码字号', exact: true }).click();
      assert.equal(await editor.locator('[data-setting=fontSize]').isVisible(), false);
      assert.deepEqual(await page.evaluate(() => window.test.second.snapshot().preferences), { ...before, fontSize: 14 });
      assert.match(await global.getByRole('combobox', { name: '代码字号', exact: true }).innerText(), /14 px/);
      await page.reload(); await global.getByRole('combobox', { name: '代码字号', exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.test.first.snapshot().preferences), { ...before, fontSize: 14 });
    });
    await t.test('恢复失败保留原值与修改标记，重试只恢复模型并保留思考设置', async () => {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await select(global, '快速对话模型', 'Demo Fast'); await select(global, '快速对话思考', 'High');
      const before = await page.evaluate(() => window.test.first.snapshot().preferences);
      const reset = global.locator('[data-setting=quickModel]').getByRole('button', { name: '恢复默认：快速对话模型', exact: true });
      await page.evaluate(() => window.test.writeFailure(true)); await reset.click();
      await global.getByRole('alert').filter({ hasText: '未能保存' }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.test.second.snapshot().preferences), before);
      assert.equal(await global.locator('[data-setting=quickModel]').getByText('已修改', { exact: true }).isVisible(), true);
      await page.evaluate(() => window.test.writeFailure(false)); await reset.click();
      const expected = { ...before }; delete expected.quickModel;
      assert.deepEqual(await page.evaluate(() => window.test.second.snapshot().preferences), expected);
      assert.match(await global.getByRole('combobox', { name: '快速对话思考', exact: true }).innerText(), /High/);
      assert.equal(await global.getByRole('alert').count(), 0);
    });
    await t.test('工具栏显隐与顺序独立恢复，快捷键只恢复当前项', async () => {
      const back = editor.locator('[data-toolbar-setting=back]');
      await back.getByRole('button', { name: '下移 后退', exact: true }).click();
      await back.getByRole('checkbox').uncheck();
      const before = await page.evaluate(() => window.test.first.snapshot().preferences);
      await back.getByRole('button', { name: '恢复默认：后退', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.test.first.snapshot().preferences.toolbar), before.toolbar.map(item => item.id === 'back' ? { ...item, visible: true } : item));
      await back.getByRole('checkbox').uncheck();
      await editor.locator('[data-setting=toolbarOrder]').getByRole('button', { name: '恢复默认：工具排列顺序', exact: true }).click();
      const toolbar = await page.evaluate(() => window.test.first.snapshot().preferences.toolbar);
      assert.equal(toolbar[0].id, 'back'); assert.equal(toolbar[0].visible, false);
      const shortcut = editor.locator('[data-setting="shortcuts.save"]');
      await shortcut.getByRole('button', { name: '保存文件', exact: true }).click(); await page.keyboard.press('Control+Alt+s');
      await editor.getByRole('alert').filter({ hasText: '此组合键已被使用' }).waitFor();
      assert.equal(await page.evaluate(() => window.test.first.snapshot().preferences.shortcuts.save), undefined);
      await page.keyboard.press('Control+Alt+g');
      assert.equal(await page.evaluate(() => window.test.first.snapshot().preferences.shortcuts.save), 'Ctrl-Alt-g');
      await shortcut.getByRole('button', { name: '恢复默认：保存文件', exact: true }).click();
      assert.equal(await page.evaluate(() => window.test.first.snapshot().preferences.shortcuts.save), undefined);
      assert.deepEqual(await page.evaluate(() => window.test.first.snapshot().preferences.toolbar), toolbar);
    });
    await t.test('保存失败保留输入，切换筛选后可继续编辑', async () => {
      const input = global.getByRole('spinbutton', { name: '最大撤销历史步数', exact: true });
      const before = await page.evaluate(() => window.test.first.snapshot().preferences.undoLimit);
      await page.evaluate(() => window.test.writeFailure(true)); await input.fill('1200'); await input.press('Tab');
      await global.getByRole('alert').waitFor();
      assert.equal(await input.inputValue(), '1200');
      assert.equal(await page.evaluate(() => window.test.first.snapshot().preferences.undoLimit), before);
      await global.getByRole('searchbox', { name: '搜索设置', exact: true }).fill('字体');
      await global.getByRole('button', { name: '清除筛选', exact: true }).click();
      assert.equal(await input.inputValue(), '1200');
      await page.evaluate(() => window.test.writeFailure(false)); await input.focus(); await input.press('Tab');
      assert.equal(await page.evaluate(() => window.test.first.snapshot().preferences.undoLimit), 1200);
    });
    await t.test('明暗主题、英文及窄屏保留设置和对齐', async () => {
      for (const suffix of ['?dark', '?en', '?en&dark']) {
        await page.goto(`http://127.0.0.1:${server.address().port}/${suffix}`);
        await global.locator('.sc-wb-model-setting').first().waitFor();
        assert.equal(await global.locator('.sc-wb-model-setting').count(), 2);
        await page.setViewportSize({ width: 1000, height: 900 });
        for (const scope of [global, editor]) assert.equal(await scope.locator('.sc-wb-settings-content').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
        if (process.env.SC_TEST_ARTIFACTS) { await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, `${process.env.SC_TEST_BROWSER || 'chromium'}-settings-${suffix.replace(/\W/g, '')}.png`) }); }
      }
      await page.evaluate(() => { document.body.style.zoom = '2'; document.querySelector('#global').style.display = 'none'; });
      await editor.getByRole('searchbox', { name: 'Search settings', exact: true }).fill('font');
      await editor.getByRole('checkbox', { name: 'Modified only', exact: true }).check();
      assert.equal(await editor.locator('.sc-wb-settings-content').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      await editor.locator('[data-setting=fontFamily]').getByRole('button', { name: 'Reset: English code font', exact: true }).click();
      assert.equal(await page.evaluate(() => window.test.first.snapshot().preferences.fontFamily), 'jetbrains');
      if (process.env.SC_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, 'settings-english-zoom.png') });
    });
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.test.dispose()); await page.close();
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
