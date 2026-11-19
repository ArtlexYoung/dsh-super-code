import { parseSource, sourceSignature, precedingComment, pythonDocstring, identifierOccurrences, lineAt, excludedAt } from './source-info.js';
import { parseDocumentation } from './documentation.js';
import { extension } from '../editor/languages.js';
import { literalMatches } from '../../../src/workbench/search-query.ts';
import { textFilter, mayContain } from './text-filter.js';
import { resolveSymbol } from './resolution.js';
import { sourceDeclarations } from './declarations.js';
import { sourceBindings, lexicalBinding } from './bindings.js';

const languageNames = { py: 'Python', php: 'PHP' };
const aliases = { ts: 'js', tsx: 'js', cpp: 'c' };
export const family = file => aliases[extension(file)] || extension(file);
const legacy = new Set(['cs', 'kt', 'swift', 'rb', 'sh']);
const word = '[\\p{L}_$][\\p{L}\\p{N}_$]*';
const functions = new RegExp(`\\b(?:function|def|func|fun)\\s+(?:[\\p{L}_$][\\p{L}\\p{N}_$]*\\.)?(${word})\\s*\\(`, 'gu');
const variables = new RegExp(`(?:\\b(?:let|var|val|const|local|export)\\s+|^\\s*)(${word})\\s*(?::[^=\\n]+)?=(?!=)`, 'gmu');
const typedFunctions = new RegExp(`(?:^|[;{}]\\s*|\\n)\\s*(?:(?:public|private|protected|static|override|async|virtual|internal|sealed|final)\\s+)*(?:[\\w<>?.\\[\\],]+\\s+)+(${word})\\s*\\(`, 'gmu');
const typedVariables = new RegExp(`\\b(?:[\\w<>?.\\[\\]]+)\\s+(${word})\\s*=`, 'gu');

export async function analyze(file, text, detail = true) {
  const parsed = await parseSource(file, text), ext = extension(file), found = new Map(), starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const add = (name, offset, kind) => {
    if (excludedAt(parsed.excluded, offset)) return;
    found.set(offset, { name, offset, kind });
  };
  for (const symbol of sourceDeclarations(parsed.tree, text, ext)) add(symbol.name, symbol.offset, symbol.kind);
  if (legacy.has(ext)) {
    for (const match of text.matchAll(functions)) add(match[1], match.index + match[0].lastIndexOf(match[1]), 'function');
    for (const match of text.matchAll(variables)) add(match[1], match.index + match[0].indexOf(match[1]), 'variable');
    if (ext === 'cs') {
      for (const match of text.matchAll(typedFunctions)) {
        if (/\b(?:return|throw|new|await|yield|else)\s/.test(match[0])) continue;
        add(match[1], match.index + match[0].lastIndexOf(match[1]), 'function');
      }
      for (const match of text.matchAll(typedVariables)) add(match[1], match.index + match[0].lastIndexOf(match[1]), 'variable');
    }
    if (ext === 'sh') for (const match of text.matchAll(new RegExp(`^\\s*(?:function\\s+)?(${word})\\s*\\(\\s*\\)\\s*\\{`, 'gmu'))) add(match[1], match.index + match[0].indexOf(match[1]), 'function');
  }
  parsed.tree?.iterate({ enter(cursor) {
    if (ext === 'json' && cursor.name === 'PropertyName') add(text.slice(cursor.from, cursor.to).replace(/^"|"$/g, ''), cursor.from, 'property');
    if (ext === 'css' && /^(?:ClassSelector|IdSelector|TagSelector)$/.test(cursor.name)) add(text.slice(cursor.from, cursor.to), cursor.from, 'selector');
    if (ext === 'html' && cursor.name === 'TagName' && cursor.node.parent?.name === 'OpenTag') add(text.slice(cursor.from, cursor.to), cursor.from, 'tag');
  } });
  if (ext === 'sql') for (const match of text.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|INDEX|FUNCTION|PROCEDURE)\s+(?:IF\s+NOT\s+EXISTS\s+)?([\p{L}_][\p{L}\p{N}_.]*)/giu)) add(match[1], match.index + match[0].lastIndexOf(match[1]), 'schema');
  const symbols = [...found.values()].sort((a, b) => a.offset - b.offset).map(symbol => {
    const line = lineAt(starts, symbol.offset);
    const value = { ...symbol, file, line, character: symbol.offset - starts[line] };
    if (!detail) return value;
    const raw = ext === 'py' ? pythonDocstring(text, value.offset, parsed) || precedingComment(text, value.offset, parsed) : precedingComment(text, value.offset, parsed);
    return { ...value, declaration: sourceSignature(text, value, parsed), documentation: parseDocumentation(raw, languageNames[ext]) };
  });
  if (!detail) return { symbols, filter: textFilter(text) };
  const occurrences = identifierOccurrences(text, parsed).map(item => ext === 'php' && item.name.startsWith('$') ? { ...item, name: item.name.slice(1), offset: item.offset + 1 } : item);
  const references = new Map();
  for (const item of occurrences) {
    if (!references.has(item.name)) references.set(item.name, []);
    references.get(item.name).push(item);
  }
  const scope = sourceBindings(parsed.tree, text, ext, symbols);
  for (const item of scope.bindings) if (item.parameter) {
    const line = lineAt(starts, item.offset);
    const owner = symbolAfter(symbols, item.ownerFrom);
    const doc = owner?.kind === 'function' && owner.offset < item.offset ? owner.documentation.params.find(param => param.name === item.name) : null;
    Object.assign(item, { file, line, character: item.offset - starts[line], documentation: { ...parseDocumentation(''), description: doc?.description || '' } });
  }
  return { text, symbols, occurrences, starts, references, ...scope };
}

