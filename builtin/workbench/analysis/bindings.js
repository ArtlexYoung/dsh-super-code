const scopes = /^(?:Block|Body|CompoundStatement|ClassBody|FunctionDeclaration|FunctionDefinition|FunctionDecl|FunctionItem|FunctionExpression|FunctionLit|MethodDeclaration|MethodDecl|MethodDefinition|ArrowFunction|LambdaExpression|ClosureExpression)$/;
const functions = /^(?:FunctionDeclaration|FunctionDefinition|FunctionDecl|FunctionItem|FunctionExpression|FunctionLit|MethodDeclaration|MethodDecl|MethodDefinition|ArrowFunction|LambdaExpression|ClosureExpression)$/;
const lists = /^(?:ParamList|ParameterList|Parameters|FormalParameters)$/;
const names = { js: 'VariableDefinition', ts: 'VariableDefinition', tsx: 'VariableDefinition', py: 'VariableName', go: 'DefName', rs: 'BoundIdentifier', c: 'Identifier', cpp: 'Identifier', java: 'Definition', php: 'VariableName' };

function enclosing(node, pattern) {
  for (; node; node = node.parent) if (pattern.test(node.name)) return node;
  return null;
}

function range(node, length) { return { from: node?.from ?? 0, to: node?.to ?? length }; }

function parameter(node, ext) {
  if (node.name !== names[ext]) return null;
  let parent = node.parent;
  for (; parent && !lists.test(parent.name); parent = parent.parent) {
    if (/Type|Expression|Function|Body|Block/.test(parent.name)) return null;
  }
  if (!parent) return null;
  if (ext === 'py') {
    if (node.parent !== parent) return null;
    for (let before = node.prevSibling; before && before.name !== ','; before = before.prevSibling) if (before.name === 'VariableName') return null;
  }
  if (['c', 'cpp'].includes(ext) && /^(?:Optional)?ParameterDeclaration$/.test(node.parent?.name) && node.parent.getChild('Identifier')?.from !== node.from) return null;
  let part = node;
  while (part.parent !== parent) part = part.parent;
  let from = part.from, to = part.to;
  for (let next = part.nextSibling; next && ![',', ')'].includes(next.name); next = next.nextSibling) to = next.to;
  return { scope: enclosing(parent.parent, functions), from, to };
}

function pythonImports(node, text) {
  const parts = [];
  for (let child = node.firstChild; child; child = child.nextSibling) parts.push(child);
  const from = parts.findIndex(child => child.name === 'from'), keyword = parts.findIndex(child => child.name === 'import');
  const source = from >= 0 ? text.slice(parts[from].to, parts[keyword].from).trim() : null;
  const result = [], tail = parts.slice(keyword + 1);
  for (let start = 0; start < tail.length;) {
    let end = start; while (end < tail.length && tail[end].name !== ',') end++;
    const part = tail.slice(start, end), names = part.filter(child => ['VariableName', 'DottedName'].includes(child.name));
    if (names.length) {
      const original = text.slice(names[0].from, names[0].to), alias = names.at(-1);
      const module = source || text.slice(names[0].from, part.find(child => child.name === 'as')?.from ?? alias.to).trim();
      result.push({ local: text.slice(alias.from, alias.to), imported: source ? original : '*', source: module, offset: alias.from });
    }
    start = end + 1;
  }
  return result;
}

