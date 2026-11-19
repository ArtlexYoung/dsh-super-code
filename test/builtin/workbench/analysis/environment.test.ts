import test from 'node:test'
import assert from 'node:assert/strict'
import { SymbolIndex, analyze } from '../../../../builtin/workbench/analysis/index.js'
import { externalDefinitions, environmentQueries } from '../../../../builtin/workbench/analysis/environment.js'
const signal = new AbortController().signal

async function indexFor(file: string, text: string, sources: Record<string, string>, entries: string[]) {
 let reads = 0
 const api = { async *languageSources() { reads++; for(const [path,text]of Object.entries(sources)) yield {kind:'source',root:'fixture',path,text,version:'v1',entry:entries.includes(path)};yield {kind:'done',reason:'source'} } }
 const index = new SymbolIndex(analyze, { external: (...args:any[]) => externalDefinitions(api, analyze, {}, ...args) })
 await index.change(file,text)
 return {index,reads:()=>reads}
}
test('Python虚拟环境包的转发和别名可跳转，依赖不会污染项目索引',async()=>{
 const file='main.py',text='from sample import execute as run\nrun(42)\n'
 const {index,reads}=await indexFor(file,text,{'sample/__init__.py':'from .api import execute\n','sample/api.py':'def execute(value: int) -> int:\n    """执行。"""\n    return value\n'},['sample/__init__.py'])
 const result=await index.navigate(file,'run',text.lastIndexOf('run'),signal)
 assert.equal(result.kind,'definitions');assert.equal(result.matches.length,1);assert.equal(result.matches[0].file,'sample/api.py');assert.match(result.matches[0].declaration,/value: int/);assert.match(result.matches[0].documentation.description,/执行/);assert.equal(result.matches[0].library.text.includes('return value'),true)
 assert.equal(index.files.size,1);assert.equal(reads(),1)
 assert.equal((await index.describe(result.matches,signal)).length,1)
})
test('JS导入的类型声明转发可定位，形参和局部定义不读取环境',async()=>{
 const file='main.ts',text='import {run as execute} from "sample";\nfunction main(value: number) { return execute(value); }'
 const {index,reads}=await indexFor(file,text,{'sample/index.d.ts':'export {run} from "./api.js";','sample/api.d.ts':'/** 执行。 */\nexport declare function run(value: number): number;'},['sample/index.d.ts'])
 const result=await index.navigate(file,'execute',text.lastIndexOf('execute'),signal)
 assert.equal(result.matches.length,1);assert.equal(result.matches[0].file,'sample/api.d.ts');assert.match(result.matches[0].declaration,/value: number/)
 const before=reads();await index.resolve(file,'value',text.lastIndexOf('value'),signal);assert.equal(reads(),before)
})
test('Python命名空间引用读取对应包，局部对象不假装成模块',async()=>{
 const text='import json as serializer\nserializer.loads("{}")\n',source=await analyze('main.py',text,true)
 assert.deepEqual(environmentQueries('main.py','loads',text.indexOf('loads'),source),[{language:'python',module:'json',name:'loads'}])
 const local='function run(serializer) { return serializer.loads("{}"); }',parsed=await analyze('main.ts',local,true)
 assert.deepEqual(environmentQueries('main.ts','loads',local.indexOf('loads'),parsed),[])
})
test('常用语言只根据明确导入查询相关源码，未知语言不扫描',async()=>{
 for(const [file,text,name,module]of [
 ['main.go','package main\nimport "fmt"\nfunc main() { fmt.Println("a") }','Println','fmt'],
 ['main.java','import java.util.List;\nclass Main { List values; }','List','java.util.List'],
 ['main.cpp','#include <api.h>\nint main() { return execute(); }','execute','api.h'],
 ['main.cs','using System.Text;\nclass Main { StringBuilder value; }','StringBuilder','System.Text'],
 ['main.rs','use sample::api::run;\nfn main() { run(); }','run','sample::api'],
 ['main.rb','require "sample"\nrun()','run','sample'],
 ]as const){const source=await analyze(file,text,true),queries=environmentQueries(file,name,text.lastIndexOf(name),source);assert.ok(queries.some(item=>item.module===module),file)}
 assert.deepEqual(environmentQueries('a.txt','name',0,{text:'name'}),[])
})
test('取消和中断流不返回看似完整的定义结果',async()=>{
 const source=await analyze('main.ts','import {run} from "pkg";run()',true)
 await assert.rejects(externalDefinitions({async *languageSources(){yield {kind:'source',path:'a.ts',text:'export function run(){}',version:'v',root:'a',entry:true}}},analyze,{},'main.ts','run',26,source,signal),/WORKBENCH_REMOTE/)
 const abort=new AbortController();abort.abort()
 await assert.rejects(externalDefinitions({async *languageSources(){yield{kind:'done'}}},analyze,{},'main.ts','run',26,source,abort.signal))
})

test('未解析的项目相对导入不发送依赖请求，声明文件保留文档',async()=>{
 for(const[file,text]of [['main.py','from .missing import run\nrun()'],['main.ts','import {run} from "./missing"; run()']]){
  const source=await analyze(file,text,true);assert.deepEqual(environmentQueries(file,'run',text.lastIndexOf('run'),source),[])
 }
 const source=await analyze('api.d.ts','/** 执行。\n * @param value 输入。\n */\nexport declare function run(value: number): number;',true)
 assert.equal(source.symbols.length,1);assert.match(source.symbols[0].documentation.description,/执行/);assert.match(source.symbols[0].documentation.params[0].description,/输入/)
})
