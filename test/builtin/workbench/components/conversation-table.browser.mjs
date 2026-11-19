import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';

const css = await readFile(new URL('../../../../builtin/workbench/style.css', import.meta.url), 'utf8');
const detailCss = await readFile(new URL('../../../../builtin/ui/style.css', import.meta.url), 'utf8');
// 对照实际 NEXT 的 MarkdownText.module.css 和 MarkdownFileLink，保留影响布局的宿主规则。
const hostCss = `
.markdown{min-width:0;overflow-wrap:anywhere;color:var(--wb-text);font:14px/1.6 sans-serif}
.markdown a,.markdown .fileLink{color:var(--wb-accent);font-weight:500;position:relative;text-decoration:none;border-left:3px solid transparent;border-right:3px solid transparent;border-top:2px solid transparent;border-bottom:2px solid transparent;margin-left:-3px;margin-right:-3px}
.linkIcon{flex:none;width:1.1em;height:1.1em;vertical-align:-.25em;margin-right:5px}
.markdown :not(pre)>code{display:inline-flex;align-items:center;box-sizing:border-box;font:12px/1.6 monospace;font-size:.875em!important;background:var(--wb-surface);border:.5px solid var(--wb-line);border-radius:3px;padding:0 5px}
.tableScroll{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain}
.tableScroll.md-table-wide{overflow-x:auto;scrollbar-width:thin}
.tableScroll table{border-collapse:collapse;width:max-content;max-width:max-content}
.tableFill table{width:100%;max-width:none}
.tableScroll th{text-align:start;padding:10px 16px;border-bottom:.5px solid var(--wb-line);font:600 14px/1.6 sans-serif;max-width:min(30vw,320px);min-width:100px}
.tableScroll td{padding:10px 16px;border-bottom:.5px solid var(--wb-line);font:14px/1.6 sans-serif;max-width:min(30vw,320px);min-width:100px}
.tableScroll :is(th,td):first-child{padding-left:0}.tableScroll td:last-child{padding-right:0}
.tableScroll table code{font-size:11px}
.fileMention{margin:0;padding:0;border:none;background:none;font:inherit;font-weight:500;color:var(--wb-accent);text-decoration:none;cursor:pointer}
.fileLink{max-width:100%;text-align:inherit}
`;
const icon = '<svg class="linkIcon" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4 1h5l3 3v11H4zM9 1v4h3"/></svg>';
const file = (label, path) => `<button type="button" class="fileMention fileLink" title="${path}" data-file="${path}">${icon}${label}</button>`;
const rows = [
  ['1', `${file('00 基础', '阅读/00_基础.md')} + ${file('01 输入和提示格式', '阅读/01_输入和提示格式.md')}`, '文字怎么变数字？候选项怎么变成 A/B/C？', '1–2h'],
  ['2', `${file('02 后端与概率读出', '阅读/02_后端与概率读出.md')} + ${file('03 一次决策与AutoThink', '阅读/03_一次决策与AutoThink.md')}`, '谁在调模型？门控怎么触发？', '2–3h'],
  ['3', `${file('04 批次规划', '阅读/04_批次规划.md')} + ${file('05 前缀缓存', '阅读/05_前缀缓存.md')} + ${file('06 执行与裁剪', '阅读/06_执行与裁剪.md')}`, '为什么快？哪里少算了？', '3–4h'],
  ['4', file('07 训练损失和LoRA', '阅读/07_训练损失和LoRA.md'), '怎么只训候选字母？', '1–2h'],
];
const table = (headers, values, name, wide = true) => `<div class="tableScroll ${wide ? 'md-table-wide' : 'tableFill'}" tabindex="0"><table data-table="${name}"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${values.map(row => `<tr>${row.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}body{padding:24px;background:#eee}${hostCss}</style><main class="sc-workbench"><section class="sc-wb-conversation"><div class="dsh-super-code-detail"><div class="dsh-super-code-detail-log"><article class="dsh-super-code-detail-entry agent"><div class="dsh-super-code-detail-message"><div class="dsh-super-code-detail-content"><div class="markdown"><h2>三、你现在该做什么</h2><p>按这个顺序读，每阶段大约这个时间：</p>
${table(['阶段', '读哪几篇', '读完能回答', '时间'], rows, 'reading')}
${table(['说明', '文件'], [['<strong>支持长路径与混合内容</strong>', `<code><button type="button" class="fileMention" data-file="src/example/module_entry_point.py">${icon}src/example/module_entry_point.py</button></code><br><a href="#details">${icon}detailsWithLongUnbrokenWordsAndParameters</a><br><em>${file('带强调格式的文件说明', 'src/example/file.md')}</em>`]], 'links', false)}
${table(Array.from({length:12}, (_,i) => `指标 ${i+1}`), [Array.from({length:12}, (_,i) => `${i+1}.25`) ], 'wide')}
<pre><code>${'long_code_'.repeat(45)}</code></pre><div class="md-code-block"><button type="button" class="host-copy" style="display:inline-flex;min-height:22px;padding:2px 6px">复制代码</button></div>
</div></div></div></article></div></div></section><button type="button" class="workbench-action">普通工作台操作</button></main>`;
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({headless:true, ...(process.env.SC_TEST_EXECUTABLE ? {executablePath:process.env.SC_TEST_EXECUTABLE} : {})});
const evidence = process.env.SC_TEST_ARTIFACTS;
try {
  if(evidence)await mkdir(evidence,{recursive:true});
  await test('宿主 Markdown 表格的列宽、文件按钮和局部滚动', {timeout:90000}, async t => {
    const page = await browser.newPage({viewport:{width:1000,height:1100}}), errors = [], results = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(html); await page.addStyleTag({content:detailCss}); await page.addStyleTag({content:css});
    await page.evaluate(() => document.addEventListener('click', event => { const file = event.target.closest('[data-file]'); if(file) window.openedFile = file.dataset.file; }));
    for (const palette of ['idea', 'vscode']) for (const dark of [false, true]) for (const scale of [1, 2]) for (const width of [240, 360, 480, 720]) {
      await t.test(`${palette} ${dark ? '暗色' : '亮色'} ${width}px ${scale === 1 ? '正常字号' : '双倍字号'}`, async () => {
        await page.evaluate(({palette,dark,width,scale}) => {
          document.body.toggleAttribute('data-ds-dark-theme',dark);
          const root = document.querySelector('.sc-workbench'); root.dataset.palette=palette; root.style.width=width+'px';
          document.querySelector('.sc-wb-conversation').style.setProperty('--wb-chat-size',11.5*scale+'px');
        }, {palette,dark,width,scale});
        const layout = await page.evaluate(() => {
          const log = document.querySelector('.dsh-super-code-detail-log'), reading = document.querySelector('[data-table=reading]');
          const overflows = [];
          for (const cell of document.querySelectorAll('th,td')) {
            const bounds = cell.getBoundingClientRect(), walker = document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);
            while(walker.nextNode()) {
              const text = walker.currentNode;if(!text.textContent.trim())continue;
              const range = document.createRange(); range.selectNodeContents(text);
              for(const rect of range.getClientRects()) if(rect.left<bounds.left-1 || rect.right>bounds.right+1)overflows.push({text:text.textContent,left:rect.left-bounds.left,right:rect.right-bounds.right});
            }
            for(const node of cell.querySelectorAll('button,svg,code')) for(const rect of node.getClientRects())if(rect.left<bounds.left-1 || rect.right>bounds.right+1)overflows.push({tag:node.tagName,left:rect.left-bounds.left,right:rect.right-bounds.right});
          }
          const head = [...reading.tHead.rows[0].cells].map(n=>n.getBoundingClientRect());
          const body = [...reading.tBodies[0].rows].map(row=>[...row.cells].map(n=>n.getBoundingClientRect()));
          const wide = document.querySelector('[data-table=wide]').parentElement;
          return {overflows,color:getComputedStyle(reading.querySelector('td')).color,textColor:getComputedStyle(document.querySelector('.sc-workbench')).color,outerWidth:log.clientWidth,outerScroll:log.scrollWidth,readingWidth:reading.getBoundingClientRect().width,columns:head.map(n=>n.width),aligned:body.every(row=>row.every((n,i)=>Math.abs(n.x-head[i].x)<1&&Math.abs(n.width-head[i].width)<1)),wideScroll:wide.scrollWidth,wideWidth:wide.clientWidth};
        });
        results.push({palette,dark,width,scale,...layout});
        if(evidence&&scale===1&&[360,720].includes(width)){
          await page.locator('.sc-wb-conversation').screenshot({path:join(evidence,`table-${palette}-${dark?'dark':'light'}-${width}.png`),animations:'disabled'});
        }
        assert.deepEqual(layout.overflows,[],JSON.stringify(layout.overflows));
        assert.equal(layout.color,layout.textColor);
        assert.ok(layout.outerScroll<=layout.outerWidth+1,JSON.stringify(layout));
        assert.equal(layout.aligned,true);
        assert.ok(layout.wideScroll>layout.wideWidth || width===720,JSON.stringify(layout));
        if(scale===1)assert.ok(layout.readingWidth<=layout.outerWidth+1,JSON.stringify(layout));
        if(scale===1&&width>=360)assert.ok(layout.columns[1]>layout.columns[0]*1.5,JSON.stringify(layout));
      });
    }
    await t.test('多行文件按钮保留点击目标，普通操作和代码块按钮保留自身样式', async () => {
      await page.locator('button[data-file="阅读/03_一次决策与AutoThink.md"]').click();
      assert.equal(await page.evaluate(()=>window.openedFile),'阅读/03_一次决策与AutoThink.md');
      await page.locator('button[data-file="src/example/module_entry_point.py"]').click();
      assert.equal(await page.evaluate(()=>window.openedFile),'src/example/module_entry_point.py');
      assert.equal(await page.locator('.workbench-action').evaluate(n=>getComputedStyle(n).minHeight),'28px');
      assert.equal(await page.locator('.host-copy').evaluate(n=>getComputedStyle(n).minHeight),'22px');
      for(const button of await page.locator('table .fileMention.fileLink').all()){
        const style=await button.evaluate(n=>{const s=getComputedStyle(n);return {padding:s.padding,top:s.marginTop,bottom:s.marginBottom,background:s.backgroundColor,font:s.fontSize,expected:getComputedStyle(n.closest('td')).fontSize};});
        assert.equal(style.padding,'0px');assert.equal(style.top,'0px');assert.equal(style.bottom,'0px');assert.equal(style.background,'rgba(0, 0, 0, 0)');assert.equal(style.font,style.expected);
      }
    });
    if(evidence)await writeFile(join(evidence,'Layout.json'),JSON.stringify(results,null,2)+'\n');
    assert.deepEqual(errors,[]);await page.close();
  });
} finally {await browser.close();}
