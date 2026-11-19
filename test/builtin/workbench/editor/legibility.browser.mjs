import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';
import{Workbench}from'./builtin/workbench/components/Workbench.jsx';import{createWorkbench}from'./builtin/workbench/controller.js';
import{zh}from'./builtin/workbench/locales.js';import css from'./builtin/workbench/style.css';import fonts from'./builtin/workbench/fonts/style.js';
const style=document.createElement('style');style.textContent=fonts+css;document.head.append(style);
const texts={'tasks.ts':[
'/** 汇总任务，保留原始列表。 */','export function summarize(tasks: Task[]): Summary {','  const pending = tasks.filter(task => !task.done);',
'  return { count: pending.length, label: "待处理任务" };','}','',
'export class TaskStore {','  async load(workspace: string): Promise<Task[]> {','    const result = await fetch(workspace);','    if (!result.ok) {',
'      throw new Error("无法读取任务");','    }','    return result.json();','  }','',
'  group(tasks: Task[]): Map<string, Task[]> {','    const groups = new Map<string, Task[]>();','    for (const task of tasks) {','      if (!task.done) {',
'        const group = groups.get(task.project) ?? [];','        group.push(task);','        groups.set(task.project, group);','      }','    }','    return groups;','  }','}',
].join('\\n'),'tasks.py':'class TaskStore:\\n    def summarize(self, tasks):\\n        for task in tasks:\\n            if task.active:\\n                print(task.name)\\n',
'tabs.go':'package main\\nfunc run() {\\n\\tfor i := 0; i < 3; i++ {\\n\\t\\tprintln(i)\\n\\t}\\n}'};
const api={fileOperation:async()=>({path:'/sample-project'}),list:async()=>({entries:Object.keys(texts).map(path=>({name:path,path,type:'file'})),truncated:false}),read:async path=>({path,text:texts[path],version:'v1'}),project:async()=>({files:Object.keys(texts),truncated:false}),models:async()=>[],fonts:async()=>[]};
const t=k=>zh[k]||k,c=createWorkbench(api,t),root=createRoot(document.getElementById('root'));
function Button({children,...props}){return <button type='button' {...props}>{children}</button>}
function Select({label,value,choices,onChange}){return <select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{choices.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}
c.layout.change({outlineOpen:false,panes:{conversation:false,quick:false,changes:false,learning:false}});
root.render(<Workbench workbench={c} Button={Button} Select={Select} Conversation={()=>null} sessionId='reading' t={t}/>);
window.test={c,texts,theme:async(palette,dark)=>{document.body.toggleAttribute('data-ds-dark-theme',dark);await c.settings({...c.snapshot().preferences,palette})},
color:word=>{const v=c.view(),at=v.state.doc.toString().indexOf(word),target=v.domAtPos(at+1).node;return getComputedStyle(target.nodeType===3?target.parentElement:target).color},
dispose(){root.unmount();c.dispose()}};`;
const built = await build({ stdin: { contents: fixture, resolveDir: repo, loader: 'jsx' }, bundle: true, write: false, platform: 'browser', format: 'esm', loader: { '.css': 'text', '.woff2': 'dataurl' } });
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(built.outputFiles[0].contents); }
  else res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('代码区阅读层次、主题和折叠', async t => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
    page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.test?.c.snapshot().indexed === 3);
    await page.evaluate(() => window.test.c.visit({ file: 'tasks.ts' }));
    await page.evaluate(() => document.fonts.ready);
    const capture = async name => { if (process.env.SC_TEST_ARTIFACTS) { await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, name + '.png'), animations: 'disabled' }); } };
    await t.test('保留四种主题实际首屏、默认字号、字体和原文', async () => {
      for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
        await page.evaluate(({ palette, dark }) => window.test.theme(palette, dark), { palette, dark });
        await page.evaluate(() => window.test.c.view().focus());
        await capture(`${palette}-${dark ? 'dark' : 'light'}`);
      }
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), await page.evaluate(() => window.test.texts['tasks.ts']));
      assert.equal(await page.locator('.cm-scroller').evaluate(node => getComputedStyle(node).fontSize), '14px');
    });
    await t.test('函数声明与方法调用使用函数颜色，普通属性维持属性颜色', async () => {
      for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
        await page.evaluate(({ palette, dark }) => window.test.theme(palette, dark), { palette, dark });
        const colors = await page.evaluate(() => {
          const v=window.test.c.view(),probe=document.createElement('span');v.dom.append(probe);
          const get=name=>{probe.style.color='var('+name+')';return getComputedStyle(probe).color};
          const result={declaration:window.test.color('summarize'),method:window.test.color('filter'),property:window.test.color('length'),functionColor:get('--wb-function'),propertyColor:get('--wb-property')};probe.remove();return result;
        });
        assert.equal(colors.declaration, colors.functionColor, JSON.stringify({ palette, dark, colors }));
        assert.equal(colors.method, colors.functionColor);
        assert.equal(colors.property, colors.propertyColor);
      }
    });
    await t.test('缩进引导覆盖2空格、4空格和Tab，装饰不改变文本或字符位置', async () => {
      for (const file of ['tasks.ts', 'tasks.py', 'tabs.go']) {
        await page.evaluate(file => window.test.c.visit({ file }), file);
        const guides = page.locator('.cm-line[data-indent-columns]');
        assert.ok(await guides.count() > 0, file);
        const values = await guides.evaluateAll(nodes => nodes.map(node => ({ columns:Number(node.dataset.indentColumns),unit:Number(node.dataset.indentUnit),background:getComputedStyle(node).backgroundImage })));
        assert.ok(values.every(value => value.columns >= value.unit && value.unit > 0 && value.background.includes('gradient')), JSON.stringify(values));
        if (file === 'tasks.py') assert.ok(values.every(value => value.unit === 4));
        if (file === 'tabs.go') assert.ok(values.some(value => value.columns === 8));
        assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), await page.evaluate(file => window.test.texts[file], file));
      }
      await page.evaluate(() => window.test.c.visit({ file: 'tasks.ts' }));
    });
    await t.test('括号匹配跟随主题，折叠图形等大且折叠后可以恢复', async () => {
      await page.evaluate(() => { const v=window.test.c.view();v.dispatch({selection:{anchor:v.state.doc.toString().indexOf('(')+1}});v.focus() });
      await page.locator('.cm-matchingBracket').first().waitFor();
      for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
        await page.evaluate(({ palette, dark }) => window.test.theme(palette, dark), { palette, dark });
        const matching = await page.locator('.cm-matchingBracket').first().evaluate(node => {
          const probe=document.createElement('span');node.append(probe);probe.style.backgroundColor='var(--wb-bracket)';probe.style.outlineColor='var(--wb-bracket-line)';
          const result={background:getComputedStyle(node).backgroundColor,outline:getComputedStyle(node).outlineColor,expectedBackground:getComputedStyle(probe).backgroundColor,expectedOutline:getComputedStyle(probe).outlineColor};probe.remove();return result;
        });
        assert.equal(matching.background, matching.expectedBackground); assert.equal(matching.outline, matching.expectedOutline);
      }
      const marker=page.locator('.cm-foldGutter .cm-fold-chevron:visible').first(); await marker.waitFor();
      const before=await marker.boundingBox(); await marker.click();
      await page.locator('.cm-foldPlaceholder').first().waitFor();
      const folded=page.locator('.cm-foldGutter .cm-fold-chevron[data-open=false]:visible').first(),after=await folded.boundingBox();
      assert.equal(before.width,after.width);assert.equal(before.height,after.height);
      await folded.click(); await page.locator('.cm-foldPlaceholder').waitFor({state:'detached'});
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), await page.evaluate(() => window.test.texts['tasks.ts']));
    });
    await t.test('缩进线跟随字体和阅读模式缩放，单行拖选、搜索和撤销不受影响', async () => {
      const before = await page.evaluate(() => { const v=window.test.c.view();return {text:v.state.doc.toString(),selection:v.state.selection.main.toJSON()} });
      await page.evaluate(() => window.test.c.settings({...window.test.c.snapshot().preferences,fontSize:17,readerMode:true}));
      const dimensions = await page.locator('.cm-line[data-indent-columns]').first().evaluate(node => ({width:parseFloat(getComputedStyle(node).backgroundSize),columns:Number(node.dataset.indentColumns)}));
      const character = await page.evaluate(() => window.test.c.view().defaultCharacterWidth);
      assert.ok(Math.abs(dimensions.width - character * dimensions.columns) < 1);
      const range = await page.evaluate(() => {const v=window.test.c.view(),from=v.state.doc.toString().indexOf('pending'),a=v.coordsAtPos(from),b=v.coordsAtPos(from+7);return {from,x:a.left,y:(a.top+a.bottom)/2,to:b.left}});
      await page.mouse.move(range.x,range.y);await page.mouse.down();await page.mouse.move(range.to,range.y,{steps:8});await page.mouse.up();
      assert.equal(await page.evaluate(() => {const v=window.test.c.view(),r=v.state.selection.main;return v.state.doc.sliceString(r.from,r.to)}), 'pending');
      await page.keyboard.press('Control+f');await page.locator('.cm-search input[name=search]').fill('pending');await page.locator('.cm-searchMatch').first().waitFor();await page.keyboard.press('Escape');
      await page.evaluate(() => {const v=window.test.c.view();v.dispatch({changes:{from:0,insert:'// check\n'}})});await page.evaluate(() => window.test.c.undo());
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), before.text);
      await page.evaluate(() => window.test.c.settings({...window.test.c.snapshot().preferences,fontSize:14,readerMode:false}));
    });
    const find = page.locator('.sc-wb-find'), query = find.locator('input[name=search]');
    const status = find.getByRole('status');
    const source = () => page.evaluate(() => window.test.c.view().state.doc.toString());
    const preferences = patch => page.evaluate(patch => window.test.c.settings({ ...window.test.c.snapshot().preferences, ...patch }), patch);
    await t.test('打开文件查找关闭悬浮说明，查找按钮不会被气泡挡住', async () => {
      await preferences({ readerMode: false });
      const point = await page.evaluate(() => {
        const view = window.test.c.view(), at = view.state.doc.toString().indexOf('summarize');
        view.dispatch({ selection: { anchor: 0 } }); view.focus();
        const box = view.coordsAtPos(at + 2);
        return { x: box.left, y: (box.top + box.bottom) / 2 };
      });
      await page.mouse.move(point.x, point.y);
      await page.locator('.signature-tooltip').waitFor();
      await page.keyboard.press('Control+f');
      await page.locator('.signature-tooltip').waitFor({ state: 'detached' });
      await find.getByRole('button', { name: '区分大小写' }).click();
      assert.equal(await find.getByRole('button', { name: '区分大小写' }).getAttribute('aria-pressed'), 'true');
      await find.getByRole('button', { name: '区分大小写' }).click();
      await find.getByRole('button', { name: '关闭', exact: true }).click();
    });
    await t.test('文件内查找默认单行，结果位置和两套主题各自可辨认', async () => {
      const original = await source();
      await page.setViewportSize({ width: 1040, height: 650 });
      await preferences({ readerMode: true });
      await page.evaluate(() => { const v = window.test.c.view(); v.dispatch({ selection: { anchor: 0 } }); v.focus(); });
      await page.keyboard.press('Control+f');
      assert.equal(await find.locator('input[name=replace]').isVisible(), false);
      await query.fill('pending');
      assert.equal(await status.textContent(), '2 处');
      await query.press('Enter'); assert.equal(await status.textContent(), '1 / 2');
      await query.press('Shift+Enter'); assert.equal(await status.textContent(), '2 / 2');
      assert.equal(await page.locator('.selection-actions:visible').count(), 0);
      const colors = new Set();
      for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
        await page.evaluate(({ palette, dark }) => window.test.theme(palette, dark), { palette, dark });
        const layout = await find.evaluate(node => {
          const bar = node.getBoundingClientRect(), panels = node.closest('.cm-panels-top').getBoundingClientRect();
          const center = item => { const box = item.getBoundingClientRect(); return box.y + box.height / 2; };
          return { height: bar.height, end: Math.abs(bar.right - panels.right), inset: bar.left - panels.left,
            closeOffset: Math.abs(center(node.querySelector('[name=closeFind]')) - center(node.querySelector('input[name=search]'))),
            focused: document.activeElement === node.querySelector('input[name=search]') };
        });
        assert.ok(layout.height < 48 && layout.end < 1 && layout.closeOffset < 2 && layout.focused, JSON.stringify(layout));
        assert.ok(palette === 'idea' ? layout.inset < 1 : layout.inset > 100, JSON.stringify(layout));
        const color = await page.locator('.cm-searchMatch-selected').first().evaluate(node => getComputedStyle(node).backgroundColor);
        colors.add(color);
        await capture(`find-${palette}-${dark ? 'dark' : 'light'}`);
      }
      assert.equal(colors.size, 4);
      await page.setViewportSize({ width: 555, height: 650 });
      assert.equal(await find.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      await capture('find-narrow');
      await find.getByRole('button', { name: '关闭', exact: true }).click();
      assert.equal(await find.count(), 0);
      assert.equal(await page.locator('.cm-content').evaluate(node => document.activeElement === node), true);
      assert.equal(await source(), original);
      await page.setViewportSize({ width: 1040, height: 650 });
      const word = await page.evaluate(() => {
        const view = window.test.c.view(), at = view.state.doc.toString().indexOf('pending');
        const box = view.coordsAtPos(at + 2);
        return { x: box.left, y: (box.top + box.bottom) / 2 };
      });
      await page.mouse.dblclick(word.x, word.y);
      await page.locator('.selection-actions').waitFor();
    });
    await t.test('输入、中文组字、查找条件和正则错误即时反馈', async () => {
      await page.keyboard.press('Control+f');
      await query.fill('TaSk');
      const insensitive = Number.parseInt(await status.textContent(), 10);
      await find.getByRole('button', { name: '区分大小写' }).click();
      assert.ok(insensitive > 2);
      assert.equal(await status.textContent(), '无匹配');
      assert.equal(await find.locator('[name=next]').isDisabled(), true);
      await find.getByRole('button', { name: '区分大小写' }).click();
      await query.fill('Task');
      const prefix = Number.parseInt(await status.textContent(), 10);
      await find.getByRole('button', { name: '全词匹配' }).click();
      assert.ok(Number.parseInt(await status.textContent(), 10) < prefix);
      await find.getByRole('button', { name: '全词匹配' }).click();
      await query.evaluate(node => {
        node.value = '待处理任务';
        node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }));
      });
      assert.equal(Number.parseInt(await status.textContent(), 10), prefix);
      await query.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: node.value })));
      assert.equal(await status.textContent(), '1 处');
      await find.getByRole('button', { name: '正则表达式' }).click();
      await query.fill('[');
      assert.equal(await status.textContent(), '正则有误');
      assert.equal(await query.getAttribute('aria-invalid'), 'true');
      await query.fill('pend.ng'); await query.press('Enter');
      assert.equal(await status.isVisible(), false);
      assert.equal(await page.locator('.cm-searchMatch-selected').first().textContent(), 'pending');
      await find.getByRole('button', { name: '正则表达式' }).click();
      await query.press('Escape');
    });
    await t.test('Ctrl+R、替换单项及全部、撤销和关闭沿用当前文件', async () => {
      const original = await source();
      await page.keyboard.press('Control+r');
      const replacement = find.locator('input[name=replace]');
      assert.equal(await replacement.evaluate(node => node === document.activeElement), true);
      const toggle = find.getByRole('button', { name: '展开或收起替换' });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await query.fill('pending'); await query.press('Enter');
      await replacement.fill('remaining');
      await replacement.press('Control+r');
      assert.equal(await replacement.inputValue(), 'remaining');
      await replacement.press('Enter');
      assert.equal((await source()).match(/remaining/g)?.length, 1);
      await replacement.press('Escape');
      await page.evaluate(() => window.test.c.undo());
      assert.equal(await source(), original);
      await page.keyboard.press('Control+f');
      await toggle.click();
      await query.fill('pending'); await replacement.fill('queued');
      await capture('find-replace');
      await find.getByRole('button', { name: '全部替换', exact: true }).click();
      assert.equal((await source()).match(/queued/g)?.length, 2);
      assert.equal(await status.textContent(), '无匹配');
      await toggle.click(); assert.equal(await replacement.isVisible(), false);
      await query.press('Escape'); await page.evaluate(() => window.test.c.undo());
      assert.equal(await source(), original);
    });
    await t.test('阅读器只淡出屏外光标的同词，粘性标题、主动选择和查找跳转保留', async () => {
      await page.evaluate(() => {
        const { c, texts } = window.test;
        texts['reading.ts'] = ['class Store {', '  read() {', ...Array.from({ length: 180 }, (_, index) => `    const task${index} = ${index};`), '    return task152;', '  }', '}'].join('\n');
        return c.visit({ file: 'reading.ts', line: 2, character: 5 });
      });
      await preferences({ readerMode: true });
      await page.locator('.cm-selectionMatch-main').waitFor();
      await page.evaluate(() => { const v = window.test.c.view(); v.scrollDOM.scrollTop = v.lineBlockAt(v.state.doc.line(60).from).top + 5; });
      await page.locator('.cm-editor[data-reading-viewport]').waitFor();
      assert.deepEqual(await page.locator('.cm-sticky-text').allTextContents(), ['class Store {', '  read() {']);
      const sameWord = page.locator('.cm-selectionMatch').last();
      const background = () => sameWord.evaluate(node => getComputedStyle(node).backgroundColor);
      assert.equal(await background(), 'rgba(0, 0, 0, 0)');
      await capture('reading-without-caret-matches');
      await page.evaluate(() => {
        const v = window.test.c.view(), start = v.state.doc.line(62).from + 4;
        v.dispatch({ selection: { anchor: start, head: start + 'const'.length } }); v.focus();
      });
      assert.notEqual(await background(), 'rgba(0, 0, 0, 0)');
      await page.keyboard.press('Control+f'); await query.fill('task152');
      await query.press('Enter'); await page.locator('.cm-searchMatch-selected').first().waitFor();
      const target = await page.locator('.cm-searchMatch-selected').first().evaluate(node => {
        const editor = node.closest('.cm-editor'), sticky = editor.querySelector('.cm-sticky');
        return { line: node.getBoundingClientRect().top, sticky: sticky.getBoundingClientRect().bottom };
      });
      assert.ok(target.line >= target.sticky - 1, JSON.stringify(target));
      await query.press('Escape');
    });
    await t.test('密集和大型文件仍能跳转，计数不扫描大文件或扩展匹配上限', async () => {
      await page.evaluate(async () => {
        const { c, texts } = window.test;
        texts['dense.txt'] = 'target\n'.repeat(1100);
        texts['large.txt'] = 'const example = 1;\n'.repeat(25000) + 'endOfExample';
        await c.visit({ file: 'dense.txt' }); c.view().focus();
      });
      await page.keyboard.press('Control+f'); await query.fill('target');
      assert.equal(await status.textContent(), '1000+ 处');
      assert.equal(await find.locator('[name=select]').isDisabled(), true);
      await query.press('Enter'); assert.equal(await status.textContent(), '1 / 1000+');
      await query.press('Escape');
      await page.evaluate(async () => { const c = window.test.c; await c.visit({ file: 'large.txt' }); c.view().focus(); });
      await page.keyboard.press('Control+f'); await query.fill('endOfExample');
      assert.equal(await status.isVisible(), false);
      await query.press('Enter'); await page.locator('.cm-searchMatch-selected').waitFor();
      assert.equal(await page.locator('.cm-searchMatch-selected').textContent(), 'endOfExample');
      assert.ok(await page.locator('.cm-line').count() < 250);
      await query.press('Escape');
    });
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.test.dispose()); await page.close();
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
