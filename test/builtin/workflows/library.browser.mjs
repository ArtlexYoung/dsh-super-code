import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { recipes } from '../../../builtin/workflows/recipes.js';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = `import React,{useSyncExternalStore} from 'react';import{createRoot}from'react-dom/client';
import{WorkflowLibrary}from'./builtin/workflows/Library.jsx';import{zh,en}from'./builtin/workflows/locales.js';import catalog from './builtin/workflows/catalog.json';
const root=createRoot(document.getElementById('root'));let language='zh',sessionId='sample',count=0,fail=false,failWrites=false,notify=()=>{},draft={draft:'修复订单金额',phase:'plain',attachmentIds:[],occurrences:[]};const listeners=new Set();
const source=catalog.flatMap(pack=>pack.skills).filter(skill=>skill.id!=='pstack/tdd'&&skill.id!=='pstack/teach').map(skill=>({...skill,path:'/demo/builtin/skills/'+skill.path}));let skills=source;
const api={async list(){count++;if(fail)throw Error('offline');return{ok:true,value:{skills}}}};const subscribe=fn=>{notify=fn;return()=>{notify=()=>{}}};
const useInput=select=>select(useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>draft));
const inputActions={setDraft(value){draft={...draft,draft:value};listeners.forEach(fn=>fn())}};
function render(){root.render(<WorkflowLibrary key={language+'-'+sessionId} sessionId={sessionId} api={api} subscribe={subscribe} useInput={useInput} inputActions={inputActions} openView={view=>{window.lastView=view}} storage={{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>{if(failWrites)throw Error('quota');localStorage.setItem(key,value)}}} t={key=>(language==='zh'?zh:en)[key]||key}/>)}render();
window.fixture={count:()=>count,draft:()=>draft,disable:()=>{skills=[];notify()},restore:()=>{skills=source;notify()},offline:()=>{fail=true;notify()},online:()=>{fail=false;notify()},locale:value=>{language=value;render()},session:value=>{sessionId=value;render()},rich:()=>{draft={...draft,attachmentIds:['file']};listeners.forEach(fn=>fn())},plain:()=>{draft={...draft,attachmentIds:[]};listeners.forEach(fn=>fn())},failWrites:value=>{failWrites=value},store:()=>JSON.parse(localStorage.getItem('dsh-super-code.workflows.v2'))};`;
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser', minify: true, loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' } });
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(app.outputFiles[0].contents); return; }
  res.end('<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
const artifacts = process.env.SC_TEST_ARTIFACTS;
try {
  await test('quest maps preserve native invocation, author routes, independent progress and accessible layouts', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const selectPack = name => page.locator('.sc-flow-packages button').filter({ has: page.locator('strong', { hasText: name }) }).click();
    const openCatalog = () => page.locator('.sc-flow-views').getByRole('button', { name: '技能图鉴 98', exact: true }).click();
    const openMap = () => page.locator('.sc-flow-views').getByRole('button', { name: '任务地图', exact: true }).click();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button', { name: '刷新可用状态' }).waitFor();
    await page.waitForFunction(() => window.fixture?.count() === 1);
    await page.getByRole('button', { name: '1. 澄清并记录', exact: true }).click();
    await page.getByRole('button', { name: '收藏此 Skill' }).click();
    await page.getByRole('button', { name: '确认完成这一关', exact: false }).click();
    await page.getByRole('button', { name: '前往下一关', exact: false }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixture.store().runs.sample.routes['matt-feature']), ['grill-with-docs']);
    await page.getByRole('button', { name: '放入对话草稿' }).click();
    assert.equal(await page.evaluate(() => window.lastView), 'chat');
    assert.match(await page.evaluate(() => window.fixture.draft().draft), /^\/grill-with-docs .*澄清并记录[\s\S]*修复订单金额$/);
    assert.equal(await page.evaluate(() => window.fixture.count()), 2, 'fetch only at mount and invocation');
    await page.reload();
    await page.locator('.sc-flow-steps li[data-complete=true]').waitFor();
    assert.equal(await page.locator('.sc-flow-steps li[data-complete=true]').count(), 1);
    assert.equal(await page.locator('.sc-flow-step[aria-current=step]').getAttribute('aria-label'), '2. 编写规格');
    await openCatalog();
    await page.getByRole('button', { name: '收藏', exact: true }).click();
    assert.equal(await page.locator('.sc-flow-skills li').count(), 1);
    await selectPack('PStack');
    await page.locator('.sc-flow-filters').getByRole('button', { name: '全部', exact: true }).click();
    await page.getByRole('searchbox').fill('tdd');
    await page.locator('.sc-flow-skills button').click();
    assert.equal(await page.getByRole('button', { name: '放入对话草稿' }).isDisabled(), true);
    await page.getByText('同名 Skill 来自其他包或项目', { exact: true }).waitFor();
    await page.getByRole('searchbox').fill('architect');
    await page.locator('.sc-flow-skills').getByRole('button', { name: 'architect PStack 可使用', exact: true }).click();
    await page.getByRole('button', { name: '返回图鉴', exact: false }).click();
    assert.equal(await page.locator('.sc-flow-detail').count(), 0);
    await page.locator('.sc-flow-skills').getByRole('button', { name: 'architect PStack 可使用', exact: true }).click();
    await page.evaluate(() => window.fixture.disable());
    await page.getByText('未启用或当前预设不可用', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '放入对话草稿' }).isDisabled(), true);
    await page.evaluate(() => window.fixture.offline());
    await page.getByText('未能读取当前会话的 Skill，请刷新重试。').waitFor();
    await page.evaluate(() => { window.fixture.online(); window.fixture.restore(); });
    await page.getByText('可使用', { exact: true }).waitFor();
    await page.evaluate(() => window.fixture.rich());
    assert.equal(await page.getByRole('button', { name: '放入对话草稿' }).isDisabled(), true);
    const timings = [];
    for (let index = 0; index < 20; index++) {
      timings.push(await page.evaluate(async index => {
        const start = performance.now(), input = document.querySelector('input[type=search]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, index % 2 ? 'tdd' : 'architect');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
        const names = [...document.querySelectorAll('.sc-flow-skills strong')].map(node => node.textContent);
        if (index % 2 ? names.length !== 1 || names[0] !== 'tdd' : !names.includes('architect') || names.includes('tdd')) throw Error('Search results did not render');
        return performance.now() - start;
      }, index));
    }
    assert.ok(Math.max(...timings) < 200, `Search responsiveness: ${timings}`);
    await page.evaluate(() => window.fixture.plain());
    await openMap();
    await selectPack('PStack');
    await page.getByRole('button', { name: '确认完成这一关', exact: false }).click();
    await page.getByRole('button', { name: '前往下一关', exact: false }).click();
    await page.locator('.sc-flow-detail h2').getByText('先定数据与接口', { exact: true }).waitFor();
    await page.getByRole('button', { name: '放入对话草稿' }).click();
    assert.match(await page.evaluate(() => window.fixture.draft().draft), /^\/poteto-mode [\s\S]*playbook：feature[\s\S]*先定数据与接口/);
    await selectPack('Matt Pocock');
    assert.equal(await page.locator('.sc-flow-steps li[data-complete=true]').count(), 1);
    await page.evaluate(() => window.fixture.failWrites(true));
    await page.getByRole('button', { name: '确认完成这一关', exact: false }).click();
    await page.getByText('浏览记录未能保存；请检查浏览器存储后重试。').waitFor();
    assert.equal(await page.locator('.sc-flow-steps li[data-complete=true]').count(), 1, 'failed writes never award progress');
    await page.evaluate(() => window.fixture.failWrites(false));
    await page.getByRole('button', { name: '确认完成这一关', exact: false }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.sc-flow-steps li[data-complete=true]').count(), 2);
    for (let index = 2; index < 5; index++) {
      await page.locator('.sc-flow-step').nth(index).click();
      await page.getByRole('button', { name: '确认完成这一关', exact: false }).click();
    }
    await page.getByText('路线已完成！每一关都留下了你的确认记录。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '重新打开这一关', exact: false }).click();
    assert.equal(await page.locator('.sc-flow-steps li[data-complete=true]').count(), 4);
    await page.reload();
    assert.equal(await page.locator('.sc-flow-steps li[data-complete=true]').count(), 4);
    await page.evaluate(() => window.fixture.session('another'));
    await page.locator('.sc-flow-route').waitFor();
    assert.equal(await page.locator('.sc-flow-steps li[data-complete=true]').count(), 0);
    await page.evaluate(() => window.fixture.session('sample'));
    await page.locator('.sc-flow-steps li[data-complete=true]').first().waitFor();
    assert.equal(await page.locator('.sc-flow-steps li[data-complete=true]').count(), 4);
    await page.locator('.sc-flow-method summary').click();
    await page.getByRole('link', { name: '阅读作者原文', exact: false }).waitFor();
    await page.locator('.sc-flow-tools').getByRole('button').filter({ hasText: '需要跑出来才能决定' }).click();
    await page.locator('.sc-flow-detail h2').getByText('prototype', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '确认完成这一关', exact: false }).count(), 0, 'optional tools are not forced checkpoints');
    const names = { mattpocock: 'Matt Pocock', pstack: 'PStack', openspec: 'OpenSpec', 'oil-ui': 'oil-ui' };
    for (const recipe of recipes) {
      await selectPack(names[recipe.pack]);
      await page.locator('.sc-flow-routes button').filter({ has: page.getByText(recipe.title[0], { exact: true }) }).click();
      assert.equal(await page.locator('.sc-flow-step').count(), recipe.steps.length);
      for (let index = 0; index < recipe.steps.length; index++) {
        await page.locator('.sc-flow-step').nth(index).click();
        assert.equal(await page.locator('.sc-flow-detail .sc-flow-command').textContent(), '/' + recipe.steps[index].skill);
        assert.equal(await page.locator('.sc-flow-mission-output strong').textContent(), recipe.steps[index].output[0]);
      }
    }
    if (artifacts) await mkdir(artifacts, { recursive: true });
    for (const language of ['zh', 'en']) for (const dark of [false, true]) for (const width of [1440, 1100, 900, 820, 720, 390]) {
      await page.evaluate(({ language, dark }) => { document.body.toggleAttribute('data-ds-dark-theme', dark); window.fixture.locale(language); }, { language, dark });
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('.sc-flow-route').waitFor();
      await page.locator('.sc-flow-step').first().click();
      await page.locator('.sc-flow-detail').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${language}/${dark}/${width}`);
      const boxes = await page.locator('.sc-flow-step').evaluateAll(nodes => nodes.map(node => { const box=node.getBoundingClientRect(); return { x:box.x,right:box.right,width:box.width }; }));
      const mapBox = await page.locator('.sc-flow-map').boundingBox();
      assert.ok(boxes.every(box=>box.x>=mapBox.x&&box.right<=mapBox.x+mapBox.width&&box.width>=44), JSON.stringify({boxes,mapBox}));
      if (artifacts) await page.screenshot({ path: join(artifacts, `workflow-${language}-${dark ? 'dark' : 'light'}-${width}.png`), animations: 'disabled' });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.sc-flow-detail').evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (artifacts) { await page.screenshot({ path: join(artifacts, 'workflow-200-percent.png'), animations: 'disabled' }); await writeFile(join(artifacts, 'workflow-timing.json'), JSON.stringify({ samples: timings, max: Math.max(...timings), median: timings.toSorted((a,b)=>a-b)[10], scope: 'Production React browser fixture; actual input events to verified results through two animation frames; not a competitor comparison' }, null, 2)); }
    assert.deepEqual(errors, []);
    await page.close();
  });
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
