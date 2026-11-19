import test from 'node:test'
import assert from 'node:assert/strict'
import { SymbolIndex } from '../../../../builtin/workbench/analysis/index.js'

test('形参优先绑定当前函数，嵌套同名参数不与项目候选混合', async () => {
  const index = new SymbolIndex(), text = 'function outer(input: string) { function inner(input: number) { return input } return input }'
  await index.change('main.ts', text)
  await index.change('other.ts', 'const input = 100;')
  for (const offset of [text.indexOf('return input') + 7, text.lastIndexOf('return input') + 7]) {
    const result = await index.navigate('main.ts', 'input', offset)
    assert.equal(result.kind, 'definitions')
    assert.deepEqual(result.matches.map(item => [item.file, item.offset]), [['main.ts', offset === text.lastIndexOf('return input') + 7 ? text.indexOf('input') : text.indexOf('input: number')]])
  }
  assert.ok(!index.declarations('main.ts').some(item => item.name === 'input'))
})

for (const [file, text, name] of [
  ['main.py', 'def outer(input: str):\n  return input\n', 'input'],
  ['main.go', 'package main\nfunc outer(input string) string { return input }', 'input'],
  ['main.rs', 'fn outer(input: i32) -> i32 { input }', 'input'],
  ['main.cpp', 'int outer(int input) { return input; }', 'input'],
  ['main.java', 'class Main { int outer(int input) { return input; } }', 'input'],
  ['main.php', '<?php function outer(string $input) { return $input; }', 'input'],
] as const) test(file + '：参数只跳到所属函数的绑定', async () => {
  const index = new SymbolIndex()
  await index.change(file, text)
  await index.change('other.' + file.split('.').pop(), text.replace('outer', 'other'))
  const result = await index.navigate(file, name, text.lastIndexOf(name))
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0]!.file, file)
  assert.equal(result.matches[0]!.offset, text.indexOf(name))
})

test('相对导入、别名、默认导入、命名空间调用只解析明确模块', async () => {
  const index = new SymbolIndex()
  await index.change('src/right.ts', 'export function run(value: number) { return value }\nexport default function main() {}')
  await index.change('src/wrong.ts', 'export function run(value: string) {}\nfunction main() {}')
  for (const [text, word] of [
    ["import {run} from './right'; run(1)", 'run'],
    ["import {run as execute} from './right'; execute(1)", 'execute'],
    ["import main from './right'; main()", 'main'],
    ["import * as kit from './right'; kit.run(1)", 'run'],
  ]) {
    await index.change('src/main.ts', text)
    const result = await index.navigate('src/main.ts', word, text.lastIndexOf(word))
    assert.equal(result.matches.length, 1, text)
    assert.equal(result.matches[0]!.file, 'src/right.ts', text)
  }
  const external = "import {run} from 'unknown-package'; run()"
  await index.change('src/main.ts', external)
  assert.deepEqual((await index.navigate('src/main.ts', 'run', external.lastIndexOf('run'))).matches, [])
})

test('参数用法不混入另一个函数同名形参或全局变量', async () => {
  const index = new SymbolIndex(), text = 'function one(input: number) { return input }\nfunction two(input: number) { return input }'
  await index.change('main.ts', text)
  const result = await index.navigate('main.ts', 'input', text.indexOf('input'))
  assert.equal(result.kind, 'usages')
  assert.deepEqual(result.matches.map(item => item.character), [text.indexOf('return input') + 7])
})

test('Python显式导入与别名绑定对应模块，成员导入不借其他文件同名符号', async () => {
  const index = new SymbolIndex()
  await index.change('pkg/utils.py', 'def run(value: int):\n  return value\n')
  await index.change('other.py', 'def run(value: str):\n  return value\n')
  for (const [text,name] of [
    ['from .utils import run as execute\nexecute(1)', 'execute'],
    ['from pkg.utils import run\nrun(1)', 'run'],
    ['import pkg.utils as kit\nkit.run(1)', 'run'],
  ]) {
    await index.change('pkg/main.py', text)
    const result=await index.navigate('pkg/main.py',name,text.lastIndexOf(name))
    assert.deepEqual(result.matches.map(item=>item.file),['pkg/utils.py'],text)
  }
})

