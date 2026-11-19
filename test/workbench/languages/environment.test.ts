import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { inspectEnvironments, parseJsonConfig } from '../../../src/workbench/languages/config.js'
import { languageSources } from '../../../src/workbench/languages/sources.js'
import { validationRoot } from '../../validation-root.js'
const signal = new AbortController().signal
async function fixture(t: any) {
 await mkdir(validationRoot,{recursive:true});const cwd=await mkdtemp(join(validationRoot,'languages-')),ctx=new Context();await ctx.plugin(LocalFileSystem,{cwd});
 t.after(async()=>{await ctx.fiber.dispose();await rm(cwd,{recursive:true,force:true})});
 const file=async(path:string,text:string)=>{await mkdir(join(cwd,path,'..'),{recursive:true});await writeFile(join(cwd,path),text)}
 return {cwd,ctx,file,root:{cwd,policy:{mode:'read-only' as const,workspaceRoot:cwd}}}
}
test('JSONC保留字符串中的注释和逗号，拒绝不完整输入',()=>{
 assert.deepEqual(parseJsonConfig('{/*a*/"url":"https://example.test/a,}","path":"c:\\\\bin",//x\n"items":[1,],}'),{url:'https://example.test/a,}',path:'c:\\bin',items:[1]})
 assert.throws(()=>parseJsonConfig('{/* never ends'));assert.throws(()=>parseJsonConfig('[]'))
})
test('JSONC尾逗号后允许行注释和块注释，嵌套及字符串内容保持原样', () => {
 const expected = { text: 'comma,} bracket,] // /*', escaped: 'quote" and \\', items: [1, { value: 2 }] }
 for (const comment of ['// 注释\n', '// 注释\r\n', '// 注释\r', '/* 注释 */', '/* 第一段 */ \r\n // 第二段\r\n']) {
  const input = `\uFEFF{ "text": ${JSON.stringify(expected.text)}, "escaped": ${JSON.stringify(expected.escaped)}, "items": [1, {"value": 2, ${comment}}, ${comment}], ${comment}}`
  assert.deepEqual(parseJsonConfig(input), expected)
 }
 for (const input of ['{"items": [1,, /* 缺值 */]}', '{"value": 1 /* 缺逗号 */ "next": 2}', '{"value": 1, /* 未结束 }']) assert.throws(() => parseJsonConfig(input))
})
test('真实VS Code配置尾逗号后有注释时仍识别自定义解释器和C头文件', async t => {
 const { cwd, ctx, file, root } = await fixture(t)
 await file('custom-python/Lib/sample.py', 'def run(): pass')
 await file('custom-headers/api.h', 'int execute(int value);')
 await file('.vscode/settings.json', '{"python.defaultInterpreterPath": "${workspaceFolder}/custom-python", // 自定义环境\n}')
 await file('.vscode/c_cpp_properties.json', '{"configurations": [{"includePath": ["${workspaceFolder}/custom-headers", /* 目录 */], // 配置\n}, /* 结束 */], /* 尾注释 */}')
 const result = await inspectEnvironments(ctx.fs, root, {}, signal)
 assert.deepEqual(result.warnings, [])
 assert.ok(result.environments.find(item => item.language === 'python')!.roots.includes(join(cwd, 'custom-python/Lib')))
 assert.ok(result.environments.find(item => item.language === 'cpp')!.roots.includes(join(cwd, 'custom-headers')))
})
test('空项目不假报解释器；VS Code配置和虚拟环境实时识别且不执行脚本',async t=>{
 const {cwd,ctx,file,root}=await fixture(t)
 assert.ok((await inspectEnvironments(ctx.fs,root,{},signal)).environments.every(item=>item.unavailable))
 await file('.vscode/settings.json','{// settings\n"python.defaultInterpreterPath":"${workspaceFolder}/venv/bin/python",}');await file('venv/bin/python','not-executable');await file('venv/pyvenv.cfg','version = 3.12.1\n');await file('venv/lib/python3.12/site-packages/demo/__init__.py','from .api import run\n');await file('venv/lib/python3.12/site-packages/demo/api.py','def run(value: int) -> int:\n    return value\n')
 const python=(await inspectEnvironments(ctx.fs,root,{},signal)).environments.find(item=>item.language==='python')!
 assert.ok(python.roots.includes(join(cwd,'venv/lib/python3.12/site-packages')))
 const events=await Array.fromAsync(languageSources(ctx.fs,root,{language:'python',module:'demo',paths:{}},signal))
 assert.equal(events.filter(event=>event.kind==='source').length,2);assert.deepEqual(events.at(-1),{kind:'done',reason:'source',warnings:[]})
 assert.equal(await readFile(join(cwd,'venv/bin/python'),'utf8'),'not-executable')
 assert.equal((await Array.fromAsync(languageSources(ctx.fs,root,{language:'python',module:'missing',paths:{}},signal))).at(-1)?.kind,'done')
})
test('JS包声明及相对转发、TypeScript标准声明均可读取，配置优先于自动发现',async t=>{
 const {ctx,file,root}=await fixture(t)
 await file('node_modules/demo/package.json','{"types":"types/main.d.ts"}');await file('node_modules/demo/types/main.d.ts','export {run} from "./api.js";');await file('node_modules/demo/types/api.d.ts','export declare function run(value: number): number;')
 await file('node_modules/typescript/lib/lib.es5.d.ts','interface Array<T> { length: number; }')
 const events=await Array.fromAsync(languageSources(ctx.fs,root,{language:'javascript',module:'demo',paths:{}},signal))
 assert.equal(events.filter(event=>event.kind==='source').length,2)
 assert.ok((await Array.fromAsync(languageSources(ctx.fs,root,{language:'javascript',module:'',paths:{}},signal))).some(event=>event.kind==='source'&&event.path==='lib.es5.d.ts'))
 const env=(await inspectEnvironments(ctx.fs,root,{javascript:'missing'},signal)).environments.find(item=>item.language==='javascript')!
 assert.equal(env.unavailable,true)
})
test('IDEA路径、Go标准库、Java源码目录、C头文件和Ruby源码可只读访问',async t=>{
 const {ctx,file,root}=await fixture(t)
 await file('.idea/workspace.xml','<sdk name="Python"><option name="SDK_HOME" value="$PROJECT_DIR$/python"/></sdk>');await file('python/Lib/os.py','def getenv(name): pass')
 assert.ok((await inspectEnvironments(ctx.fs,root,{},signal)).environments.find(item=>item.language==='python')!.roots.length)
 for(const [language,path,module,text]of [['go','toolchain/src/fmt/print.go','fmt','package fmt\nfunc Println(a ...any) {}'],['java','java/src/java.base/java/util/List.java','java.util.List','public interface List {}'],['cpp','cpp/include/api.h','api.h','int execute(int value);'],['ruby','ruby/lib/sample.rb','sample','def run; end']]as const){
 await file(path,text);const base=path.split('/')[0]!
 const events=await Array.fromAsync(languageSources(ctx.fs,root,{language,module,paths:{[language]:base}},signal))
 assert.ok(events.some(event=>event.kind==='source'&&event.text===text),language)
 }
})
test('拒绝越界模块和链接，不跟随包转发到根外；损坏配置显式提示，取消不吞掉',async t=>{
 const {cwd,ctx,file,root}=await fixture(t)
 await file('library/api.ts','export function run() {}');await file('outside/secret.ts','private');await symlink(join(cwd,'outside/secret.ts'),join(cwd,'library/escape.ts'))
 for(const module of ['../outside/secret','/etc/passwd','C:\\secrets','https://example.test/a']) await assert.rejects(async()=>Array.fromAsync(languageSources(ctx.fs,root,{language:'javascript',module,paths:{javascript:'library'}},signal)))
 const events=await Array.fromAsync(languageSources(ctx.fs,root,{language:'javascript',module:'escape',paths:{javascript:'library'}},signal));assert.ok(!events.some(event=>event.kind==='source'))
 await file('.vscode/settings.json','{broken');assert.deepEqual((await inspectEnvironments(ctx.fs,root,{},signal)).warnings,['.vscode/settings.json'])
 const abort=new AbortController();abort.abort();await assert.rejects(async()=>Array.fromAsync(languageSources(ctx.fs,root,{language:'python',module:'os',paths:{}},abort.signal)))
})

