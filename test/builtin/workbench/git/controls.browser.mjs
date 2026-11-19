// 运行：node --test test/builtin/workbench/git/controls.browser.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(import.meta.url), { build } = require('esbuild'), playwright = require('playwright');
const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GitConfirmation} from './builtin/workbench/git/Controls.jsx';
import css from './builtin/workbench/style.css';
const style = document.createElement('style'); style.textContent=css; document.head.append(style);
function Button({children,...props}) {return <button {...props}>{children}</button>}
function App() {
  const [staged,setStaged]=useState(null);
  window.test={open(count){setStaged(Array.from({length:count},(_,index)=>({path:'src/file-'+String(index).padStart(6,'0')+'.ts'})))}};
  return <main className="sc-workbench" style={{height:'100vh',position:'relative'}}><button onClick={()=>window.test.open(20000)}>open</button>{staged&&<GitConfirmation input={{action:'commit',message:'review'}} state={{branch:'main',remotes:[]}} staged={staged} cancel={()=>setStaged(null)} accept={()=>{}} t={key=>key} Button={Button}/>}</main>
}
createRoot(document.getElementById('root')).render(<App/>);
`;
const built = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'text' } });
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
  response.end(request.url === '/app.js' ? built.outputFiles[0].contents : '<!doctype html><meta charset="utf-8"><style>body{margin:0;font:13px system-ui}</style><div id="root"></div><script type="module" src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await playwright[process.env.SC_TEST_BROWSER || 'chromium'].launch({ headless: true, executablePath: process.env.SC_TEST_EXECUTABLE || undefined });
try {
  await test('两万文件提交确认只渲染可见行，列表末尾仍可访问，关闭后恢复焦点', async () => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto('http://127.0.0.1:' + server.address().port);
      const opener = page.getByRole('button', { name: 'open', exact: true });
      await opener.focus(); await page.keyboard.press('Enter');
      const dialog = page.getByRole('alertdialog'), rows = dialog.locator('li,[role="listitem"]');
      await dialog.waitFor();
      assert.equal(await rows.first().textContent(), 'src/file-000000.ts');
      assert.ok(await rows.count() < 100, '确认列表应按可见区域渲染，不能创建两万个文件节点');
      await dialog.locator('.sc-wb-git-file-list').evaluate(node => { node.scrollTop = node.scrollHeight; });
      await rows.filter({ hasText: 'src/file-019999.ts' }).waitFor();
      assert.ok(await rows.count() < 100);
      const before = await page.evaluate(() => document.activeElement.textContent);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'gitConfirm');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), before);
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      assert.equal(await opener.evaluate(node => node === document.activeElement), true);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await test('空文件与单文件确认保持紧凑，窄屏和视口变化后文件仍可访问', async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 500 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto('http://127.0.0.1:' + server.address().port);
      for (const count of [0, 1]) {
        await page.evaluate(count => window.test.open(count), count);
        const dialog = page.getByRole('alertdialog');
        await dialog.waitFor();
        assert.equal(await dialog.locator('[role="listitem"]').count(), count);
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= 400);
        if (count) {
          const region = await dialog.getByRole('list').boundingBox();
          const list = await dialog.locator('.sc-wb-git-file-list').boundingBox();
          assert.ok(list.height <= region.height, '短列表不能沿用通用列表的最小高度而溢出确认区域');
        }
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
      }
      await page.getByRole('button', { name: 'open', exact: true }).click();
      await page.setViewportSize({ width: 800, height: 650 });
      const list = page.getByRole('alertdialog').locator('.sc-wb-git-file-list');
      await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.getByRole('listitem').filter({ hasText: 'src/file-019999.ts' }).waitFor();
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