test('本地遮蔽、解构参数、目录入口与重新导出保留确定的定义，未导出的名字不当成导出', async () => {
  const index=new SymbolIndex()
  await index.change('lib/value.ts','export function run() {}\nfunction hidden() {}')
  await index.change('lib/index.ts',"export {run as execute} from './value';")
  for (const [text,name,expected] of [
    ["import {execute} from './lib'; execute()", 'execute', 'lib/value.ts'],
    ["import {hidden} from './lib/value'; hidden()", 'hidden', null],
    ['const value = 1; function one({value}: Options) {return value}', 'value', 'main.ts'],
  ]) {
    await index.change('main.ts',text)
    const result=await index.navigate('main.ts',name,text.lastIndexOf(name))
    assert.deepEqual(result.matches.map(item=>item.file),expected?[expected]:[],text)
    if(name==='value')assert.equal(result.matches[0]!.offset,text.indexOf('{value')+1)
  }
})

test('局部参数遮蔽命名空间导入时，不把该参数的成员误解析到导入模块', async () => {
  const index=new SymbolIndex(),text="import * as kit from './right'; function one(kit: unknown) {return kit.run()}"
  await index.change('right.ts','export function run() {}')
  await index.change('main.ts',text)
  assert.deepEqual((await index.navigate('main.ts','run',text.lastIndexOf('run'))).matches,[])
})

test('参数默认值引用不是新参数，函数结束位置不再保留该函数的参数绑定', async () => {
  const index=new SymbolIndex(),python='fallback = 1\ndef one(input = fallback):\n  return input\n'
  await index.change('main.py',python)
  const fallback=await index.navigate('main.py','fallback',python.lastIndexOf('fallback'))
  assert.equal(fallback.matches.length,1);assert.equal(fallback.matches[0]!.offset,0)
  const cpp='int fallback = 1;\nint one(int input = fallback) { return input; }'
  await index.change('main.cpp',cpp)
  assert.equal((await index.navigate('main.cpp','fallback',cpp.lastIndexOf('fallback'))).matches[0]!.offset,4)
  const js='const input = 1; function one(input: number) { return input }input;'
  await index.change('main.ts',js)
  assert.equal((await index.navigate('main.ts','input',js.lastIndexOf('input'))).matches[0]!.offset,6)
})

test('Python同名参数默认值在外部作用域求值，函数体和参数声明仍指向形参', async () => {
  const index=new SymbolIndex(),text='input = 1\ndef one(input = input):\n  return input\n'
  await index.change('main.py',text)
  const declaration=text.indexOf('input = input')
  assert.equal((await index.navigate('main.py','input',text.indexOf('= input')+2)).matches[0]!.offset,0)
  assert.equal((await index.navigate('main.py','input',text.lastIndexOf('input'))).matches[0]!.offset,declaration)
  assert.equal((await index.navigate('main.py','input',declaration+2)).kind,'usages')
})

test('数千个导出与形参仍完整解析末尾调用，参数没有进入顶层结构', async () => {
  const count=4096,index=new SymbolIndex(),text=Array.from({length:count},(_,i)=>'export function task'+i+'(input: number) {return input}').join('\n')
  await index.change('large.ts',text)
  const result=await index.navigate('large.ts','input',text.lastIndexOf('input'))
  assert.equal(result.matches.length,1)
  assert.equal(result.matches[0]!.offset,text.lastIndexOf('(input')+1)
  assert.equal(index.declarations('large.ts').length,count)
  await index.change('main.ts',"import {task4095} from './large'; task4095(1)")
  assert.equal((await index.navigate('main.ts','task4095',35)).matches.length,1)
})