function groupedNames(group, text) {
  const result = [];
  let part = [];
  for (let child = group.firstChild; child; child = child.nextSibling) {
    if (![',', '}'].includes(child.name)) { part.push(child); continue; }
    const identifiers = part.filter(item => /^(?:VariableName|VariableDefinition|String)$/.test(item.name));
    part = [];
    if (!identifiers.length) continue;
    const name = item => text.slice(item.from, item.to).replace(/^['"]|['"]$/g, '');
    result.push({ original: name(identifiers[0]), alias: name(identifiers.at(-1)), offset: identifiers.at(-1).from });
  }
  return result;
}

function declarationsWithin(symbols, from, to) {
  let start = 0, end = symbols.length;
  while (start < end) {
    const middle = (start + end) >>> 1;
    if (symbols[middle].offset < from) start = middle + 1; else end = middle;
  }
  end = start;
  while (end < symbols.length && symbols[end].offset < to) end++;
  return symbols.slice(start, end);
}

function namedExports(node, text, source, symbols) {
  if (node.getChild('Star') && source) return [{ exported: '*', local: '*', source }];
  if (!node.getChild('default')) return declarationsWithin(symbols, node.from, node.to).map(item => ({ exported: item.name, local: item.name, source: null }));
  const declaration = node.getChild('FunctionDeclaration') || node.getChild('ClassDeclaration');
  const name = declaration?.getChild('VariableDefinition') || node.getChild('VariableName');
  return name ? [{ exported: 'default', local: text.slice(name.from, name.to), source: null }] : [];
}

function importBindings(tree, text, symbols) {
  const imports = [], exports = [];
  for (let node = tree?.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === 'ImportStatement') { imports.push(...pythonImports(node, text)); continue; }
    if (!['ImportDeclaration', 'ExportDeclaration'].includes(node.name)) continue;
    const imported = node.name === 'ImportDeclaration', string = node.getChild('String');
    const source = string ? text.slice(string.from + 1, string.to - 1) : null;
    const group = node.getChild(imported ? 'ImportGroup' : 'ExportGroup');
    if (group) for (const item of groupedNames(group, text)) {
      if (imported) imports.push({ local: item.alias, imported: item.original, source, offset: item.offset });
      else exports.push({ exported: item.alias, local: item.original, source });
    }
    if (imported) {
      for (const name of node.getChildren('VariableDefinition')) imports.push({ local: text.slice(name.from, name.to), imported: node.getChild('Star') ? '*' : 'default', source, offset: name.from });
    } else if (!group) exports.push(...namedExports(node, text, source, symbols));
  }
  return { imports, exports };
}

/** 词法绑定独立于文件结构；参数与导入不会污染项目级声明列表。 */
export function sourceBindings(tree, text, ext, symbols) {
  const bindings = [], members = new Map(), byOffset = new Map(symbols.map(item => [item.offset, item]));
  tree?.iterate({ enter(cursor) {
    const node = cursor.node, symbol = byOffset.get(node.from);
    if (symbol && text.slice(node.from, node.to).replace(/^\$/, '') === symbol.name) {
      const declaration = symbol.kind === 'function' ? enclosing(node.parent, functions) : /^(?:ClassDeclaration|InterfaceDeclaration)$/.test(node.parent?.name) ? node.parent : null;
      const parent = declaration ? declaration.parent : node.parent;
      const scope = enclosing(parent, scopes);
      const local = !!scope && scope.name !== 'ClassBody' && scope.parent?.name !== 'NamespaceDefinition';
      bindings.push({ ...symbol, local, ...range(scope, text.length) });
    }
    const param = parameter(node, ext);
    if (param?.scope) {
      const raw = text.slice(node.from, node.to), dollar = ext === 'php' && raw.startsWith('$');
      bindings.push({ name: raw.slice(Number(dollar)), offset: node.from + Number(dollar), kind: 'variable',
        declaration: text.slice(param.from, param.to), parameter: true, local: true, ownerFrom: param.scope.from, ...range(ext === 'py' ? param.scope.getChild('Body') || param.scope : param.scope, text.length) });
    }
    if (node.name === 'PropertyName' && node.parent?.name === 'MemberExpression' && node.parent.lastChild?.from === node.from) {
      const receiver = node.parent.firstChild;
      members.set(node.from, receiver?.name === 'VariableName' ? { name: text.slice(receiver.from, receiver.to), offset: receiver.from } : null);
    }
  } });
  return { bindings, members, ...importBindings(tree, text, bindings.filter(item => !item.parameter && item.from === 0 && item.to === text.length)) };
}

export function lexicalBinding(source, name, offset) {
  if (source.members?.has(offset)) return null;
  let best;
  for (const item of source.bindings || []) {
    if (item.name !== name) continue;
    if (item.parameter && item.offset <= offset && offset < item.offset + name.length) return item;
    if (offset < item.from || offset >= item.to) continue;
    if (!best || item.to - item.from < best.to - best.from) best = item;
  }
  return best;
}

function pythonModule(file, source, files) {
  const relative = source.match(/^\.+/)?.[0].length || 0, folders = relative ? file.split('/').slice(0, -relative) : [];
  if (relative > file.split('/').length - 1) return null;
  const path = [...folders, source.slice(relative).replaceAll('.', '/')].filter(Boolean).join('/');
  return [path + '.pyi', path + '.py', path + '/__init__.pyi', path + '/__init__.py'].find(candidate => files.has(candidate)) || null;
}

export function modulePath(file, source, files) {
  if (file.endsWith('.py') || file.endsWith('.pyi')) return pythonModule(file, source, files);
  if (!source?.startsWith('.')) return null;
  const parts = file.split('/').slice(0, -1);
  for (const part of source.split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  const path = parts.join('/'), base = path.replace(/\.(?:m?js|cjs|jsx)$/, '');
  // 先遵从写出的扩展名，再采用 TS 常用的运行时 JS 路径与目录入口。
  const candidates = [path, ...['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].map(ext => base + ext),
    ...['.ts', '.tsx', '.js', '.jsx'].map(ext => path + '/index' + ext)];
  return candidates.find(candidate => files.has(candidate)) || null;
}
