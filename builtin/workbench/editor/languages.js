import { en } from '../locales.js';
import { StreamLanguage } from '@codemirror/language';
import { snippetCompletion } from '@codemirror/autocomplete';

const loaders = {
  js: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  ts: () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true })),
  tsx: () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true, jsx: true })),
  py: () => import('@codemirror/lang-python').then(m => m.python()),
  go: () => import('@codemirror/lang-go').then(m => m.go()),
  rs: () => import('@codemirror/lang-rust').then(m => m.rust()),
  c: () => import('@codemirror/lang-cpp').then(m => m.cpp()),
  cpp: () => import('@codemirror/lang-cpp').then(m => m.cpp()),
  java: () => import('@codemirror/lang-java').then(m => m.java()),
  cs: () => import('@codemirror/legacy-modes/mode/clike').then(m => StreamLanguage.define(m.csharp)),
  kt: () => import('@codemirror/legacy-modes/mode/clike').then(m => StreamLanguage.define(m.kotlin)),
  swift: () => import('@codemirror/legacy-modes/mode/swift').then(m => StreamLanguage.define(m.swift)),
  rb: () => import('@codemirror/legacy-modes/mode/ruby').then(m => StreamLanguage.define(m.ruby)),
  php: () => import('@codemirror/lang-php').then(m => m.php()),
  sh: () => import('@codemirror/legacy-modes/mode/shell').then(m => StreamLanguage.define(m.shell)),
  json: () => import('@codemirror/lang-json').then(m => m.json()),
  html: () => import('@codemirror/lang-html').then(m => m.html()),
  css: () => import('@codemirror/lang-css').then(m => m.css()),
  sql: () => import('@codemirror/lang-sql').then(m => m.sql()),
};
const aliases = { jsx: 'tsx', mjs: 'js', cjs: 'js', mts: 'ts', cts: 'ts', pyi: 'py', cc: 'cpp', cxx: 'cpp', h: 'c', hpp: 'cpp', kts: 'kt', bash: 'sh', zsh: 'sh', htm: 'html' };
export const extension = file => { const ext = file.split('.').at(-1).toLowerCase(); return aliases[ext] || ext; };
export async function loadLanguage(file) { return loaders[extension(file)]?.() ?? []; }

const keywords = {
  js: 'const let function return async await import export if else for class new',
  ts: 'const let function return async await interface type import export if else for class new',
  py: 'def class return async await import from if elif else for while with try except lambda',
  go: 'func var const type struct interface return if else for range package import defer',
  rs: 'fn let mut const pub impl trait struct enum use match if else for loop return',
  c: 'int double char void struct typedef return if else for while switch',
  cpp: 'auto constexpr class namespace template typename return if else for while',
  java: 'public private static final class interface return new if else for try catch',
  cs: 'public private static class interface namespace async await var return new if else',
  kt: 'fun val var class object interface return when if else for suspend',
  swift: 'func let var class struct protocol return guard if else for async await',
  rb: 'def class module return if elsif else end do unless yield',
  php: 'function class public private return foreach if else namespace use',
  sh: 'if then elif else fi for do done case esac function local export',
};
const cTypes = 'bool char double float int long short signed unsigned void wchar_t size_t';
const types = {
  ts: 'any bigint boolean never number object string symbol unknown void',
  py: 'int float str bool bytes list dict set tuple object type None',
  go: 'bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr',
  rs: 'bool char str String i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 Option Result Vec',
  c: cTypes, cpp: cTypes,
  java: 'boolean byte char double float int long short void String Object Integer Double Float Boolean',
  cs: 'bool byte char decimal double float int long object sbyte short string uint ulong ushort void',
  kt: 'Any Boolean Byte Char Double Float Int Long Nothing Short String Unit',
  swift: 'Any Bool Character Double Float Int Int8 Int16 Int32 Int64 String UInt Void',
  rb: 'Array BasicObject Class FalseClass Float Hash Integer Module NilClass Numeric Object String Symbol TrueClass',
  php: 'array bool callable float int iterable mixed never null object string void',
};
const templates = {
  js: ['function', 'function ${name}(${args}) {\n\t${}\n}'],
  ts: ['function', 'function ${name}(${args}): ${void} {\n\t${}\n}'],
  py: ['def', 'def ${name}(${args}):\n\t${pass}'],
  go: ['func', 'func ${name}(${args}) {\n\t${}\n}'],
  rs: ['fn', 'fn ${name}(${args}) {\n\t${}\n}'],
  c: ['function', '${int} ${name}(${void}) {\n\t${}\n}'],
  cpp: ['function', '${void} ${name}(${args}) {\n\t${}\n}'],
  java: ['method', 'public ${void} ${name}(${args}) {\n\t${}\n}'],
  cs: ['method', 'public ${void} ${Name}(${args}) {\n\t${}\n}'],
  kt: ['fun', 'fun ${name}(${args}) {\n\t${}\n}'],
  swift: ['func', 'func ${name}(${args}) {\n\t${}\n}'],
  rb: ['def', 'def ${name}(${args})\n\t${}\nend'],
  php: ['function', 'function ${name}(${args}) {\n\t${}\n}'],
  sh: ['function', '${name}() {\n\t${}\n}'],
};
export function syntaxSuggestions(file, t = key => en[key]) {
  const ext = extension(file) === 'tsx' ? 'ts' : extension(file);
  const options = (keywords[ext] || '').split(' ').filter(Boolean).map(label => ({ label, type: 'keyword', detail: t('syntaxKeyword') }));
  for (const label of (types[ext] || '').split(' ').filter(Boolean)) {
    const existing = options.find(option => option.label === label);
    if (existing) { existing.type = 'type'; existing.detail = t('basicType'); }
    else options.push({ label, type: 'type', detail: t('basicType') });
  }
  const template = templates[ext];
  if (template) options.unshift(snippetCompletion(template[1], { label: template[0], type: 'snippet', detail: t('functionTemplate') }));
  return options;
}
