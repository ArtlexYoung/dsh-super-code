import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';
import{Conflict}from'./builtin/workbench/git/Conflict.jsx';
import{FileCompare}from'./builtin/workbench/components/FileCompare.jsx';
import{GitPanel}from'./builtin/workbench/git/Panel.jsx';
import{CodeHistory}from'./builtin/workbench/git/History.jsx';
import{EditorView}from'@codemirror/view';import{openSearchPanel}from'@codemirror/search';
import{Locations}from'./builtin/workbench/components/PanelContent.jsx';import{projectSearchDefaults}from'./src/workbench/search-query.ts';
import{compareText}from'./src/workbench/git/text-diff.ts';import{diffLines}from'diff';
const mode=new URLSearchParams(location.search).get('mode'),listeners=new Set(),requests=[],visited=[];let closed=0,refreshed=0;
let state={searchQuery:{...projectSearchDefaults},panel:{id:'shared',kind:mode==='compare'?'fileCompare':mode==='search'?'search':mode==='history'?'lineHistory':'git',path:'base.txt',target:{path:'base.txt',start:1,end:1},text:'left\\n'}};
const locationMode=['definitions','usages'].includes(mode);if(locationMode)state.panel={id:'locations',kind:mode,matches:Array.from({length:650},(_,line)=>({file:'source.ts',line,character:2,name:'target'}))};
const gitState={state:{exists:true,version:'v1',writable:true,branch:'main',head:'a'.repeat(40),backend:'native',merging:false,branches:['main','other'],remoteBranches:[],remotes:[],author:{name:'Demo',email:'demo@example.invalid'},history:[{oid:'a'.repeat(40),message:'commit-a',author:'Demo',timestamp:1},{oid:'b'.repeat(40),message:'commit-b',author:'Demo',timestamp:2}],changes:['old.txt','new.txt'].map(path=>({path,head:1,stage:1,worktree:2}))},sources:[]};
gitState.state.changes.push({path:'staged.txt',head:1,stage:2,worktree:2});
const hold=input=>new Promise((resolve,reject)=>requests.push({resolve,reject,input}));
const conflict={path:'conflict.txt',version:'v1',base:'base\\n',ours:'ours\\n',theirs:'theirs\\n',result:'<<<<<<< ours\\nours\\n=======\\ntheirs\\n>>>>>>> theirs\\n'};
const workbench={setSearchQuery(patch){state={...state,searchQuery:{...state.searchQuery,...patch}};for(const listener of listeners)listener()},snapshot:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},panel(panel){state={...state,panel};for(const listener of listeners)listener()},
list:async()=>({entries:[],truncated:false}),refresh:async()=>{refreshed++},changes:{snapshot:()=>gitState,subscribe:()=>()=>{},refresh:async()=>{},invalidate(){}},
visit:async value=>{visited.push(value)},fail(error){throw error},
async *searchProject(query,signal){await hold(query);if(query.search!=='empty')for(let start=0;start<650;start+=256)yield{kind:'matches',path:query.search+'.txt',version:'v1',matches:Array.from({length:Math.min(256,650-start)},(_,i)=>({line:start+i,character:1,length:query.search.length,lineText:'('+query.search+')'}))};yield{kind:'done',scanned:1,skipped:0};if(query.search==='interrupted')throw new Error('stream ended')},
async git(input){if(input.action==='status')return gitState;const revision=requests.length;await hold(input);if(['commit','resolveConflict','stage','restoreHunk','checkout'].includes(input.action))return{kind:'state',state:{...gitState.state,version:'v2'}};if(input.action==='conflict')return{kind:'conflict',conflict};if(input.action==='commitFiles')return{kind:'commitFiles',oid:input.oid,files:['old.txt','new.txt'],revision};if(input.action==='lineHistory')return{kind:'lineHistory',history:{entries:[{oid:'a'.repeat(40),parent:'b'.repeat(40),before:input.target,after:input.target,message:'history-entry',author:'Demo',timestamp:1}],warnings:[],uncommitted:false}};const path=input.path||input.entry?.after.path,after=path+' #'+revision+'\\n';return{kind:'diff',diff:compareText(path,'left\\n',after,diffLines('left\\n',after))}},
async compareFiles(left,right){const after=right+' #'+requests.length+'\\n';await hold();return compareText(left,'left\\n',after,diffLines('left\\n',after))}};
function Button({children,...props}){return <button {...props}>{children}</button>}
function Select({label,value,choices,onChange}){return <select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{choices.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>}
function History(){const snapshot=React.useSyncExternalStore(workbench.subscribe,workbench.snapshot);return <CodeHistory workbench={workbench} panel={snapshot.panel} Button={Button} t={t} palette="idea"/>}
function LocationView(){const snapshot=React.useSyncExternalStore(workbench.subscribe,workbench.snapshot);if(!snapshot.panel)return null;return <Locations data={snapshot.panel} workbench={workbench} Button={Button} t={t}/>}
function ConflictView(){const snapshot=React.useSyncExternalStore(workbench.subscribe,workbench.snapshot);return <Conflict workbench={workbench} path={snapshot.panel.conflictFile||'conflict.txt'} Button={Button} t={t} palette="idea" close={()=>{closed++}}/>}
const t=key=>key,roots=['a','b'].map(id=>{const root=createRoot(document.getElementById(id));root.render(locationMode?<LocationView/>:mode==='history'?<History/>:mode==='search'?<Locations workbench={workbench} Button={Button} t={t} search/>:mode==='git'?<GitPanel workbench={workbench} Button={Button} Select={Select} t={t} palette="idea"/>:mode==='compare'?<FileCompare panel={state.panel} workbench={workbench} Button={Button} t={t} palette="idea"/>:<ConflictView/>);return root});
window.test={visited,retargetLocations(matches){workbench.panel({id:'next-locations',kind:mode,matches})},count:()=>requests.length,closed:()=>closed,refreshed:()=>refreshed,input:index=>requests[index]?.input,release(index){requests[index]?.resolve()},fail(index){requests[index]?.reject(new Error('read failed'))},openSearch(){openSearchPanel(EditorView.findFromDOM(document.querySelector('#a .sc-wb-git-compare section:nth-child(2) .cm-editor')))},clone(){state=structuredClone(state);for(const listener of listeners)listener()},conflictPath(file){workbench.panel({...state.panel,conflictFile:file,state:{...state.panel.state,gitConflicts:{...state.panel.state?.gitConflicts,[file]:{...conflict,path:file,text:'ready\\n'}}}})},retarget(){workbench.panel({...state.panel,id:'next-history',target:{path:'next.txt',start:2,end:3},text:'next\\n'})},dispose(){requests.forEach(request=>request.resolve());roots.forEach(root=>root.unmount())},state:()=>state};`;
const app = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser' });
const server = createServer((req, res) => { res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? app.outputFiles[0].contents : '<!doctype html><style>body{margin:0}#a,#b{min-height:450px}.cm-editor{height:120px}.sc-wb-results{height:220px;overflow:auto}</style><div id="a"></div><div id="b"></div><script type="module" src="/app.js"></script>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('共享工具的迟到读取不能覆盖另一视图的当前状态', { timeout: 30000 }, async t => {
    let page, errors;
    const open = async mode => { page = await browser.newPage(); page.setDefaultTimeout(3500); errors = []; page.on('pageerror', error => errors.push(error.message)); await page.goto('http://127.0.0.1:' + server.address().port + '/?mode=' + mode); };
    t.afterEach(async () => { await page.evaluate(() => window.test.dispose()); await page.close(); assert.deepEqual(errors, []); });
    const result = side => page.locator('#' + side + ' .sc-wb-conflict-columns > section:nth-child(2) .cm-content');
    const release = index => page.evaluate(index => window.test.release(index), index);
    const ready = side => page.waitForFunction(side => document.querySelector('#' + side + ' .sc-wb-conflict')?.getAttribute('aria-busy') === 'false', side);
    await t.test('另一个视图的初次冲突读取不能覆盖已编辑的解决草稿', async () => {
      await open('conflict'); await page.waitForFunction(() => window.test.count() === 2); await release(0); await ready('a');
      await page.locator('#a').getByRole('button', { name: 'gitAcceptAllOurs', exact: true }).click();
      assert.equal((await result('a').textContent()).trim(), 'ours');
      await release(1); await ready('b');
      assert.equal((await result('a').textContent()).trim(), 'ours');
      assert.equal((await result('b').textContent()).trim(), 'ours');
    });
    await t.test('重新读取期间另一视图的新编辑仍保留', async () => {
      await open('conflict'); await page.waitForFunction(() => window.test.count() === 2); await release(0); await release(1); await ready('a'); await ready('b');
      await page.locator('#a').getByRole('button', { name: 'gitAcceptAllOurs', exact: true }).click();
      await page.locator('#a').getByRole('button', { name: 'gitReloadConflict', exact: true }).click(); await page.waitForFunction(() => window.test.count() === 3);
      await page.locator('#b').getByRole('button', { name: 'gitAcceptAllTheirs', exact: true }).click();
      await release(2); await ready('a');
      assert.equal((await result('a').textContent()).trim(), 'theirs');
      assert.equal((await result('b').textContent()).trim(), 'theirs');
    });
    await t.test('没有新编辑时，用户主动重新读取仍可以替换旧草稿', async () => {
      await open('conflict'); await page.waitForFunction(() => window.test.count() === 2); await release(0); await release(1); await ready('a'); await ready('b');
      await page.locator('#a').getByRole('button', { name: 'gitAcceptAllOurs', exact: true }).click();
      await page.locator('#a').getByRole('button', { name: 'gitReloadConflict', exact: true }).click(); await page.waitForFunction(() => window.test.count() === 3);
      await page.evaluate(() => window.test.clone()); await release(2); await ready('a');
      assert.match(await result('a').textContent(), /<<<<<<< ours/);
      assert.match(await result('b').textContent(), /<<<<<<< ours/);
    });
    await t.test('保存冲突期间另一视图的新编辑不能被完成回调删除', async () => {
      await open('conflict'); await page.waitForFunction(() => window.test.count() === 2); await release(0); await release(1); await ready('a'); await ready('b');
      await page.locator('#a button[title=gitAcceptAllOurs]').click(); await page.locator('#a button[title=gitSaveResolution]').click(); await page.waitForFunction(() => window.test.count() === 3);
      assert.equal(await page.evaluate(() => window.test.input(2).text), 'ours\n');
      await page.locator('#b button[title=gitAcceptAllTheirs]').click(); await release(2); await ready('a');
      assert.equal(await page.evaluate(() => window.test.state().panel.state.gitConflicts['conflict.txt']?.text), 'theirs\n');
      assert.equal(await page.evaluate(() => window.test.closed()), 0);
      assert.equal(await page.locator('#a [role=alert]').textContent(), 'gitResolutionDraftKept');
    });
    for (const failure of [false, true]) await t.test(failure ? '冲突保存失败保留解决草稿和窗口' : '冲突草稿未改变时，保存后正常清理并关闭', async () => {
      await open('conflict'); await page.waitForFunction(() => window.test.count() === 2); await release(0); await release(1); await ready('a'); await ready('b');
      await page.locator('#a button[title=gitAcceptAllOurs]').click(); await page.locator('#a button[title=gitSaveResolution]').click(); await page.waitForFunction(() => window.test.count() === 3);
      await page.evaluate(() => window.test.clone());
      if (failure) await page.evaluate(() => window.test.fail(2)); else await release(2);
      await ready('a');
      assert.equal(await page.evaluate(() => window.test.state().panel.state.gitConflicts['conflict.txt']?.text), failure ? 'ours\n' : undefined);
      assert.equal(await page.evaluate(() => window.test.closed()), failure ? 0 : 1);
      assert.equal(await page.locator('#a [role=alert]').count(), failure ? 1 : 0);
    });
    await t.test('切换到已保存草稿的另一冲突文件时，不显示旧文件错误', async () => {
      await open('conflict'); await page.waitForFunction(() => window.test.count() === 2);
      await page.evaluate(() => window.test.fail(0)); await release(1); await ready('a'); await ready('b'); await page.locator('#a [role=alert]').waitFor();
      await page.evaluate(() => window.test.conflictPath('next.txt'));
      await page.locator('#a .sc-wb-conflict > header strong').getByText('next.txt', { exact: true }).waitFor();
      assert.equal(await page.locator('[role=alert]').count(), 0);
      assert.equal((await result('a').textContent()).trim(), 'ready');
    });
    await t.test('文件对比目标改变后，不重新显示另一个视图的旧结果', async () => {
      await open('compare'); const target = side => page.locator('#' + side).getByRole('textbox', { name: 'fileCompareTarget' });
      await target('a').fill('old.txt'); await page.locator('#a').getByRole('button', { name: 'fileCompare', exact: true }).click(); await page.waitForFunction(() => window.test.count() === 1);
      await target('b').fill('new.txt'); await release(0); await page.waitForFunction(() => !document.querySelector('#a button[type=submit]').disabled);
      assert.equal(await target('a').inputValue(), 'new.txt'); assert.equal(await page.locator('.sc-wb-git-diff').count(), 0);
      await page.locator('#b').getByRole('button', { name: 'fileCompare', exact: true }).click(); await page.waitForFunction(() => window.test.count() === 2); await release(1);
      await page.locator('#b .sc-wb-git-diff').waitFor(); assert.equal(await page.locator('.sc-wb-git-diff').count(), 2);
      assert.match(await page.locator('#a .sc-wb-git-diff').textContent(), /new\.txt/);
    });
    await t.test('旧文件对比失败不污染新目标，下一次对比仍可完成', async () => {
      await open('compare'); const target = side => page.locator('#' + side).getByRole('textbox', { name: 'fileCompareTarget' });
      await target('a').fill('old.txt'); await page.locator('#a').getByRole('button', { name: 'fileCompare', exact: true }).click(); await page.waitForFunction(() => window.test.count() === 1);
      await target('b').fill('new.txt'); await page.evaluate(() => window.test.fail(0)); await page.waitForFunction(() => !document.querySelector('#a button[type=submit]').disabled);
      assert.equal(await page.locator('[role=alert]').count(), 0);
      await page.locator('#a').getByRole('button', { name: 'fileCompare', exact: true }).click(); await page.waitForFunction(() => window.test.count() === 2); await release(1);
      await page.locator('#a .sc-wb-git-diff').waitFor(); assert.match(await page.locator('#a .sc-wb-git-diff').textContent(), /new\.txt/);
    });
    await t.test('另一视图打开新文件对比后，旧目标已经显示的错误应消失', async () => {
      await open('compare'); await page.locator('#a input').fill('old.txt'); await page.locator('#a button[type=submit]').click();
      await page.waitForFunction(() => window.test.count() === 1); await page.evaluate(() => window.test.fail(0)); await page.locator('#a [role=alert]').waitFor();
      await page.locator('#b input').fill('new.txt'); await page.locator('#b button[type=submit]').click(); await page.waitForFunction(() => window.test.count() === 2); await release(1);
      await page.locator('#b .sc-wb-git-diff').waitFor(); assert.equal(await page.locator('[role=alert]').count(), 0);
    });
    await t.test('两个视图对比相同文件时，先发出的旧快照不能覆盖后发的新结果', async () => {
      await open('compare'); await page.locator('#a input').fill('same.txt'); await page.locator('#a button[type=submit]').click(); await page.waitForFunction(() => window.test.count() === 1);
      await page.locator('#b button[type=submit]').click(); await page.waitForFunction(() => window.test.count() === 2); await release(1);
      await page.locator('#b .sc-wb-git-diff').waitFor(); assert.match(await page.locator('#b .sc-wb-git-diff').textContent(), /#1/);
      await release(0); await page.waitForFunction(() => !document.querySelector('#a button[type=submit]').disabled);
      assert.match(await page.locator('#a .sc-wb-git-diff').textContent(), /#1/);
    });
    const gitReady = () => page.waitForFunction(() => document.querySelector('#a .sc-wb-git').getAttribute('aria-busy') === 'false');
    const newDiff = async count => {
      await page.locator('#b button[title=git_changes]').click(); await page.locator('#b button[title="new.txt"]').click();
      await page.waitForFunction(count => window.test.count() === count, count); await release(count - 1);
      await page.locator('#b .sc-wb-git-diff > header strong').getByText('new.txt', { exact: true }).waitFor();
    };
    await t.test('内容相同的外窗快照保留差异编辑器中的搜索', async () => {
      await open('git'); await newDiff(1);
      await page.evaluate(() => window.test.openSearch());
      const search = page.locator('#a .cm-search input[name=search]');
      await search.fill('new.txt');
      await page.evaluate(async () => { window.test.clone(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      assert.equal(await search.count(), 1);
      assert.equal(await search.inputValue(), 'new.txt');
      await newDiff(2);
      await page.locator('#a .sc-wb-git-compare').getByText('new.txt #1', { exact: true }).waitFor();
      assert.equal(await search.count(), 0);
    });
    for (const action of ['diff', 'commitFiles', 'historyDiff']) await t.test(`Git ${action} 的迟到结果不改变另一视图的新选择`, async () => {
      await open('git');
      if (action !== 'diff') {
        await page.locator('#a button[title=git_history]').click(); await page.locator('#a button[title=commit-a]').click();
        await page.waitForFunction(() => window.test.count() === 1);
        if (action === 'historyDiff') {
          await release(0); await page.locator('#a .sc-wb-git-history-file[title="old.txt"]').click();
          await page.waitForFunction(() => window.test.count() === 2);
        }
      } else { await page.locator('#a button[title="old.txt"]').click(); await page.waitForFunction(() => window.test.count() === 1); }
      const pending = action === 'historyDiff' ? 1 : 0;
      await newDiff(pending + 2); await release(pending); await gitReady();
      assert.equal(await page.locator('#b .sc-wb-git-diff > header strong').textContent(), 'new.txt');
      assert.equal(await page.evaluate(() => window.test.state().panel.state.gitSelected), 'worktree:new.txt');
    });
    await t.test('Git 旧选择读取失败不覆盖新选择，也不显示过期错误', async () => {
      await open('git'); await page.locator('#a button[title="old.txt"]').click(); await page.waitForFunction(() => window.test.count() === 1);
      await newDiff(2); await page.evaluate(() => window.test.fail(0)); await gitReady();
      assert.equal(await page.locator('#a .sc-wb-git-diff > header strong').textContent(), 'new.txt'); assert.equal(await page.locator('[role=alert]').count(), 0);
    });
    await t.test('另一视图打开新Git差异后，旧文件已经显示的读取错误应消失', async () => {
      await open('git'); await page.locator('#a button[title="old.txt"]').click(); await page.waitForFunction(() => window.test.count() === 1);
      await page.evaluate(() => window.test.fail(0)); await page.locator('#a [role=alert]').waitFor(); await newDiff(2);
      assert.equal(await page.locator('[role=alert]').count(), 0);
    });
    for (const action of ['diff', 'commitFiles', 'historyDiff']) await t.test(`两个视图读取相同 Git ${action} 时仍以较新请求为准`, async () => {
      await open('git');
      if (action !== 'diff') {
        await page.locator('#a button[title=git_history]').click(); await page.locator('#a button[title=commit-a]').click(); await page.waitForFunction(() => window.test.count() === 1);
        if (action === 'historyDiff') { await release(0); await page.locator('#b .sc-wb-git-history-file[title="old.txt"]').waitFor(); }
      }
      if (action === 'diff') await page.locator('#a button[title="old.txt"]').click();
      if (action === 'historyDiff') await page.locator('#a .sc-wb-git-history-file[title="old.txt"]').click();
      const first = action === 'historyDiff' ? 1 : 0;
      await page.waitForFunction(count => window.test.count() === count, first + 1);
      const selector = action === 'commitFiles' ? 'button[title=commit-a]' : action === 'diff' ? 'button[title="old.txt"]' : '.sc-wb-git-history-file[title="old.txt"]';
      await page.locator('#b ' + selector).click(); await page.waitForFunction(count => window.test.count() === count, first + 2); await release(first + 1);
      if (action === 'commitFiles') await page.waitForFunction(() => window.test.state().panel.state.gitCommit?.revision === 1);
      else { await page.locator('#b .sc-wb-git-diff').waitFor(); assert.match(await page.locator('#b .sc-wb-git-diff').textContent(), new RegExp('#' + (first + 1))); }
      await release(first); await gitReady();
      if (action === 'commitFiles') assert.equal(await page.evaluate(() => window.test.state().panel.state.gitCommit.revision), 1);
      else assert.match(await page.locator('#a .sc-wb-git-diff').textContent(), new RegExp('#' + (first + 1)));
    });
    await t.test('当前提交的文件列表在两个视图中一致，仍能打开提交差异', async () => {
      await open('git'); await page.locator('#a button[title=git_history]').click(); await page.locator('#a button[title=commit-a]').click();
      await page.waitForFunction(() => window.test.count() === 1); await release(0); await page.locator('#b .sc-wb-git-history-file[title="old.txt"]').waitFor();
      await page.locator('#b .sc-wb-git-history-file[title="old.txt"]').click(); await page.waitForFunction(() => window.test.count() === 2); await release(1);
      await page.locator('#b .sc-wb-git-diff').waitFor(); assert.equal(await page.locator('#b .sc-wb-git-diff > header strong').textContent(), 'old.txt');
    });
    await t.test('提交完成不能清空另一视图在提交期间填写的新说明', async () => {
      await open('git'); const summary = side => page.locator('#' + side + ' textarea[aria-label=gitCommitMessage]');
      await summary('a').fill('first change'); await page.locator('#a button[title=gitCommit]').click(); await page.locator('#a .sc-wb-git-confirm-actions button[title=gitConfirm]').click();
      await page.waitForFunction(() => window.test.count() === 1); assert.equal(await page.evaluate(() => window.test.input(0).message), 'first change');
      await summary('b').fill('next change'); await release(0); await gitReady();
      assert.equal(await summary('a').inputValue(), 'next change'); assert.equal(await summary('b').inputValue(), 'next change');
    });
    for (const failure of [false, true]) await t.test(failure ? '提交失败仍保留原提交说明' : '未修改的提交说明在成功后正常清空', async () => {
      await open('git'); const summary = side => page.locator('#' + side + ' textarea[aria-label=gitCommitMessage]');
      await summary('a').fill('first change'); await page.locator('#a button[title=gitCommit]').click(); await page.locator('#a .sc-wb-git-confirm-actions button[title=gitConfirm]').click();
      await page.waitForFunction(() => window.test.count() === 1);
      if (failure) await page.evaluate(() => window.test.fail(0)); else await release(0);
      await gitReady();
      assert.equal(await summary('a').inputValue(), failure ? 'first change' : ''); assert.equal(await summary('b').inputValue(), failure ? 'first change' : '');
      assert.equal(await page.locator('#a [role=alert]').count(), failure ? 1 : 0);
    });
    await t.test('暂存完成不能清空另一视图后来选择的文件差异', async () => {
      await open('git'); await page.locator('#a .sc-wb-git-file:has(button[title="old.txt"]) button[title=gitStage]').click();
      await page.waitForFunction(() => window.test.count() === 1); await newDiff(2); await release(0); await gitReady();
      assert.equal(await page.locator('#b .sc-wb-git-diff > header strong').textContent(), 'new.txt');
      assert.equal(await page.evaluate(() => window.test.state().panel.state.gitSelected), 'worktree:new.txt');
    });
    await t.test('提交完成清理原说明，但保留另一视图后来选择的文件差异', async () => {
      await open('git'); await page.locator('#a textarea[aria-label=gitCommitMessage]').fill('first change');
      await page.locator('#a button[title=gitCommit]').click(); await page.locator('#a .sc-wb-git-confirm-actions button[title=gitConfirm]').click();
      await page.waitForFunction(() => window.test.count() === 1); await newDiff(2); await release(0); await gitReady();
      assert.equal(await page.locator('#b .sc-wb-git-diff > header strong').textContent(), 'new.txt');
      assert.equal(await page.locator('#b textarea[aria-label=gitCommitMessage]').inputValue(), '');
    });
    await t.test('按段还原后的再次读取，不能覆盖另一视图较新的文件差异', async () => {
      await open('git'); await page.locator('#a button[title="old.txt"]').click(); await page.waitForFunction(() => window.test.count() === 1); await release(0);
      await page.locator('#a button[title=gitRestoreHunk]').click(); await page.waitForFunction(() => window.test.count() === 2); await release(1);
      await page.waitForFunction(() => window.test.count() === 3); await newDiff(4); await release(2); await gitReady();
      assert.equal(await page.locator('#a .sc-wb-git-diff > header strong').textContent(), 'new.txt');
    });
    await t.test('Git写入失败仍显示错误，并保留另一视图较新的差异', async () => {
      await open('git'); await page.locator('#a .sc-wb-git-file:has(button[title="old.txt"]) button[title=gitStage]').click();
      await page.waitForFunction(() => window.test.count() === 1); await newDiff(2); await page.evaluate(() => window.test.fail(0)); await gitReady();
      assert.equal(await page.locator('#a .sc-wb-git-diff > header strong').textContent(), 'new.txt');
      assert.equal(await page.locator('#a [role=alert]').count(), 1);
    });
    await t.test('切分支完成后即使视图已换选择，仍刷新实际工作文件', async () => {
      await open('git'); await page.locator('#a button[title=git_branches]').click(); await page.locator('#a button[title=gitCheckout]:enabled').click();
      await page.locator('#a .sc-wb-git-confirm-actions button[title=gitConfirm]').click(); await page.waitForFunction(() => window.test.count() === 1);
      await newDiff(2); await release(0); await gitReady();
      assert.equal(await page.evaluate(() => window.test.refreshed()), 1);
      assert.equal(await page.locator('#a .sc-wb-git-diff > header strong').textContent(), 'new.txt');
    });
    await t.test('函数历史收到内容相同的外窗快照时，不重新查询或清空列表', async () => {
      await open('history'); await page.waitForFunction(() => window.test.count() === 2); await release(0); await release(1);
      await page.locator('#a button[title=history-entry]').waitFor(); await page.locator('#b button[title=history-entry]').waitFor();
      await page.evaluate(async () => { window.test.clone(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      assert.equal(await page.evaluate(() => window.test.count()), 2);
      assert.equal(await page.locator('button[title=history-entry]').count(), 2);
    });
    await t.test('新函数历史面板仍发起新查询，并忽略旧面板迟到结果', async () => {
      await open('history'); await page.waitForFunction(() => window.test.count() === 2);
      await page.evaluate(() => window.test.retarget()); await page.waitForFunction(() => window.test.count() === 4);
      assert.equal(await page.evaluate(() => window.test.input(2).target.path), 'next.txt');
      await release(2); await release(3); await page.locator('#b button[title=history-entry]').waitFor();
      await release(0); await release(1);
      assert.match(await page.locator('#a .sc-wb-git-toolbar').textContent(), /next\.txt/);
      assert.equal(await page.locator('button[title=history-entry]').count(), 2);
    });
    const searchField = side => page.locator('#' + side).getByRole('combobox', { name: 'search', exact: true });
    const searched = side => page.locator('#' + side + ' .sc-wb-search-actions').getByText('650 searchMatches', { exact: true }).waitFor();
    const resultList = side => page.locator('#' + side).getByRole('listbox', { name: 'locationResults' });
    const chosen = side => page.locator('#' + side + ' .sc-wb-results [aria-selected=true]');
    const readySearch = async () => {
      await open('search'); await searchField('a').fill('needle'); await page.waitForFunction(() => window.test.count() === 2);
      await release(0); await release(1); await searched('a'); await searched('b');
    };
    await t.test('搜索结果支持方向键选择和回车定位，两个视图的候选互不覆盖', async () => {
      await readySearch();
      await searchField('a').press('ArrowDown');
      await chosen('a').waitFor(); assert.equal(await chosen('a').getAttribute('title'), 'needle.txt:2');
      assert.equal(await chosen('b').getAttribute('title'), 'needle.txt:1');
      assert.equal(await page.evaluate(() => window.test.visited.length), 0);
      await searchField('a').press('Enter');
      assert.equal(await page.evaluate(() => window.test.visited.at(-1).line), 1);
      assert.equal(await page.evaluate(() => window.test.visited.at(-1).character), 1);
    });
    await t.test('键盘可到650项结果的首尾，保持虚拟滚动和有效的可访问候选', async () => {
      await readySearch(); await resultList('a').focus(); await resultList('a').press('End');
      await page.locator('#a [aria-selected=true][aria-posinset="650"]').waitFor();
      assert(await page.locator('#a .sc-wb-results button').count() < 30);
      assert.equal(await chosen('a').getAttribute('aria-setsize'), '650');
      await resultList('a').press('ArrowDown'); await resultList('a').press('Enter');
      assert.equal(await page.evaluate(() => window.test.visited.at(-1).line), 649);
      await page.locator('#a .sc-wb-results').evaluate(node => { node.scrollTop = 0; });
      await page.waitForFunction(() => !document.querySelector('#a input').hasAttribute('aria-activedescendant'));
      assert.equal(await resultList('a').getAttribute('aria-activedescendant'), null);
      await searchField('a').press('ArrowUp'); await page.locator('#a [aria-selected=true][aria-posinset="649"]').waitFor();
      assert.equal(await searchField('a').evaluate(node => document.getElementById(node.getAttribute('aria-activedescendant'))?.getAttribute('aria-posinset')), '649');
      await resultList('a').focus(); await resultList('a').press('Home'); await page.locator('#a [aria-selected=true][aria-posinset="1"]').waitFor();
      await resultList('a').press('ArrowUp'); assert.equal(await chosen('a').getAttribute('title'), 'needle.txt:1');
    });
    await t.test('查询改变、加载、失败或空结果时，回车不能误跳旧候选', async () => {
      await readySearch(); await resultList('a').focus(); await resultList('a').press('End');
      await searchField('b').fill('interrupted'); await searchField('a').press('Enter');
      assert.equal(await chosen('a').count(), 0); assert.equal(await page.evaluate(() => window.test.visited.length), 0);
      await page.waitForFunction(() => window.test.count() === 4); await release(2); await release(3); await page.locator('#a [role=alert]').waitFor();
      await searchField('a').press('Enter'); assert.equal(await page.evaluate(() => window.test.visited.length), 0);
      await searchField('a').fill('empty'); await page.waitForFunction(() => window.test.count() === 6); await release(4); await release(5);
      await page.locator('#a').getByText('noResults', { exact: true }).waitFor(); await searchField('a').press('ArrowDown'); await searchField('a').press('Enter');
      assert.equal(await chosen('a').count(), 0); assert.equal(await page.evaluate(() => window.test.visited.length), 0);
      await searchField('b').fill('retry'); await page.waitForFunction(() => window.test.count() === 8); await release(6); await release(7); await searched('a');
      assert.equal(await chosen('a').getAttribute('title'), 'retry.txt:1'); await searchField('a').press('Enter');
      assert.equal(await page.evaluate(() => window.test.visited.at(-1).file), 'retry.txt');
    });
    await t.test('输入法、修饰键和输入框Home/End不被结果导航接管，清空后保留输入焦点', async () => {
      await readySearch();
      for (const init of [{ key: 'Enter', isComposing: true }, { key: 'ArrowDown', isComposing: true }, { key: 'ArrowDown', shiftKey: true }, { key: 'ArrowUp', ctrlKey: true }, { key: 'Enter', altKey: true }, { key: 'Enter', metaKey: true }, { key: 'Home' }, { key: 'End' }]) {
        assert.equal(await searchField('a').evaluate((node, init) => !node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })), init), false);
      }
      assert.equal(await chosen('a').getAttribute('title'), 'needle.txt:1'); assert.equal(await page.evaluate(() => window.test.visited.length), 0);
      await page.locator('#a').getByRole('button', { name: 'clearFileSearch', exact: true }).press('Enter');
      assert.equal(await searchField('a').inputValue(), ''); assert.equal(await searchField('a').evaluate(node => node === document.activeElement), true);
      assert.equal(await chosen('a').count(), 0);
    });
    for (const mode of ['definitions', 'usages']) await t.test(mode+'支持键盘候选，点击和回车跳转后关闭面板', async () => {
      await open(mode); await resultList('a').focus(); await resultList('a').press('ArrowDown');
      assert.equal(await chosen('a').getAttribute('title'), 'source.ts:2'); assert.equal(await chosen('b').getAttribute('title'), 'source.ts:1');
      await page.evaluate(() => window.test.clone());
      assert.equal(await chosen('a').getAttribute('title'), 'source.ts:2');
      await page.locator('#a button[title="source.ts:4"]').click();
      await page.waitForFunction(()=>window.test.state().panel===null);
      assert.equal(await page.evaluate(()=>window.test.visited.at(-1).line),3);
      await page.evaluate(() => window.test.retargetLocations([{file:'next.ts',line:8,character:3,name:'next'}]));
      await resultList('a').focus();await resultList('a').press('Enter');
      await page.waitForFunction(()=>window.test.state().panel===null);
      assert.equal(await page.evaluate(()=>window.test.visited.at(-1).file),'next.ts');
    });
    await t.test('全局搜索使用项目文本流，650处结果可滚动定位且清空不再发请求', async () => {
      await open('search'); await searchField('a').fill('needle'); await page.waitForFunction(() => window.test.count() === 2);
      assert.equal(await page.evaluate(() => window.test.input(0).locations), true); await release(0); await release(1); await searched('a'); await searched('b');
      assert(await page.locator('#a .sc-wb-results button').count() < 30);
      await page.locator('#a .sc-wb-results').evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.locator('#a button[title="needle.txt:650"]').click();
      assert.equal(await page.evaluate(() => window.test.visited.at(-1).line), 649); assert.equal(await page.evaluate(() => window.test.visited.at(-1).character), 1);
      await searchField('b').fill(''); await page.waitForTimeout(250);
      assert.equal(await page.locator('.sc-wb-results button').count(), 0); assert.equal(await page.evaluate(() => window.test.count()), 2); assert.equal(await page.locator('[role=alert]').count(), 0);
    });
    await t.test('跨视图改查询后，旧搜索结果或失败均不能覆盖新查询', async () => {
      await open('search'); await searchField('a').fill('old'); await page.waitForFunction(() => window.test.count() === 2);
      await searchField('b').fill('new'); await page.waitForFunction(() => window.test.count() === 4);
      await release(2); await release(3); await searched('a'); await searched('b');
      await release(0); await page.evaluate(() => window.test.fail(1)); await page.waitForTimeout(50);
      assert.equal(await searchField('a').inputValue(), 'new'); assert.equal(await page.locator('[role=alert]').count(), 0);
      assert.equal(await page.locator('button[title^="old.txt:"]').count(), 0); assert(await page.locator('button[title^="new.txt:"]').count() > 0);
    });
    await t.test('搜索失败保留错误，修改查询后可重试，未完整结束不展示成功结果', async () => {
      await open('search'); await searchField('a').fill('interrupted'); await page.waitForFunction(() => window.test.count() === 2);
      await release(0); await release(1); await page.locator('#a [role=alert]').waitFor(); await page.locator('#b [role=alert]').waitFor();
      assert.equal(await page.locator('.sc-wb-results button').count(), 0);
      await searchField('b').fill('retry'); await page.waitForFunction(() => window.test.count() === 4);
      await release(2); await release(3); await searched('a'); await searched('b');
      assert.equal(await page.locator('[role=alert]').count(), 0);
    });
  });
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
