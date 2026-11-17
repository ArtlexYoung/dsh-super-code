import { loadLanguage } from '../editor/languages.js';

const declarations = /^(?:FunctionDeclaration|FunctionDefinition|FunctionDecl|FunctionItem|MethodDeclaration|MethodDecl|MethodDefinition|ConstructorDeclaration|ArrowFunction)$/;
const bindings = /^(?:VariableDeclaration|LetDeclaration|VarSpec|ConstSpec|ConstItem|StaticItem|AssignStatement|AssignmentExpression|FieldDeclaration|LocalVariableDeclaration|PropertyDeclaration|Declaration)$/;
const bodies = /^(?:Block|CompoundStatement|Body|ConstructorBody)$/;
const ignored = /^(?:LineComment|BlockComment|Comment|String|StringLiteral|RawString|CharLiteral|CharacterLiteral|RegExp|comment|string(?:\..*)?)$/;
const interpolations = { TemplateString: 'Interpolation', FormatString: 'FormatReplacement' };

export function lineAt(starts, offset) {
  let low = 0, high = starts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] <= offset) low = middle; else high = middle;
  }
  return low;
}

export function excludedAt(ranges, offset) {
  let low = 0, high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle].to <= offset) low = middle + 1; else high = middle;
  }
  return ranges[low]?.from <= offset;
}

export async function parseSource(file, text) {
  const support = await loadLanguage(file);
  const language = support.language || support;
  if (!language.parser) return { tree: null, excluded: [] };
  const tree = language.parser.parse(text), excluded = [];
  tree.iterate({ enter(node) {
    if (ignored.test(node.name)) { excluded.push({ from: node.from, to: node.to, kind: /comment/i.test(node.name) ? 'comment' : 'string' }); return false; }
    // 模板文本不算引用，但 ${...} 内的代码仍参与索引。
    const interpolation = interpolations[node.name];
    if (!interpolation) return;
    let from = node.from;
    for (let child = node.node.firstChild; child; child = child.nextSibling) {
      if (child.name !== interpolation) continue;
      excluded.push({ from, to: child.from, kind: 'string' }); from = child.to;
    }
    excluded.push({ from, to: node.to, kind: 'string' });
  } });
  excluded.sort((a, b) => a.from - b.from);
  return { tree, excluded };
}

export function declarationAt(tree, offset) {
  for (let node = tree?.resolveInner(offset, 1); node; node = node.parent) {
    if (declarations.test(node.name)) return node;
  }
  return null;
}

function bindingAt(tree, offset) {
  for (let node = tree?.resolveInner(offset, 1); node; node = node.parent) {
    if (bindings.test(node.name)) return node;
  }
  return null;
}

export function sourceSignature(text, symbol, parsed) {
  const declaration = /func|method|generator/i.test(symbol.kind) ? declarationAt(parsed.tree, symbol.offset) : null;
  if (declaration) {
    let end = declaration.to;
    for (let child = declaration.firstChild; child; child = child.nextSibling) {
      if (bodies.test(child.name)) { end = child.from; break; }
    }
    return text.slice(declaration.from, end).trim().replace(/;$/, '').trim();
  }
  // 只读取所属声明；旧词法模式没有声明节点时仍沿用源码行，不猜测缺少的类型。
  const binding = bindingAt(parsed.tree, symbol.offset), limit = binding?.to ?? text.length;
  const lineStart = binding?.from ?? text.lastIndexOf('\n', symbol.offset - 1) + 1;
  let header = '', depth = 0;
  for (let from = lineStart; from < limit;) {
    const remaining = text.slice(from, limit), next = remaining.indexOf('\n');
    const end = next < 0 ? limit : from + next, line = next < 0 ? remaining : remaining.slice(0, next);
    for (let column = 0; column < line.length; column++) {
      const character = line[column];
      if (character === '(') depth++;
      if (character === ')') depth--;
      if (character === '{' && depth === 0) return (header + line.slice(0, column)).trim();
    }
    header += (header ? '\n' : '') + line.trim();
    if (depth <= 0 || end === limit) break;
    from = end + 1;
  }
  return header.replace(/;$/, '').trim();
}

export function precedingComment(text, offset, parsed) {
  const declaration = declarationAt(parsed.tree, offset);
  let start = declaration?.from ?? text.lastIndexOf('\n', offset - 1) + 1;
  // export、装饰器和模板包装属于声明，不阻断紧邻的文档注释。
  for (let node = declaration?.parent; node && /^(?:ExportDeclaration|DecoratedStatement|TemplateDeclaration)$/.test(node.name); node = node.parent) start = node.from;
  const parts = [];
  let low = 0, high = parsed.excluded.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (parsed.excluded[middle].to <= start) low = middle + 1; else high = middle;
  }
  for (let index = low - 1; index >= 0; index--) {
    const range = parsed.excluded[index];
    if (text.slice(range.to, start).trim()) break;
    if (range.kind !== 'comment') break;
    parts.unshift(text.slice(range.from, range.to)); start = range.from;
  }
  return parts.join('\n');
}

export function pythonDocstring(text, offset, parsed) {
  const declaration = declarationAt(parsed.tree, offset);
  if (!declaration || declaration.name !== 'FunctionDefinition') return '';
  const body = declaration.getChild('Body'), statement = body?.getChild('ExpressionStatement'), string = statement?.getChild('String');
  if (!string || body.firstChild?.nextSibling?.from !== statement.from) return '';
  const value = text.slice(string.from, string.to).replace(/^[rRuU]?(?:"""|''')/, '').replace(/(?:"""|''')$/, '');
  const lines = value.split('\n'), rest = lines.slice(1);
  const indentation = Math.min(...rest.filter(line => line.trim()).map(line => /^\s*/.exec(line)[0].length));
  return [lines[0].trim(), ...rest.map(line => line.slice(Number.isFinite(indentation) ? indentation : 0))].join('\n').trim();
}

export function identifierOccurrences(text, parsed) {
  const found = [], identifiers = /[\p{L}_$][\p{L}\p{N}_$]*/gu;
  let excluded = 0;
  for (const match of text.matchAll(identifiers)) {
    while (parsed.excluded[excluded]?.to <= match.index) excluded++;
    if (parsed.excluded[excluded]?.from <= match.index) continue;
    const node = parsed.tree?.resolveInner(match.index, 1);
    const parent = node?.parent?.name || '';
    found.push({ name: match[0], offset: match.index, kind: /Call|Invocation|Application/.test(parent) ? 'call' : 'reference' });
  }
  return found;
}