test('venv链接解释器保留环境根，源码变化与非法编码不被伪装成成功',async t=>{
 const {cwd,ctx,file,root}=await fixture(t)
 await file('global/bin/python','must not run');await file('venv/Lib/sample.py','def run(value): return value')
 await mkdir(join(cwd,'venv/bin'),{recursive:true});await symlink(join(cwd,'global/bin/python'),join(cwd,'venv/bin/python'))
 await file('.vscode/settings.json','{"python.defaultInterpreterPath":"${workspaceFolder}/venv/bin/python"}')
 const events=await Array.fromAsync(languageSources(ctx.fs,root,{language:'python',module:'sample',paths:{}},signal))
 assert.ok(events.some(e=>e.kind==='source'&&e.text.includes('def run')))
 let changed=false
 const unstable=new Proxy(ctx.fs,{get(target,key){
  if(key==='readBytes')return async(...args:any[])=>{const value=await target.readBytes(...args);if(String(args[0].targetKey).endsWith('sample.py'))changed=true;return value}
  if(key==='stat')return async(...args:any[])=>{const value=await target.stat(...args);return changed&&String(args[0].targetKey).endsWith('sample.py')&&value?{...value,version:'changed'}:value}
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value
 }})
 await assert.rejects(async()=>Array.fromAsync(languageSources(unstable,root,{language:'python',module:'sample',paths:{}},signal)),/WORKBENCH_CONFLICT/)
 await writeFile(join(cwd,'venv/Lib/bad.py'),Buffer.from([0xff,0xfe]))
 await assert.rejects(async()=>Array.fromAsync(languageSources(ctx.fs,root,{language:'python',module:'bad',paths:{}},signal)))
})

