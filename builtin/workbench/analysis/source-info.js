import { loadLanguage } from '../editor/languages.js';

const declarations = /^(?:FunctionDeclaration|FunctionDefinition|FunctionDecl|FunctionItem|MethodDeclaration|MethodDecl|MethodDefinition|ConstructorDeclaration|ArrowFunction)$/;
const bodies = /^(?:Block|CompoundStatement|Body|ConstructorBody)$/;
const ignored = /^(?:LineComment|BlockComment|Comment|String|StringLiteral|RawString|CharLiteral|CharacterLiteral|RegExp|comment|string(?:\..*)?)$/;
const interpolations = { TemplateString: 'Interpolation', FormatString: 'FormatReplacement' };

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

export function sourceSignature(text, symbol, parsed) {
  const declaration = /func|method|generator/i.test(symbol.kind) ? declarationAt(parsed.tree, symbol.offset) : null;
  if (declaration) {
    let end = declaration.to;
    for (let child = declaration.firstChild; child; child = child.nextSibling) {
      if (bodies.test(child.name)) { end = child.from; break; }
    }
    return text.slice(declaration.from, end).trim().replace(/;$/, '').trim();
  }
  // 旧语言模式只提供着色标记，保留源码声明头，不猜测缺少的类型。
  const lineStart = text.lastIndexOf('\n', symbol.offset - 1) + 1;
  const lines = text.slice(lineStart).split('\n');
  let header = '', depth = 0;
  for (const line of lines) {
    for (let column = 0; column < line.length; column++) {
      const character = line[column];
      if (character === '(') depth++;
      if (character === ')') depth--;
      if (character === '{' && depth === 0) return (header + line.slice(0, column)).trim();
    }
    header += (header ? '\n' : '') + line.trim();
    if (depth <= 0) break;
  }
  return header.replace(/;$/, '').trim();
}

export function precedingComment(text, offset, parsed) {
  const declaration = declarationAt(parsed.tree, offset);
  let start = declaration?.from ?? text.lastIndexOf('\n', offset - 1) + 1;
  // export、装饰器和模板包装属于声明，不阻断紧邻的文档注释。
  for (let node = declaration?.parent; node && /^(?:ExportDeclaration|DecoratedStatement|TemplateDeclaration)$/.test(node.name); node = node.parent) start = node.from;
  const parts = [];
  for (const range of [...parsed.excluded].reverse()) {
    if (range.to > start) continue;
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
