import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { webkit, chromium } from 'playwright';
import { tsImport } from 'tsx/esm/api';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const { listSystemFonts } = await tsImport('../../../../src/workbench/fonts.ts', import.meta.url);
const families = await listSystemFonts(new AbortController().signal);
const fixture = `import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';import{createRoot}from'react-dom/client';
import{apply,createWorkbenchPreference}from'./builtin/workbench/index.jsx';import{Workbench}from'./builtin/workbench/components/Workbench.jsx';import{zh,en}from'./builtin/workbench/locales.js';
import { SelectControl } from './builtin/ui/controls.js';
const query=new URLSearchParams(location.search),t=k=>(query.has('en')?en:zh)[k]||k;let fail=false;
if(query.has('dark'))document.body.setAttribute('data-ds-dark-theme','');
const text='// 中文注释：统计已完成的任务\\nexport function summarize(tasks: Task[]): number {\\n  return tasks.filter(task => task.done).length;\\n}';
const ok=value=>({ok:true,value}),remote={
 async fonts(_session,signal){const r=await fetch('/fonts'+(fail?'?fail':''),{signal});if(!r.ok)return{ok:false,error:{message:'WORKBENCH_FONTS_UNAVAILABLE'}};return ok(await r.json())},
 async fileOperation(){return ok({path:'/sample-project'})},async list(){return ok({entries:[{name:'tasks.ts',path:'tasks.ts',type:'file'}],truncated:false})},
 async project(){return ok({files:['tasks.ts'],truncated:false})},async storeIndex(){return ok(true)},async environments(){return ok({environments:[],warnings:[]})},async read(){return ok({path:'tasks.ts',text,version:'v1'})},async models(){return ok([])},
 async *git(){yield{kind:'state',state:{exists:false,changes:[],branches:[],remoteBranches:[],remotes:[],history:[]},sources:[]}}};
const contributions=new Map(),disposers=[],preference=createWorkbenchPreference(localStorage);preference.save({enabled:true});
const ctx={effect(run){const d=run();if(typeof d==='function')disposers.push(d)},inject(names,run){if(names.includes('remote.superCodeWorkbench'))run(ctx)},locale:{register:()=>()=>{},bind:()=>t,getLocale:()=>({active:'zh',locales:[{id:'zh',label:'中文'}]})},remote:{superCodeWorkbench:remote},sessions:{list:{getSnapshot:()=>({byId:{demo:{cwd:'/sample-project'}}})}},sidebarRightTabs:{register:()=>()=>{}},slots:{entries:()=>[],inject(_name,run){disposers.push(run())},register(v,component){contributions.set(v.id,{v,component});return()=>contributions.delete(v.id)}}};
const Button=({children,...props})=><button type='button' {...props}>{children}</button>;
const ui=apply(ctx,{Button,Select:SelectControl,MarkdownText:'div',Conversation:()=>null,preference}),entry=contributions.get('super-code-workbench').v,c=entry.inject('demo').workbench;
const root=createRoot(document.getElementById('root'));function render(global=false){root.render(global?<ui.Settings remote={remote}/>:<Workbench workbench={c} Button={Button} Select={SelectControl} Conversation={()=>null} t={t} sessionId='demo'/>)}render();
window.test={c,render,fail:value=>{fail=value},text,dispose(){root.unmount();for(const d of disposers.reverse())if(typeof d==='function')d()}};`;
const app = await build({ stdin: { contents: fixture, resolveDir: repo, loader: 'jsx' }, bundle: true, write: false, platform: 'browser', format: 'esm', external: ['@deepseek-ai/*'], loader: { '.css': 'text', '.woff2': 'dataurl' } });
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(app.outputFiles[0].contents); }
  else if (req.url === '/fonts?fail') { res.writeHead(503); res.end('unavailable'); }
  else if (req.url === '/fonts') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify([...families, 'Only Server Missing Font'])); }
  else res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}.dsh-super-code-select{position:relative;display:inline-flex}.dsh-super-code-select-trigger{border:1px solid var(--wb-line)!important}.dsh-super-code-select-trigger svg{width:14px}.dsh-super-code-select-menu{position:fixed;z-index:2000000;overflow:auto;background:var(--wb-bg);border:1px solid var(--wb-line);box-shadow:0 4px 18px #0002;border-radius:5px;padding:4px}.dsh-super-code-select-option{display:flex;justify-content:space-between;cursor:pointer;padding:5px 9px}.dsh-super-code-select-option svg{width:14px;visibility:hidden}.dsh-super-code-select-option[aria-selected=true] svg{visibility:visible}.dsh-super-code-select-option[data-active=true]{background:var(--wb-hover)}</style><div id="root"></div><script type="module" src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('内嵌可变字体与本机中英文字体设置', async t => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const available = await page.evaluate(async names => {
      const result = [];
      for (const name of names) {
        try { await new FontFace('Font test probe', `local(${JSON.stringify(name)})`).load(); result.push(name); }
        catch {}
      }
      return result;
    }, families);
    const latinFont = ['Menlo', 'Monaco', 'Consolas', 'Courier New', 'DejaVu Sans Mono'].find(name => available.includes(name));
    const chineseFont = ['Songti SC', 'PingFang SC', 'Arial Unicode MS', 'Microsoft YaHei', 'Noto Sans CJK SC'].find(name => available.includes(name));
    assert.ok(latinFont, '需要浏览器可用的本机等宽字体');
    assert.ok(chineseFont, '需要浏览器可用的本机中文字体');
    try { await page.waitForFunction(() => window.test?.c.snapshot().indexed > 0); }
    catch (error) { t.diagnostic(JSON.stringify({ errors, state: await page.evaluate(() => { const state = window.test?.c.snapshot(); return state && { error: state.error, status: state.status, indexed: state.indexed, indexing: state.indexing }; }) })); throw error; }
    await page.evaluate(() => window.test.c.visit({ file: 'tasks.ts' }));
    const select = async (name, value) => { await page.getByRole('combobox', { name, exact: true }).click(); await page.getByRole('option', { name: value, exact: true }).click(); };
    const detected = () => page.waitForFunction(() => [...document.querySelectorAll('.sc-wb-font-status')].some(n => /已检测本机字体：\s*[1-9]\d*/.test(n.textContent)));
    await t.test('未安装系统字体也加载内嵌普通和斜体，100–800字重且无字体网络请求', async () => {
      const result = await page.evaluate(async () => {
        const regular = await document.fonts.load('400 14px "Super Code JetBrains Mono"', 'abc012=>');
        const italic = await document.fonts.load('italic 700 14px "Super Code JetBrains Mono"', 'abc012=>');
        return { regular: regular.map(face => ({ style: face.style, weight: face.weight, status: face.status })), italic: italic.map(face => ({ style: face.style, weight: face.weight, status: face.status })), family: getComputedStyle(document.querySelector('.cm-scroller')).fontFamily };
      });
      assert.deepEqual(result.regular, [{ style: 'normal', weight: '100 800', status: 'loaded' }]);
      assert.deepEqual(result.italic, [{ style: 'italic', weight: '100 800', status: 'loaded' }]);
      assert.equal(result.family.split(',')[0].trim().replace(/^"|"$/g, ''), 'Super Code JetBrains Mono');
      assert.ok(requests.every(url => url.startsWith(`http://127.0.0.1:${server.address().port}`)));
    });
    await t.test('真实本机字体自动检测去重，远程不存在的候选不出现，中英文字体分别可选', async () => {
      await page.evaluate(() => window.test.c.panel({ kind: 'settings' }));
      await page.locator('.sc-wb-settings-nav').getByRole('button', { name: '阅读与字体', exact: true }).click();
      await detected();
      await page.getByRole('combobox', { name: '英文代码字体', exact: true }).click();
      assert.equal(await page.getByRole('option', { name: 'Only Server Missing Font', exact: true }).count(), 0);
      assert.equal(await page.getByRole('option', { name: latinFont, exact: true }).count(), 1);
      await page.getByRole('option', { name: 'JetBrains Mono（内置）', exact: true }).click();
      await select('中文回退字体', chineseFont);
      const value = await page.evaluate(() => ({ preferences: window.test.c.snapshot().preferences, family: getComputedStyle(document.querySelector('.cm-scroller')).fontFamily, text: window.test.c.view().state.doc.toString() }));
      assert.equal(value.preferences.chineseFontFamily, 'local:' + chineseFont); assert.ok(value.family.split(',').some(name => name.trim().replace(/^"|"$/g, '') === chineseFont));
      assert.equal(value.text, await page.evaluate(() => window.test.text));
      const glyphs = await page.evaluate(font => { const canvas=document.createElement('canvas'),c=canvas.getContext('2d'),text='中文注释统计任务';c.font='20px '+getComputedStyle(document.querySelector('.cm-scroller')).fontFamily;const actual=c.measureText(text).width;c.font='20px '+JSON.stringify(font);return {actual,expected:c.measureText(text).width}; }, chineseFont);
      assert.ok(Math.abs(glyphs.actual - glyphs.expected) < .01, JSON.stringify(glyphs));
      if (process.env.SC_TEST_ARTIFACTS) { await mkdir(process.env.SC_TEST_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, 'fonts-settings-light.png') }); }
      await select('英文代码字体', latinFont);
      await page.evaluate(() => window.test.c.panel(null));
    });
    await t.test('两个设置入口双向保存、刷新保留，改变字体不改源码', async () => {
      await page.evaluate(() => window.test.render(true));
      await detected();
      assert.equal(await page.getByRole('combobox', { name: '英文代码字体', exact: true }).innerText(), latinFont);
      assert.equal(await page.getByRole('combobox', { name: '中文回退字体', exact: true }).innerText(), chineseFont);
      await select('英文代码字体', 'JetBrains Mono（内置）');
      await page.reload(); await page.waitForFunction(() => window.test?.c.snapshot().indexed > 0);
      await page.evaluate(() => window.test.c.visit({ file: 'tasks.ts' }));
      assert.equal(await page.evaluate(() => window.test.c.snapshot().preferences.chineseFontFamily), 'local:' + chineseFont);
      assert.equal(await page.evaluate(() => window.test.c.view().state.doc.toString()), await page.evaluate(() => window.test.text));
      await page.evaluate(() => window.test.c.panel({ kind: 'settings' }));
      await detected();
    });
    await t.test('枚举失败保留可用选项和已选字体，恢复后可刷新', async () => {
      await page.evaluate(() => window.test.fail(true)); await page.getByRole('button', { name: '刷新字体', exact: true }).click();
      await page.getByText('部分字体未能读取，已保留可用选项。', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.test.c.snapshot().preferences.chineseFontFamily), 'local:' + chineseFont);
      await page.evaluate(() => window.test.fail(false)); await page.getByRole('button', { name: '刷新字体', exact: true }).click();
      await page.getByText('部分字体未能读取，已保留可用选项。', { exact: true }).waitFor({ state: 'detached' });
      await detected();
    });
    await t.test('明暗主题、英文界面和窄窗口保留双字体设置', async () => {
      for (const query of ['?dark', '?en', '?en&dark']) {
        await page.goto(`http://127.0.0.1:${server.address().port}/${query}`); await page.waitForFunction(() => window.test?.c.snapshot().indexed > 0);
        await page.evaluate(() => window.test.render(true)); await page.setViewportSize({ width: 800, height: 800 });
        const name = query.includes('en') ? 'Chinese fallback font' : '中文回退字体';
        await page.getByRole('combobox', { name, exact: true }).waitFor();
        assert.equal(await page.getByRole('combobox', { name, exact: true }).innerText(), chineseFont);
        assert.equal(await page.locator('.sc-wb-settings-content').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
        if (process.env.SC_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.SC_TEST_ARTIFACTS, `fonts-settings-${query.replace(/\W/g, '')}.png`) });
      }
    });
    assert.deepEqual(errors, []);
    if (process.env.SC_TEST_ARTIFACTS) await writeFile(join(process.env.SC_TEST_ARTIFACTS, 'font-requests.json'), JSON.stringify({ requests: requests.length, externalRequests: requests.filter(url => !url.startsWith(`http://127.0.0.1:${server.address().port}`)).length, hostFontFamilies: families.length }, null, 2));
    await page.evaluate(() => window.test.dispose()); await page.close();
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