test('无源码环境返回准确原因，Windows和UNC拼接不损坏网络前缀',async t=>{
 const {ctx,file,root}=await fixture(t)
 assert.equal((await Array.fromAsync(languageSources(ctx.fs,root,{language:'python',module:'os',paths:{}},signal))).at(-1)?.reason,'no-environment')
 await file('environment/marker','')
 assert.equal((await Array.fromAsync(languageSources(ctx.fs,root,{language:'python',module:'os',paths:{python:'environment'}},signal))).at(-1)?.reason,'no-source')
 const {join:combine}=await import('../../../src/workbench/languages/config.js')
 assert.equal(combine('\\\\server\\share','lib','api.py'),'//server/share/lib/api.py');assert.equal(combine('C:\\env','Lib'),'C:/env/Lib')
})

test('从真实依赖目录读源码并交给前端解析，Python和JS声明均可跳转',async t=>{
 const {ctx,file,root}=await fixture(t)
 await file('venv/Lib/demo/__init__.py','from .api import run\n');await file('venv/Lib/demo/api.py','def run(value: int) -> int:\n    return value\n')
 await file('node_modules/demo/index.d.ts','export {run} from "./api.js";');await file('node_modules/demo/api.d.ts','export declare function run(value: number): number;')
 const {SymbolIndex,analyze}=await import('../../../builtin/workbench/analysis/index.js'),{externalDefinitions}=await import('../../../builtin/workbench/analysis/environment.js')
 for(const[language,path,text]of [['python','main.py','from demo import run\nrun(42)'],['javascript','main.ts','import {run} from "demo";run(42)']]as const){
  const api={languageSources:(input:unknown,active:AbortSignal)=>languageSources(ctx.fs,root,input,active)}
  const index=new SymbolIndex(analyze,{external:(...args:any[])=>externalDefinitions(api,analyze,{},...args)})
  await index.change(path,text);const result=await index.resolve(path,'run',text.lastIndexOf('run'),signal)
  assert.equal(result.length,1,language);assert.equal(result[0].library.entry,false);assert.equal(index.files.size,1)
 }
})

test('常用语言的明确源码布局可从导入定位声明，包括无后缀C++头和Rust标准源码',async t=>{
 const {ctx,file,root}=await fixture(t),{SymbolIndex,analyze}=await import('../../../builtin/workbench/analysis/index.js'),{externalDefinitions}=await import('../../../builtin/workbench/analysis/environment.js')
 const cases=[
 ['go','caller.go','package main\nimport "fmt"\nfunc main(){fmt.Println("a")}','Println','src/fmt/print.go','package fmt\nfunc Println(value string) {}'],
 ['java','Caller.java','import java.util.List;\nclass Caller { List list; }','List','java/util/List.java','package java.util;\npublic interface List {}'],
 ['cpp','caller.cpp','#include <api>\nint main(){return execute(1);}','execute','api','int execute(int value) { return value; }'],
 ['csharp','Caller.cs','using Demo;\nclass Caller {void Run(){Execute(1);}}','Execute','Demo/Api.cs','namespace Demo { public class Api { public int Execute(int value) {return value;} } }'],
 ['rust','caller.rs','use std::fs::read_to_string;\nfn main(){read_to_string("a");}','read_to_string','std/src/fs.rs','pub fn read_to_string(path: &str) -> String { String::new() }'],
 ['ruby','caller.rb','require "sample"\nrun(1)','run','sample.rb','def run(value)\n value\nend'],
 ['php','caller.php','<?php\nuse Demo\\Api;\nApi();','Api','Demo/Api.php','<?php\nnamespace Demo;\nclass Api {}'],
 ['javascript','caller.ts','parseInt("1")','parseInt','lib.es5.d.ts','/** Parse. */\ndeclare function parseInt(value: string): number;'],
 ]as const
 for(const[language,path,text,name,dependency,content]of cases){
  await file('sources/'+dependency,content);const api={languageSources:(input:unknown,active:AbortSignal)=>languageSources(ctx.fs,root,input,active)}
  const index=new SymbolIndex(analyze,{external:(...args:any[])=>externalDefinitions(api,analyze,{[language]:'sources'},...args)})
  await index.change(path,text);const result=await index.resolve(path,name,text.lastIndexOf(name),signal);assert.ok(result.length>0,language);assert.equal(result[0].library.text,content,language)
 }
})

test('查询一种语言不探测其他语言的受限环境，宿主拒绝当前源码读取时仍报错',async t=>{
 const {ctx,file,root}=await fixture(t);await file('venv/Lib/demo.py','def run(): pass')
 const restricted=new Proxy(ctx.fs,{get(target,key){if(key==='resolve')return async(path:string,...args:any[])=>{if(path==='restricted')throw new Error('HOST_ACCESS_DENIED');return target.resolve(path,...args)};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
 const events=await Array.fromAsync(languageSources(restricted,root,{language:'python',module:'demo',paths:{cpp:'restricted'}},signal));assert.ok(events.some(e=>e.kind==='source'))
 await assert.rejects(async()=>Array.fromAsync(languageSources(restricted,root,{language:'python',module:'demo',paths:{python:'restricted'}},signal)),/HOST_ACCESS_DENIED/)
})
