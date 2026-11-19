import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const source = [
  '/**',
  ' * 汇总任务，**保留原始列表**，返回 `Summary`。',
  ' *',
  ' * ### 使用顺序',
  ' * 1. 读取当前项目的任务。',
  ' * 2. 忽略已完成项，并按项目统计。',
  ' *',
  ' * @param {Task[]} tasks 待处理的 **任务列表**。',
  ' * @param {boolean} includeArchived 是否包含归档任务。',
  ' * @returns {Summary} 项目统计与 `pending` 列表。',
  ' */',
  'export function summarize(tasks: Task[], includeArchived = false): Summary {',
  '  const pending = tasks.filter(task => includeArchived || !task.done);',
  '  return { count: pending.length, label: "待处理任务" };',
  '}',
  '',
  'export class TaskStore {',
  '  /**',
  '   * 读取项目中的任务。',
  '   * @param {string} workspace 工作目录名称。',
  '   * @returns {Task[]} 当前项目的任务。',
  '   */',
  '  async load(workspace: string): Promise<Task[]> {',
  '    const tasks = await readTasks(workspace);',
  '    return tasks.filter(task => task.active);',
  '  }',
  '}',
  '',
  ...Array.from({ length: 40 }, (_, i) => `const item${i} = ${i};`),
].join('\n');
const example = [
  'export class Example {',
  '\t/**',
  '\t * 说明如何传入任务。',
  '\t *',
  '\t * ````ts',
  '\t * const template = `',
  '\t * @param literal 示例里的文本',
  '\t * ```',
  '\t * `;',
  '\t * ````',
  '\t * @param tasks 待处理项目。',
  '\t * @returns {number} 数量。',
  '\t */',
  '\tload(tasks: string[]) { return tasks.length; }',
  '}',
].join('\n');
const pythonExample = [
  'def summarize(tasks):',
  '    """汇总任务。',
  '',
  '    ~~~text',
  '    Args:',
  '        example (str): 示例里的文本。',
  '    ~~~',
  '',
  '    Args:',
  '        tasks (list): 待处理的任务。',
  '    """',
  '    return len(tasks)',
].join('\n');
const tagsOnly = [
  '/**',
  ' * @param {string[]} tasks 待处理的任务。',
  ' * @returns {number} 任务数量。',
  ' */',
  'function count(tasks: string[]) { return tasks.length; }',
].join('\n');
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';
import{Workbench}from'./builtin/workbench/components/Workbench.jsx';import{createWorkbench}from'./builtin/workbench/controller.js';
import{zh}from'./builtin/workbench/locales.js';import css from'./builtin/workbench/style.css';import fonts from'./builtin/workbench/fonts/style.js';
import{EditorView}from'@codemirror/view';
import{SearchQuery,setSearchQuery,findNext,openSearchPanel,closeSearchPanel}from'@codemirror/search';
import{foldCode,unfoldAll}from'@codemirror/language';
const texts={'tasks.ts':${JSON.stringify(source)},
'examples.ts':${JSON.stringify(example)},'examples.py':${JSON.stringify(pythonExample)},
'tags.ts':${JSON.stringify(tagsOnly)},
'tasks.py':'def summarize(tasks):\\n    """汇总任务。\\n\\n    Args:\\n        tasks (list): 待处理的任务。\\n\\n    Returns:\\n        int: 任务数量。\\n    """\\n    return len(tasks)\\n',
'plain.ts':'/* 普通多行注释。\\n * 保留为源码。\\n */\\nconst typed = /** inline type */ value;\\n/** 单行文档仍保留源码。 */\\nconst ready = true;',
'unsafe.ts':'/**\\n * **安全文档** [危险链接](javascript:alert(1))\\n * <img src="/unexpected-image" onerror="alert(1)">\\n * <script>alert(1)</script>\\n */\\nfunction unsafe() { return 1; }',
'huge.ts':'/**\\n'+Array.from({length:1800},()=> ' * 很长的文档保持源码的虚拟显示。').join('\\n')+'\\n */\\nfunction huge() {}',
'large.ts':'class Large {\\n  /**\\n   * 按需读取大量条目。\\n   */\\n  run() {\\n'+Array.from({length:25000},(_,i)=>'    const value'+i+' = '+i+';').join('\\n')+'\\n  }\\n}'};
const style=document.createElement('style');style.textContent=fonts+css;document.head.append(style);
const api={fileOperation:async()=>({path:'/sample-project'}),list:async()=>({entries:Object.keys(texts).map(path=>({name:path,path,type:'file'})),truncated:false}),read:async path=>({path,text:texts[path],version:'v1'}),project:async()=>({files:Object.keys(texts),truncated:false}),models:async()=>[],fonts:async()=>[],git:async()=>({kind:'state',state:{exists:false,changes:[],branches:[],remoteBranches:[],remotes:[],history:[]},sources:[]})};
const t=k=>zh[k]||k,c=createWorkbench(api,t),root=createRoot(document.getElementById('root'));
function Button({children,...props}){return <button type='button' {...props}>{children}</button>}
function Select({label,value,choices,onChange}){return <select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{choices.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}
c.layout.change({outlineOpen:false,panes:{conversation:false,quick:false,changes:false,learning:false}});
root.render(<Workbench workbench={c} Button={Button} Select={Select} Conversation={()=>null} sessionId='reader' t={t}/>);
window.test={c,texts,settings:patch=>c.settings({...c.snapshot().preferences,...patch}),
theme:async(palette,dark)=>{document.body.toggleAttribute('data-ds-dark-theme',dark);await c.settings({...c.snapshot().preferences,palette})},
position:word=>c.view().state.doc.toString().indexOf(word),
select:(from,to=from)=>{const v=c.view();v.dispatch({selection:{anchor:from,head:to},effects:EditorView.scrollIntoView(from,{y:'start'})});v.focus()},
find:word=>{const v=c.view();openSearchPanel(v);v.dispatch({effects:setSearchQuery.of(new SearchQuery({search:word}))});return findNext(v)},
closeSearch:()=>closeSearchPanel(c.view()),fold:()=>foldCode(c.view()),unfold:()=>unfoldAll(c.view()),
dispose(){root.unmount();c.dispose()}};`;
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, platform: 'browser', format: 'esm', loader: { '.css': 'text', '.woff2': 'dataurl' } });
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(app.outputFiles[0].contents); }
  else { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('阅读器中的源码内文档', async t => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [], requests = [];
    page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.test?.c.snapshot().indexed === 9);
    await page.evaluate(() => window.test.c.visit({ file: 'tasks.ts' })); await page.evaluate(() => document.fonts.ready);
    const capture = async name => { if (process.env.SC_TEST_ARTIFACTS) { await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, name + '.png'), animations: 'disabled' }); } };
    const measure = () => page.evaluate(() => {
      const view = window.test.c.view(), doc = view.state.doc;
      const box = view.scrollDOM.getBoundingClientRect();
      const declarations = ['export function summarize', 'async load'].map(text => view.coordsAtPos(window.test.position(text)));
      return {
        documents: [...view.dom.querySelectorAll('.cm-reader-document')].map(node => {
          const { left, height, width } = node.getBoundingClientRect(); return { left: left - box.left, height, width };
        }),
        declarationTop: declarations[0]?.top - box.top,
        declarationIndent: declarations[1] && declarations[0] ? declarations[1].left - declarations[0].left : null,
        expectedOrigins: ['/**', '/**\n   *'].map(text => doc.lineAt(window.test.position(text)).number),
        origins: [...view.dom.querySelectorAll('.cm-reader-line-number')].map(node => Number(node.textContent)),
      };
    });
    const record = async (name, data) => {
      if (!process.env.SC_TEST_ARTIFACTS) return;
      await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true });
      await writeFile(join(process.env.SC_TEST_ARTIFACTS, name + '.json'), JSON.stringify(data, null, 2) + '\n');
    };
    await t.test('开启已有阅读器开关后在源码中排版文档，源文本和选区保持', async () => {
      const before = await page.evaluate(() => ({ text: window.test.c.view().state.doc.toString(), selection: window.test.c.view().state.selection.toJSON() }));
      await capture('reader-off');
      await page.evaluate(() => window.test.settings({ readerMode: true }));
      await page.locator('.cm-reader-document').first().waitFor();
      await capture('reader-on');
      assert.ok(await page.locator('.cm-reader-document').count() > 0, '阅读器应在源码内呈现独立的多行文档');
      assert.deepEqual(await page.evaluate(() => ({ text: window.test.c.view().state.doc.toString(), selection: window.test.c.view().state.selection.toJSON() })), before);
      const first = page.locator('.cm-reader-document').first();
      assert.equal(await first.locator('strong').first().textContent(), '保留原始列表');
      assert.equal(await first.locator('li').count(), 2);
      assert.match(await first.textContent(), /tasks.*Task\[\]/);
      assert.equal(await first.getByRole('button', { name: '查看源码', exact: true }).count(), 1);
      const caret = await page.evaluate(() => { const v=window.test.c.view(),rect=v.coordsAtPos(0);return {height:rect.bottom-rect.top,line:v.defaultLineHeight} });
      assert.ok(caret.height <= caret.line + 1, JSON.stringify(caret));
    });
    await t.test('查看源码只展开当前文档，修改和撤销仍操作原文', async () => {
      await page.locator('.cm-reader-document').first().getByRole('button', { name: '查看源码', exact: true }).click();
      assert.equal(await page.locator('.cm-reader-document').count(), 1);
      assert.ok(await page.locator('.cm-line').filter({hasText:'/**'}).count() > 0);
      await page.evaluate(() => { const v=window.test.c.view(),from=window.test.position('汇总任务');v.dispatch({changes:{from,to:from+4,insert:'读取任务'},selection:{anchor:from+1},userEvent:'input'}); });
      assert.match(await page.evaluate(() => window.test.c.view().state.doc.toString()), /读取任务，/);
      await page.evaluate(() => window.test.c.undo());
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), source);
      await page.evaluate(() => window.test.select(window.test.position('const pending')));
      await page.waitForFunction(() => document.querySelectorAll('.cm-reader-document').length === 2);
    });
    await t.test('搜索和完整选区会展开原文，退出搜索后可恢复文档排版', async () => {
      assert.equal(await page.evaluate(() => window.test.find('@param')), true);
      assert.equal(await page.evaluate(() => { const v=window.test.c.view(),s=v.state.selection.main;return v.state.doc.sliceString(s.from,s.to) }), '@param');
      assert.equal(await page.locator('.cm-reader-document').count(), 1);
      await page.evaluate(() => { window.test.closeSearch();window.test.select(0,window.test.c.view().state.doc.length); });
      assert.equal(await page.locator('.cm-reader-document').count(), 0);
      assert.equal(await page.evaluate(() => { const v=window.test.c.view(),s=v.state.selection.main;return v.state.doc.sliceString(s.from,s.to) }), source);
      await page.evaluate(() => window.test.select(window.test.position('const pending')));
      await page.waitForFunction(() => document.querySelectorAll('.cm-reader-document').length === 2);
      await page.evaluate(() => window.test.settings({readerMode:false}));
      assert.equal(await page.locator('.cm-reader-document').count(), 0);
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), source);
      await page.evaluate(() => window.test.settings({readerMode:true}));
      await page.locator('.cm-reader-document').first().waitFor();
    });
    await t.test('切换到Python排版首条函数文档，普通注释、内联及单行注释保留源码', async () => {
      await page.evaluate(() => window.test.c.visit({file:'tasks.py'}));
      const doc = page.locator('.cm-reader-document');await doc.waitFor();
      assert.match(await doc.textContent(), /汇总任务/);assert.match(await doc.textContent(), /tasks.*list/);assert.match(await doc.textContent(), /int/);
      assert.doesNotMatch(await doc.textContent(), /Args:|"""/);
      await page.evaluate(() => window.test.c.visit({file:'plain.ts'}));
      assert.equal(await page.locator('.cm-reader-document').count(), 0);
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), await page.evaluate(() => window.test.texts['plain.ts']));
    });
    await t.test('源码文档不执行HTML、不加载图片或危险链接', async () => {
      await page.evaluate(() => window.test.c.visit({file:'unsafe.ts'}));
      const doc=page.locator('.cm-reader-document');await doc.waitFor();
      assert.match(await doc.textContent(), /安全文档/);
      assert.equal(await doc.locator('img,svg,script,iframe,a[href^="javascript:"]').count(), 0);
      assert.equal(requests.some(url => url.includes('unexpected-image')), false);
    });
    await t.test('超长文档保持源码虚拟行，大文件反复滚动不丢文档或移动光标', async () => {
      await page.evaluate(() => window.test.c.visit({file:'huge.ts'}));
      assert.equal(await page.locator('.cm-reader-document').count(), 0);
      assert.ok(await page.locator('.cm-line').count() < 200);
      await page.evaluate(() => window.test.c.visit({file:'large.ts'}));
      await page.locator('.cm-reader-document').waitFor();
      const scrolls=[];
      for(let i=0;i<3;i++) {
        await page.evaluate(() => window.test.select(window.test.c.view().state.doc.line(24000).from));
        await page.waitForFunction(() => {const v=window.test.c.view(),r=v.coordsAtPos(v.state.selection.main.head),box=v.scrollDOM.getBoundingClientRect();return v.viewport.from>100000&&r&&r.top>=box.top&&r.bottom<=box.bottom});
        assert.ok(await page.locator('.cm-line').count() < 200);
        const selected=await page.evaluate(() => window.test.c.view().state.selection.toJSON());
        // 滚动本身不更改编辑器选区。
        await page.evaluate(() => {window.test.c.view().scrollDOM.scrollTop=0});
        await page.waitForFunction(() => window.test.c.view().viewport.from === 0);
        await page.locator('.cm-reader-document').waitFor();
        assert.deepEqual(await page.evaluate(() => window.test.c.view().state.selection.toJSON()), selected);
        scrolls.push(await page.evaluate(() => window.test.c.view().scrollDOM.scrollTop));
      }
      assert.ok(scrolls.every(value => value < 2), JSON.stringify(scrolls));
      await capture('reader-large');
      if(process.env.SC_TEST_ARTIFACTS) await writeFile(join(process.env.SC_TEST_ARTIFACTS,'large.json'),JSON.stringify({scrolls,...await page.evaluate(()=>({lines:window.test.c.view().state.doc.lines,rendered:document.querySelectorAll('.cm-line').length,documents:document.querySelectorAll('.cm-reader-document').length}))},null,2));
    });
    await t.test('折叠函数后不显示其内部文档，展开和前置编辑后仍可正确查看源码', async () => {
      await page.evaluate(() => window.test.c.visit({file:'tasks.ts'}));
      await page.evaluate(() => window.test.select(window.test.position('export class')));
      assert.equal(await page.evaluate(() => window.test.fold()), true);
      await page.waitForFunction(() => document.querySelectorAll('.cm-reader-document').length === 1);
      assert.equal(await page.locator('.cm-foldPlaceholder').count(), 1);
      await page.evaluate(() => window.test.unfold());
      await page.waitForFunction(() => document.querySelectorAll('.cm-reader-document').length === 2);
      await page.evaluate(() => {const v=window.test.c.view();v.dispatch({changes:{from:0,insert:'// 更新说明\n'},selection:{anchor:0},userEvent:'input'})});
      await page.waitForFunction(() => document.querySelectorAll('.cm-reader-document').length === 2);
      await page.locator('.cm-reader-document').first().getByRole('button',{name:'查看源码',exact:true}).click();
      assert.equal(await page.evaluate(() => window.test.c.view().state.selection.main.from), '// 更新说明\n'.length + 1);
      await page.evaluate(() => window.test.c.undo());
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), source);
    });
    await t.test('嵌套文档随对应声明缩进，保留原始行号', async () => {
      await page.evaluate(() => window.test.select(0));
      for (const palette of ['idea', 'vscode']) {
        await page.evaluate(palette => window.test.theme(palette, false), palette);
        await page.locator('.cm-reader-document').nth(1).waitFor();
        const layout = await measure();
        await record(`indent-${palette}`, layout);
        assert.ok(Math.abs(layout.documents[1].left - layout.documents[0].left - layout.declarationIndent) <= 1, JSON.stringify(layout));
        assert.deepEqual(layout.origins, layout.expectedOrigins);
      }
    });
    await t.test('围栏内的示例保留完整，真实参数仍独立显示', async () => {
      for (const [file, sample, parameter] of [['examples.ts', '@param literal', 'tasks'], ['examples.py', 'example (str)', 'tasks']]) {
        await page.evaluate(file => window.test.c.visit({ file }), file);
        const doc = page.locator('.cm-reader-document');
        await doc.waitFor();
        const renderedExamples = await doc.locator('pre code').allTextContents();
        assert.equal(renderedExamples.length, 1, JSON.stringify(renderedExamples));
        assert.ok(renderedExamples[0].includes(sample), renderedExamples[0]);
        assert.deepEqual(await doc.locator('dt code').allTextContents(), [parameter]);
        if (file.endsWith('.ts')) {
          const left = await doc.evaluate(node => {
            const v = window.test.c.view(), token = window.test.position('load(tasks');
            return node.getBoundingClientRect().left - v.coordsAtPos(token).left;
          });
          assert.ok(Math.abs(left) <= 1, `Tab 缩进差 ${left}px`);
        }
      }
    });
    await t.test('四主题、窄窗与两倍缩放均保持文档可读且不撑宽代码区', async () => {
      await page.evaluate(() => window.test.c.visit({file:'tasks.ts'}));
      await page.evaluate(() => window.test.select(0));
      for(const palette of ['idea','vscode']) for(const dark of [false,true]) {
        await page.evaluate(([p,d]) => window.test.theme(p,d), [palette,dark]);
        await page.locator('.cm-reader-document').first().waitFor();
        const colors=await page.locator('.cm-reader-document').first().evaluate((n, palette) => {
          const c=getComputedStyle(n),p=document.createElement('i');n.append(p);
          p.style.color='var(--wb-text)';const text=getComputedStyle(p).color;
          p.style.background=palette === 'idea' ? 'var(--wb-surface)' : 'var(--wb-bg)';
          const bg=getComputedStyle(p).backgroundColor;p.remove();
          return {color:c.color,bg:c.backgroundColor,text,expected:bg,radius:c.borderTopLeftRadius,edge:c.borderInlineStartWidth};
        }, palette);
        assert.equal(colors.color, colors.text);assert.equal(colors.bg, colors.expected);
        assert.equal(colors.radius, palette === 'idea' ? '6px' : '0px');
        assert.equal(colors.edge, '2px');
        await capture(`reader-${palette}-${dark?'dark':'light'}`);
      }
      await page.setViewportSize({width:480,height:800});
      await page.evaluate(() => window.test.theme('idea',false));
      await page.locator('.cm-reader-document[data-compact]').first().waitFor();
      await page.waitForFunction(() => {const n=document.querySelector('.cm-reader-document');return n.getBoundingClientRect().right<=innerWidth});
      const narrow=await page.locator('.cm-reader-document').first().evaluate(n=>({scroll:n.scrollWidth,width:n.clientWidth,right:n.getBoundingClientRect().right}));
      assert.ok(narrow.scroll<=narrow.width+1 && narrow.right<=480, JSON.stringify(narrow));
      await capture('reader-narrow');await page.setViewportSize({width:1000,height:900});
      await page.evaluate(() => {document.getElementById('root').style.zoom='2'});
      await page.locator('.cm-reader-document[data-compact]').first().waitFor();
      await capture('reader-zoom');
      const zoom=await page.locator('.cm-reader-document').first().evaluate(n=>({
        scroll:n.scrollWidth,width:n.clientWidth,
        actionsLeft:n.querySelector('.cm-reader-actions').getBoundingClientRect().left,
        textRight:n.querySelector('.cm-reader-lead').getBoundingClientRect().right,
      }));
      assert.ok(zoom.scroll<=zoom.width+1, JSON.stringify(zoom));
      assert.ok(zoom.actionsLeft>=zoom.textRight, JSON.stringify(zoom));
      await page.evaluate(() => {document.getElementById('root').style.zoom='1'});
    });
    await t.test('窄窗口优先显示代码，键盘展开后保留焦点和选择', async () => {
      await page.evaluate(() => { document.getElementById('root').style.zoom = ''; });
      await page.setViewportSize({ width: 480, height: 800 });
      for (const palette of ['idea', 'vscode']) {
        await page.evaluate(palette => window.test.theme(palette, palette === 'vscode'), palette);
        await page.evaluate(() => window.test.select(0));
        const card = page.locator('.cm-reader-document[data-compact]').first(), toggle = card.locator('.cm-reader-toggle');
        await card.waitFor();
        const collapsed = await measure();
        await record(`narrow-${palette}`, collapsed);
        await capture(`narrow-${palette}`);
        assert.ok(collapsed.documents[0].height <= 120 && collapsed.declarationTop <= 160, JSON.stringify(collapsed));
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        assert.equal(await card.getByText('使用顺序', { exact: true }).isVisible(), false);
        await toggle.press('Enter');
        await card.getByText('使用顺序', { exact: true }).waitFor();
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        assert.equal(await toggle.evaluate(node => node === document.activeElement), true);
        assert.equal(await page.evaluate(() => window.test.c.view().state.selection.main.head), 0);
        // 选区进入原始注释时会拆掉排版组件，离开后应恢复同一份展开状态。
        await page.evaluate(() => window.test.select(window.test.position('汇总任务')));
        await page.evaluate(() => window.test.select(0));
        await card.getByText('使用顺序', { exact: true }).waitFor();
        await page.evaluate(() => {
          const view = window.test.c.view();
          view.dispatch({ changes: { from: 0, insert: '// 示例\n' }, userEvent: 'input' });
          window.test.select(0);
        });
        await card.getByText('使用顺序', { exact: true }).waitFor();
        await page.evaluate(() => window.test.c.undo());
        await page.evaluate(() => window.test.c.visit({ file: 'tasks.py' }));
        await page.evaluate(() => window.test.c.visit({ file: 'tasks.ts' }));
        await card.getByText('使用顺序', { exact: true }).waitFor();
        await toggle.press('Space');
        await card.getByText('使用顺序', { exact: true }).waitFor({ state: 'hidden' });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      assert.equal(await page.locator('.cm-reader-document').first().locator('.cm-reader-toggle').getAttribute('aria-expanded'), 'false');
    });
    await t.test('只有参数和返回值的文档也能收起，恢复时保留类型', async () => {
      await page.setViewportSize({ width: 480, height: 800 });
      await page.evaluate(() => window.test.c.visit({ file: 'tags.ts' }));
      const card = page.locator('.cm-reader-document'), toggle = card.locator('.cm-reader-toggle');
      await card.locator('.cm-reader-excerpt').waitFor();
      assert.equal(await card.locator('dl').isVisible(), false);
      await toggle.click();
      await card.locator('dl').waitFor();
      await card.locator('.cm-reader-excerpt').waitFor({ state: 'hidden' });
      assert.equal(await card.locator('.documentation-type').textContent(), 'string[]');
      assert.equal(await card.locator('.documentation-return > code').textContent(), 'number');
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString() === window.test.texts['tags.ts']), true);
    });
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.test.dispose()); await page.close();
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