const kinds = ['function', 'variable', 'property', 'selector', 'tag', 'schema'];
const SOURCE_CACHE_BYTES = 16 * 1024 * 1024;
const REFERENCE_BYTES = 64, DECLARATION_BYTES = 256;
function compact(symbols) {
  const positions = new Uint32Array(symbols.length * 3), types = new Uint8Array(symbols.length);
  symbols.forEach((symbol, i) => { positions.set([symbol.offset, symbol.line, symbol.character], i * 3); types[i] = kinds.indexOf(symbol.kind); });
  // 复制名称，避免字符串切片继续持有整份源码；数字位置以紧凑数组存储。
  return { symbols: JSON.parse(JSON.stringify(symbols.map(symbol => symbol.name))), positions, kinds: types };
}
function symbolAt(entry, i, file) {
  return { name: entry.symbols[i], offset: entry.positions[i * 3], line: entry.positions[i * 3 + 1], character: entry.positions[i * 3 + 2], kind: kinds[entry.kinds[i]], file };
}

function symbolAfter(symbols, offset) {
  let from = 0, to = symbols.length;
  while (from < to) {
    const middle = (from + to) >>> 1;
    if (symbols[middle].offset < offset) from = middle + 1; else to = middle;
  }
  return symbols[from];
}

function findSymbol(symbols, item) {
  const symbol = symbolAfter(symbols, item.offset);
  return symbol?.offset === item.offset && symbol.name === item.name ? symbol : null;
}

