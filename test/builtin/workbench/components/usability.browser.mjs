import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { tsImport } from 'tsx/esm/api';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const candidate = process.env.SC_TEST_PACKAGE;
const { WorkbenchWindows } = candidate ? await import(pathToFileURL(join(candidate, 'lib/workbench/window.js')))
  : await tsImport('../../../../src/workbench/window.ts', import.meta.url);
import { fixture } from './fixture.mjs';
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text', '.woff2': 'dataurl' } });
const windows = new WorkbenchWindows(undefined, () => readFile(process.env.SC_TEST_WINDOW_SCRIPT || join(candidate || repo, 'dist/window.js')));
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
    let value;
    if (url.pathname === '/open') value = await windows.open('demo', false);
    else if (url.pathname === '/send') windows.send('demo', body.id, body.content);
    else if (url.pathname === '/close') windows.close('demo', body.id);
    else { res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>'); return; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value || {}));
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
const evidence = process.env.SC_TEST_ARTIFACTS;
async function toolInkOffsets(page) {
  const buttons = await page.locator('.sc-wb-side-rail button').evaluateAll(nodes => nodes.map(node => {
    const rect = value => ({ x: value.x, y: value.y, width: value.width, height: value.height });
    const label = node.querySelector('span'), box = node.getBoundingClientRect(), range = document.createRange();
    const letters = Array.from(label.textContent, (_letter, index) => { range.setStart(label.firstChild, index); range.setEnd(label.firstChild, index + 1); return rect(range.getBoundingClientRect()); });
    return { name: node.textContent.trim(), label: rect(label.getBoundingClientRect()), icon: rect(node.querySelector('svg').getBoundingClientRect()), letters, center: box.x + box.width / 2,
      foreground: getComputedStyle(node).color, background: node.getAttribute('aria-pressed') === 'true' ? getComputedStyle(node).backgroundColor : getComputedStyle(node.closest('nav')).backgroundColor };
  }));
  const screenshot = (await page.screenshot({ animations: 'disabled' })).toString('base64');
  return page.evaluate(async ({ buttons, screenshot }) => {
    const image = new Image(); image.src = `data:image/png;base64,${screenshot}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data, scale = image.width / innerWidth;
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const distance = (pixel, color) => color.reduce((total, value, index) => total + (pixel[index] - value) ** 2, 0);
    return buttons.map(button => {
      const foreground = rgb(button.foreground), background = rgb(button.background);
      const center = rect => {
        let left = Infinity, right = -Infinity;
        for (let y = Math.floor(rect.y * scale); y < Math.ceil((rect.y + rect.height) * scale); y++) {
          for (let x = Math.floor(rect.x * scale); x < Math.ceil((rect.x + rect.width) * scale); x++) {
            const start = (y * image.width + x) * 4, pixel = pixels.slice(start, start + 3);
            if (distance(pixel, foreground) < distance(pixel, background)) { left = Math.min(left, x); right = Math.max(right, x); }
          }
        }
        return (left + right + 1) / 2 / scale;
      };
      const text = center(button.label), icon = center(button.icon);
      return { name: button.name, offset: text - button.center, iconOffset: icon - button.center, relative: text - icon,
        letters: button.letters.map(letter => center(letter) - button.center) };
    });
  }, { buttons, screenshot });
}
try {
  await test('工作台交互与主题回归', { timeout: 120000 }, async t => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 940 } }), errors = [];
    page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
    const reload = async (preserveLayout = false) => {
      if (!preserveLayout && page.url() !== 'about:blank') await page.evaluate(() => localStorage.removeItem('dsh-super-code-workbench-layout'));
      await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.test?.controller.snapshot().indexed === 3);
    };
    const visit = file => page.evaluate(file => window.test.controller.visit({ file }), file);
    const rail = page.locator('.sc-wb-side-rail-right');
    const capture = async name => { if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, name + '.png'), animations:'disabled' }); } };
    await t.test('IDEA 逐字笔画、图标与按钮在普通及高像素密度下对齐', async () => {
      for (const deviceScaleFactor of [1, 2]) {
        const target = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor });
        try {
          await target.goto(`http://127.0.0.1:${server.address().port}`); await target.waitForFunction(() => window.test?.controller.snapshot().indexed === 3);
          for (const allOpen of [false, true]) {
            if (allOpen) for (const button of await target.locator('.sc-wb-side-rail button').all()) if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
            for (const dark of [false, true]) {
              await target.evaluate(dark => window.test.theme('idea', dark), dark);
              const offsets = await toolInkOffsets(target);
              assert.equal(offsets.length, 6);
              assert.ok(offsets.every(item => Number.isFinite(item.offset) && Math.abs(item.offset) <= .5 && Math.abs(item.iconOffset) <= .25 && Math.abs(item.relative) <= .5
                && item.letters.every(offset => Number.isFinite(offset) && Math.abs(offset) <= .5)), JSON.stringify({ deviceScaleFactor, allOpen, dark, offsets }));
            }
          }
        } finally { await target.close(); }
      }
    });
    await t.test('只显示已开启的区域，左右都无关闭区域的标题占位', async () => {
      await reload();
      await page.locator('.sc-wb-side-rail:not(.sc-wb-side-rail-right)').getByRole('button', {name:'文件结构',exact:true}).click();
      assert.equal(await page.locator('.sc-wb-explorer-outline').isVisible(), false);
      assert.deepEqual(await page.locator('.sc-wb-right-pane:visible').evaluateAll(nodes => nodes.map(n => n.dataset.pane)), ['conversation']);
      await rail.getByRole('button', { name: '快速对话', exact: true }).click();
      await rail.getByRole('button', { name: '对话', exact: true }).click();
      assert.deepEqual(await page.locator('.sc-wb-right-pane:visible').evaluateAll(nodes => nodes.map(n => n.dataset.pane)), ['quick']);
    });
    await t.test('紧凑布局可保存，右栏临时放大保留其他面板、比例及未保存文字', async () => {
      await reload(); await visit('a.ts');
      const tabs = page.locator('.sc-wb-editor-group:visible .sc-wb-tabs');
      const comfortable = (await tabs.boundingBox()).height;
      await page.locator('[data-toolbar-action=settings]').click();
      await page.getByRole('combobox', { name: '布局密度' }).selectOption('compact');
      await page.locator('.sc-wb-main[data-density=compact]').waitFor();
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
      assert.ok((await tabs.boundingBox()).height < comfortable);
      await rail.getByRole('button', { name: '快速对话', exact: true }).click();
      const conversation = page.locator('.sc-wb-right-pane[data-pane=conversation]');
      const quick = page.locator('.sc-wb-right-pane[data-pane=quick]');
      const splitter = page.getByRole('separator', { name: /对话/ }).last();
      await splitter.press('ArrowDown');
      const layout = await page.evaluate(() => window.test.controller.layout.snapshot());
      const height = (await quick.boundingBox()).height;
      await page.evaluate(() => window.test.controller.view().dispatch({ changes: { from: 0, insert: '// unsaved\n' } }));
      await quick.getByRole('button', { name: '放大「快速对话」' }).press('Enter');
      assert.equal(await conversation.isVisible(), false);
      assert.ok((await quick.boundingBox()).height > height);
      await capture('compact-expanded-tool');
      await quick.getByRole('button', { name: '恢复「快速对话」布局' }).press('Enter');
      assert.equal(await conversation.isVisible(), true);
      assert.equal((await quick.boundingBox()).height, height);
      assert.deepEqual(await page.evaluate(() => window.test.controller.layout.snapshot()), layout);
      assert.ok(await page.evaluate(() => window.test.controller.view().state.doc.toString().startsWith('// unsaved\n')));
      await page.evaluate(() => window.test.controller.save());
      await reload(true); await page.locator('.sc-wb-main[data-density=compact]').waitFor();
      await page.evaluate(() => { const controller = window.test.controller; return controller.settings({ ...controller.snapshot().preferences, density: 'comfortable' }); });
    });
    await t.test('文件夹开关的绘图与外框高度一致，工具栏图标不挤压', async () => {
      await reload();
      for (const theme of ['idea', 'vscode']) {
        await page.evaluate(theme => window.test.theme(theme, false), theme);
        const folder = page.locator('[data-tree-path=folder]');
        const bounds = () => folder.locator(`[data-icon-theme=${theme}]`).evaluate(n => { const r = n.getBBox(); return { y: r.y, height: r.height }; });
        const before = await bounds(); await folder.click(); assert.deepEqual(await bounds(), before); await folder.click();
      }
      const icons = await page.locator('.sc-wb-toolbar svg:visible,.sc-wb-side-rail svg:visible').evaluateAll(nodes => nodes.map(n => ({ w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height })));
      assert.ok(icons.every(r => r.w > 0 && r.w === r.h));
    });
    await t.test('IDEA 两侧图标下显示竖排文字，可即时关闭并恢复；VS Code 保持图标栏', async () => {
      await reload(); await visit('a.ts');
      assert.equal(await page.evaluate(() => window.test.controller.snapshot().preferences.showToolNames), true);
      for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
        await page.evaluate(({ palette, dark }) => window.test.theme(palette, dark), { palette, dark });
        for (const shown of [true, false]) {
          await page.evaluate(() => window.test.controller.panel({ kind: 'settings' }));
          await page.getByRole('checkbox', { name: '显示工具文字', exact: true }).setChecked(shown);
          await page.locator('.sc-wb-dialog-heading').getByRole('button', { name: '关闭', exact: true }).click();
          const buttons = await page.locator('.sc-wb-side-rail button').evaluateAll(nodes => nodes.map(node => {
            const icon = node.querySelector('svg').getBoundingClientRect(), label = node.querySelector('span'), text = label.getBoundingClientRect(), box = node.getBoundingClientRect();
            const range = document.createRange(); range.selectNodeContents(label);
            const letters = range.getBoundingClientRect(), center = rect => rect.x + rect.width / 2;
            const characters = Array.from(label.textContent, (_character, index) => { range.setStart(label.firstChild, index); range.setEnd(label.firstChild, index + 1); const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y }; });
            return { name: label.textContent, writing: getComputedStyle(label).writingMode, clip: getComputedStyle(label).clipPath,
              below: text.top >= icon.bottom, contained: text.bottom <= box.bottom && text.left >= box.left && text.right <= box.right,
              textOffset: center(letters) - center(icon), iconOffset: center(icon) - center(box),
              characters,
              icon: { width: icon.width, height: icon.height }, width: box.width, height: box.height };
          }));
          assert.deepEqual(buttons.map(button => button.name), ['文件', '文件结构', '对话', '快速对话', '修改文件', '学习']);
          for (const button of buttons) {
            assert.equal(button.icon.width, button.icon.height);
            if (palette === 'idea' && shown) {
              assert.equal(button.writing, 'horizontal-tb'); assert.equal(button.clip, 'none');
              assert.ok(button.below && button.contained, JSON.stringify(button));
              assert.ok(Math.abs(button.textOffset) < 1 && Math.abs(button.iconOffset) < 1, JSON.stringify(button));
              assert.ok(button.characters.every((item, index, items) => index === 0 || item.y > items[index - 1].y && Math.abs(item.x - items[0].x) < 1), JSON.stringify(button));
            } else { assert.notEqual(button.clip, 'none'); assert.equal(button.width, button.height); }
          }
          await capture(`tool-labels-${palette}-${dark ? 'dark' : 'light'}-${shown ? 'shown' : 'hidden'}`);
        }
      }
      await page.evaluate(() => window.test.controller.settings({ ...window.test.controller.snapshot().preferences, showToolNames: true }));
    });
    await t.test('工具文字在英文和低高度窗口可滚动且全部按钮仍可切换，偏好刷新保留', async () => {
      await reload(); await page.evaluate(async () => { await window.test.theme('idea', false); window.test.locale(); });
      await page.setViewportSize({ width: 720, height: 360 });
      const labels = page.locator('.sc-wb-side-rail button > span');
      assert.deepEqual(await labels.allTextContents(), ['Files', 'Outline', 'Conversation', 'Quick conversations', 'Changed files', 'Learn']);
      const centers = await labels.evaluateAll(nodes => nodes.map(node => {
        const icon = node.parentElement.querySelector('svg').getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(node);
        const text = range.getBoundingClientRect(); return text.x + text.width / 2 - icon.x - icon.width / 2;
      }));
      assert.ok(centers.every(offset => Math.abs(offset) < 1), JSON.stringify(centers));
      assert.ok(await rail.evaluate(node => node.scrollHeight > node.clientHeight));
      for (const button of await page.locator('.sc-wb-side-rail button').all()) {
        const before = await button.getAttribute('aria-pressed'); await button.click();
        assert.equal(await button.getAttribute('aria-pressed'), String(before !== 'true'));
      }
      await rail.getByRole('button', { name: 'Learn', exact: true }).scrollIntoViewIfNeeded();
      assert.ok(await rail.evaluate(node => node.scrollTop > 0));
      assert.equal(await page.locator('.sc-wb-body').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      await capture('tool-labels-english-short');
      await page.evaluate(() => window.test.controller.settings({ ...window.test.controller.snapshot().preferences, showToolNames: false }));
      await reload();
      assert.equal(await page.locator('.sc-wb-main').getAttribute('data-tool-names'), 'false');
      await page.evaluate(() => window.test.controller.settings({ ...window.test.controller.snapshot().preferences, showToolNames: true }));
      await page.setViewportSize({ width: 1440, height: 940 });
    });
    await t.test('没有文件标签也能生成项目阅读路径', async () => {
      await reload(); await rail.getByRole('button', { name: '学习', exact: true }).click();
      await page.getByRole('textbox', { name: '阅读目标' }).fill('我是小白，想学项目的两个模块');
      await page.getByRole('button', { name: '生成阅读路径', exact: true }).click();
      await page.getByText('从项目入口开始', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.lastReading.file), undefined);
      assert.equal(await page.locator('.sc-wb-tab').count(), 0);
    });
    await t.test('窄栏表格和长链接换行，代码单独横滚不撑宽消息', async () => {
      await reload();
      for (const width of [240, 360, 480]) {
        await page.locator('.sc-wb-main').evaluate((n, width) => n.style.setProperty('--wb-reading-width', width + 'px'), width);
        const sizes = await page.locator('.dsh-super-code-detail-log').evaluate(n => ({ width: n.clientWidth, scroll: n.scrollWidth, table: n.querySelector('table').getBoundingClientRect().width }));
        assert.ok(sizes.scroll <= sizes.width + 1, JSON.stringify(sizes)); assert.ok(sizes.table <= sizes.width, JSON.stringify(sizes));
      }
      await capture('narrow-conversation');
    });
    await t.test('单行拖选、双击扩选有主题选区高亮，四种配色均可见', async () => {
      await reload(); await visit('a.ts');
      for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
        await page.evaluate(({palette,dark})=>window.test.theme(palette,dark), {palette,dark});
        const point = await page.evaluate(() => { const v=window.test.controller.view(),at=v.state.doc.toString().indexOf('value:');const c=v.coordsAtPos(at);return {x:c.left+2,y:(c.top+c.bottom)/2}; });
        await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+28,point.y,{steps:8});await page.mouse.up();
        assert.ok(await page.evaluate(()=>window.test.controller.view().state.selection.main.to-window.test.controller.view().state.selection.main.from)>1);
        await page.locator('.cm-selectionBackground').first().waitFor();
        assert.equal(await page.locator('.cm-activeLine').first().evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
        let visible = await page.locator('.cm-selectionBackground').first().evaluate(n=>({bg:getComputedStyle(n).backgroundColor,expected:getComputedStyle(n.closest('.sc-workbench')).getPropertyValue('--wb-selection').trim()}));
        const match = visible.expected.match(/^#(..)(..)(..)$/); assert.equal(visible.bg, `rgb(${match.slice(1).map(v=>parseInt(v,16)).join(', ')})`);
        await page.mouse.dblclick(point.x+10,point.y);assert.equal(await page.evaluate(()=>{const v=window.test.controller.view();return v.state.sliceDoc(v.state.selection.main.from,v.state.selection.main.to)}),'value');
        await capture(`selection-${palette}-${dark?'dark':'light'}`);
      }
    });
    await t.test('同名候选的标题与函数卡片对齐', async () => {
      await reload();
      await page.evaluate(async () => {
        window.test.texts['caller.ts'] = 'add(2);';
        await window.test.controller.refresh();
        await window.test.controller.visit({ file: 'caller.ts' });
      });
      const p=await page.evaluate(()=>{const v=window.test.controller.view(),c=v.coordsAtPos(v.state.doc.toString().lastIndexOf('add')+1);return {x:c.left,y:(c.top+c.bottom)/2}});
      await page.mouse.move(p.x,p.y);const tip=page.locator('.signature-tooltip');await tip.waitFor();
      assert.equal(await tip.locator('.documentation-card').count(), 2);
      const rect=await tip.evaluate(n=>{const a=n.querySelector('.documentation-candidates'),b=n.querySelector('.documentation-card'),range=document.createRange();range.selectNodeContents(a);return{header:range.getBoundingClientRect().x,card:b.getBoundingClientRect().x+parseFloat(getComputedStyle(b).paddingLeft)}});
      assert.equal(rect.header,rect.card);await capture('candidates');
    });
    await t.test('不支持关闭的路由显示配置提示，不把关闭误标为可用默认项', async () => {
      await reload(); await page.evaluate(()=>window.test.controller.panel({kind:'settings'}));
      const choice=page.getByRole('combobox',{name:'快速对话思考'});await choice.locator('option').filter({hasText:'High'}).waitFor({state:'attached'});
      assert.match(await choice.locator('option:checked').textContent(),/未配置|不可用/);
      assert.ok(await page.getByText('当前模型的 DSH 配置未提供关闭思考，请在模型设置中检查或改选其他模型。',{exact:true}).count()>0);
      await page.getByRole('combobox',{name:'快速对话模型'}).selectOption(JSON.stringify(['demo','controllable']));
      assert.equal(await choice.inputValue(),'off');assert.equal(await choice.locator('option:checked').textContent(),'关闭（默认）');
      assert.deepEqual(await page.evaluate(()=>window.test.controller.snapshot().preferences.quickModel),{provider:'demo',model:'controllable'});
    });
    await t.test('快速对话在气泡和列表展示等待、完成状态', async () => {
      await reload();await visit('a.ts');await page.evaluate(()=>{const c=window.test.controller;c.view().dispatch({selection:{anchor:0,head:6}});c.assistant.select();c.assistant.draft('解释选区');void c.assistant.send()});
      await page.locator('.sc-wb-assistant [role=status]').filter({hasText:'正在回答'}).waitFor();
      await rail.getByRole('button',{name:'快速对话',exact:true}).click();
      await page.locator('.sc-wb-quick-row').getByText('正在回答',{exact:true}).waitFor();
      await page.evaluate(()=>window.test.answer());await page.locator('.sc-wb-quick-row').getByText('已完成',{exact:true}).waitFor();await capture('quick-complete');
    });
    await t.test('主编辑器与多个独立窗口同时可用，关闭一个不影响另一个', async () => {
      await reload();await visit('a.ts');
      const open=async file=>{const event=page.waitForEvent('popup');await page.evaluate(file=>{void window.test.controller.openWindow({kind:'file',file})},file);const p=await event;await p.getByRole('button',{name:'返回 DSH',exact:true}).waitFor();await p.locator('.cm-content').waitFor();return p};
      const first=await open('a.ts');first.on('pageerror',error=>errors.push(error.message));
      assert.equal(await page.locator('.sc-wb-window-content').getAttribute('aria-hidden'),null);
      assert.equal(await page.locator('.sc-wb-editor').isVisible(),true);await visit('b.ts');
      const second=await open('b.ts');second.on('pageerror',error=>errors.push(error.message));
      assert.equal(await first.locator('.sc-wb-path-name').textContent(),'a.ts');
      assert.equal(await second.locator('.sc-wb-path-name').textContent(),'b.ts');
      await first.locator('.cm-content').click();await first.keyboard.press('Control+End');await first.keyboard.type('// peer edit');
      await visit('a.ts');await page.waitForFunction(()=>window.test.controller.view().state.doc.toString().includes('// peer edit'));
      const third=await open('a.ts');third.on('pageerror',error=>errors.push(error.message));
      await third.locator('.cm-content').click();await third.keyboard.press('ControlOrMeta+End');
      await Promise.all([
        page.evaluate(()=>window.test.controller.view().dispatch({changes:{from:0,insert:'// main edit\n'}})),
        third.keyboard.type('// another window'),
      ]);
      await page.waitForFunction(()=>window.test.controller.view().state.doc.toString().includes('// another window'));
      for(const peer of[first,third]){
        await peer.getByText('// main edit',{exact:true}).waitFor();
        assert.equal(await peer.locator('.cm-content .cm-line').evaluateAll(nodes=>nodes.map(n=>n.textContent).join('\n')),await page.evaluate(()=>window.test.controller.view().state.doc.toString()));
      }
      await Promise.all([first.waitForEvent('close'), first.getByRole('button',{name:'返回 DSH',exact:true}).click()]);
      assert.equal(second.isClosed(),false);assert.equal(third.isClosed(),false);
      for(const peer of[second,third]) await Promise.all([peer.waitForEvent('close'), peer.getByRole('button',{name:'返回 DSH',exact:true}).click()]);
      assert.equal(await page.evaluate(()=>window.test.controller.index.files.size),3);
      await page.evaluate(()=>window.test.controller.undo());
      assert.equal(await page.evaluate(()=>window.test.controller.view().state.doc.toString().includes('// another window')),false);
      await page.evaluate(()=>window.test.controller.undo('redo'));
      assert.equal(await page.evaluate(()=>window.test.controller.view().state.doc.toString().includes('// another window')),true);
    });
    await t.test('正式独立窗口的作用域跟随本地光标，多个视图独立导航并同步修改', async () => {
      await reload();await visit('a.ts');
      const doc='class Store {\n  load() {\n    const value = 1;\n    return value;\n  }\n}\nfunction other() {\n  return 2;\n}';
      await page.evaluate(doc=>{const v=window.test.controller.view();v.dispatch({changes:{from:0,to:v.state.doc.length,insert:doc},selection:{anchor:doc.indexOf('return value')}})},doc);
      const opened=page.waitForEvent('popup');await page.evaluate(()=>{void window.test.controller.openWindow({kind:'file',file:'a.ts'})});
      const peer=await opened;peer.on('pageerror',error=>errors.push(error.message));
      await peer.locator('.cm-content').waitFor();await peer.locator('.cm-line').filter({hasText:'return value;'}).click();
      await peer.getByRole('button',{name:'跳转到 load',exact:true}).waitFor();
      assert.deepEqual(await peer.locator('.sc-wb-scope-path button>span').allTextContents(),['Store','load']);
      await peer.getByRole('button',{name:'跳转到 load',exact:true}).click();
      await peer.waitForFunction(() => document.querySelector('.cm-content')?.matches(':focus') && document.querySelector('.cm-activeLine')?.textContent.includes('load()'));
      await peer.locator('.cm-line').filter({hasText:'return 2;'}).click();
      await peer.getByRole('button',{name:'跳转到 other',exact:true}).waitFor();
      assert.deepEqual(await page.locator('.sc-wb-main .sc-wb-scope-path button>span').allTextContents(),['Store','load']);
      const mainCursor=await page.evaluate(()=>window.test.controller.view().state.selection.main.head);
      await peer.keyboard.press('Home');await peer.keyboard.type('  ');
      await page.waitForFunction(()=>window.test.controller.view().state.doc.toString().includes('    return 2'));
      assert.deepEqual(await peer.locator('.sc-wb-scope-path button>span').allTextContents(),['other']);
      assert.equal(await page.evaluate(()=>window.test.controller.view().state.selection.main.head),mainCursor);
      await page.evaluate(()=>window.test.controller.settings({...window.test.controller.snapshot().preferences,palette:'vscode'}));
      await peer.waitForFunction(()=>document.querySelector('.sc-workbench.sc-wb-main')?.dataset.palette==='vscode');
      await peer.locator('.sc-wb-path .sc-wb-scope-path').getByRole('button',{name:'跳转到 other',exact:true}).click();
      await peer.waitForFunction(() => document.querySelector('.cm-activeLine')?.textContent.includes('function other()'));
      assert.deepEqual(await peer.locator('.sc-wb-scope-path button>span').allTextContents(),['other']);
      assert.equal(await page.evaluate(()=>window.test.controller.view().state.selection.main.head),mainCursor);
      if(evidence)await peer.screenshot({path:join(evidence,'scope-independent-window.png'),animations:'disabled'});
      await Promise.all([peer.waitForEvent('close'), peer.getByRole('button',{name:'返回 DSH',exact:true}).click()]);
    });
    await t.test('正式独立工作台的专注阅读与粘性行导航只作用于该窗口', async () => {
      await reload(); await visit('a.ts');
      const doc = ['class Store {', '  load() {', '    let total = 0;',
        ...Array.from({ length: 100 }, (_, index) => `    total += ${index};`), '    return total;', '  }', '}'].join('\n');
      await page.evaluate(doc => {
        const view = window.test.controller.view();
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc }, selection: { anchor: 0 } });
      }, doc);
      const opening = page.waitForEvent('popup');
      await page.getByRole('button', { name: '独立窗口', exact: true }).click();
      const peer = await opening;
      peer.on('pageerror', error => errors.push(error.message));
      try {
        await peer.locator('.cm-content').waitFor();
        await peer.setViewportSize({ width: 540, height: 761 });
        const focus = peer.getByRole('button', { name: '专注阅读', exact: true });
        await focus.click();
        assert.equal(await focus.getAttribute('aria-pressed'), 'true');
        assert.equal(await peer.locator('.sc-wb-side-rail:visible').count(), 0);
        assert.equal(await page.getByRole('button', { name: '专注阅读', exact: true }).getAttribute('aria-pressed'), 'false');
        assert.equal(await page.locator('.sc-wb-side-rail:visible').count(), 2);
        const scroller = peer.locator('.cm-scroller');
        assert.ok((await scroller.boundingBox()).width >= 535);
        await scroller.evaluate(node => { node.scrollTop = 900; });
        const sticky = peer.locator('.cm-sticky:not([hidden])').getByRole('button', { name: /load\(/ });
        await sticky.waitFor();
        const lines = await scroller.evaluate(node => {
          const box = node.getBoundingClientRect(), top = node.querySelector('.cm-sticky').getBoundingClientRect().bottom;
          return [...node.querySelectorAll('.cm-line')].filter(line => {
            const rect = line.getBoundingClientRect();
            return rect.top >= top && rect.bottom <= box.bottom;
          }).map(line => line.textContent);
        });
        assert.ok(lines.length >= 12);
        await sticky.press('Enter');
        await peer.locator('.cm-activeLine').filter({ hasText: 'load() {' }).waitFor();
        await peer.keyboard.press('Alt+ArrowLeft');
        await peer.locator('.cm-activeLine').filter({ hasText: /total \+=/ }).waitFor({ timeout: 5000 });
        assert.ok(lines.includes(await peer.locator('.cm-activeLine').textContent()));
        await peer.keyboard.press('Alt+ArrowRight');
        await peer.locator('.cm-activeLine').filter({ hasText: 'load() {' }).waitFor();
        assert.equal(await page.evaluate(() => window.test.controller.view().state.selection.main.head), 0);
        await focus.click();
        assert.equal(await peer.locator('.sc-wb-side-rail:visible').count(), 2);
        await scroller.evaluate(node => { node.scrollTop = 900; });
        await sticky.waitFor();
        const heading = await sticky.boundingBox();
        const scrollBefore = await scroller.evaluate(node => node.scrollTop);
        await peer.mouse.move(heading.x + heading.width / 2, heading.y + heading.height / 2);
        await peer.mouse.wheel(0, 120);
        await peer.waitForFunction(before => document.querySelector('.cm-scroller').scrollTop > before + 70, scrollBefore);
        await peer.getByRole('button', { name: '折叠代码 2', exact: true }).press('Enter');
        const folded = peer.locator('.cm-foldPlaceholder');
        await folded.waitFor();
        assert.equal(await page.locator('.cm-foldPlaceholder').count(), 0);
        await folded.click();
        await folded.waitFor({ state: 'detached' });

        await page.evaluate(() => window.test.controller.settings({ ...window.test.controller.snapshot().preferences, readerMode: true, stickyScroll: false }));
        await peer.locator('.cm-lineWrapping').waitFor();
        await scroller.evaluate(node => { node.scrollTop = 1000; });
        const reading = peer.locator('.sc-wb-scope-path[data-reading=true]');
        const method = reading.getByRole('button', { name: '跳转到 load', exact: true });
        await method.waitFor();
        assert.equal(await page.locator('.sc-wb-scope-path[data-reading=true]').count(), 0);
        assert.equal(await peer.locator('.cm-sticky:visible').count(), 0);
        await method.click();
        await reading.waitFor({ state: 'detached' });
        await peer.keyboard.press('Alt+ArrowLeft');
        await peer.locator('.cm-activeLine').filter({ hasText: /total \+=/ }).waitFor({ timeout: 5000 });
        assert.equal(await page.evaluate(() => window.test.controller.view().state.selection.main.head), 0);
      } finally {
        await page.evaluate(() => window.test.controller.settings({ ...window.test.controller.snapshot().preferences, readerMode: false, stickyScroll: true }));
        await Promise.all([peer.waitForEvent('close'), peer.locator('[data-toolbar-action=window]').click()]);
      }
    });
    await t.test('正式独立窗口复用符号搜索与函数筛选，查询和光标各自独立', async () => {
      await reload(); await visit('a.ts');
      await page.evaluate(() => window.test.controller.layout.change({ explorerOpen: true, filesOpen: false, outlineOpen: true }));
      const main = page.locator('.sc-wb-main #sc-wb-outline');
      await main.getByRole('combobox', { name: '搜索符号', exact: true }).fill('add');
      const opened = page.waitForEvent('popup');
      await page.getByRole('button', { name: '独立窗口', exact: true }).click();
      const peer = await opened; peer.setDefaultTimeout(5000); peer.on('pageerror', error => errors.push(error.message));
      try {
        const outline = peer.locator('#sc-wb-outline'), search = outline.getByRole('combobox', { name: '搜索符号', exact: true });
        await search.waitFor(); assert.equal(await search.inputValue(), '');
        await search.fill('missing'); assert.equal(await outline.getByRole('option').count(), 0);
        assert.equal(await main.getByRole('option').count(), 1);
        const filter = outline.getByRole('button', { name: '只看函数', exact: true });
        await filter.hover();
        const tooltip = peer.getByRole('tooltip', { name: '只看函数', exact: true });
        await tooltip.waitFor();
        assert.ok((await tooltip.boundingBox()).y + (await tooltip.boundingBox()).height <= (await filter.boundingBox()).y + 1);
        await filter.click();
        await search.fill('add'); await search.press('Enter');
        await peer.getByRole('button', { name: '跳转到 add', exact: true }).waitFor();
        assert.equal(await outline.locator('[aria-current=location] span').textContent(), 'add');
        assert.equal(await main.locator('[aria-current=location]').count(), 0);
        assert.equal(await page.evaluate(() => window.test.controller.view().state.selection.main.head), 0);
        await page.evaluate(() => { const v = window.test.controller.view(); v.dispatch({ changes: { from: v.state.doc.length, insert: '\nfunction addedLater() { return 0; }' } }); });
        await outline.getByRole('option').filter({ hasText: 'addedLater' }).waitFor();
        await search.fill('addedLater'); await search.press('Enter');
        await peer.getByRole('button', { name: '跳转到 addedLater', exact: true }).waitFor();
        assert.equal(await outline.locator('[aria-current=location] span').textContent(), 'addedLater');
        assert.equal(await main.locator('[aria-current=location]').count(), 0);
        assert.equal(await main.getByRole('combobox').inputValue(), 'add');
        assert.equal(await page.evaluate(() => window.test.controller.view().state.selection.main.head), 0);
        if (evidence) await peer.screenshot({ path: join(evidence, 'outline-independent-window.png'), animations: 'disabled' });

        await page.evaluate(() => {
          const view = window.test.controller.view();
          const insert = '\nclass FirstCache {\n  load() { return 1; }\n}\nclass SecondCache {\n  load() { return 2; }\n}\n';
          view.dispatch({ changes: { from: view.state.doc.length, insert } });
        });
        await filter.click();
        await search.fill('');
        const first = outline.getByRole('option', { name: /^FirstCache\.load,/ });
        const second = outline.getByRole('option', { name: /^SecondCache\.load,/ });
        await second.waitFor();
        assert.equal(await first.getAttribute('data-depth'), '1');
        assert.equal(await second.getAttribute('data-depth'), '1');
        await search.fill('load');
        assert.deepEqual(await outline.locator('.sc-wb-outline-context').allTextContents(), ['FirstCache', 'SecondCache']);
        if (evidence) await peer.screenshot({ path: join(evidence, 'outline-owners-independent-window.png'), animations: 'disabled' });
        await search.fill('secondcache.load'); await search.press('Enter');
        await peer.getByRole('button', { name: '跳转到 SecondCache', exact: true }).waitFor();
        assert.equal(await second.getAttribute('aria-current'), 'location');
        assert.equal(await main.getByRole('combobox').inputValue(), 'add');
        assert.equal(await page.evaluate(() => window.test.controller.view().state.selection.main.head), 0);
      } catch (error) {
        t.diagnostic(JSON.stringify(await peer.evaluate(() => ({ text: document.querySelector('#sc-wb-outline')?.textContent, input: document.querySelector('#sc-wb-outline input')?.value, scope: document.querySelector('.sc-wb-scope-path')?.textContent, alert: document.querySelector('[role=alert]')?.textContent }))));
        t.diagnostic(JSON.stringify(await page.evaluate(() => ({ symbols: window.test.controller.snapshot().symbols, indexed: window.test.controller.index.declarations('a.ts'), text: window.test.controller.view().state.doc.toString(), error: window.test.controller.snapshot().error }))));
        throw error;
      } finally {
        await Promise.all([peer.waitForEvent('close'), peer.locator('[data-toolbar-action=window]').click()]);
      }
    });
    await t.test('正式独立窗口的参数信息使用本地光标，关闭后主页面保持可用', async () => {
      await reload(); await visit('a.ts');
      const text='function combine(first: number, second: string) { return first; }\ncombine(1, "text");';
      await page.evaluate(text => { const v=window.test.controller.view();v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text},selection:{anchor:text.lastIndexOf('combine(')+8}});v.focus(); },text);
      await page.keyboard.press('Control+p'); await page.locator('.parameter-tooltip .documentation-active-parameter').first().waitFor();
      const mainCursor=await page.evaluate(()=>window.test.controller.view().state.selection.main.head);
      const opened=page.waitForEvent('popup'); await page.evaluate(()=>{void window.test.controller.openWindow({kind:'file',file:'a.ts'})});
      const peer=await opened; peer.setDefaultTimeout(5000);peer.on('pageerror',error=>errors.push(error.message));
      try {
        const line=peer.locator('.cm-line').filter({hasText:/^combine\(1, "text"\);$/});await line.click();
        await peer.keyboard.press('End');await peer.keyboard.press('ArrowLeft');await peer.keyboard.press('ArrowLeft');await peer.keyboard.press('ArrowLeft');
        await peer.keyboard.press('Control+p'); const active=peer.locator('.parameter-tooltip .documentation-active-parameter');await active.first().waitFor();
        assert.equal(await active.first().textContent(),'second: string');
        assert.equal(await page.evaluate(()=>window.test.controller.view().state.selection.main.head),mainCursor);
        assert.equal(await page.evaluate(()=>window.test.controller.view().state.doc.toString()),text);
        if(evidence)await peer.screenshot({path:join(evidence,'parameters-independent-window.png'),animations:'disabled'});
        await peer.keyboard.press('Escape');await peer.locator('.parameter-tooltip').waitFor({state:'detached'});
      } finally { await Promise.all([peer.waitForEvent('close'),peer.getByRole('button',{name:'返回 DSH',exact:true}).click()]); }
      await page.evaluate(()=>window.test.controller.view().focus());await page.keyboard.press('Control+p');
      await page.locator('.parameter-tooltip .documentation-active-parameter').first().waitFor();
      await page.keyboard.press('Escape');
    });
    await t.test('阅读器的文档和两套结构样式在真实独立窗口生效，源码与偏好同步', async () => {
      await reload();await visit('a.ts');
      const text='/**\n * 读取 **任务列表**。\n * @param {number} value 任务编号。\n */\nexport function reader(value: number) { return value; }\nexport function sample() { return read([{ value: 0 }]); }';
      await page.evaluate(text=>{const v=window.test.controller.view();v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text},selection:{anchor:0}})},text);
      await page.evaluate(()=>window.test.controller.settings({...window.test.controller.snapshot().preferences,palette:'idea',readerMode:true}));
      await page.locator('.cm-reader-document').waitFor();
      const opened=page.waitForEvent('popup');
      await page.evaluate(()=>{void window.test.controller.openWindow({kind:'file',file:'a.ts'})});
      const peer=await opened;peer.setDefaultTimeout(5000);peer.on('pageerror',error=>errors.push(error.message));
      try {
        await peer.locator('.cm-reader-document').waitFor();
        assert.equal(await peer.locator('.cm-reader-document strong').textContent(),'任务列表');
        const mainCard = page.locator('.sc-wb-main .cm-reader-document:visible'), peerCard = peer.locator('.cm-reader-document');
        const disclosure = peerCard.getByRole('button', { name: '收起文档' });
        await disclosure.press('Enter');
        await peerCard.locator('dl').waitFor({ state: 'hidden' });
        assert.equal(await mainCard.locator('dl').isVisible(), true);
        assert.equal(await peer.locator('.cm-reader-line-number').textContent(), '1');
        await peer.locator('.cm-reader-declaration').filter({hasText:'function sample()'}).waitFor();
        await page.evaluate(()=>window.test.theme('vscode',false));
        await peer.locator('.cm-line').filter({hasText:'function sample()'}).locator('.cm-reader-bracket').first().waitFor();
        assert.equal(await peer.locator('.cm-reader-declaration').count(),0);
        await peerCard.getByRole('button', { name: '展开文档' }).click();
        await peerCard.locator('dl').waitFor();
        await peer.locator('.cm-reader-document').getByRole('button',{name:'查看源码',exact:true}).click();
        await peer.locator('.cm-reader-document').waitFor({state:'detached'});
        assert.equal(await page.locator('.cm-reader-document').count(),1,'原页面保留自己的光标和阅读状态');
        assert.equal(await page.evaluate(()=>window.test.controller.view().state.doc.toString()),text);
        await peer.keyboard.press('ArrowDown');await peer.keyboard.press('End');await peer.keyboard.type(' 已更新');
        await page.waitForFunction(()=>window.test.controller.view().state.doc.toString().includes('已更新'));
        await page.locator('.cm-reader-document').filter({hasText:'已更新'}).waitFor();
        await page.evaluate(()=>window.test.controller.settings({...window.test.controller.snapshot().preferences,readerMode:false}));
        for(const target of [page,peer]) await target.locator('.cm-reader-document').waitFor({state:'detached'});
        assert.equal(await peer.locator('.cm-line').filter({hasText:'/**'}).count(),1);
      } catch(error) {
        t.diagnostic(JSON.stringify({main:await page.evaluate(()=>({text:window.test.controller.view().state.doc.toString(),selection:window.test.controller.view().state.selection.toJSON()})),peer:await peer.evaluate(()=>({focus:document.activeElement?.outerHTML,lines:[...document.querySelectorAll('.cm-line')].map(n=>n.textContent),alert:document.querySelector('[role=alert]')?.textContent}))}));
        if(evidence){await mkdir(evidence,{recursive:true});await peer.screenshot({path:join(evidence,'reader-window-failure.png')});}throw error;
      } finally {const closed=peer.waitForEvent('close');await peer.getByRole('button',{name:'返回 DSH',exact:true}).click();await closed;}
    });
    await t.test('完整独立窗口继承并实时同步六项侧栏，不使用临时来源的默认布局', async () => {
      await reload(); await visit('a.ts');
      const peers=[];
      const left = target => target.locator('.sc-wb-side-rail:not(.sc-wb-side-rail-right)');
      const right = target => target.locator('.sc-wb-side-rail-right');
      const select = async (target, labels) => {
        for(const bar of [left(target),right(target)])for(const button of await bar.getByRole('button').all()){
          const name=(await button.textContent()).trim(),pressed=String(labels.includes(name));
          if(await button.getAttribute('aria-pressed')!==pressed)await button.click();
          await target.waitForFunction(({name,pressed})=>[...document.querySelectorAll('.sc-wb-side-rail button')].some(n=>n.textContent.trim()===name&&n.getAttribute('aria-pressed')===pressed),{name,pressed});
        }
      };
      const verify = async (target,labels) => {
        await target.waitForFunction(labels => {
          const buttons=[...document.querySelectorAll('.sc-wb-side-rail button')];
          return buttons.length===6&&buttons.every(n=>n.getAttribute('aria-pressed')===String(labels.includes(n.textContent.trim())));
        },labels);
        assert.equal(await target.locator('.sc-wb-explorer-files').isVisible(),labels.includes('文件'));
        assert.equal(await target.locator('.sc-wb-explorer-outline').isVisible(),labels.includes('文件结构'));
        assert.equal(await target.locator('.sc-wb-right').isVisible(),labels.some(v=>['对话','快速对话','修改文件','学习'].includes(v)));
        for(const [key,label]of Object.entries({conversation:'对话',quick:'快速对话',changes:'修改文件',learning:'学习'})){
          assert.equal(await target.locator(`[data-pane=${key}]`).isVisible(),labels.includes(label));
        }
      };
      const open = async () => {
        const event=page.waitForEvent('popup');await page.getByRole('button',{name:'独立窗口',exact:true}).click();const peer=await event;
        peers.push(peer);peer.setDefaultTimeout(5000);peer.on('pageerror',error=>errors.push(error.message));
        await peer.locator('[data-toolbar-action=window]').waitFor();return peer;
      };
      try {
        await select(page,['文件','快速对话']);
        const first=await open();await verify(first,['文件','快速对话']);
        const second=await open();await verify(second,['文件','快速对话']);
        for (const target of [page, first, second]) assert.equal(await target.locator('.sc-wb-main').getAttribute('data-tool-names'), 'true');
        await page.evaluate(() => window.test.controller.settings({ ...window.test.controller.snapshot().preferences, showToolNames: false }));
        for (const target of [page, first, second]) await target.waitForFunction(() => document.querySelector('.sc-wb-main').dataset.toolNames === 'false');
        await first.locator('[data-toolbar-action=settings]').click();
        const names = first.getByRole('checkbox', { name: /显示工具文字|Show tool labels/ });
        await names.check();
        for (const target of [page, first, second]) await target.waitForFunction(() => document.querySelector('.sc-wb-main').dataset.toolNames === 'true');
        const reader = first.getByRole('checkbox', { name: /阅读器模式|Reader mode/, exact: true });
        await reader.check();
        for (const target of [page, first, second]) await target.waitForFunction(() => getComputedStyle(document.querySelector('.cm-scroller')).fontSize === '15px');
        await reader.uncheck();
        for (const target of [page, first, second]) await target.waitForFunction(() => getComputedStyle(document.querySelector('.cm-scroller')).fontSize === '14px');
        await page.evaluate(() => window.test.controller.settings({ ...window.test.controller.snapshot().preferences, fontFamily: 'menlo', chineseFontFamily: 'local:Songti SC', fontSize: 17, lineHeight: 1.7 }));
        for (const target of [page, first, second]) await target.waitForFunction(() => {
          const style = getComputedStyle(document.querySelector('.cm-scroller'));
          return style.fontSize === '17px' && Math.abs(parseFloat(style.lineHeight) - 28.9) < .01 && /^Menlo,/.test(style.fontFamily) && style.fontFamily.includes('Songti SC');
        });
        await first.getByRole('combobox', { name: /中文回退字体|Chinese fallback font/, exact: true }).click();
        await first.getByRole('option', { name: /系统自动选择|System default/, exact: true }).click();
        for (const target of [page, first, second]) await target.waitForFunction(() => !getComputedStyle(document.querySelector('.cm-scroller')).fontFamily.includes('Songti SC'));
        await page.evaluate(() => window.test.controller.settings({ ...window.test.controller.snapshot().preferences, fontSize: 14, lineHeight: 1.5 }));
        await first.locator('.sc-wb-dialog-heading button').last().click();
        assert.equal(await first.evaluate(()=>localStorage.getItem('dsh-super-code-workbench-layout')),null);
        if(evidence)for(const [name,target]of [['host',page],['first',first],['second',second]])await target.screenshot({path:join(evidence,`shared-layout-${name}.png`),animations:'disabled'});
        for(const labels of [['文件结构','修改文件'],[],['文件','文件结构','学习'],['文件','快速对话','修改文件']]){
          await select(page,labels);for(const target of [page,first,second])await verify(target,labels);
        }
        await select(first,['文件结构','快速对话','学习']);for(const target of [page,first,second])await verify(target,['文件结构','快速对话','学习']);
        const splitter=first.getByRole('separator',{name:'调整右侧栏宽度',exact:true});
        const before=await first.locator('.sc-wb-main').evaluate(n=>n.style.getPropertyValue('--wb-reading-width'));
        await splitter.focus();await first.keyboard.press('ArrowLeft');
        await first.waitForFunction(before=>document.querySelector('.sc-wb-main').style.getPropertyValue('--wb-reading-width')!==before,before);
        await first.waitForFunction(()=>document.querySelector('.sc-wb-main').style.getPropertyValue('--wb-reading-width')!=='320px');
        const width=await first.locator('.sc-wb-main').evaluate(n=>n.style.getPropertyValue('--wb-reading-width'));
        for(const target of [page,second])await target.waitForFunction(width=>document.querySelector('.sc-wb-main').style.getPropertyValue('--wb-reading-width')===width,width);
        const row=first.getByRole('separator',{name:'调整区域高度 · 快速对话',exact:true}),ratio=await row.getAttribute('aria-valuenow');
        await row.focus();await first.keyboard.press('ArrowDown');
        await first.waitForFunction(ratio=>document.querySelector('.sc-wb-right [role=separator]').getAttribute('aria-valuenow')!==ratio,ratio);
        const flex=await first.locator('[data-pane=quick]').evaluate(n=>n.style.flex);
        for(const target of [page,second])await target.waitForFunction(flex=>document.querySelector('[data-pane=quick]').style.flex===flex,flex);
        assert.equal(await first.evaluate(()=>localStorage.getItem('dsh-super-code-workbench-layout')),null);
        await Promise.all([first.waitForEvent('close'), first.locator('[data-toolbar-action=window]').click()]);
        await Promise.all([second.waitForEvent('close'), second.locator('[data-toolbar-action=window]').click()]);
        await page.waitForFunction(()=>!window.test.controller.snapshot().window);
        await reload(true);await verify(page,['文件结构','快速对话','学习']);
        const reopened=await open();await verify(reopened,['文件结构','快速对话','学习']);
        await Promise.all([reopened.waitForEvent('close'), reopened.locator('[data-toolbar-action=window]').click()]);
        await capture('shared-window-layout');
      }finally{for(const peer of peers)if(!peer.isClosed())await peer.close();}
    });
    await t.test('切换文件和缩窄工作台后，当前标签保持可见', async () => {
      await reload();
      for (const palette of ['idea', 'vscode']) {
        await page.setViewportSize({ width: 1440, height: 940 });
        await page.evaluate(palette => window.test.theme(palette, false), palette);
        for (const file of ['a.ts', 'b.ts', 'folder/test.py']) {
          await visit(file); await page.evaluate(file => window.test.controller.keepTab(file), file);
        }
        await page.setViewportSize({ width: 720, height: 720 });
        const visible = () => page.waitForFunction(() => {
          const nav = document.querySelector('.sc-wb-tabs'), tab = nav.querySelector('[data-active=true]');
          const bounds = nav.getBoundingClientRect(), active = tab.getBoundingClientRect();
          return active.left >= bounds.left - 1 && active.right <= bounds.right + 1;
        });
        await visible();
        for (const file of ['a.ts', 'folder/test.py', 'b.ts']) { await visit(file); await visible(); }
      }
      await page.setViewportSize({ width: 1440, height: 940 });
    });
    await t.test('选区提问有足够空间时显示在代码下方，不遮住所选代码', async () => {
      await reload(); await visit('a.ts');
      for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
        await page.evaluate(async ({ palette, dark }) => {
          await window.test.theme(palette, dark);
          const c = window.test.controller, v = c.view(), line = v.state.doc.line(2);
          v.dispatch({ selection: { anchor: line.from, head: line.to } }); c.assistant.select();
        }, { palette, dark });
        await page.locator('.sc-wb-assistant textarea').waitFor();
        const bounds = await page.evaluate(() => {
          const v = window.test.controller.view(), selection = v.state.selection.main;
          return { end: v.coordsAtPos(selection.to).bottom, popup: document.querySelector('.sc-wb-assistant').getBoundingClientRect().top };
        });
        assert.ok(bounds.popup >= bounds.end, JSON.stringify(bounds));
        await capture(`selection-popup-${palette}-${dark ? 'dark' : 'light'}`);
        await page.evaluate(() => window.test.controller.assistant.close());
      }
    });
    await t.test('设置或选区气泡开启时不残留选区操作浮条，关闭后恢复', async () => {
      await reload(); await visit('a.ts');
      await page.evaluate(() => { const v = window.test.controller.view(); v.dispatch({ selection: { anchor: 0, head: 6 } }); });
      const actions = page.locator('.selection-actions'); await actions.waitFor();
      await page.evaluate(() => window.test.controller.panel({ kind: 'settings' }));
      await page.locator('.sc-wb-settings').waitFor(); assert.equal(await actions.isVisible(), false);
      await page.evaluate(() => window.test.controller.panel(null)); await actions.waitFor();
      await page.evaluate(() => window.test.controller.assistant.select());
      await page.locator('.sc-wb-assistant textarea').waitFor(); assert.equal(await actions.isVisible(), false);
      assert.equal(await page.evaluate(() => window.test.controller.view().state.selection.main.to), 6);
      await page.evaluate(() => window.test.controller.assistant.close()); await actions.waitFor();
    });
    await t.test('四种主题的设置分组可导航，修改保留，窄窗口仍可操作', async () => {
      await reload();
      for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) {
        await page.setViewportSize({ width: 1440, height: 940 });
        await page.evaluate(async ({ palette, dark }) => { await window.test.theme(palette, dark); window.test.controller.panel({ kind: 'settings' }); }, { palette, dark });
        const nav = page.locator('.sc-wb-settings-nav'), content = page.locator('.sc-wb-settings-content');
        await nav.getByRole('button', { name: '文件与编辑', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.sc-wb-settings-content').scrollTop > 0);
        const before = await page.getByRole('checkbox', { name: '以预览标签打开文件' }).isChecked();
        await page.getByRole('checkbox', { name: '以预览标签打开文件' }).click();
        assert.equal(await page.evaluate(() => window.test.controller.snapshot().preferences.previewTabs), !before);
        await nav.getByRole('button', { name: '自定义快捷键', exact: true }).click();
        const shortcut = page.locator('.sc-wb-shortcut button[title="当前文件搜索"]');
        await shortcut.click(); assert.equal(await shortcut.textContent(), '按下组合键…');
        assert.equal(await shortcut.evaluate(node => node === document.activeElement), true, '录制按钮必须接收后续按键');
        await page.keyboard.press('Escape');
        await nav.getByRole('button', { name: '外观与布局', exact: true }).click();
        await page.getByRole('combobox', { name: '工作台主题', exact: true }).waitFor();
        assert.ok(await content.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
        await page.setViewportSize({ width: 520, height: 620 });
        await nav.getByRole('button', { name: '快速对话与翻译', exact: true }).click();
        await page.getByRole('combobox', { name: '快速对话模型', exact: true }).waitFor();
        assert.ok(await content.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
        const close = page.locator('.sc-wb-dialog-heading').getByRole('button', { name: '关闭', exact: true }), rect = await close.boundingBox();
        assert.ok(rect.width >= 32 && rect.height >= 32 && rect.x + rect.width <= 520);
        await close.click(); assert.equal(await page.locator('.sc-wb-dialog').count(), 0);
      }
      await page.setViewportSize({ width: 1440, height: 940 });
    });
    assert.deepEqual(errors,[]);await page.close();
  });
} finally { await browser.close();windows.dispose();await new Promise(resolve=>server.close(resolve)); }
