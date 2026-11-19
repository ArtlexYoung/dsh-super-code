import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = `import {createWorkbench} from './builtin/workbench/controller.js';
import{createWindowProxy}from'./builtin/workbench/windows/proxy.js';import{ChangeSet}from'@codemirror/state';
let text='0123456789',version='v1',root='/demo',blocked,release,releaseLanguage,proxy,fileWait,releaseFile;const projects=new Map(),reads=[],sent=[],saves=[];
const api={fileOperation:async input=>{if(input.action==='createDirectory'){window.test.fileWaiting=true;await fileWait;return{path:input.path,token:'new-directory'}}return{path:root}},list:async()=>({entries:[],truncated:false}),project:async()=>({files:[],truncated:false}),async read(path){reads.push(path);if(path==='slow.ts')await blocked;return{path,text:path==='a.ts'?text:'second',version}},async save(input){saves.push(input.text);return{...input,version:'saved'}}};
const a=createWorkbench(api,key=>key,{projects}),b=createWorkbench(api,key=>key,{projects});
window.test={a,b,projects,reads,sent,saves,root(value){root=value},holdFile(){fileWait=new Promise(resolve=>{releaseFile=resolve})},releaseFile(){releaseFile()},async ready(){await a.attach(document.querySelector('#a'),document.body);await b.attach(document.querySelector('#b'),document.body)},async proxy(){proxy=createWindowProxy(async value=>{sent.push(value)},key=>key);await proxy.accept({kind:'state',patch:{snapshot:{file:'first.txt',preferences:a.snapshot().preferences},editor:{file:'first.txt',text:'first',version:0}}});return proxy},remoteEdit(){return proxy.accept({kind:'edit',file:'first.txt',version:1,changes:ChangeSet.of({from:5,insert:' from host'},5).toJSON(),selection:{ranges:[{anchor:10,head:10}],main:0},ack:null,readOnly:false})},external(value){text=value;version='v2'},hold(){blocked=new Promise(resolve=>{release=resolve})},release(){release()},holdLanguage(file){const pending=new Promise(resolve=>{releaseLanguage=resolve});window.waitLanguage=path=>path===file?(window.test.languageWaiting=true,pending):undefined},releaseLanguage(){window.waitLanguage=undefined;releaseLanguage()},dispose(){proxy?.dispose();a.dispose();b.dispose();for(const project of projects.values())project.dispose()}};`;
const app = await build({ stdin: { contents: fixture, loader: 'js', resolveDir: repo }, bundle: true, write: false, format: 'esm', platform: 'browser', plugins: [{ name: 'language-loading-delay', setup(build) {
  build.onLoad({ filter: /editor\/view\.js$/ }, async ({ path }) => {
    const contents = await readFile(path, 'utf8'), start = 'const language = await loadLanguage(file);';
    assert.ok(contents.includes(start));
    return { contents: contents.replace(start, `${start} await window.waitLanguage?.(file);`), loader: 'js' };
  });
} }] });
const server = createServer((req, res) => { res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? app.outputFiles[0].contents : '<!doctype html><div id="a"></div><div id="b"></div><script type="module" src="/app.js"></script>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (process.env.SC_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.SC_TEST_EXECUTABLE ? { executablePath: process.env.SC_TEST_EXECUTABLE } : {}) });
try {
  await test('真实编辑器的文件切换、多视图状态和网页兼容', { timeout: 30000 }, async t => {
    let page, errors;
    t.beforeEach(async () => {
      page = await browser.newPage(); errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => !!window.test); await page.evaluate(() => window.test.ready());
    });
    t.afterEach(async () => { await page.evaluate(() => window.test.dispose()); await page.close(); assert.deepEqual(errors, []); });
    await t.test('同文件光标位置形成可前进后退的历史，拖选和输入不制造逐字历史', async () => {
      const state=await page.evaluate(async()=>{
        const {a}=window.test;await a.visit({file:'a.ts'});
        a.view().dispatch({selection:{anchor:2},userEvent:'select.pointer'});
        a.view().dispatch({selection:{anchor:2,head:5},userEvent:'select.pointer'});
        a.view().dispatch({selection:{anchor:8},userEvent:'select.pointer'});
        await a.move(-1);const back=a.view().state.selection.main;
        await a.move(1);const forward=a.view().state.selection.main.head;
        a.view().dispatch({changes:{from:8,insert:'x'},selection:{anchor:9},userEvent:'input.type'});
        await a.move(-1);const afterTyping=a.view().state.selection.main;
        a.view().dispatch({selection:{anchor:6},userEvent:'select.pointer'});
        return{file:a.snapshot().file,back:[back.from,back.to],forward,afterTyping:[afterTyping.from,afterTyping.to],forwardAfterBranch:a.snapshot().forward};
      });
      assert.deepEqual(state,{file:'a.ts',back:[2,5],forward:8,afterTyping:[2,5],forwardAfterBranch:false});
    });
    await t.test('在历史位置前插入新行后，后退仍定位原代码字符', async () => {
      const state=await page.evaluate(async()=>{
        const{a}=window.test;await a.visit({file:'a.ts'});
        a.view().dispatch({selection:{anchor:2}});a.view().dispatch({selection:{anchor:8}});
        a.view().dispatch({changes:{from:0,insert:'\n\n'},userEvent:'input.type'});
        await a.move(-1);const view=a.view(),head=view.state.selection.main.head,line=view.state.doc.lineAt(head);
        return{head,line:line.number,column:head-line.from,text:line.text};
      });
      assert.deepEqual(state,{head:4,line:3,column:2,text:'0123456789'});
    });
    await t.test('跨视图切回文件保留各自选区', async () => {
      const head = await page.evaluate(async () => { const {a,b}=window.test;for(const c of [a,b]){await c.visit({file:'a.ts'});c.keepTab('a.ts')}a.view().dispatch({selection:{anchor:2}});b.view().dispatch({selection:{anchor:7}});await a.visit({file:'b.ts'});await b.visit({file:'b.ts'});await a.visit({file:'a.ts'});return a.view().state.selection.main.head; });
      assert.equal(head, 2);
    });
    await t.test('切回干净标签立即显示外部新内容', async () => {
      const text = await page.evaluate(async () => { const {a}=window.test;await a.visit({file:'a.ts'});a.keepTab('a.ts');await a.visit({file:'b.ts'});window.test.external('new external content');await a.visit({file:'a.ts'});return a.view().state.doc.toString(); });
      assert.equal(text, 'new external content');
    });
    await t.test('旧读取未结束时新文件仍可打开，晚到结果不覆盖', async () => {
      const state = await page.evaluate(async () => { const {a}=window.test;window.test.hold();const slow=a.visit({file:'slow.ts'});await new Promise(resolve=>setTimeout(resolve,0));let before;try{await Promise.race([a.visit({file:'a.ts'}),new Promise((_resolve,reject)=>setTimeout(()=>reject(new Error('新导航被旧读取阻塞')),2000))]);before=a.snapshot().file}finally{window.test.release();await slow}return{before,after:a.snapshot().file}; });
      assert.deepEqual(state, { before: 'a.ts', after: 'a.ts' });
    });
    await t.test('缺少randomUUID时仍可创建工具面板和选区对话', async () => {
      const state = await page.evaluate(async () => { Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true});const{a}=window.test;a.panel({kind:'git'});await a.visit({file:'a.ts'});a.view().dispatch({selection:{anchor:0,head:3}});a.assistant.select();return{panel:a.snapshot().panel.kind,thread:!!a.snapshot().assistant.thread?.id}; });
      assert.deepEqual(state, { panel: 'git', thread: true });
    });
    await t.test('真实编辑器连续预览释放无状态缓冲，其他视图仍可编辑共享文件', async () => {
      const state = await page.evaluate(async () => {
        const { a,b,projects,reads }=window.test;
        await a.visit({file:'shared.txt'});await b.visit({file:'shared.txt'});
        for(let i=0;i<40;i++)await a.visit({file:'preview-'+i+'.txt'});
        const before={local:a.documents.size,project:projects.get('/demo').documents.size,tabs:a.snapshot().tabs.length};
        b.view().dispatch({changes:{from:0,insert:'peer '}});
        await a.visit({file:'shared.txt'});
        return {before,text:a.view().state.doc.toString(),shared:a.documents.get('shared.txt')===b.documents.get('shared.txt')};
      });
      assert.deepEqual(state,{before:{local:1,project:2,tabs:1},text:'peer second',shared:true});
    });
    await t.test('连续选区提问未输入时不残留隐藏对话及干净预览缓冲', async () => {
      const state=await page.evaluate(async()=>{
        const{a,projects}=window.test;
        for(let i=0;i<40;i++){await a.visit({file:'draft-'+i+'.txt'});a.view().dispatch({selection:{anchor:0,head:2}});a.assistant.select()}
        await a.visit({file:'last.txt'});
        const project=projects.get('/demo');
        return{threads:[...project.conversations.files.values()].flat().length,buffers:project.documents.size,local:a.documents.size,rows:a.snapshot().assistant.conversations.length};
      });
      assert.deepEqual(state,{threads:0,buffers:1,local:1,rows:0});
    });
    await t.test('真实定时器触发的自动保存等待文件操作，再保存共享编辑', async () => {
      const state=await page.evaluate(async()=>{
        const{a,saves}=window.test;await a.visit({file:'a.ts'});
        a.settings({...a.snapshot().preferences,autoSave:'immediate'});
        a.view().dispatch({changes:{from:0,insert:'edited '}});
        window.test.holdFile();const operation=a.fileOperation({action:'createDirectory',path:'new-folder'});
        let before;
        try{await new Promise(resolve=>setTimeout(resolve,20));before={writes:saves.length,error:a.snapshot().error,waiting:window.test.fileWaiting}}
        finally{window.test.releaseFile();await operation}
        await new Promise(resolve=>setTimeout(resolve,0));
        return{before,saves,dirty:a.documents.get('a.ts').dirty};
      });
      assert.deepEqual(state,{before:{writes:0,error:'',waiting:true},saves:['edited 0123456789'],dirty:false});
    });
    await t.test('真实编辑器切换项目后不执行旧项目排队的保存', async () => {
      const state=await page.evaluate(async()=>{
        const{a,projects,saves}=window.test;await a.visit({file:'a.ts'});a.view().dispatch({changes:{from:0,insert:'first '}});
        let release,started;const begun=new Promise(resolve=>{started=resolve});
        const lock=projects.get('/demo').exclusive(async()=>{started();await new Promise(resolve=>{release=resolve})});await begun;
        const saving=a.save().then(()=>null,error=>error.message);
        try{window.test.root('/second');a.detach();await a.attach(document.querySelector('#a'),document.body);await a.visit({file:'a.ts'});a.view().dispatch({changes:{from:0,insert:'second '}})}
        finally{release();await lock}
        return{failure:await saving,saves,old:projects.get('/demo').documents.get('a.ts').text,current:a.view().state.doc.toString(),dirty:a.documents.get('a.ts').dirty};
      });
      assert.deepEqual(state,{failure:'WORKBENCH_PROJECT_CHANGED',saves:[],old:'first 0123456789',current:'second 0123456789',dirty:true});
    });
    await t.test('真实键盘后退与前进可以打断未完成的文件读取', async () => {
      await page.evaluate(async()=>{const{a}=window.test;await a.visit({file:'a.ts',character:3});await a.visit({file:'b.ts'});window.test.hold();window.test.slow=a.visit({file:'slow.ts'})});
      await page.waitForFunction(()=>window.test.a.snapshot().status==='loading');
      await page.locator('#a .cm-content').press('Alt+ArrowLeft');
      try {
        await page.waitForFunction(()=>window.test.a.snapshot().file==='a.ts');
        assert.equal(await page.evaluate(()=>window.test.a.view().state.selection.main.head),3);
        await page.locator('#a .cm-content').press('Alt+ArrowRight');
        await page.waitForFunction(()=>window.test.a.snapshot().file==='b.ts');
      } finally {await page.evaluate(async()=>{window.test.release();await window.test.slow})}
      assert.equal(await page.evaluate(()=>window.test.a.snapshot().file),'b.ts');
    });
    for (const removed of ['other.ts', 'slow.ts']) await t.test(`真实编辑器在另一视图回收${removed}时保留正确导航和状态`, async () => {
      await page.evaluate(async () => { const { a } = window.test; await a.visit({ file: 'a.ts' }); a.keepTab('a.ts'); window.test.hold(); window.test.slow = a.visit({ file: 'slow.ts' }); });
      await page.waitForFunction(() => window.test.reads.includes('slow.ts'));
      const state = await page.evaluate(async removed => {
        const { a, b } = window.test;
        try { await b.fileOperation({ action: 'trash', path: removed }); }
        finally { window.test.release(); await window.test.slow; }
        return { file: a.snapshot().file, status: a.snapshot().status, text: a.view().state.doc.toString(), error: a.snapshot().error };
      }, removed);
      assert.deepEqual(state, { file: removed === 'slow.ts' ? 'a.ts' : 'slow.ts', status: 'saved', text: removed === 'slow.ts' ? '0123456789' : 'second', error: '' });
    });
    for (const removed of ['a.ts', 'slow.ts']) await t.test(`真实编辑器回收历史文件${removed}后快捷键遵守更新后的导航状态`, async () => {
      const state = await page.evaluate(async removed => {
        const { a, b } = window.test;
        for (const file of ['a.ts', 'b.ts', 'slow.ts']) { await a.visit({ file }); a.keepTab(file); }
        await a.move(-1); await b.fileOperation({ action: 'trash', path: removed });
        return { back: a.snapshot().back, forward: a.snapshot().forward };
      }, removed);
      assert.deepEqual(state, { back: removed !== 'a.ts', forward: removed !== 'slow.ts' });
      await page.locator('#a .cm-content').press(removed === 'a.ts' ? 'Alt+ArrowRight' : 'Alt+ArrowLeft');
      await page.waitForFunction(file => window.test.a.snapshot().file === file, removed === 'a.ts' ? 'slow.ts' : 'a.ts');
    });
    await t.test('语言组件延迟时，新导航不阻塞且晚到状态不能创建旧标签', async () => {
      await page.evaluate(()=>{const {a}=window.test;window.test.holdLanguage('delayed.txt');window.test.opening=a.visit({file:'delayed.txt'})});
      await page.waitForFunction(()=>window.test.languageWaiting);
      try {
        await page.evaluate(()=>window.test.a.visit({file:'a.ts'}));
        assert.equal(await page.evaluate(()=>window.test.a.snapshot().file),'a.ts');
      } finally {await page.evaluate(async()=>{window.test.releaseLanguage();await window.test.opening})}
      assert.equal(await page.evaluate(()=>window.test.a.documents.has('delayed.txt')),false);
    });
    await t.test('语言组件延迟期间保留其他视图的新文本和新选区对话', async () => {
      await page.evaluate(async()=>{const {a,b}=window.test;await b.visit({file:'shared.txt'});window.test.holdLanguage('shared.txt');window.test.opening=a.visit({file:'shared.txt'})});
      await page.waitForFunction(()=>window.test.languageWaiting);
      const state=await page.evaluate(async()=>{
        const {a,b}=window.test;b.view().dispatch({changes:{from:6,insert:' from peer'}});
        b.view().dispatch({selection:{anchor:7,head:16}});b.assistant.select();b.assistant.draft('保留选区问题');b.assistant.pin();
        window.test.releaseLanguage();await window.test.opening;
        return {a:a.view().state.doc.toString(),b:b.view().state.doc.toString(),dirty:a.documents.get('shared.txt').dirty,marks:a.assistant.threads('shared.txt').length};
      });
      assert.deepEqual(state,{a:'second from peer',b:'second from peer',dirty:true,marks:1});
    });
    for(const beforeAttach of [true,false]) await t.test(`真实独立窗口在${beforeAttach?'挂载前':'语言加载中'}收到的修改与版本完整接续`,async()=>{
      await page.evaluate(async before=>{
        window.peer=await window.test.proxy();window.test.holdLanguage('first.txt');
        if(before)await window.test.remoteEdit();
        window.attaching=window.peer.attach(document.body.appendChild(document.createElement('div')),document.body);
      },beforeAttach);
      await page.waitForFunction(()=>window.test.languageWaiting);
      const state=await page.evaluate(async before=>{
        if(!before)await window.test.remoteEdit();window.test.releaseLanguage();await window.attaching;
        const view=window.peer.view(),text=view.state.doc.toString(),head=view.state.selection.main.head;
        view.dispatch({changes:{from:0,insert:'local '}});await new Promise(resolve=>setTimeout(resolve,0));
        return {text,head,version:window.test.sent.find(value=>value.method==='edit')?.args[0].version};
      },beforeAttach);
      assert.deepEqual(state,{text:'first from host',head:10,version:1});
    });
    await t.test('保活的编辑器重新挂载后继续遵守项目只读锁',async()=>{
      const state=await page.evaluate(async()=>{
        const {a,projects}=window.test;await a.visit({file:'a.ts'});
        let release;const pending=new Promise(resolve=>{release=resolve}),project=projects.get('/demo'),locking=project.exclusive(()=>pending);
        await new Promise(resolve=>setTimeout(resolve,0));a.keepAlive(true);
        try {await a.attach(document.body.appendChild(document.createElement('div')),document.body);return a.view().state.readOnly}
        finally{release();await locking;a.keepAlive(false)}
      });
      assert.equal(state,true);
    });
    await t.test('文件内搜索框的撤销属于搜索文字，不撤回文件代码', async () => {
      await page.evaluate(async () => {
        const { a } = window.test; await a.visit({ file: 'a.ts' });
        a.view().dispatch({ changes: { from: 0, insert: 'keep ' }, userEvent: 'input.type' });
      });
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.locator('#a .cm-content').press(`${modifier}+f`);
      const query = page.locator('#a .cm-search input[name=search]');
      await query.fill(''); await query.pressSequentially('needle');
      await query.press(`${modifier}+z`);
      assert.equal(await page.evaluate(() => window.test.a.view().state.doc.toString()), 'keep 0123456789');
      assert.notEqual(await query.inputValue(), 'needle');
    });
  });
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
