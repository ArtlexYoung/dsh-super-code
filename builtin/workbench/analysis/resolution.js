import { lexicalBinding, modulePath } from './bindings.js';
import { extension } from '../editor/languages.js';

export async function resolveSymbol(index, file, name, offset, signal) {
  const source = await index.load(file, true, signal);
  if (!source) return [];
  const reference = source.references.get(name)?.find(item => item.offset <= offset && offset <= item.offset + name.length);
  if (!reference) return [];
  offset = reference.offset;
  const local = lexicalBinding(source, name, offset);
  if (local) return [{ name: local.name, offset: local.offset, kind: local.kind, file, line: local.line, character: local.character }];
  const member = source.members?.get(offset);
  const imported = source.imports?.find(item => item.local === (member?.name || name));
  if (member && imported && lexicalBinding(source, member.name, member.offset)) return [];
  if (imported) {
    if (member && imported.imported !== '*') return [];
    const path = modulePath(file, imported.source, index.files);
    return path ? exported(index, path, member ? name : imported.imported, signal) : index.external ? index.external(file, name, offset, source, signal) : [];
  }
  // 其他文件的局部变量与形参不属于当前名称的全局候选。
  const candidates = index.candidates(file, name), result = [];
  for (const item of candidates) {
    const value = await index.load(item.file, true, signal);
    const binding = value?.bindings?.find(binding => binding.offset === item.offset);
    if (!binding?.local || source.members?.has(offset) && item.kind === 'function') result.push(item);
  }
  return result.length || !index.external ? result : index.external(file, name, offset, source, signal);
}
async function exported(index, file, name, signal, seen = new Set()) {
  const key = file + ':' + name;
  if (seen.has(key)) return [];
  seen.add(key);
  const source = await index.load(file, true, signal);
  if (!source) return [];
  if (['py', 'pyi'].includes(extension(file))) {
    const imported = source.imports?.find(item => item.local === name);
    if (imported) {
      const path = modulePath(file, imported.source, index.files);
      return path ? exported(index, path, imported.imported, signal, seen) : [];
    }
  }
  const alias = source.exports?.find(item => item.exported === name);
  if (alias?.source) {
    const path = modulePath(file, alias.source, index.files);
    return path ? exported(index, path, alias.local, signal, seen) : [];
  }
  if (!alias && ['js', 'ts', 'tsx'].includes(extension(file))) {
    const matches = [];
    for (const item of source.exports || []) if (item.exported === '*' && name !== 'default') {
      const path = modulePath(file, item.source, index.files);
      if (path) matches.push(...await exported(index, path, name, signal, seen));
    }
    return matches;
  }
  const local = alias?.local || name;
  return source.symbols.filter(item => item.name === local && source.bindings?.some(binding => binding.offset === item.offset && binding.from === 0 && binding.to === source.text.length)).map(item => ({ ...item, file }));
}
