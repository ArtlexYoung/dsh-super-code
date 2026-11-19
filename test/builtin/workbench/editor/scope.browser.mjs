import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const text = [
  '/** 项目任务。\n * 读取已有的任务并筛选。\n */',
  'export class TaskStore {', '  async load(', '    tasks: number[],', '  ): Promise<number[]> {',
  '    const normalize = (value: number) => {', '      if (value > 0) {',
  ...Array.from({ length: 90 }, (_, i) => `        const result${i} = value + ${i};`),
  '        return result0;', '      }', '      return value;', '    };',
  '    return tasks.map(normalize);', '  }', '}', '',
  'function other() {', '  return "done";', '}',
].join('\n');
const tooltipCss = await readFile(join(repo, 'builtin/ui/style.css'), 'utf8');
const fixture = `import React,{useRef,useEffect}from 'react';import{createRoot}from'react-dom/client';
import{Workbench}from'./builtin/workbench/components/Workbench.jsx';import{createWorkbench}from'./builtin/workbench/controller.js';
import{zh}from'./builtin/workbench/locales.js';import css from'./builtin/workbench/style.css';import fonts from'./builtin/workbench/fonts/style.js';
import{EditorView}from'@codemirror/view';import{foldCode,unfoldAll,foldable,syntaxTree,syntaxTreeAvailable,syntaxParserRunning}from'@codemirror/language';
import{readScope}from'./builtin/workbench/editor/scope.js';
const texts={'tasks.ts':${JSON.stringify(text)},'empty.txt':'','legacy.sh':'function run() {\\n  echo ready\\n}',
'literal.ts':${JSON.stringify('function run() {\n  return `first\nplain\nlast`;\n}')},
'tabs.go':'package main\\nfunc run() {\\n\\tif true {\\n\\t\\tprintln(1)\\n\\n\\t}\\n}',
'tasks.py':'class Store:\\n    def run(self):\\n        for value in range(3):\\n            print(value)\\n\\n        return 1\\n',
'large.ts':'class Large {\\n  run() {\\n'+Array.from({length:25000},(_,i)=>'    const item'+i+' = '+i+';').join('\\n')+'\\n  }\\n}'};
const style=document.createElement('style');style.textContent=fonts+css+${JSON.stringify(tooltipCss)};document.head.append(style);
const api={fileOperation:async()=>({path:'/sample-project'}),list:async()=>({entries:Object.keys(texts).map(path=>({name:path,path,type:'file'})),truncated:false}),read:async path=>({path,text:texts[path],version:'v1'}),project:async()=>({files:Object.keys(texts),truncated:false}),models:async()=>[],fonts:async()=>[],git:async()=>({kind:'state',state:{exists:false,changes:[],branches:[],remoteBranches:[],remotes:[],history:[]},sources:[]})};
const t=k=>zh[k]||k,c=createWorkbench(api,t),root=createRoot(document.getElementById('root'));
import { ActionButton } from './builtin/ui/controls.js';
const Button=ActionButton;
function Select(){return null}
c.layout.change({outlineOpen:false,panes:{conversation:false,quick:false,changes:false,learning:false}});
root.render(<Workbench workbench={c} Button={Button} Select={Select} Conversation={()=>null} sessionId='scope' t={t}/>);
window.test={c,texts,select:word=>{const v=c.view(),pos=v.state.doc.toString().indexOf(word);v.dispatch({selection:{anchor:pos},effects:EditorView.scrollIntoView(pos,{y:'center'})});v.focus()},
scroll:word=>{const v=c.view(),pos=v.state.doc.lineAt(v.state.doc.toString().indexOf(word)).from;v.dispatch({effects:EditorView.scrollIntoView(pos,{y:'start'})})},
settings:patch=>c.settings({...c.snapshot().preferences,...patch}),theme:async(palette,dark)=>{document.body.toggleAttribute('data-ds-dark-theme',dark);await c.settings({...c.snapshot().preferences,palette})},
fold:()=>foldCode(c.view()),unfold:()=>unfoldAll(c.view()),parsed:()=>syntaxTreeAvailable(c.view().state,c.view().viewport.to)&&!syntaxParserRunning(c.view()),
inspect:()=>{const v=c.view(),s=v.state,line=s.doc.lineAt(s.selection.main.head);return{scope:readScope(s),selection:s.selection.toJSON(),line:line.text,visible:v.visibleRanges,fold:foldable(s,line.from,line.to),tree:syntaxTree(s).length}},
dispose(){root.unmount();c.dispose()}};`;
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, platform: 'browser', format: 'esm', external: ['@deepseek-ai/*'], loader: { '.css': 'text', '.woff2': 'dataurl' } });
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(app.outputFiles[0].contents); }
  else { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('当前类、函数与活动代码块', async t => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
    page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.test?.c.snapshot().indexed === 7);
    await page.evaluate(() => window.test.c.visit({ file: 'tasks.ts' }));
    await page.evaluate(() => document.fonts.ready);
    const names = () => page.locator('.sc-wb-scope-path button>span').allTextContents();
    const visit = file => page.evaluate(file => window.test.c.visit({ file }), file);
    const select = async word => {
      await page.evaluate(word => window.test.select(word), word);
      await page.waitForFunction(word => {const v=window.test.c.view(),pos=v.state.doc.toString().indexOf(word),rect=v.coordsAtPos(pos),box=v.scrollDOM.getBoundingClientRect();return rect&&rect.top>=box.top&&rect.bottom<=box.bottom},word);
      await page.waitForFunction(()=>window.test.parsed());
    };
    const capture = async name => { if (process.env.SC_TEST_ARTIFACTS) { await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, name + '.png'), animations: 'disabled' }); } };
    await t.test('光标位置显示当前类和嵌套函数，原文保持', async () => {
      await select('const result40');
      assert.deepEqual(await names(), ['TaskStore', 'load', 'normalize']);
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), text);
    });
    await t.test('作用域跳转进入前后导航记录，目标不被粘性行覆盖', async () => {
      const offset = () => page.evaluate(() => window.test.c.view().state.selection.main.head);
      const previous = await offset();
      await page.getByRole('button', { name: '跳转到 load', exact: true }).click();
      await page.waitForFunction(() => window.test.c.snapshot().back && document.querySelector('.sc-wb-scope-path [aria-current=location] span')?.textContent === 'load');
      assert.deepEqual(await names(), ['TaskStore', 'load']);
      const result = await page.evaluate(() => { const v=window.test.c.view(),pos=v.state.selection.main.head,box=v.coordsAtPos(pos);return {pos,y:box.top,bottom:box.bottom,top:v.scrollDOM.getBoundingClientRect().top,sticky:v.dom.querySelector('.cm-sticky:not([hidden])')?.getBoundingClientRect().bottom||0} });
      assert.equal(result.pos, text.indexOf('load('));
      assert.ok(result.y >= Math.max(result.top, result.sticky) - 1, JSON.stringify(result));
      await page.evaluate(() => window.test.c.move(-1));
      assert.equal(await offset(), previous);
      await page.evaluate(() => window.test.c.move(1));
      assert.equal(await offset(), result.pos);
      await page.getByRole('button', { name: '跳转到 TaskStore', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.sc-wb-scope-path [aria-current=location] span')?.textContent === 'TaskStore');
      assert.deepEqual(await names(), ['TaskStore']);
    });
    await t.test('活动线跟随最近代码块，包含空白和闭合行，离开后不残留', async () => {
      await select('const result40');
      let lines = await page.locator('.cm-line[data-active-indent]').evaluateAll(nodes => nodes.map(node => ({text:node.textContent,column:node.dataset.activeIndent})));
      assert.ok(lines.some(line => line.text.includes('result40') && line.column === '6'), JSON.stringify(lines));
      assert.ok(lines.every(line => line.column === '6'));
      await select('return tasks');
      lines = await page.locator('.cm-line[data-active-indent]').evaluateAll(nodes => nodes.map(node => ({text:node.textContent,column:node.dataset.activeIndent})));
      assert.ok(lines.some(line => line.text.includes('return tasks') && line.column === '2'),JSON.stringify({lines,info:await page.evaluate(()=>window.test.inspect())}));
      assert.ok(lines.every(line => line.column === '2'));
      await visit('tabs.go'); await select('println');
      const tabLines = await page.locator('.cm-line[data-active-indent]').evaluateAll(nodes => nodes.map(node => ({
        text: node.textContent, column: node.dataset.activeIndent, indent: node.dataset.indentColumns,
        repeat: getComputedStyle(node).backgroundRepeat,
      })));
      assert.ok(tabLines.some(line => line.text.includes('println') && line.column === '4'));
      const blank = tabLines.find(line => !line.text.trim() && line.column === '4');
      assert.ok(blank, JSON.stringify(tabLines));
      assert.equal(blank.indent, undefined);
      assert.ok(tabLines.some(line => line.text.trim() === '}' && line.column === '4'));
      assert.ok(tabLines.every(line => line.repeat.split(',').every(layer => layer.trim() === 'no-repeat')), JSON.stringify(tabLines));
      await visit('tasks.py'); await select('print');
      assert.deepEqual(await names(), ['Store', 'run']);
      assert.ok(await page.locator('.cm-line[data-active-indent="8"]').count() > 0);
      await visit('empty.txt');
      assert.equal(await page.locator('.cm-line[data-active-indent]').count(), 0);
      await visit('literal.ts');await select('plain');
      assert.deepEqual(await names(), ['run']);
      assert.equal(await page.locator('.cm-line').filter({hasText:/^plain$/}).getAttribute('data-active-indent'),null);
    });
    await t.test('顶层、空文件和词法模式保持固定一行，不显示虚构的类和函数', async () => {
      for (const file of ['empty.txt', 'legacy.sh', 'tasks.ts']) {
        await visit(file);
        await page.evaluate(() => {const v=window.test.c.view();v.dispatch({selection:{anchor:0}})});
        assert.deepEqual(await names(), []);
        assert.equal(await page.locator('.sc-wb-scope-path').innerText(), '文件顶层');
        assert.equal((await page.locator('.sc-wb-scope-path').boundingBox()).height, 24);
      }
    });
    await t.test('修改函数名和撤销后立即更新，不改动文件的其他内容', async () => {
      await select('const result40');
      await page.evaluate(() => {const v=window.test.c.view(),from=v.state.doc.toString().indexOf('normalize =');v.dispatch({changes:{from,to:from+9,insert:'transform'},userEvent:'input'})});
      assert.deepEqual(await names(), ['TaskStore','load','transform']);
      await page.evaluate(() => window.test.c.undo());
      assert.deepEqual(await names(), ['TaskStore','load','normalize']);
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), text);
    });
    await t.test('折叠、阅读器、单行拖选、查找及键盘导航仍可使用', async () => {
      await select('): Promise'); assert.equal(await page.evaluate(() => window.test.fold()),true,JSON.stringify(await page.evaluate(()=>window.test.inspect())));
      await page.locator('.cm-foldPlaceholder').waitFor();
      assert.deepEqual(await names(), ['TaskStore','load']);
      await page.evaluate(() => window.test.unfold());
      await page.locator('.cm-foldPlaceholder').waitFor({state:'detached'});
      await page.evaluate(() => window.test.settings({readerMode:true}));
      await page.locator('.cm-reader-document').waitFor();
      await select('return tasks');
      const box = await page.evaluate(() => {const v=window.test.c.view(),from=v.state.doc.toString().indexOf('return tasks')+7,a=v.coordsAtPos(from),b=v.coordsAtPos(from+5);return {x:a.left,y:(a.top+a.bottom)/2,to:b.left}});
      await page.mouse.move(box.x,box.y);await page.mouse.down();await page.mouse.move(box.to,box.y,{steps:8});await page.mouse.up();
      assert.equal(await page.evaluate(() => {const v=window.test.c.view(),r=v.state.selection.main;return v.state.doc.sliceString(r.from,r.to)}), 'tasks');
      await page.keyboard.press('Control+f');
      const find = page.locator('.cm-search input[name=search]');
      await find.fill('result50'); await find.press('Enter');
      const match = page.locator('.cm-searchMatch-selected'); await match.waitFor();
      assert.equal(await match.textContent(), 'result50');
      await find.press('Escape');
      assert.equal(await page.locator('.cm-search').count(), 0);
      await page.getByRole('button',{name:'跳转到 load',exact:true}).focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(pos => window.test.c.view().state.selection.main.head === pos, text.indexOf('load('));
      await page.locator('.sc-wb-scope-path [aria-current=location] > span').filter({ hasText: /^load$/ }).waitFor();
      assert.deepEqual(await names(), ['TaskStore','load']);
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), text);
      await page.evaluate(() => window.test.settings({readerMode:false}));
    });
    await t.test('四主题的作用域位置、图标、气泡与活动线匹配，窗口缩小时保留当前名称', async () => {
      await select('const result40');
      const nav = page.getByRole('navigation', {name:'当前作用域', exact:true});
      const current = nav.getByRole('button', {name:'跳转到 normalize', exact:true});
      for (const palette of ['idea','vscode']) for (const dark of [false,true]) {
        await page.evaluate(({palette,dark})=>window.test.theme(palette,dark),{palette,dark});
        await current.hover();
        const tip = page.getByRole('tooltip').filter({ hasText: '跳转到 normalize' });
        await tip.waitFor();
        const appearance = await nav.evaluate((node, palette) => {
          const active = node.querySelector('[aria-current=location]'), line = document.querySelector('.cm-line[data-active-indent]');
          const tip = document.getElementById(active.getAttribute('aria-describedby'));
          const probe = document.createElement('span'); node.append(probe);
          probe.style.backgroundColor='var(--wb-bg)'; probe.style.color='var(--wb-text)';
          const icons = [...node.querySelectorAll('[data-icon]')].map(svg => ({
            kind:svg.dataset.icon, shown:getComputedStyle(svg.querySelector('[data-icon-theme=' + palette + ']')).display !== 'none',
          }));
          const value = { inline:Boolean(node.closest('.sc-wb-path')), icons, tipColor:getComputedStyle(tip).color,
            tipBackground:getComputedStyle(tip).backgroundColor, color:getComputedStyle(probe).color, background:getComputedStyle(probe).backgroundColor,
            tipBottom:tip.getBoundingClientRect().bottom, buttonTop:active.getBoundingClientRect().top,
            gradient:getComputedStyle(line).backgroundImage, base:getComputedStyle(line).getPropertyValue('--wb-indent'), active:getComputedStyle(line).getPropertyValue('--wb-indent-active') };
          probe.remove(); return value;
        }, palette);
        assert.equal(appearance.inline,palette==='vscode');
        assert.equal(await page.getByRole('navigation', {name:'当前作用域', exact:true}).count(),1);
        assert.deepEqual(appearance.icons,[{kind:'type',shown:true},{kind:'method',shown:true},{kind:'function',shown:true}]);
        assert.equal(appearance.tipColor,appearance.color);assert.equal(appearance.tipBackground,appearance.background);
        assert.ok(appearance.tipBottom<=appearance.buttonTop-6,JSON.stringify(appearance));assert.notEqual(appearance.base,appearance.active);assert.ok(appearance.gradient.startsWith('linear-gradient'));
        await capture('scope-'+palette+'-'+(dark?'dark':'light'));
      }
      await page.setViewportSize({width:480,height:760});
      await page.evaluate(()=>window.test.settings({fontSize:19,readerMode:true}));await select('const result40');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),480);
      await capture('scope-narrow');
      await page.locator('.sc-workbench.sc-wb-main').evaluate(node=>{node.style.zoom='2'});
      await page.waitForFunction(() => {
        const button = document.querySelector('.sc-wb-scope-path [aria-current=location]'), nav = button?.parentElement;
        if (!button) return false;
        const child = button.getBoundingClientRect(), parent = nav.getBoundingClientRect();
        return child.width > 14 && child.right <= parent.right + 1 && child.left >= parent.left - 1;
      });
      await capture('scope-zoom');
      assert.ok(await page.locator('.sc-wb-path-name').isVisible());
      assert.ok(await current.isVisible());
      await page.locator('.sc-workbench.sc-wb-main').evaluate(node=>{node.style.zoom=''});
      await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>window.test.settings({fontSize:14,readerMode:false}));
    });
    await t.test('两套路径和文件结构跟随阅读视口，跳转后可回到正文并保留源码选区', async () => {
      const viewState = () => page.evaluate(() => window.test.c.view().state.selection.toJSON());
      const scope = page.getByRole('navigation', { name: '当前作用域', exact: true });
      const offset = () => page.evaluate(() => window.test.c.view().state.selection.main.head);
      const selected = page.locator('.sc-wb-outline [aria-current=location]');
      const layout = await page.evaluate(() => window.test.c.layout.snapshot());
      try {
        await page.evaluate(() => window.test.c.layout.change({ explorerOpen: true, outlineOpen: true }));
        await visit('tasks.ts');
        for (const palette of ['idea', 'vscode']) for (const stickyScroll of [true, false]) {
          await page.evaluate(patch => window.test.settings(patch), { palette, stickyScroll, readerMode: true });
          await select('TaskStore'); const original = await viewState();
          await page.evaluate(() => window.test.scroll('const result32'));
          await scope.locator('[aria-current=location]').filter({ hasText: 'normalize' }).waitFor();
          await selected.filter({ hasText: 'normalize' }).waitFor();
          assert.equal(await scope.getAttribute('data-reading'), 'true');
          assert.equal(await scope.getByRole('img', { name: '阅读位置' }).count(), 1);
          assert.equal(await scope.evaluate(node => Boolean(node.closest('.sc-wb-path'))), palette === 'vscode');
          assert.deepEqual(await names(), ['TaskStore','load','normalize']);
          assert.deepEqual(await viewState(), original);
          if (!stickyScroll) assert.equal(await page.locator('.cm-sticky:visible').count(), 0);
          await scope.getByRole('button', { name: '跳转到 load', exact: true }).click();
          await scope.locator('[aria-current=location] > span').filter({ hasText: /^load$/ }).waitFor();
          assert.equal(await scope.getAttribute('data-reading'), null);
          assert.equal(await offset(), text.indexOf('load('));
          await page.evaluate(() => window.test.c.move(-1));
          assert.match(text.slice(await offset()), /^const result3[0-9] =/);
          await page.evaluate(() => window.test.c.move(1));
          assert.equal(await offset(), text.indexOf('load('));
        }
        await select('TaskStore');
        await page.evaluate(() => {
          const view = window.test.c.view(), from = view.state.selection.main.head;
          view.dispatch({ selection: { anchor: from, head: from + 'TaskStore'.length } });
          window.test.scroll('const result32');
        });
        await page.waitForFunction(() => window.test.c.view().scrollDOM.scrollTop > 300);
        assert.deepEqual(await names(), ['TaskStore']);
        assert.equal(await scope.getAttribute('data-reading'), null);
        await visit('empty.txt');
        assert.deepEqual(await names(), []);
        assert.equal(await selected.count(), 0);
      } finally {
        await page.evaluate(layout => {
          window.test.c.layout.change(layout);
          return window.test.settings({ readerMode: false, stickyScroll: true });
        }, layout);
      }
    });
    await t.test('25004 行延后解析、大幅跳转及连续定位仍虚拟显示', async () => {
      await visit('large.ts'); await select('const item20000');
      await page.waitForFunction(()=>window.test.parsed(),{timeout:12000});
      await page.waitForFunction(()=>document.querySelector('.sc-wb-scope-path')?.textContent.includes('run'));
      assert.deepEqual(await names(), ['Large','run']);
      const large=await page.evaluate(()=>{const v=window.test.c.view(),text=v.state.doc.toString(),times=[];for(let i=0;i<100;i++){const start=performance.now();v.dispatch({selection:{anchor:text.indexOf('item'+(20000+i)+' =')}});times.push(performance.now()-start)}return {lines:v.state.doc.lines,rendered:v.dom.querySelectorAll('.cm-line').length,guided:v.dom.querySelectorAll('[data-active-indent]').length,median:times.toSorted((a,b)=>a-b)[50],max:Math.max(...times),textUnchanged:text===window.test.texts['large.ts']}});
      assert.equal(large.lines,25004);assert.ok(large.rendered<200,JSON.stringify(large));assert.ok(large.guided<200);assert.equal(large.textUnchanged,true);
      await page.getByRole('button',{name:'跳转到 run',exact:true}).click();
      await page.waitForFunction(()=>window.test.c.view().scrollDOM.scrollTop===0);
      if(process.env.SC_TEST_ARTIFACTS)await writeFile(join(process.env.SC_TEST_ARTIFACTS,'large.json'),JSON.stringify(large,null,2));
      await capture('scope-large');
    });
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.test.dispose()); await page.close();
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
