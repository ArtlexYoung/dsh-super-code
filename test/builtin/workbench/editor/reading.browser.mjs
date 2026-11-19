import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';
import {Workbench} from './builtin/workbench/components/Workbench.jsx';
import {createWorkbench} from './builtin/workbench/controller.js';
import {zh} from './builtin/workbench/locales.js';import css from './builtin/workbench/style.css';
import fontStyles from './builtin/workbench/fonts/style.js';
import {EditorView} from '@codemirror/view';import {EditorState} from '@codemirror/state';
import {javascript} from '@codemirror/lang-javascript';import {stickyLines} from './builtin/workbench/editor/sticky.js';
import {syntaxTree,syntaxTreeAvailable,syntaxParserRunning,foldCode,unfoldAll} from '@codemirror/language';
import {editorTheme} from './builtin/workbench/editor/theme.js';
import {appearanceDefaults} from './builtin/workbench/editor/appearance.js';
import {indentGuides} from './builtin/workbench/editor/guides.js';
import {loadLanguage} from './builtin/workbench/editor/languages.js';
const style=document.createElement('style');style.textContent=fontStyles+css;document.head.append(style);
const texts={'long.ts':[
'export class Store {','  calculate(','    items: number[],','  ): number {','    let total = 0;','    for (const value of items) {','      if (value >= 0) {',
...Array.from({length:90},(_,i)=>'        total += value; // 第 '+(i+1)+' 项'+(i===43?'，保留编辑器横向滚动时的标题。'.repeat(65):'')),
'      }','    }','    return total;','  }','}',
...Array.from({length:55},(_,i)=>'const tail'+i+' = '+i+';'),
].join('\\n'),'wrapped.ts':[
'export class Summary {','  /**','   * 汇总输入并保留完整文本。'.repeat(25),'   * @param value 要汇总的文本','   */',
'  summarize(value: string): string {',
'    const label = "'+ '阅读长行 mixed words '.repeat(35)+'";',
'\\tconst token = "'+'LongIdentifier'.repeat(90)+'";',
...Array.from({length:30},(_,i)=>'    const row'+i+' = label + "'+'连续阅读代码 '.repeat(12)+'";'),
'    return label + value + token;','  }','}',
].join('\\n'),'other.ts':'export const ready = true;','empty.txt':'','legacy.sh':'function run() {\\n  echo ready\\n}'};
const api={fileOperation:async()=>({path:'/sample-project'}),list:async()=>({entries:Object.keys(texts).map(path=>({name:path,path,type:'file'})),truncated:false}),read:async path=>({path,text:texts[path],version:'v1'}),project:async()=>({files:Object.keys(texts),truncated:false}),models:async()=>[],git:async()=>({kind:'state',state:{exists:false,changes:[],branches:[],remoteBranches:[],remotes:[],history:[]},sources:[]})};
const c=createWorkbench(api,key=>zh[key]||key),root=createRoot(document.getElementById('root'));
function Button({children,...props}){return <button type='button' {...props}>{children}</button>}
function Select({label,value,choices,onChange}){return <select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{choices.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select>}
root.render(<Workbench workbench={c} Button={Button} Select={Select} Conversation={()=>null} sessionId="reading" t={key=>zh[key]||key}/>);
window.test={c,texts,
structure:async(file,doc,palette)=>{
 const host=document.createElement('div');host.className='sc-workbench';host.dataset.palette=palette;host.style.cssText='position:fixed;inset:0';document.body.append(host);
 const view=new EditorView({parent:host,state:EditorState.create({doc,extensions:[await loadLanguage(file),editorTheme(palette,{...appearanceDefaults,readerMode:true})]})});
 try {
  for(let frame=0;frame<6;frame++) await new Promise(requestAnimationFrame);
  return [...view.dom.querySelectorAll('.cm-line')].map(row=>({text:row.textContent,divider:row.classList.contains('cm-reader-declaration'),brackets:[...row.querySelectorAll('.cm-reader-bracket')].map(node=>{
   let leaf=node;while(leaf.firstElementChild)leaf=leaf.firstElementChild;
   return {text:node.textContent,slot:Number(node.dataset.bracketColor),color:getComputedStyle(leaf).color};
  })}));
 } finally {view.destroy();host.remove();}
},theme:async(palette,dark)=>{document.body.toggleAttribute('data-ds-dark-theme',dark);await c.settings({...c.snapshot().preferences,palette})},
select:(from,to=from)=>{const v=c.view();v.dispatch({selection:{anchor:from,head:to},effects:EditorView.scrollIntoView(from,{y:'center'})});v.focus()},
foldReady:()=>{const v=c.view();return syntaxTreeAvailable(v.state,v.state.doc.length)},
unfold:()=>unfoldAll(c.view()),
fold:()=>{const v=c.view(),selection=v.state.selection.toJSON(),block=v.lineBlockAt(v.state.selection.main.head),tree=syntaxTree(v.state).length,folded=foldCode(v);return {folded,selection,tree,block}},
scroll:line=>{const v=c.view();v.dispatch({effects:EditorView.scrollIntoView(v.state.doc.line(line).from,{y:'start'})})},
performance:async(wrapping=false)=>{
 const doc=['class Large {','  run() {',...Array.from({length:25000},(_,i)=>'    const value'+i+' = '+(wrapping?'"'+'long source code '.repeat(20)+'"':i)+';'),'  }','}'].join('\\n');
 const host=document.createElement('div');host.className='sc-workbench';host.style.cssText='height:500px;width:1000px;position:fixed;inset:0;z-index:999999';document.body.append(host);
 const results=[];
 for(const enabled of [false,true,false]){
  const v=new EditorView({parent:host,state:EditorState.create({doc,extensions:[javascript(),editorTheme('idea',{...appearanceDefaults,readerMode:wrapping&&enabled}),...(enabled?[stickyLines(key => key),indentGuides]:[])]})});
  const ready=async()=>{const deadline=performance.now()+7000;while(!syntaxTreeAvailable(v.state,v.viewport.to)||syntaxParserRunning(v)||(enabled&&!v.dom.querySelector('.cm-sticky:not([hidden]) .cm-sticky-line'))){if(performance.now()>deadline)throw new Error('后台解析完成后应显示粘性行');await new Promise(requestAnimationFrame)}};
  v.scrollDOM.scrollTop=310;await new Promise(requestAnimationFrame);await ready();
  const frames=[];let activeFrames=0;
  for(let i=1;i<=35;i++){const start=performance.now();v.scrollDOM.scrollTop=i*310;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);frames.push(performance.now()-start);if(v.dom.querySelector('.cm-sticky:not([hidden]) .cm-sticky-line'))activeFrames++}
  const sorted=frames.toSorted((a,b)=>a-b),result={enabled,lines:v.state.doc.lines,median:sorted[Math.floor(sorted.length/2)],max:Math.max(...frames),rendered:v.dom.querySelectorAll('.cm-line').length,guided:v.dom.querySelectorAll('.cm-line[data-indent-columns]').length,activeFrames,sticky:v.dom.querySelectorAll('.cm-sticky:not([hidden]) .cm-sticky-line').length,wrapping:v.lineWrapping,width:v.scrollDOM.clientWidth,scrollWidth:v.scrollDOM.scrollWidth};
  const start=performance.now();v.scrollDOM.scrollTop=v.lineBlockAt(v.state.doc.line(20000).from).top;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);await ready();
  result.jump={elapsed:performance.now()-start,line:v.state.doc.lineAt(v.lineBlockAtHeight(v.scrollDOM.scrollTop).from).number,tree:syntaxTree(v.state).length,viewport:v.viewport,headers:[...v.dom.querySelectorAll('.cm-sticky:not([hidden]) .cm-sticky-text')].map(node=>node.textContent)};
  results.push(result);v.destroy();
 }
 host.remove();return results;
},dispose(){root.unmount();c.dispose()}};`;
const bundle = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, platform: 'browser', format: 'esm', loader: { '.css': 'text', '.woff2': 'dataurl' } });
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); }
  else { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('代码阅读排版与粘性行', async t => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }), errors = [];
    page.setDefaultTimeout(7000);
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.test?.c.snapshot().indexed > 0 || window.test?.c.snapshot().error);
    assert.equal(await page.evaluate(() => window.test.c.snapshot().error), '');
    await page.evaluate(() => window.test.c.visit({ file: 'long.ts' }));
    const scrollTo = async line => {
      await page.evaluate(line => window.test.scroll(line), line);
      await page.waitForFunction(() => document.querySelectorAll('.cm-sticky:not([hidden]) .cm-sticky-line').length > 0);
    };
    const settings = patch => page.evaluate(patch => window.test.c.settings({ ...window.test.c.snapshot().preferences, ...patch }), patch);
    const headers = () => page.locator('.cm-sticky:not([hidden]) .cm-sticky-code').allTextContents();
    await t.test('默认字号 14px、行高 21px，文件首屏不出现重复标题', async () => {
      assert.deepEqual(await page.locator('.cm-scroller').evaluate(node => ({ size: getComputedStyle(node).fontSize, height: getComputedStyle(node).lineHeight })), { size: '14px', height: '21px' });
      assert.equal(await page.locator('.cm-sticky:visible').count(), 0);
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), await page.evaluate(() => window.test.texts['long.ts']));
    });
    await t.test('源码路径旁直接切换阅读器，键盘操作保留文件和选区', async () => {
      await page.evaluate(() => window.test.select(3, 9));
      const button = page.getByRole('button', { name: '阅读器模式', exact: true });
      assert.equal(await button.getAttribute('aria-pressed'), 'false');
      await button.focus();
      await page.keyboard.press('Space');
      await page.locator('.cm-content.cm-lineWrapping').waitFor();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      await page.keyboard.press('Enter');
      await page.locator('.cm-content.cm-lineWrapping').waitFor({ state: 'detached' });
      assert.equal(await button.getAttribute('aria-pressed'), 'false');
      assert.deepEqual(await page.evaluate(() => window.test.c.view().state.selection.main.toJSON()), { anchor: 3, head: 9 });
    });
    await t.test('两套阅读器分别绘制声明边界和成对括号，省略空行、文档和声明之外的文本', async () => {
      const doc = [
        'class Store {', '  count = 0;', '  first() {}', '  second() { return format(group([section({ name: "[plain]" })])); }',
        '  /** 关联说明。 */', '  documented() {}', '', '  spaced() {}', '  // 文本：([{}])', '}',
        'const incomplete = next([1, 2',
      ].join('\n');
      const read = (file, doc, palette) => page.evaluate(args => window.test.structure(...args), [file, doc, palette]);
      const idea = await read('sample.ts', doc, 'idea');
      assert.deepEqual(idea.filter(row => row.divider).map(row => row.text.trim().split('(')[0]), ['first', 'second']);
      assert.ok(idea.every(row => row.brackets.length === 0));
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), dark);
        const rows = await read('sample.ts', doc, 'vscode');
        assert.ok(rows.every(row => !row.divider));
        assert.deepEqual(rows[8].brackets, []);
        assert.deepEqual(rows[10].brackets, []);
        const slots = rows[3].brackets.map(item => item.slot), colors = rows[3].brackets.map(item => item.color);
        assert.equal(rows[3].brackets.map(item => item.text).join(''), '(){(([({})]))}');
        assert.deepEqual(slots, [1, 1, 1, 2, 0, 1, 2, 0, 0, 2, 1, 0, 2, 1]);
        assert.equal(new Set(colors).size, 3);
        assert.equal(colors[3], colors[12]);
      }
      await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'));
    });
    await t.test('括号层次沿真实语法树越过模板字符串、嵌入语言和接收者', async () => {
      const samples = [
        ['sample.ts', 'const label = \u0060text [plain] \u0024{take([item[0]])}\u0060;', '{([[]])}', [0, 1, 2, 0, 0, 2, 1, 0]],
        ['sample.ts', 'const row = receiver[select(1)][lookup(2)];', '[()][()]', [0, 1, 1, 0, 0, 1, 1, 0]],
        ['sample.py', 'value = select([{"label": "[plain]"}])', '([{}])', [0, 1, 2, 2, 1, 0]],
        ['sample.json', '{"data": [[1]], "label":"[plain]"}', '{[[]]}', [0, 1, 2, 2, 1, 0]],
        ['sample.go', 'package demo\nvar items = []int{1}', '[]{}', [0, 0, 0, 0]],
        ['sample.html', '<script>const row = read([1]);</script>', '([])', [0, 1, 1, 0]],
        ['sample.txt', 'function fake([{}]) {}', '', []],
        ['sample.sh', 'echo "([{}])"', '', []],
      ];
      for (const [file, source, expected, levels] of samples) {
        const rows = await page.evaluate(([file, source]) => window.test.structure(file, source, 'vscode'), [file, source]);
        const brackets = rows.flatMap(row => row.brackets);
        assert.equal(brackets.map(mark => mark.text).join(''), expected, file);
        assert.deepEqual(brackets.map(mark => mark.slot), levels, file);
      }
    });
    await t.test('跨行签名只在标题补出滚过的部分，离开方法后移除标题', async () => {
      await settings({ readerMode: true, stickyScroll: true });
      try {
        await page.waitForFunction(() => window.test.foldReady());
        await page.evaluate(() => {
          const v = window.test.c.view();
          v.scrollDOM.scrollTop = v.lineBlockAt(v.state.doc.line(2).from).top + v.documentPadding.top + 1;
        });
        await page.waitForFunction(() => document.querySelectorAll('.cm-sticky:not([hidden]) .cm-sticky-line').length === 2);
        assert.deepEqual(await headers(), ['export class Store {', '  calculate(items: number[],…']);
        const method = page.locator('.cm-sticky-line').nth(1);
        assert.equal(await method.getAttribute('title'), 'calculate(items: number[],): number {');
        const continuation = page.locator('.cm-line').filter({ hasText: /^\s*\): number \{$/ });
        const [body, sticky] = await Promise.all([continuation.boundingBox(), method.boundingBox()]);
        assert.ok(body.y >= sticky.y + sticky.height - 2, JSON.stringify({body, sticky}));
        const tail = await page.evaluate(() => {
          const v = window.test.c.view(), target = v.state.doc.lineAt(v.state.doc.toString().indexOf('const tail0'));
          window.test.scroll(target.number);
          return target.from;
        });
        await page.waitForFunction(tail => window.test.c.view().coordsAtPos(tail), tail);
        await page.evaluate(tail => {
          const v = window.test.c.view();
          v.scrollDOM.scrollTop += v.coordsAtPos(tail).top - v.scrollDOM.getBoundingClientRect().top + 1;
        }, tail);
        await page.waitForFunction(tail => {
          const v = window.test.c.view(), top = v.scrollDOM.getBoundingClientRect().top - v.documentTop;
          return v.lineBlockAtHeight(top).from >= tail;
        }, tail);
        await page.locator('.cm-sticky').waitFor({ state: 'hidden' });
      } finally {
        await settings({ readerMode: false });
        await page.evaluate(() => window.test.select(0));
      }
    });
    await t.test('给括号着色后仍能沿同一行拖选并搜索准确的原始代码', async () => {
      await settings({ palette: 'vscode', readerMode: true });
      try {
        const target = await page.evaluate(() => {
          const v = window.test.c.view(), source = v.state.doc.toString(), text = '(const value of items)';
          const start = source.indexOf(text);
          window.test.select(start);
          return { start, text };
        });
        const row = page.locator('.cm-line').filter({ hasText: /for \(const value of items\)/ });
        const marks = row.locator('.cm-reader-bracket');
        await marks.first().waitFor();
        const colors = await marks.evaluateAll(elements => elements.map(element => {
          let leaf = element;
          while (leaf.firstElementChild) leaf = leaf.firstElementChild;
          return [getComputedStyle(element).color, getComputedStyle(leaf).color];
        }));
        assert.ok(colors.length >= 2);
        assert.ok(colors.every(([mark, text]) => mark === text), JSON.stringify(colors));
        const points = await page.evaluate(({start, text}) => {
          const v = window.test.c.view(), from = v.coordsAtPos(start), to = v.coordsAtPos(start + text.length);
          return { x: from.left, y: (from.top + from.bottom) / 2, end: to.left };
        }, target);
        await page.mouse.move(points.x, points.y); await page.mouse.down();
        await page.mouse.move(points.end, points.y, { steps: 7 }); await page.mouse.up();
        const selected = () => page.evaluate(() => {
          const v = window.test.c.view(), {from,to} = v.state.selection.main;
          return v.state.doc.sliceString(from,to);
        });
        assert.equal(await selected(), target.text);
        await page.evaluate(() => window.test.select(0));
        await page.keyboard.press('Control+f');
        const search = page.locator('.cm-search input[name=search]');
        await search.fill(''); await search.pressSequentially(target.text); await search.press('Enter');
        await page.waitForFunction(({start, text}) => {
          const {from, to} = window.test.c.view().state.selection.main;
          return from === start && to === start + text.length;
        }, target);
        await page.locator('.cm-search').getByRole('button', { name: '关闭', exact: true }).click();
        assert.equal(await selected(), target.text);
        await settings({ readerMode: false });
        assert.equal(await row.locator('.cm-reader-bracket').count(), 0);
        assert.equal(await selected(), target.text);
      } finally {
        await settings({ palette: 'idea', readerMode: false });
        await page.evaluate(() => window.test.select(0));
      }
    });
    await t.test('文件结构只列真实声明，重新赋值不重复，点击仍能定位到源码', async () => {
      await page.evaluate(() => window.test.c.layout.change({ explorerOpen: true, outlineOpen: true }));
      await page.locator('#sc-wb-outline').waitFor();
      if (process.env.SC_TEST_ARTIFACTS) { await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, 'outline-idea-light.png') }); }
      const symbols = await page.evaluate(() => window.test.c.snapshot().symbols);
      assert.equal(symbols.filter(item => item.name === 'total').length, 1);
      assert.equal(symbols.length, 59);
      const icon = name => page.locator('#sc-wb-outline button').filter({ has: page.getByText(name, { exact: true }) }).locator('svg').getAttribute('data-icon');
      assert.equal(await icon('Store'), 'type');
      assert.equal(await icon('calculate'), 'method');
      assert.equal(await icon('total'), 'variable');
      assert.equal(await page.locator('#sc-wb-outline button').filter({ has: page.locator('span', { hasText: /^total$/ }) }).count(), 1);
      await page.locator('#sc-wb-outline button').filter({ has: page.locator('span', { hasText: /^total$/ }) }).click();
      await page.waitForFunction(() => window.test.c.snapshot().cursor?.line === 4);
      assert.equal(await page.evaluate(() => window.test.c.view().state.selection.main.head), symbols.find(item => item.name === 'total').offset);
    });
    await t.test('深层滚动保留类、多行方法签名与循环，行号及语法颜色对应源码', async () => {
      await scrollTo(45);
      assert.deepEqual(await headers(), ['export class Store {', '  calculate(items: number[],): number {', '    for (const value of items) {']);
      assert.deepEqual(await page.locator('.cm-sticky-number').allTextContents(), ['1', '2', '6']);
      assert.ok(await page.locator('.cm-sticky-code span[class]').count() > 0);
      const bounds = await page.locator('.cm-sticky').evaluate(node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, scroller: node.closest('.cm-scroller').getBoundingClientRect().top }));
      assert.ok(Math.abs(bounds.top - bounds.scroller) < 1);
      assert.ok(bounds.bottom - bounds.top <= 64);
      const gutter = await page.evaluate(() => {
        const v = window.test.c.view(), right = node => { const r = document.createRange(); r.selectNodeContents(node); return r.getBoundingClientRect().right; };
        return { sticky: right(v.dom.querySelector('.cm-sticky-number')), code: right(v.dom.querySelector('.cm-lineNumbers .cm-gutterElement:last-child')) };
      });
      assert.ok(Math.abs(gutter.sticky - gutter.code) < 0.6, `粘性行号和正文行号应对齐：${JSON.stringify(gutter)}`);
    });
    await t.test('点击粘性标题返回声明，目标行可见且不被标题覆盖', async () => {
      await page.locator('.cm-sticky-line').nth(1).click();
      await page.waitForFunction(() => window.test.c.snapshot().cursor?.line === 1);
      await page.waitForFunction(() => { const v = window.test.c.view(), title = v.dom.querySelector('.cm-sticky:not([hidden])'); return v.coordsAtPos(v.state.doc.line(2).from)?.top >= (title?.getBoundingClientRect().bottom || v.scrollDOM.getBoundingClientRect().top) - 1; });
      assert.ok(await page.evaluate(() => { const v = window.test.c.view(), title = v.dom.querySelector('.cm-sticky:not([hidden])'); return v.coordsAtPos(v.state.doc.line(2).from).top >= (title?.getBoundingClientRect().bottom || v.scrollDOM.getBoundingClientRect().top) - 1; }));
    });
    await t.test('离开内层作用域时外层标题保持原位，不被一起推离视口', async () => {
      await scrollTo(99);
      await page.waitForFunction(() => !document.querySelector('.cm-sticky').textContent.includes('for (const value'));
      assert.ok((await headers()).includes('export class Store {'));
      assert.ok(await page.locator('.cm-sticky').evaluate(node => Math.abs(node.getBoundingClientRect().top - node.closest('.cm-scroller').getBoundingClientRect().top) < 1));
    });
    await t.test('标题上原生滚动，阅读缩进随可见作用域，主题保留各自的折叠控件', async () => {
      const previous = await page.evaluate(() => window.test.c.snapshot().preferences);
      const heading = page.locator('.cm-sticky-line').nth(1);
      const control = page.getByRole('button', { name: '折叠代码 2', exact: true });
      const placeholder = page.locator('.cm-foldPlaceholder');
      const position = () => page.evaluate(() => window.test.c.view().scrollDOM.scrollTop);
      try {
        await page.setViewportSize({ width: 980, height: 670 });
        for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
          await page.evaluate(({ palette, dark }) => window.test.theme(palette, dark), { palette, dark });
          await settings({ readerMode: true });
          await page.evaluate(() => window.test.select(0));
          await scrollTo(55);
          await heading.waitFor();
          await control.waitFor();
          await page.locator('.cm-line[data-active-indent="6"]').filter({ hasText: /total \+= value/ }).first().waitFor();
          const guide = await page.locator('.cm-line[data-active-indent="6"]').first().evaluate(node => getComputedStyle(node).backgroundSize.split(',')[0]);
          assert.equal(guide, palette === 'idea' ? '2px 100%' : '1px 100%');
          const scope = page.getByRole('navigation', { name: '当前作用域', exact: true });
          await scope.getByRole('button', { name: '跳转到 calculate', exact: true }).waitFor();
          const visibleScope = await scope.evaluate(node => {
            const bounds = node.getBoundingClientRect();
            return [...node.querySelectorAll('button>span')].map(label => {
              const rect = label.getBoundingClientRect();
              const fullyVisible = rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && label.scrollWidth <= label.clientWidth + 1;
              return { name: label.textContent, fullyVisible };
            });
          });
          assert.deepEqual(visibleScope, [{ name: 'Store', fullyVisible: true }, { name: 'calculate', fullyVisible: true }]);
          const reader = page.getByRole('button', { name: '阅读器模式', exact: true });
          assert.equal(await reader.locator('span').isVisible(), palette === 'idea');
          assert.ok(await reader.isVisible());
          const box = await heading.boundingBox();
          // 先让鼠标真实进入标题区，再移出，避免切换视口后 WebKit 沿用上一帧的 hover 链。
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForFunction(() => document.querySelector('.cm-sticky').matches(':hover'));
          await page.mouse.move(box.x + box.width / 2, box.y + box.height * 4);
          await page.waitForFunction(() => !document.querySelector('.cm-sticky').matches(':hover'));
          assert.ok(await control.evaluate(node => {
            const rect = node.getBoundingClientRect();
            return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
          }), '粘性折叠控件应处于普通行号栏之上');
          const glyph = control.locator('.cm-fold-chevron');
          assert.deepEqual(await glyph.evaluate(node => {
            const css = getComputedStyle(node);
            return { border: css.borderLeftWidth, opacity: css.opacity };
          }), palette === 'idea' ? { border: '1px', opacity: '0.72' } : { border: '0px', opacity: '0' });
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          assert.equal(await glyph.evaluate(node => getComputedStyle(node).opacity), '1');
          const before = await position();
          await page.mouse.wheel(0, 160);
          await page.waitForFunction(before => window.test.c.view().scrollDOM.scrollTop > before + 80, before);
          assert.equal(await page.evaluate(() => window.test.c.view().state.selection.main.head), 0);
          assert.ok((await headers()).some(header => header.includes('calculate(')));
          if (process.env.SC_TEST_ARTIFACTS) {
            await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true });
            const name = ['context', palette, dark ? 'dark' : 'light'].join('-') + '.png';
            await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, name), animations: 'disabled' });
          }
          if (palette === 'idea') await control.click(); else await control.press('Enter');
          await placeholder.waitFor();
          await page.waitForFunction(() => {
            const v = window.test.c.view(), fold = v.dom.querySelector('.cm-foldPlaceholder');
            const pinned = v.dom.querySelector('.cm-sticky:not([hidden])');
            const top = pinned?.getBoundingClientRect().bottom ?? v.scrollDOM.getBoundingClientRect().top;
            return fold?.parentElement.textContent.includes('): number {') && fold.getBoundingClientRect().top >= top - 1;
          });
          assert.equal(await page.evaluate(() => window.test.c.view().state.selection.main.head), 0);
          await placeholder.press('Space');
          await placeholder.waitFor({ state: 'detached' });
        }
        await page.evaluate(() => window.test.select(1, 7));
        assert.equal(await page.locator('.cm-editor[data-reading-viewport]').count(), 0);
        assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), await page.evaluate(() => window.test.texts['long.ts']));
      } finally {
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.evaluate(value => {
          window.test.unfold();
          document.body.removeAttribute('data-ds-dark-theme');
          window.test.c.settings(value);
        }, previous);
        await page.evaluate(() => window.test.select(0));
      }
    });
    await t.test('搜索栏位于粘性行上方，搜索仍能选择匹配项', async () => {
      await scrollTo(45); await page.evaluate(() => window.test.c.view().focus()); await page.keyboard.press('Control+f');
      const input = page.locator('.cm-search input[name=search]'); await input.fill(''); await input.pressSequentially('total');
      await page.locator('.cm-searchMatch').first().waitFor();
      const bounds = await page.evaluate(() => ({ search: document.querySelector('.cm-search').getBoundingClientRect().bottom, sticky: document.querySelector('.cm-sticky').getBoundingClientRect().top }));
      assert.ok(bounds.search <= bounds.sticky + 1);
      await page.keyboard.press('Escape');
    });
    await t.test('阅读模式不修改源码、选区或撤销记录，注释正体并提高可读性', async () => {
      await page.evaluate(() => { const v = window.test.c.view(); v.dispatch({ changes: { from: 0, insert: '// 阅读检查\n' }, selection: { anchor: 3, head: 7 } }); });
      const before = await page.evaluate(() => ({ text: window.test.c.view().state.doc.toString(), selection: window.test.c.view().state.selection.main.toJSON() }));
      await settings({ readerMode: true, fontSize: 15, lineHeight: 1.5 });
      assert.deepEqual(await page.evaluate(() => ({ text: window.test.c.view().state.doc.toString(), selection: window.test.c.view().state.selection.main.toJSON() })), before);
      assert.deepEqual(await page.locator('.cm-scroller').evaluate(node => ({ size: getComputedStyle(node).fontSize, height: parseFloat(getComputedStyle(node).lineHeight) })), { size: '16px', height: 26 });
      await page.evaluate(() => { window.test.c.view().scrollDOM.scrollTop = 0; });
      const comment = page.locator('.cm-line span').filter({ hasText: '阅读检查' }).first(); await comment.waitFor();
      assert.equal(await comment.evaluate(node => getComputedStyle(node).fontStyle), 'normal');
      await page.evaluate(() => window.test.c.undo());
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), await page.evaluate(() => window.test.texts['long.ts']));
    });
    await t.test('编辑器设置可即时关闭和恢复粘性行，普通文字不触发开关', async () => {
      await page.evaluate(() => window.test.c.panel({ kind: 'settings' }));
      await page.locator('.sc-wb-settings-nav').getByRole('button', { name: '阅读与字体', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('.sc-wb-settings-nav button')].some(node => node.textContent === '阅读与字体' && node.getAttribute('aria-current') === 'location'));
      const checkbox = page.getByRole('checkbox', { name: '滚动时保留作用域标题', exact: true });
      await page.locator('.sc-wb-setting > span').getByText('滚动时保留作用域标题', { exact: true }).click();
      assert.equal(await checkbox.isChecked(), true);
      await checkbox.uncheck(); assert.equal(await page.locator('.cm-sticky').count(), 0);
      await checkbox.check(); await page.getByRole('combobox', { name: '代码字号', exact: true }).selectOption('17');
      assert.equal(await page.evaluate(() => window.test.c.snapshot().preferences.fontSize), 17);
      await page.evaluate(() => window.test.c.panel(null)); await scrollTo(45);
      assert.equal(await page.locator('.cm-sticky').count(), 1);
      await settings({ readerMode: false, fontSize: 14, lineHeight: 1.5 });
    });
    await t.test('开关、字体与行距实时保存，刷新后仍保留', async () => {
      await settings({ readerMode: true, fontFamily: 'system', lineHeight: 1.8, stickyScroll: false });
      await page.reload(); await page.waitForFunction(() => window.test?.c.snapshot().indexed > 0);
      await page.evaluate(() => window.test.c.visit({ file: 'long.ts' }));
      const preferences = await page.evaluate(() => window.test.c.snapshot().preferences);
      assert.equal(preferences.readerMode, true); assert.equal(preferences.fontFamily, 'system'); assert.equal(preferences.lineHeight, 1.8); assert.equal(preferences.stickyScroll, false);
      assert.equal(await page.locator('.cm-sticky').count(), 0);
      await settings({ readerMode: false, fontSize: 14, lineHeight: 1.5, stickyScroll: true, fontFamily: 'theme' });
    });
    await t.test('切换到其他作用域、空文件或旧词法语言不残留标题', async () => {
      await scrollTo(45); await page.evaluate(() => window.test.scroll(120));
      await page.waitForFunction(() => !document.querySelector('.cm-sticky:not([hidden])'));
      for (const file of ['other.ts', 'empty.txt', 'legacy.sh']) {
        await page.evaluate(file => window.test.c.visit({ file }), file);
        assert.equal(await page.locator('.cm-sticky:visible').count(), 0, file);
      }
    });
    await t.test('两套明暗主题及窄窗横向滚动代码时保留粘性签名开头', async () => {
      await page.evaluate(() => window.test.c.visit({ file: 'long.ts' }));
      const distance = 480;
      const settledFrame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      try {
        await page.setViewportSize({ width: 720, height: 700 });
        for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
          await page.evaluate(({ palette, dark }) => window.test.theme(palette, dark), { palette, dark });
          await scrollTo(45);
          await settledFrame();
          await page.waitForFunction(distance => {
            const scroller = window.test.c.view().scrollDOM;
            return scroller.scrollWidth - scroller.clientWidth >= distance;
          }, distance);
          assert.equal((await headers()).length, 3);
          const signature = () => page.evaluate(() => {
            const heading = document.querySelectorAll('.cm-sticky:not([hidden]) .cm-sticky-text')[1];
            const name = heading && [...heading.querySelectorAll('span')].find(token => token.textContent === 'calculate');
            if (!name) return null;
            const range = document.createRange();
            range.selectNodeContents(name);
            const token = range.getBoundingClientRect(), clip = heading.parentElement.getBoundingClientRect();
            return { left: token.left, visible: token.width > 0 && token.left >= clip.left && token.right <= clip.right };
          });
          await page.evaluate(() => { window.test.c.view().scrollDOM.scrollLeft = 0; });
          const before = await signature(); assert.ok(before?.visible);
          await page.evaluate(distance => { window.test.c.view().scrollDOM.scrollLeft = distance; }, distance);
          await page.waitForFunction(distance => window.test.c.view().scrollDOM.scrollLeft >= distance - 5, distance);
          await settledFrame();
          assert.deepEqual(await signature(), before);
          const { x, width } = await page.locator('.cm-sticky').boundingBox();
          assert.ok(x + width <= 720);
          if (process.env.SC_TEST_ARTIFACTS) { await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, `reading-${palette}-${dark ? 'dark' : 'light'}.png`) }); }
        }
      } finally {
        await page.setViewportSize({ width: 1400, height: 900 });
      }
    });
    await t.test('两套主题区分行号栏、折叠图形与当前行，窄窗保留阅读器按钮', async () => {
      await page.evaluate(() => window.test.select(window.test.c.view().state.doc.line(2).from));
      await page.setViewportSize({ width: 610, height: 760 });
      try {
        for (const dark of [false, true]) for (const palette of ['idea', 'vscode']) {
          await page.evaluate(({ palette, dark }) => window.test.theme(palette, dark), { palette, dark });
          await page.locator(`.sc-wb-main[data-palette=${palette}]`).waitFor();
          const style = await page.evaluate(() => ({
            gutters: getComputedStyle(document.querySelector('.cm-gutters')).borderRightWidth,
            fold: getComputedStyle(document.querySelector('.cm-fold-chevron')).borderTopWidth,
            active: getComputedStyle(document.querySelector('.cm-activeLine')).boxShadow,
            overflow: document.documentElement.scrollWidth > innerWidth,
          }));
          const idea = palette === 'idea';
          assert.equal(style.gutters, idea ? '1px' : '0px');
          assert.equal(style.fold, idea ? '1px' : '0px');
          assert.equal(style.active === 'none', idea);
          assert.equal(style.overflow, false);
          await page.getByRole('button', { name: '阅读器模式', exact: true }).waitFor();
        }
      } finally {
        await page.evaluate(() => window.test.theme('idea', false));
        await page.setViewportSize({ width: 1400, height: 900 });
      }
    });
    await t.test('放大两倍后标题和搜索栏仍对齐，点击可返回声明', async () => {
      const layout = await page.evaluate(() => window.test.c.layout.snapshot());
      await page.evaluate(() => { window.test.c.layout.change({ explorerOpen: false, panes: { conversation: false, quick: false, changes: false, learning: false } }); document.body.style.zoom = '2'; });
      try {
        assert.equal(await page.evaluate(() => CSS.supports('zoom', '2')), true);
        await page.evaluate(() => window.test.c.view().focus()); await page.keyboard.press('Control+f');
        await page.locator('.cm-search input[name=search]').pressSequentially('total');
        await scrollTo(45);
        const bounds = await page.locator('.cm-sticky').evaluate(node => ({ top: node.getBoundingClientRect().top, left: node.getBoundingClientRect().left, scroller: node.closest('.cm-scroller').getBoundingClientRect().toJSON() }));
        assert.ok(Math.abs(bounds.top - bounds.scroller.top) < 1, JSON.stringify(bounds));
        assert.ok(Math.abs(bounds.left - bounds.scroller.left) < 1);
        await page.locator('.cm-sticky-line').nth(1).click();
        await page.waitForFunction(() => window.test.c.snapshot().cursor?.line === 1);
        await page.locator('.cm-search').getByRole('button', { name: '关闭', exact: true }).click();
      } finally { await page.evaluate(layout => { document.body.style.zoom = ''; window.test.c.layout.change(layout); }, layout); }
    });
    await t.test('阅读器让中英长行、Tab 和无空格长串随可用宽度换行，不撑开代码区', async () => {
      await page.evaluate(() => window.test.c.visit({ file: 'wrapped.ts' }));
      await settings({ readerMode: false, fontFamily: 'jetbrains', fontSize: 14, lineHeight: 1.5 });
      await page.setViewportSize({ width: 840, height: 760 });
      await page.waitForFunction(() => { const v = window.test.c.view(); return v.scrollDOM.scrollWidth > v.scrollDOM.clientWidth * 2; });
      console.log('长行原始宽度', await page.evaluate(() => { const v = window.test.c.view(); return { width: v.scrollDOM.clientWidth, scroll: v.scrollDOM.scrollWidth, lines: v.state.doc.lines }; }));
      await settings({ readerMode: true });
      await page.waitForFunction(() => { const v = window.test.c.view(); return v.lineWrapping; });
      await page.waitForFunction(() => { const v = window.test.c.view(); return v.scrollDOM.scrollWidth <= v.scrollDOM.clientWidth + 1; });
      const dimensions = await page.evaluate(() => {
        const v = window.test.c.view();
        return { width: v.scrollDOM.clientWidth, scroll: v.scrollDOM.scrollWidth, height: v.lineBlockAt(v.state.doc.line(8).from).height, lineHeight: v.defaultLineHeight };
      });
      assert.ok(dimensions.scroll <= dimensions.width + 1, JSON.stringify(dimensions));
      assert.ok(dimensions.height > dimensions.lineHeight * 2, JSON.stringify(dimensions));
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), await page.evaluate(() => window.test.texts['wrapped.ts']));
      console.log('阅读器长行宽度', dimensions);
    });
    await t.test('续行跟随源码缩进，IDEA 加两列区分续行', async () => {
      for (const palette of ['idea', 'vscode']) {
        await page.evaluate(palette => window.test.theme(palette, false), palette);
        const indent = await page.locator('.cm-line').filter({ hasText: /const label =/ }).evaluate(node => {
          const view = window.test.c.view(), start = view.state.doc.line(7).from;
          const first = view.coordsAtPos(start + 4);
          const range = document.createRange(); range.selectNodeContents(node);
          const bounds = node.getBoundingClientRect(), css = getComputedStyle(node);
          const fragments = [...range.getClientRects()].filter(rect => rect.width > 0);
          const continuation = fragments.find(rect => rect.top > first.top + 10);
          return { first: first.left - bounds.x, continuation: continuation.x - bounds.x,
            inset: parseFloat(css.getPropertyValue('--wb-code-inset')), advance: view.defaultCharacterWidth };
        });
        assert.ok(Math.abs(indent.first - (indent.inset + 4 * indent.advance)) <= 1, JSON.stringify(indent));
        const expected = indent.inset + (palette === 'idea' ? 6 : 4) * indent.advance;
        assert.ok(Math.abs(indent.continuation - expected) <= 1, JSON.stringify({ palette, expected, indent }));
      }
    });
    await t.test('换行后的鼠标拖选和双击仍选中准确的源码字符', async () => {
      await page.evaluate(() => {
        const v = window.test.c.view(), line = v.state.doc.line(7), start = line.from + line.text.indexOf('mixed', 260);
        window.test.select(start);
      });
      await page.waitForFunction(() => { const v = window.test.c.view(), r = v.coordsAtPos(v.state.selection.main.head), box = v.scrollDOM.getBoundingClientRect(); return r && r.top > box.top + 60 && r.bottom < box.bottom; });
      const target = await page.evaluate(() => {
        const v = window.test.c.view(), start = v.state.selection.main.head, from = v.coordsAtPos(start), to = v.coordsAtPos(start + 5);
        return { start, x: from.left, end: to.left, y: (from.top + from.bottom) / 2, fromTop: from.top, toTop: to.top, originalTop: v.lineBlockAt(v.state.doc.line(7).from).top + v.documentTop };
      });
      assert.equal(target.fromTop, target.toTop); assert.ok(target.fromTop > target.originalTop + 20);
      await page.mouse.move(target.x, target.y); await page.mouse.down(); await page.mouse.move(target.end, target.y, { steps: 5 }); await page.mouse.up();
      assert.equal(await page.evaluate(() => { const v = window.test.c.view(), s = v.state.selection.main; return v.state.doc.sliceString(s.from, s.to); }), 'mixed');
      assert.ok(await page.locator('.cm-selectionBackground').count() > 0);
      await page.mouse.dblclick(target.x + 9, target.y);
      assert.equal(await page.evaluate(() => { const v = window.test.c.view(), s = v.state.selection.main; return v.state.doc.sliceString(s.from, s.to); }), 'mixed');
      assert.equal(await page.evaluate(() => window.test.c.snapshot().cursor.line), 6);
    });
    await t.test('软换行保留选区和撤销，关闭后恢复横向滚动', async () => {
      const before = await page.evaluate(() => {
        const v = window.test.c.view(), from = v.state.doc.line(7).from + 12;
        v.dispatch({ changes: { from, insert: 'NEW ' }, selection: { anchor: from, head: from + 3 }, userEvent: 'input' });
        return { text: v.state.doc.toString(), selection: v.state.selection.toJSON() };
      });
      for (const readerMode of [false, true]) {
        await settings({ readerMode });
        assert.deepEqual(await page.evaluate(() => ({ text: window.test.c.view().state.doc.toString(), selection: window.test.c.view().state.selection.toJSON() })), before);
      }
      await page.evaluate(() => window.test.c.view().focus()); await page.keyboard.press('Control+z');
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), await page.evaluate(() => window.test.texts['wrapped.ts']));
      await settings({ readerMode: false });
      await page.waitForFunction(() => { const v = window.test.c.view(); return !v.lineWrapping && v.scrollDOM.scrollWidth > v.scrollDOM.clientWidth * 2; });
      await settings({ readerMode: true });
    });
    await t.test('搜索能定位换行末端，粘性标题与行号仍对应原始函数', async () => {
      await page.evaluate(() => window.test.select(0)); await page.keyboard.press('Control+f');
      await page.locator('.cm-search input[name=search]').fill('');
      await page.locator('.cm-search input[name=search]').pressSequentially('value + token');
      await page.locator('.cm-search input[name=search]').press('Enter');
      await page.waitForFunction(() => { const v = window.test.c.view(), s = v.state.selection.main; return v.state.doc.sliceString(s.from, s.to) === 'value + token'; });
      await page.waitForFunction(() => { const v = window.test.c.view(), box = v.scrollDOM.getBoundingClientRect(), r = v.coordsAtPos(v.state.selection.main.from); return r && r.top >= box.top && r.bottom <= box.bottom; });
      await page.waitForFunction(() => document.querySelectorAll('.cm-sticky:not([hidden]) .cm-sticky-line').length === 2);
      assert.deepEqual(await headers(), ['export class Summary {', '  summarize(value: string): string {']);
      assert.deepEqual(await page.locator('.cm-sticky-number').allTextContents(), ['1', '6']);
      await page.keyboard.press('Escape');
      await page.locator('.cm-sticky-line').nth(1).click();
      await page.waitForFunction(() => window.test.c.snapshot().cursor?.line === 5);
      assert.ok(await page.evaluate(() => { const v = window.test.c.view(), r = v.coordsAtPos(v.state.doc.line(6).from), top = v.dom.querySelector('.cm-sticky:not([hidden])')?.getBoundingClientRect().bottom || v.scrollDOM.getBoundingClientRect().top; return r.top >= top - 1; }));
    });
    await t.test('换行可与文档排版和函数折叠共存，点击及键盘展开后不残留行高', async () => {
      await page.evaluate(() => window.test.select(0));
      await page.locator('.cm-reader-document').waitFor();
      const document = await page.locator('.cm-reader-document').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
      assert.ok(document.scroll <= document.width + 1, JSON.stringify(document));
      await page.evaluate(() => { const v = window.test.c.view(); window.test.select(v.state.doc.line(6).from); });
      await page.waitForFunction(() => window.test.foldReady());
      const folding=await page.evaluate(() => window.test.fold());
      assert.equal(folding.folded,true,JSON.stringify(folding));
      const expand = page.getByRole('button', { name: '展开代码', exact: true });
      await expand.click();
      await expand.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => window.test.fold().folded), true);
      await expand.press('Enter');
      await expand.waitFor({ state: 'detached' });
      await page.evaluate(() => { const v = window.test.c.view(); window.test.select(v.state.doc.line(8).from); });
      await page.waitForFunction(() => { const v = window.test.c.view(); return v.lineBlockAt(v.state.doc.line(8).from).height > v.defaultLineHeight * 2; });
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.lines), 41);
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), await page.evaluate(() => window.test.texts['wrapped.ts']));
    });
    await t.test('明暗主题、窄窗及两倍缩放按当前宽度重排，切文件继续生效', async () => {
      await page.evaluate(() => window.test.c.layout.change({ explorerOpen: false, panes: { conversation: false, quick: false, changes: false, learning: false } }));
      for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
        await page.evaluate(({ palette, dark }) => window.test.theme(palette, dark), { palette, dark });
        await page.setViewportSize({ width: 640, height: 760 });
        await page.evaluate(() => window.test.select(0));
        await page.waitForFunction(() => { const v = window.test.c.view(); return v.scrollDOM.scrollWidth <= v.scrollDOM.clientWidth + 1; });
        if (process.env.SC_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, `wrapped-${palette}-${dark ? 'dark' : 'light'}.png`) });
      }
      await page.evaluate(() => { const v = window.test.c.view(); window.test.select(v.state.doc.line(8).from + 12); });
      await page.waitForFunction(() => { const v = window.test.c.view(); return [...v.dom.querySelectorAll('.cm-line')].some(n => n.textContent.includes('LongIdentifier')); });
      const wide = await page.evaluate(() => { const v = window.test.c.view(); return v.lineBlockAt(v.state.doc.line(8).from).height; });
      await page.evaluate(() => { document.body.style.zoom = '2'; });
      try {
        await page.waitForFunction(wide => { const v = window.test.c.view(); return v.scrollDOM.scrollWidth <= v.scrollDOM.clientWidth + 1 && v.lineBlockAt(v.state.doc.line(8).from).height > wide; }, wide);
        assert.ok(await page.evaluate(wide => { const v = window.test.c.view(); return v.lineBlockAt(v.state.doc.line(8).from).height > wide; }, wide));
      } finally { await page.evaluate(() => { document.body.style.zoom = ''; }); }
      await page.evaluate(() => window.test.c.visit({ file: 'other.ts' }));
      assert.equal(await page.evaluate(() => window.test.c.view().lineWrapping), true);
      await page.evaluate(() => window.test.c.visit({ file: 'wrapped.ts' }));
      await settings({ readerMode: false });
      await page.setViewportSize({ width: 1400, height: 900 });
    });
    await t.test('宿主内的窄工作台保留阅读宽度，专注按钮不修改布局或选区', async () => {
      await page.evaluate(() => window.test.c.visit({ file: 'wrapped.ts', line: 0 }));
      await settings({ readerMode: true });
      const layout = await page.evaluate(() => {
        const { c } = window.test;
        document.getElementById('root').style.width = '540px';
        c.layout.change({ explorerOpen: true, filesOpen: true, outlineOpen: true, panes: { conversation: true } });
        window.test.select(1, 6);
        return c.layout.snapshot();
      });
      try {
        const button = page.getByRole('button', { name: '专注阅读', exact: true });
        const width = async () => (await page.locator('.cm-scroller').boundingBox()).width;
        const source = () => page.evaluate(() => {
          const { c } = window.test;
          return { file: c.snapshot().file, selection: c.view().state.selection.toJSON(), reader: c.view().lineWrapping,
            savedLayout: localStorage.getItem('dsh-super-code-workbench-layout') };
        });
        for (const palette of ['idea', 'vscode']) {
          await page.evaluate(palette => window.test.theme(palette, palette === 'vscode'), palette);
          const regular = await width(), original = await source();
          assert.ok(regular >= 269, `${palette}: ${regular}px`);
          await page.locator('.cm-reader-document[data-compact]').waitFor();
          await button.press('Space');
          assert.equal(await button.getAttribute('aria-pressed'), 'true');
          assert.ok(await width() >= 535);
          assert.equal(await page.locator('.sc-wb-side-rail:visible').count(), 0);
          await page.locator('.cm-reader-document:not([data-compact])').waitFor();
          assert.deepEqual(await source(), original);
          await button.press('Enter');
          assert.equal(await button.getAttribute('aria-pressed'), 'false');
          assert.equal(await width(), regular);
          assert.equal(await page.locator('.sc-wb-side-rail:visible').count(), 2);
          await page.locator('.cm-reader-document[data-compact]').waitFor();
          assert.deepEqual(await source(), original);
        }
        assert.deepEqual(await page.evaluate(() => window.test.c.layout.snapshot()), layout);
      } finally {
        await page.evaluate(() => { document.getElementById('root').style.width = ''; });
        await settings({ readerMode: false });
      }
    });
    await t.test('光标在屏外时，粘性标题的后退回到正文，前进回到声明', async () => {
      await page.evaluate(() => window.test.c.visit({ file: 'long.ts', line: 0 }));
      await scrollTo(45);
      const visibleRange = await page.evaluate(() => {
        const view = window.test.c.view(), box = view.scrollDOM.getBoundingClientRect();
        const top = view.dom.querySelector('.cm-sticky').getBoundingClientRect().bottom;
        const lineAtHeight = y => view.state.doc.lineAt(view.lineBlockAtHeight(y - view.documentTop).from).number;
        return { first: lineAtHeight(top), last: lineAtHeight(box.bottom) };
      });
      assert.ok(visibleRange.first > 1);
      await page.locator('.cm-sticky-line').nth(1).click();
      await page.waitForFunction(() => window.test.c.snapshot().cursor?.line === 1);
      await page.evaluate(() => window.test.c.move(-1));
      const returned = await page.evaluate(() => window.test.c.snapshot().cursor.line + 1);
      assert.ok(returned >= visibleRange.first && returned <= visibleRange.last, JSON.stringify({ returned, visibleRange }));
      await page.evaluate(() => window.test.c.move(1));
      assert.equal(await page.evaluate(() => window.test.c.snapshot().cursor.line + 1), 2);
    });
    if (process.env.SC_TEST_READING_PERF) await t.test('大文件保持虚拟渲染并记录开销，不建立第二份索引', async () => {
      const results = await page.evaluate(() => window.test.performance());
      if (process.env.SC_TEST_ARTIFACTS) await writeFile(join(process.env.SC_TEST_ARTIFACTS, 'reading-performance.json'), JSON.stringify(results, null, 2));
      console.log('Reading scroll frames', JSON.stringify(results));
      for (const result of results) {
        assert.equal(result.lines, 25004); assert.ok(result.rendered < 500); assert.equal(result.sticky > 0, result.enabled);
        assert.equal(result.guided > 0, result.enabled); assert.ok(result.guided <= result.rendered);
        assert.equal(result.activeFrames, result.enabled ? 35 : 0);
        assert.ok(Math.abs(result.jump.line - 20000) <= 1); assert.ok(result.jump.tree >= result.jump.viewport.to);
        assert.deepEqual(result.jump.headers, result.enabled ? ['class Large {', '  run() {'] : []);
      }
    });
    if (process.env.SC_TEST_READING_PERF) await t.test('25,004 行长代码开启换行仍虚拟渲染并能跳到第 20,000 行', async () => {
      const results = await page.evaluate(() => window.test.performance(true));
      if (process.env.SC_TEST_ARTIFACTS) await writeFile(join(process.env.SC_TEST_ARTIFACTS, 'wrapping-performance.json'), JSON.stringify(results, null, 2));
      console.log('Wrapped reading scroll frames', JSON.stringify(results));
      for (const result of results) {
        assert.equal(result.lines, 25004); assert.ok(result.rendered < 500);
        assert.equal(result.wrapping, result.enabled);
        assert.equal(result.scrollWidth <= result.width + 1, result.enabled);
        assert.ok(Math.abs(result.jump.line - 20000) <= 1);
        assert.ok(result.jump.tree >= result.jump.viewport.to);
        assert.deepEqual(result.jump.headers, result.enabled ? ['class Large {', '  run() {'] : []);
      }
    });
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.test.dispose()); await page.close();
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
