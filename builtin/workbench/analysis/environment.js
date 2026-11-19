import { SymbolIndex } from './index.js';
import { extension } from '../editor/languages.js';
import { lexicalBinding } from './bindings.js';
import { resolveSymbol } from './resolution.js';

const languageOf = { py: 'python', js: 'javascript', ts: 'javascript', tsx: 'javascript', go: 'go', rs: 'rust', java: 'java', c: 'cpp', cpp: 'cpp', cs: 'csharp', php: 'php', rb: 'ruby' };

export function environmentQueries(file, name, offset, source) {
  const language = languageOf[extension(file)];
  if (!language) return [];
  const receiver = source.text.slice(0, offset).match(/([\p{L}_$][\p{L}\p{N}_$]*)\s*(?:\.|::)\s*$/u)?.[1];
  if (receiver && lexicalBinding(source, receiver, offset - receiver.length - 1)) return [];
  if (language === 'python' || language === 'javascript') {
    const imported = source.imports.find(item => item.local === (receiver || name));
    if (imported) return imported.source.startsWith('.') ? [] : [{ language, module: imported.source, name: receiver || imported.imported === '*' ? name : imported.imported }];
    return receiver ? [] : [{ language, module: language === 'python' ? 'builtins' : '', name }];
  }
  const text = source.text, result = [];
  if (language === 'go') for (const block of text.matchAll(/\bimport\s*(\([\s\S]*?\)|(?:\w+\s+)?"[^"\n]+")/g)) for (const item of block[1].matchAll(/(?:(\w+)\s+)?"([^"\n]+)"/g)) {
    if ((item[1] || item[2].split('/').at(-1)) === receiver) result.push({ language, module: item[2], name });
  }
  if (language === 'rust') for (const item of text.matchAll(/\buse\s+([\w:]+)(?:\s+as\s+(\w+))?\s*;/g)) {
    const parts = item[1].split('::'); if ((item[2] || parts.at(-1)) === (receiver || name)) result.push({ language, module: receiver ? item[1] : parts.slice(0, -1).join('::'), name: receiver ? name : parts.at(-1) });
  }
  if (language === 'java') for (const item of text.matchAll(/\bimport\s+(?:static\s+)?([\w.]+)\s*;/g)) if (item[1].split('.').at(-1) === (receiver || name)) result.push({ language, module: item[1], name });
  if (language === 'cpp') for (const item of text.matchAll(/^\s*#\s*include\s*[<"]([^>"\n]+)[>"]/gm)) result.push({ language, module: item[1], name });
  if (language === 'csharp') for (const item of text.matchAll(/\busing\s+([\w.]+)\s*;/g)) result.push({ language, module: item[1], name });
  if (language === 'php') for (const item of text.matchAll(/\buse\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/g)) if ((item[2] || item[1].split('\\').at(-1)) === (receiver || name)) result.push({ language, module: item[1].replaceAll('\\', '/'), name });
  if (language === 'ruby') for (const item of text.matchAll(/\brequire\s*["']([^"'\n]+)["']/g)) result.push({ language, module: item[1], name });
  return result;
}

/** 依赖分析按查询创建并释放，不污染项目名称集合或磁盘缓存。 */
export async function externalDefinitions(api, analyzer, paths, file, name, offset, source, signal) {
  if (!api.languageSources) return [];
  const matches = [], seen = new Set();
  for (const query of environmentQueries(file, name, offset, source)) {
    const roots = new Map(); let completed = false;
    for await (const event of api.languageSources({ language: query.language, module: query.module, paths }, signal)) {
      signal?.throwIfAborted();
      if (event.kind === 'done') { completed = true; continue; }
      if (!roots.has(event.root)) roots.set(event.root, new Map());
      roots.get(event.root).set(event.path, event);
    }
    if (!completed) throw new Error('WORKBENCH_REMOTE');
    for (const [root, documents] of roots) {
      const parse = query.language === 'cpp' ? (path, text, detail) => analyzer(path.includes('.') ? path : path + '.cpp', text, detail) : analyzer;
      const index = new SymbolIndex(parse, { read: path => documents.get(path).text });
      try {
        for (const [path, doc] of documents) { signal?.throwIfAborted(); await index.change(path, doc.text); }
        let found;
        if (query.language === 'javascript' && !query.module) found = index.candidates([...documents.keys()][0], query.name);
        else if (['python', 'javascript'].includes(query.language)) {
          found = [];
          for (const doc of documents.values()) if (doc.entry) {
            const isPython = query.language === 'python', local = '__dsh_definition', probe = isPython ? '__dsh_query.py' : '__dsh_query.ts';
            const text = isPython ? `from ${query.module} import ${query.name} as ${local}\n${local}` : `import {${query.name} as ${local}} from './${doc.path}';\n${local}`;
            await index.change(probe, text); found.push(...await resolveSymbol(index, probe, local, text.lastIndexOf(local), signal));
          }
        } else found = index.candidates([...documents.keys()][0], query.name);
        for (const item of await index.describe(found, signal)) {
          const doc = documents.get(item.file), key = root + ':' + item.file + ':' + item.offset;
          if (!doc || seen.has(key)) continue;
          seen.add(key); matches.push({ ...item, library: { ...doc, language: query.language }, file: item.file });
        }
      } finally { index.clear(); }
    }
  }
  return matches;
}
