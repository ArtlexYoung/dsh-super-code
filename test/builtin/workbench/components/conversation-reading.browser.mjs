import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';
import{AgentDetail}from'./builtin/sidebar/detail.js';import{detailRecord}from'./builtin/sidebar/messages.js';
import{icons}from'./builtin/ui/controls.js';import{zh,en}from'./builtin/ui/locale.js';import{SafeMarkdown}from'./builtin/workbench/windows/markdown.jsx';
import uiStyle from'./builtin/ui/style.css';import workbenchStyle from'./builtin/workbench/style.css';
for(const content of [uiStyle,workbenchStyle]){const style=document.createElement('style');style.textContent=content;document.head.appendChild(style)}
icons.MarkdownText=SafeMarkdown;icons.CodeBlock=({code})=><pre>{code}</pre>;
const prompt='请检查订单导出，保留编号前导零。\\n'+Array.from({length:12},(_,i)=>'检查项 '+i+'：核对金额、列顺序和空值，记录实际结果。').join('\\n');
const event=(seq,type,data)=>({event:{seq,type,time:1700000000000+seq,data}});
const question=(seq,text)=>event(seq,'user/message',{source:{kind:'user'},content:[{type:'text',text}]});
const reply=(seq,text,interrupted=false)=>event(seq,'assistant/message',{message:{content:[{type:'text',text}]},interrupted});
const initial=[question(1,prompt),reply(2,'先核对输入数据。'),event(3,'tool/call',{turn:1,step:1,name:'read',callId:'read-a',arguments:'{}'}),event(4,'tool/result',{turn:1,step:1,message:{role:'tool',toolCallId:'read-a',isError:true,content:[{type:'text',text:'找不到检查文件。'}]}}),reply(5,'编号 007 应保留为文本。\\n\\n'+Array.from({length:25},(_,i)=>'核对记录 '+i+'：金额按数值排序，导出后读取文件验证。').join('\\n\\n')),question(6,'再检查空金额。'),reply(7,'空金额保持为空。'),question(8,'这一项尚无回复。'),event(9,'turn/error',{message:'执行中断，请核对错误。'})];
const stores=new Map(),states=new WeakMap(),tabs=new Map();let selected='designer',language='zh',compact=true,starts=0;
for(const id of ['designer','reviewer']){const entries=id==='designer'?initial:[question(1,'检查多行输入。\\n1\\n2\\n3\\n4\\n5\\n6'),reply(2,'多行输入已检查。')];const listeners=new Set();const store={snapshot:{status:'ready',items:entries.map(entry=>detailRecord(entry)),projections:{},hasMore:false,earlier:false},listeners};stores.set(id,store);tabs.set(id,{signal:new AbortController().signal,visible:true,contentId:'dsh-resource://super-agent/'+id})}
const inspector=(address)=>{const store=stores.get(new URL(address).pathname.slice(1));return{getSnapshot:()=>store.snapshot,subscribe:fn=>{store.listeners.add(fn);return()=>store.listeners.delete(fn)},start:()=>{starts++},dispose:()=>{},older:()=>{throw Error('Unexpected history read')}}};
const sessions={byId:{designer:{id:'designer',title:'方案设计'},reviewer:{id:'reviewer',title:'实现检查'}}};
const app=createRoot(document.getElementById('root'));const render=()=>app.render(<main className='sc-workbench'><nav><button onClick={()=>{selected='designer';render()}}>方案设计</button><button onClick={()=>{selected='reviewer';render()}}>实现检查</button></nav><div className={compact?'sc-wb-conversation':'plain-detail'}><AgentDetail key={selected} useTabInfo={()=>({tab:tabs.get(selected)})} useSessions={select=>select(sessions)} sessionId={selected} createInspector={inspector} detailStates={states} openMemory={()=>{}} compact={compact} t={key=>(language==='zh'?zh:en)[key]||key}/></div></main>);
render();window.fixture={prompt,starts:()=>starts,locale:value=>{language=value;render()},compact:value=>{compact=value;render()},append:()=>{const store=stores.get(selected);store.snapshot={...store.snapshot,items:[...store.snapshot.items,detailRecord(reply(10,'执行到一半的记录。',true))]};store.listeners.forEach(fn=>fn())},orphan:()=>{const store=stores.get(selected);store.snapshot={...store.snapshot,items:[detailRecord(reply(20,'只有这一段历史回复。'))]};store.listeners.forEach(fn=>fn())}};`;
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser', minify: true, loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' } });
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(app.outputFiles[0].contents); return; }
  response.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}.sc-workbench{height:100%;display:flex;flex-direction:column}.sc-workbench>nav{padding:8px}.plain-detail{overflow:auto}</style><div id="root"></div><script type="module" src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
const open = async () => { const page = await browser.newPage({ viewport: { width: 390, height: 700 } }); page.setDefaultTimeout(4000); await page.goto(`http://127.0.0.1:${server.address().port}`); return page; };
const chooseQuestion = async (page, number, language = 'zh') => {
  await page.getByRole('combobox', { name: language === 'zh' ? '本页问题' : 'Questions on this page', exact: true }).click();
  await page.getByRole('option', { name: new RegExp('^' + number + '\\.') }).click();
};
try {
  await test('长问题按需展开，原文、键盘和每个 Agent 的阅读状态保留', async () => {
    const page = await open();
    try {
      const long = page.locator('[data-message-seq="1"] .sc-wb-question');
      await long.waitFor({ state: 'attached' });
      assert.equal(await long.evaluate(node => node.open), false);
      assert.equal(await long.locator('.dsh-super-code-detail-content').isVisible(), false);
      assert.equal(await page.locator('[data-message-seq="6"] details').count(), 0, 'Short questions stay directly readable');
      await chooseQuestion(page, 1);
      await page.waitForFunction(() => document.querySelector('.sc-wb-question').open);
      assert.equal(await long.locator('pre').innerText(), await page.evaluate(() => window.fixture.prompt));
      const starts = await page.evaluate(() => window.fixture.starts());
      await long.locator('summary').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('.sc-wb-question').open);
      await page.keyboard.press('Space');
      await page.waitForFunction(() => document.querySelector('.sc-wb-question').open);
      assert.equal(await page.evaluate(() => window.fixture.starts()), starts, 'Folding does not reopen the journal stream');
      await page.getByRole('button', { name: '实现检查', exact: true }).click();
      await page.locator('[data-agent-detail="reviewer"]').waitFor();
      assert.equal(await long.evaluate(node => node.open), false, 'Multiline questions fold independently');
      await page.getByRole('button', { name: '方案设计', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.sc-wb-question')?.open);
      await page.evaluate(() => window.fixture.compact(false));
      assert.equal(await page.locator('.sc-wb-question').count(), 0, 'The ordinary agent detail still shows the full question');
      assert.equal(await page.locator('[data-message-seq="1"] pre').innerText(), await page.evaluate(() => window.fixture.prompt));
    } finally { await page.close(); }
  });
  await test('查看回复只定位本次问题的最后一条记录，错误与新回复仍可见', async () => {
    const page = await open();
    try {
      const view = page.getByRole('button', { name: '查看回复', exact: true });
      await chooseQuestion(page, 1); await view.click();
      await page.waitForFunction(() => document.activeElement?.dataset.messageSeq === '5');
      const visible = await page.locator('[data-message-seq="5"]').evaluate(node => {
        const log = node.closest('.dsh-super-code-detail-log').getBoundingClientRect(), bounds = node.getBoundingClientRect();
        return bounds.top >= log.top - 1 && bounds.top < log.bottom;
      });
      assert.equal(visible, true);
      await page.locator('.sc-wb-tool-group summary').first().click();
      await page.locator('[data-message-seq="4"] summary').click();
      await page.getByText('找不到检查文件。', { exact: true }).waitFor();
      await chooseQuestion(page, 2); await view.click();
      await page.waitForFunction(() => document.activeElement?.dataset.messageSeq === '7');
      await page.getByRole('button', { name: '实现检查', exact: true }).click();
      await page.locator('[data-agent-detail="reviewer"]').waitFor();
      await page.getByRole('button', { name: '方案设计', exact: true }).click();
      await page.locator('[data-agent-detail="designer"]').waitFor();
      await view.click();
      await page.waitForFunction(() => document.activeElement?.dataset.messageSeq === '7');
      await chooseQuestion(page, 3);
      assert.equal(await view.isDisabled(), true);
      await view.hover();
      await page.getByRole('tooltip', { name: '本页还没有这次提问的回复。', exact: true }).waitFor();
      await page.getByText('执行中断，请核对错误。', { exact: true }).waitFor();
      await page.evaluate(() => window.fixture.append());
      await page.waitForFunction(() => !document.querySelector('.sc-wb-question-nav>button').disabled);
      await view.click();
      await page.waitForFunction(() => document.activeElement?.dataset.messageSeq === '10');
      await page.getByText('Agent · 已中断', { exact: true }).waitFor();
      await page.evaluate(() => window.fixture.orphan());
      await page.waitForFunction(() => !document.querySelector('.sc-wb-question-nav'));
      await page.getByText('只有这一段历史回复。', { exact: true }).waitFor();
    } finally { await page.close(); }
  });
  await test('中英文、窄栏和放大字号下都能展开问题并定位回复', async () => {
    const page = await open(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.evaluate(() => window.fixture.locale('en'));
      for (const width of [260,390,720]) {
        await page.setViewportSize({ width, height: 700 });
        for (const scale of [1,2]) {
          await page.evaluate(value => { document.body.style.zoom = String(value); }, scale);
          await chooseQuestion(page, 1, 'en');
          const button = page.getByRole('button', { name: 'View reply', exact: true });
          await button.click();
          await page.waitForFunction(() => document.activeElement?.dataset.messageSeq === '5');
          assert.equal(await page.locator('.sc-wb-question-nav').evaluate(node => node.scrollWidth <= node.clientWidth), true);
          assert.equal(await page.locator('.dsh-super-code-detail-log').evaluate(node => node.scrollWidth <= node.clientWidth), true);
          if (process.env.SC_TEST_ARTIFACTS && width === 390 && scale === 1) {
            await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true });
            await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, 'reading-en-390.png') });
          }
        }
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
