import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = `import{createEditor}from'./builtin/workbench/editor/view.js';import{defaults}from'./builtin/workbench/editor/preferences.js';
import{SymbolIndex}from'./builtin/workbench/analysis/index.js';import{zh}from'./builtin/workbench/locales.js';import css from'./builtin/workbench/style.css';
import{EditorState}from'@codemirror/state';
const style=document.createElement('style');style.textContent=css;document.head.append(style);
const preferences={...defaults(),readerMode:true}, index=new SymbolIndex();
let file='sample.ts';const editor=createEditor({parent:document.getElementById('root'),tooltipParent:document.body,index,t:k=>zh[k]||k,changed(){},commands:{},assistant:{threads:()=>[],update(){}},currentFile:()=>file});
const source='/**\\n * 读取 **任务列表**。\\n * @param value 任务编号。\\n */\\nfunction read(value: number) { return value; }';
const show=async(path,text,settings=preferences,saved)=>{file=path;const state=await editor.state(path,()=>({text,saved}),settings);editor.show(state);editor.preferences(settings)};
await show(file,source);window.test={editor,preferences,source,show,EditorState};`;
const bundle = await build({ stdin: { contents: fixture, loader: 'js', resolveDir: repo }, bundle: true, write: false, platform: 'browser', format: 'esm', loader: { '.css': 'text' } });
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); }
  else { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root" class="sc-workbench"></div><script type="module" src="/app.js"></script>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('相同编辑器偏好不重复重建语言界面和阅读文档', async () => {
    const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`); await page.locator('.cm-reader-document').waitFor();
      assert.equal(await page.evaluate(() => {
        const node = document.querySelector('.cm-reader-document'), { editor, preferences } = window.test;
        editor.preferences(structuredClone(preferences));
        return node.isConnected;
      }), true, '重复快照中的相同偏好应保留文档 DOM');
      await page.locator('.cm-reader-document').getByRole('button', { name: '查看源码', exact: true }).click();
      const before = await page.evaluate(() => window.test.editor.view.state.selection.toJSON());
      await page.evaluate(() => { for (let i = 0; i < 20; i++) window.test.editor.preferences(structuredClone(window.test.preferences)); });
      assert.deepEqual(await page.evaluate(() => window.test.editor.view.state.selection.toJSON()), before);
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('End'); await page.keyboard.type(' 已更新');
      assert.ok((await page.evaluate(() => window.test.editor.view.state.doc.toString())).includes(' 已更新'));
      await page.evaluate(() => window.test.editor.preferences({ ...window.test.preferences, readerMode: false, fontSize: 18 }));
      await page.locator('.cm-reader-document').waitFor({ state: 'detached' });
      assert.equal(await page.locator('.cm-scroller').evaluate(node => getComputedStyle(node).fontSize), '18px');
      await page.evaluate(() => window.test.show('next.py', '"""\n项目说明。\n"""\ndef run():\n    return 1'));
      await page.locator('.cm-reader-document').waitFor();
      await page.locator('.cm-reader-document').getByText('项目说明。', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await test('无关设置实时更新不移走阅读控件焦点', async t => {
    const changes = [
      ['自动保存', { autoSave: '15' }], ['撤销步长', { undoLimit: 2000 }],
      ['工具栏顺序', { toolbar: [] }], ['快捷键提示', { showToolbarShortcuts: false }],
      ['工具文字', { showToolNames: false }], ['窗口模式', { windowMode: 'external' }],
      ['目录跟随', { followFile: false }], ['预览标签', { previewTabs: false }],
      ['快速对话思考', { quickReasoning: 'low' }], ['翻译思考', { translationReasoning: 'low' }],
      ['快速对话模型', { quickModel: { provider: 'demo', model: 'demo' } }],
      ['翻译模型', { translationModel: { provider: 'demo', model: 'demo' } }],
    ];
    for (const [name, patch] of changes) await t.test(name, async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const source = page.locator('.cm-reader-source');
        await source.waitFor(); await source.focus();
        const result = await page.evaluate(patch => {
          const { editor, preferences } = window.test;
          const control = document.activeElement, card = control.closest('.cm-reader-document');
          const sticky = editor.view.dom.querySelector('.cm-sticky');
          const text = editor.view.state.doc, selection = editor.view.state.selection.toJSON();
          editor.preferences({ ...preferences, ...patch });
          return { document: card.isConnected, sticky: sticky.isConnected, focused: document.activeElement === control,
            text: editor.view.state.doc === text, selection: JSON.stringify(editor.view.state.selection.toJSON()) === JSON.stringify(selection) };
        }, patch);
        assert.deepEqual(result, { document: true, sticky: true, focused: true, text: true, selection: true });
      } finally { await page.close(); }
    });
  });
  await test('主题和快捷键变化保留阅读器，粘性行开关只更新粘性行', async () => {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.locator('.cm-reader-source').waitFor();
      const result = await page.evaluate(() => {
        const { editor, preferences } = window.test;
        const control = document.querySelector('.cm-reader-source'), card = control.closest('.cm-reader-document');
        const sticky = editor.view.dom.querySelector('.cm-sticky'), theme = editor.view.themeClasses;
        control.focus();
        editor.preferences({ ...preferences, palette: 'vscode', keymap: 'vscode' });
        const themed = { reader: card.isConnected, sticky: sticky.isConnected, focused: document.activeElement === control, themeChanged: editor.view.themeClasses !== theme };
        editor.preferences({ ...preferences, palette: 'vscode', keymap: 'vscode', stickyScroll: false });
        const disabled = { reader: card.isConnected, sticky: sticky.isConnected, focused: document.activeElement === control };
        editor.preferences(preferences);
        return { themed, disabled, restored: !!editor.view.dom.querySelector('.cm-sticky') };
      });
      assert.deepEqual(result, { themed: { reader: true, sticky: true, focused: true, themeChanged: true }, disabled: { reader: true, sticky: false, focused: true }, restored: true });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await test('首次显示状态后，无关的首次设置同步也保留阅读控件', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.locator('.cm-reader-document').waitFor();
      await page.evaluate(async () => {
        const { editor, preferences, source } = window.test;
        editor.show(await editor.state('sample.ts', () => ({ text: source }), preferences));
      });
      await page.locator('.cm-reader-source').waitFor();
      const result = await page.evaluate(() => {
        const { editor, preferences } = window.test, control = document.querySelector('.cm-reader-source');
        const sticky = editor.view.dom.querySelector('.cm-sticky'); control.focus();
        editor.preferences({ ...preferences, autoSave: '15' });
        return { document: control.isConnected, sticky: sticky.isConnected, focused: document.activeElement === control };
      });
      assert.deepEqual(result, { document: true, sticky: true, focused: true });
    } finally { await page.close(); }
  });
  await test('字体和阅读器实时切换，保留源码、选区和只读状态', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.locator('.cm-reader-document').waitFor();
      await page.evaluate(() => {
        const { editor, preferences, source } = window.test;
        editor.view.dispatch({ selection: { anchor: source.indexOf('function') + 2 } });
        editor.readonly(true);
        editor.preferences({ ...preferences, fontSize: 18, lineHeight: 1.8, fontFamily: 'consolas', chineseFontFamily: 'local:Demo CJK', readerMode: false });
      });
      const style = await page.locator('.cm-scroller').evaluate(node => {
        const style = getComputedStyle(node); return { size: style.fontSize, height: style.lineHeight, font: style.fontFamily };
      });
      assert.equal(style.size, '18px');
      assert.ok(Math.abs(parseFloat(style.height) - 32.4) < 0.001);
      assert.equal(style.font.replaceAll('"', ''), 'Consolas, Demo CJK, Super Code JetBrains Mono, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, monospace');
      assert.equal(await page.evaluate(() => window.test.editor.view.lineWrapping), false);
      await page.evaluate(() => window.test.editor.preferences({ ...window.test.preferences, fontSize: 18, lineHeight: 1.8 }));
      assert.equal(await page.locator('.cm-scroller').evaluate(node => getComputedStyle(node).fontSize), '19px');
      await page.waitForFunction(() => window.test.editor.view.lineWrapping);
      assert.equal(await page.evaluate(() => window.test.editor.view.lineWrapping), true);
      assert.equal(await page.evaluate(() => window.test.editor.view.state.facet(window.test.EditorState.readOnly)), true);
      assert.equal(await page.evaluate(() => window.test.editor.view.state.selection.main.head), await page.evaluate(() => window.test.source.indexOf('function') + 2));
      assert.equal(await page.evaluate(() => window.test.editor.view.state.doc.toString()), await page.evaluate(() => window.test.source));
    } finally { await page.close(); }
  });
  await test('自定义快捷键立即替换且对象原地变更可被识别', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.locator('.cm-reader-document').waitFor();
      await page.evaluate(() => {
        const { editor, preferences, source } = window.test;
        window.test.next = { ...preferences, shortcuts: { comment: 'Alt-c' } };
        editor.preferences(window.test.next);
        editor.view.dispatch({ selection: { anchor: source.indexOf('function') } }); editor.view.focus();
      });
      await page.keyboard.press('Control+/');
      assert.equal(await page.evaluate(() => window.test.editor.view.state.doc.toString()), await page.evaluate(() => window.test.source));
      await page.keyboard.press('Alt+c');
      assert.match(await page.evaluate(() => window.test.editor.view.state.doc.toString()), /\/\/ function read/);
      await page.evaluate(() => { window.test.next.shortcuts.comment = 'Alt-x'; window.test.editor.preferences(window.test.next); });
      await page.keyboard.press('Alt+c');
      assert.match(await page.evaluate(() => window.test.editor.view.state.doc.toString()), /\/\/ function read/);
      await page.keyboard.press('Alt+x');
      assert.equal(await page.evaluate(() => window.test.editor.view.state.doc.toString()), await page.evaluate(() => window.test.source));
    } finally { await page.close(); }
  });
  await test('换文件及恢复旧状态使用当前偏好，不残留前一文件的配置', async () => {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.locator('.cm-reader-document').waitFor();
      await page.evaluate(async () => {
        const { editor, preferences, show } = window.test;
        window.test.saved = editor.view.state;
        await show('next.py', '"""\nPython 项目说明。\n"""\ndef run():\n    return 1', { ...preferences, readerMode: false, stickyScroll: false, fontSize: 18 });
      });
      assert.equal(await page.locator('.cm-reader-document,.cm-sticky').count(), 0);
      await page.evaluate(async () => {
        const { show, source, preferences, saved } = window.test;
        await show('sample.ts', source, { ...preferences, palette: 'vscode', fontSize: 16 }, saved);
      });
      await page.locator('.cm-reader-document').getByText('读取', { exact: false }).waitFor();
      assert.equal(await page.locator('.cm-scroller').evaluate(node => getComputedStyle(node).fontSize), '17px');
      assert.equal(await page.locator('.cm-sticky').count(), 1);
      await page.evaluate(() => { window.test.editor.dispose(); window.test.editor.preferences(window.test.preferences); });
      assert.equal(await page.locator('.cm-editor').count(), 0);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