export class SymbolIndex {
  #updates = new Map();
  files = new Map();
  versions = new Map();
  names = new Map();
  pending = new Map();
  contents = new Map();
  cache = new Map();
  cacheSize = 0;
  sequence = 0;
  constructor(analyzer = analyze, { read, external, cacheBytes = read ? SOURCE_CACHE_BYTES : Infinity } = {}) { this.analyzer = analyzer; this.read = read; this.external = external; this.cacheBytes = cacheBytes; }
  async fingerprint(file, text) {
    // 局域网 HTTP 页面可能没有 WebCrypto；此时不做内容合并，仍完整索引。
    if (!globalThis.crypto?.subtle) return `file:${file}:${++this.sequence}`;
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return `${extension(file)}:${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  remember(key, value) {
    this.forget(key);
    const size = value.text.length * 2 + (value.occurrences?.length || 0) * REFERENCE_BYTES + (value.symbols?.length || 0) * DECLARATION_BYTES + (value.bindings?.length || 0) * 96 + (value.members?.size || 0) * 64;
    if (size > this.cacheBytes) return;
    while (this.cacheSize + size > this.cacheBytes) this.forget(this.cache.keys().next().value);
    this.cache.set(key, { value, size }); this.cacheSize += size;
  }
  forget(key) { const old = this.cache.get(key); if (old) { this.cacheSize -= old.size; this.cache.delete(key); } }
  change(file, text) {
    // 索引偏移与编辑器的逻辑文档一致，磁盘换行格式仍由缓冲区保留。
    text = text.replace(/\r\n?/g, '\n');
    const previous = this.#updates.get(file);
    if (previous?.text === text) return previous.work;
    const work = this.#change(file, text), update = { text, work };
    this.#updates.set(file, update);
    const release = () => { if (this.#updates.get(file) === update) this.#updates.delete(file); };
    void work.then(release, release);
    return work;
  }
  async #change(file, text) {
    const version = Symbol();
    this.versions.set(file, version);
    // 先使旧任务失效，再复用已有源码，避免重复哈希和无 WebCrypto 时重建详细解析。
    if (this.cache.get(this.files.get(file)?.key)?.value.text === text) return;
    const key = await this.fingerprint(file, text);
    if (this.versions.get(file) !== version || this.files.get(file)?.key === key) return;
    const old = this.contents.get(key);
    const work = old ? Promise.resolve(old) : this.pending.get(key) || this.analyzer(file, text, false).then(result => ({
      key, filter: result.filter === undefined ? textFilter(text) : result.filter,
      ...compact(result.symbols), paths: new Set(),
    }));
    this.pending.set(key, work);
    try {
      const result = await work;
      if (this.versions.get(file) !== version) return;
      this.install(file, result);
      this.remember(key, { text });
    } finally { if (this.pending.get(key) === work) this.pending.delete(key); }
  }
  install(file, result) {
    this.remove(file, false);
    if (!result.paths.size) for (const [i, name] of result.symbols.entries()) {
        const nameKey = `${family(file)}\0${name}`;
        if (!this.names.has(nameKey)) this.names.set(nameKey, { name, contents: new Map() });
        const group = this.names.get(nameKey);
        result.symbols[i] = group.name;
        // 名称集合同时记录首个声明序号，补全不再逐个重扫整份声明。
        if (!group.contents.has(result)) group.contents.set(result, i);
      }
    result.paths.add(file); this.contents.set(result.key, result);
    this.files.set(file, result);
  }
  restore(file, entry) {
    this.versions.set(file, Symbol());
    if (this.files.get(file)?.key === entry.key) return;
    this.install(file, this.contents.get(entry.key) || { key: entry.key, filter: Uint32Array.from(entry.filter), ...compact(entry.symbols), paths: new Set() });
  }
  removeNames(file) {
    const entry = this.files.get(file);
    if (!entry || entry.paths.size > 1) return;
    for (const name of new Set(entry.symbols)) {
      const key = `${family(file)}\0${name}`, group = this.names.get(key);
      group.contents.delete(entry); if (!group.contents.size) this.names.delete(key);
    }
  }
  remove(file, invalidate = true) {
    this.removeNames(file);
    const value = this.files.get(file);
    value?.paths.delete(file);
    if (value && !value.paths.size) { this.contents.delete(value.key); this.forget(value.key); }
    if (invalidate) { this.versions.delete(file); this.files.delete(file); this.#updates.delete(file); }
  }
  clear() { this.#updates.clear(); this.versions.clear(); this.files.clear(); this.names.clear(); this.pending.clear(); this.contents.clear(); this.cache.clear(); this.cacheSize = 0; }
  declarations(file) {
    const entry = this.files.get(file);
    return entry ? entry.symbols.map((_name, i) => symbolAt(entry, i, file)) : [];
  }
  candidates(file, name, exact = true) {
    if (extension(file) === 'php') name = name.replace(/^\$/, '');
    const prefix = `${family(file)}\0`, wanted = name.toLowerCase();
    const groups = exact ? [[prefix + name, this.names.get(prefix + name)]] : this.names;
    const matches = [], local = this.files.get(file);
    for (const [key, group] of groups) {
      if (!group || !key.startsWith(prefix) || (exact ? group.name !== name : !group.name.toLowerCase().startsWith(wanted))) continue;
      if (!exact) {
        const entry = group.contents.has(local) ? local : group.contents.keys().next().value;
        matches.push(symbolAt(entry, group.contents.get(entry), entry === local ? file : entry.paths.values().next().value));
      } else for (const entry of group.contents.keys()) for (const [i, value] of entry.symbols.entries()) {
        if (value === name) for (const path of entry.paths) matches.push(symbolAt(entry, i, path));
      }
    }
    return matches
      .sort((a, b) => Number(b.file === file) - Number(a.file === file) || a.file.localeCompare(b.file) || a.offset - b.offset);
  }
  async load(file, detail, signal) {
    signal?.throwIfAborted();
    let entry = this.files.get(file);
    if (!entry) return null;
    let value = this.cache.get(entry.key)?.value;
    const text = value?.text ?? (await this.read(file, signal)).replace(/\r\n?/g, '\n');
    signal?.throwIfAborted();
    if (this.files.get(file) !== entry) return this.load(file, detail, signal);
    if (!value) {
      const changing = this.change(file, text), version = this.versions.get(file);
      await changing;
      signal?.throwIfAborted();
      if (this.versions.get(file) !== version) return this.load(file, detail, signal);
      entry = this.files.get(file);
      if (!entry) return null;
      value = this.cache.get(entry.key)?.value;
    }
    if (detail && !value?.references) {
      // 同内容的窗口和提示共用在途解析；完成即释放，取消仍由各调用方独立处理。
      entry.detail ||= this.analyzer(file, text).finally(() => { delete entry.detail; });
      value = await entry.detail;
    } else value ||= { text };
    signal?.throwIfAborted();
    if (this.files.get(file) !== entry) return this.load(file, detail, signal);
    this.remember(entry.key, value);
    return value;
  }
  async describe(items, signal) {
    const result = [], loaded = new Map();
    for (const item of items) {
      if (item.library) { result.push(item); continue; }
      const entry = this.files.get(item.file);
      if (!entry) continue;
      const value = loaded.get(entry) || await this.load(item.file, true, signal);
      if (value && this.files.get(item.file) === entry) loaded.set(entry, value);
      const symbol = value && (findSymbol(value.symbols, item) || value.bindings?.find(binding => binding.offset === item.offset && binding.name === item.name));
      if (symbol) result.push({ ...symbol, file: item.file });
    }
    return result;
  }
  async navigate(file, name, offset, signal) {
    if (extension(file) === 'php') name = name.replace(/^\$/, '');
    const definitions = await resolveSymbol(this, file, name, offset, signal);
    if (!definitions.some(item => item.file === file && item.offset <= offset && offset <= item.offset + name.length)) return { kind: 'definitions', matches: definitions };
    const source = await this.load(file, true, signal);
    const local = lexicalBinding(source, name, offset), matches = [];
    const declarations = new Set(definitions.map(item => item.file + ':' + item.offset));
    for (const [path, entry] of this.files) {
      signal?.throwIfAborted();
      if (local?.local && path !== file) continue;
      if (family(file) !== family(path) || !mayContain(entry.filter, name)) continue;
      const value = await this.load(path, true, signal);
      if (!value) continue;
      for (const item of value.references.get(name) || []) {
        if (declarations.has(path + ':' + item.offset)) continue;
        const binding = lexicalBinding(value, name, item.offset);
        if (binding && (path !== file || binding.offset !== local?.offset)) continue;
        if (local?.parameter && !binding) continue;
        const imported = value.imports?.find(binding => binding.local === name);
        if (imported) {
          const targets = await resolveSymbol(this, path, name, item.offset, signal);
          if (!targets.some(target => declarations.has(target.file + ':' + target.offset))) continue;
        }
        const line = lineAt(value.starts, item.offset), end = value.starts[line + 1];
        matches.push({ file: path, line, character: item.offset - value.starts[line], length: name.length, lineText: value.text.slice(value.starts[line], end === undefined ? undefined : end - 1) });
      }
    }
    return { kind: 'usages', matches, ambiguous: definitions.length > 1 };
  }
  resolve(file, name, offset, signal) { return resolveSymbol(this, file, name, offset, signal); }
  async search(query, limit = 500, signal) {
    signal?.throwIfAborted();
    const matches = [];
    if (!query) return { matches, truncated: false };
    for (const [file, entry] of this.files) {
      signal?.throwIfAborted();
      if (!mayContain(entry.filter, query)) continue;
      const value = await this.load(file, false, signal);
      if (!value) continue;
      let line = 0;
      for (const lineText of value.text.split('\n')) {
        for (const match of literalMatches(lineText, query, false)) {
          if (matches.length === limit) return { matches, truncated: true };
          matches.push({ file, line, character: match.from, length: match.to - match.from, lineText });
        }
        line++;
      }
    }
    return { matches, truncated: false };
  }
}
