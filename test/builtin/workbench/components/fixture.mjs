export const fixture = `import React from 'react';import{createRoot}from'react-dom/client';
import{createDraftStore}from'./builtin/workbench/draft-store.js';
import{createStudyStore}from'./builtin/workbench/study-store.js';
import{createWorkspaceSession}from'./builtin/workbench/session.js';
import{searchMatches,locationBatches,searchPathFilter,searchText}from'./src/workbench/search-query.ts';
import{Workbench}from'./builtin/workbench/components/Workbench.jsx';import{createWorkbench}from'./builtin/workbench/controller.js';
import{SafeMarkdown}from'./builtin/workbench/windows/markdown.jsx';import{zh,en}from'./builtin/workbench/locales.js';import css from'./builtin/workbench/style.css';import fontStyles from './builtin/workbench/fonts/style.js';
const style=document.createElement('style');style.textContent=fontStyles+css;document.head.append(style);let language='zh',resolveAnswer;
const query=new URLSearchParams(location.search);
const t=k=>(language==='zh'?zh:en)[k]||k;
const texts={'a.ts':'/** Adds an amount. @param value the amount */\\nexport function add(value: number): number { return value + 1; }\\nadd(2);',
'b.ts':'/** Another add. */\\nexport function add(value: string): string { return value; }', 'folder/test.py':'def example():\\n    return 1'};
if(query.has('recovery')){texts['a.ts']+='\\n'+'// long file '+('reading '.repeat(35)+'\\n').repeat(200);for(const [path,value]of Object.entries(JSON.parse(sessionStorage.getItem('recovery-test-disk')||'{}'))){if(value===null)delete texts[path];else texts[path]=value}}
async function request(path,body,signal){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal});if(!r.ok)throw Error(await r.text());return r.json()}
const windows={open:(native,signal)=>request('/open',{},signal),close:id=>request('/close',{id}),send:(id,content,signal)=>request('/send',{id,content},signal),async *events(id,signal){const r=await fetch('/events?id='+id,{signal});let pending='';const decoder=new TextDecoder();for await(const b of r.body){pending+=decoder.decode(b,{stream:true});let end;while((end=pending.indexOf('\\n'))>=0){yield JSON.parse(pending.slice(0,end));pending=pending.slice(end+1)}}}};
const readGates=new Map(),readSignals=new Map();
let saveGate,saveStarted=false;
const versions={},versionOf=path=>versions[path]||'v1';let revision=1;
const api={windows,fonts:async()=>['Menlo','Songti SC'],list:async path=>({entries:path==='folder'?[{name:'test.py',path:'folder/test.py',type:'file'}]:[{name:'folder',path:'folder',type:'directory'},{name:'a.ts',path:'a.ts',type:'file'},{name:'b.ts',path:'b.ts',type:'file'}],truncated:false}),read:async(path,signal)=>{readSignals.set(path,signal);await readGates.get(path)?.promise;if(!(path in texts))throw new Error('WORKBENCH_NOT_FILE');return{path,text:texts[path],version:versionOf(path)}},save:async input=>{if(input.version!==versionOf(input.path))throw new Error('WORKBENCH_CONFLICT');texts[input.path]=input.text;versions[input.path]='v'+(++revision);return{path:input.path,text:input.text,version:versionOf(input.path)}},project:async()=>({files:Object.keys(texts),truncated:false}),fileOperation:async()=>({path:query.get('root')||'/demo'}),git:async()=>({kind:'snapshot',snapshot:{version:'v',files:[],branches:[],commits:[],remotes:[],status:{}}}),models:async()=>[{provider:'demo',model:'configured',name:'演示模型',current:true,efforts:[{id:'high',name:'High'},{id:'max',name:'Max'}]},{provider:'demo',model:'controllable',name:'可关闭思考的演示模型',efforts:[{id:'off',name:'Off'},{id:'high',name:'High'}]}],assist:async()=>new Promise(resolve=>{resolveAnswer=resolve}),async *reading(input){window.lastReading=input;yield{kind:'status',stage:'catalog'};yield{kind:'sources',sources:[{id:'S1',file:'a.ts',fromLine:1,toLine:1,text:texts['a.ts'].split('\\n')[0],version:'v1'}],partial:false};yield{kind:'plan',plan:{title:'项目阅读',summary:'从项目入口开始',steps:[{title:'入口',reason:'了解输入输出',refs:[{file:'a.ts',fromLine:1,toLine:1,quote:texts['a.ts'].split('\\n')[0]}]}]}};yield{kind:'done'}}};
const studyStore=query.has('study')?createStudyStore(query.get('study')):undefined;
if(studyStore){
  for(const [path,value] of Object.entries(JSON.parse(sessionStorage.getItem('study-test-disk')||'{}'))){if(value===null)delete texts[path];else texts[path]=value}
  const reading=api.reading, assist=api.assist;
  window.studyTest={store:studyStore, requests:0};
  api.assist=(...args)=>{window.studyTest.requests++;return assist(...args)};
  api.reading=async function*(input){
    window.studyTest.requests++;
    if(input.kind==='plan'){yield* reading(input);return}
    const ref=input.step.refs[0];
    yield{kind:'sources',sources:[{id:'S1',file:ref.file,fromLine:ref.fromLine,toLine:ref.toLine,text:ref.quote,version:versionOf(ref.file)}],partial:false};
    yield{kind:'section',section:{title:'入口说明',text:'入口为 add 函数。',refs:[ref]}};
    yield{kind:'done'};
  };
}
const controller=createWorkbench(api,t,{studyStore,draftStore:query.has('drafts')?createDraftStore(query.get('drafts')):undefined,session:query.has('recovery')?createWorkspaceSession(localStorage,query.get('recovery')):undefined}),root=createRoot(document.getElementById('root'));
const save=api.save;api.save=async input=>{if(saveGate){saveStarted=true;await saveGate.promise}return save(input)};
api.searchProject=async function*(query,signal){for(const path of Object.keys(texts)){signal.throwIfAborted();if(!searchPathFilter(query).file(path))continue;const file=await api.read(path);if(query.locations){for(const matches of locationBatches(file.text,query.search,query.caseSensitive,query))yield{kind:'matches',path,version:file.version,matches};continue}const count=[...searchMatches(searchText(file.text),query)].length;if(count)yield{kind:'file',path,version:file.version,count,sample:file.text.split('\\n')[0]}}yield{kind:'done',scanned:Object.keys(texts).length,skipped:0}};
function Button({children,...p}){return <button type='button' {...p}>{children}</button>}
function Select({label,value,choices,onChange,disabled}){return <select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{choices.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}
function Conversation(){return <div className='sc-wb-conversation'><div className='dsh-super-code-detail-log'><div className='dsh-super-code-detail-entry agent'><div className='dsh-super-code-detail-message'><div className='dsh-super-code-detail-content'><h2>三、你现在该做什么</h2><div className='host-markdown'><table><thead><tr><th>阶段</th><th>读哪几篇</th><th>读完能回答</th><th>时间</th></tr></thead><tbody><tr><td>1</td><td><a href='#'>输入和提示格式以及一次决策与完整流程</a> + <code><button>src/example/module_entry_point.py</button></code></td><td>文字如何变为输入？候选选项怎样形成决策结果？</td><td>1–2h</td></tr></tbody></table><pre><code>{'long_code_'.repeat(45)}</code></pre></div></div></div></div></div></div>}
function render(){root.render(<Workbench workbench={controller} Button={Button} Select={Select} Conversation={Conversation} MarkdownText={SafeMarkdown} sessionId='demo' t={t}/>)}render();
window.test={controller,texts,draftStore:query.has('drafts')?createDraftStore(query.get('drafts')):null,readAborted:path=>readSignals.get(path)?.aborted,holdSave:()=>{let release;saveStarted=false;const promise=new Promise(resolve=>{release=resolve});saveGate={promise,release}},saveStarted:()=>saveStarted,releaseSave:()=>{saveGate?.release();saveGate=null},holdRead:path=>{let release;const promise=new Promise(resolve=>{release=resolve});readGates.set(path,{promise,release})},releaseReads:()=>{for(const gate of readGates.values())gate.release();readGates.clear()},external:(path,text)=>{texts[path]=text;versions[path]='v'+(++revision)},answer:result=>resolveAnswer(result||{kind:'ask',text:'选区返回加法的结果。'}),theme:(palette,dark)=>{document.body.toggleAttribute('data-ds-dark-theme',dark);return controller.settings({...controller.snapshot().preferences,palette})},locale:()=>{language='en';render()},dispose:()=>{root.unmount();controller.dispose()}};`;
