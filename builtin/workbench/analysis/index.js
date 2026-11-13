import { parseSource, sourceSignature, precedingComment, pythonDocstring, identifierOccurrences } from './source-info.js';
import { parseDocumentation } from './documentation.js';
import { extension } from '../editor/languages.js';

const identifiers = /^(?:VariableDefinition|TypeDefinition|PropertyDefinition|DefName|BoundIdentifier|Definition|Identifier|VariableName|FieldName|Name|variableName\.definition)$/;
const declarations = /^(?:FunctionDeclaration|FunctionDefinition|FunctionDecl|FunctionItem|MethodDeclaration|MethodDecl|MethodDefinition|ClassDeclaration|ClassDefinition|InterfaceDeclaration|StructItem|EnumItem|TypeAliasDeclaration|VariableDeclaration|LetDeclaration|ConstItem|VarSpec|VarDecl|InitDeclarator|VariableDeclarator|AssignStatement)$/;
const parameters = /^(?:ParamList|ParameterList|Parameters|FormalParameters|Parameter|FormalParameter|ParameterDeclaration)$/;
const languageNames = { py: 'Python', php: 'PHP' };
const aliases = { ts: 'js', tsx: 'js', cpp: 'c' };
export const family = file => aliases[extension(file)] || extension(file);
const legacy = new Set(['cs', 'kt', 'swift', 'rb', 'sh']);
const word = '[\\p{L}_$][\\p{L}\\p{N}_$]*';
const functions = new RegExp(`\\b(?:function|def|func|fun)\\s+(?:[\\p{L}_$][\\p{L}\\p{N}_$]*\\.)?(${word})\\s*\\(`, 'gu');
const variables = new RegExp(`(?:\\b(?:let|var|val|const|local|export)\\s+|^\\s*)(${word})\\s*(?::[^=\\n]+)?=(?!=)`, 'gmu');
const typedFunctions = new RegExp(`(?:^|[;{}]\\s*|\\n)\\s*(?:(?:public|private|protected|static|override|async|virtual|internal|sealed|final)\\s+)*(?:[\\w<>?.\\[\\],]+\\s+)+(${word})\\s*\\(`, 'gmu');
const typedVariables = new RegExp(`\\b(?:[\\w<>?.\\[\\]]+)\\s+(${word})\\s*=`, 'gu');

function declarationName(node) {
  if (!identifiers.test(node.name)) return null;
  if (node.name === 'variableName.definition') return node;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'AssignmentExpression' && parent.firstChild?.from === node.from) return parent;
    if (parameters.test(parent.name) || /Expression|Block|Body|Program|Script|SourceFile/.test(parent.name)) return null;
    if (declarations.test(parent.name)) {
      if (parent.name === 'VariableDeclaration' && node.name === 'VariableDefinition') return parent;
      // C、Java 等声明节点中的首个标识符才是声明名，初始化表达式不是定义。
      let first;
      parent.toTree().iterate({ enter(child) {
        if (parameters.test(child.name) || /^(?:Block|Body|CompoundStatement)$/.test(child.name)) return false;
        if (first === undefined && identifiers.test(child.name)) first = child.from + parent.from;
      } });
      return first === node.from ? parent : null;
    }
  }
  return null;
}

export async function analyze(file, text) {
  const parsed = await parseSource(file, text), ext = extension(file), found = new Map(), starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const add = (name, offset, kind) => {
    if (parsed.excluded.some(range => range.from <= offset && offset < range.to)) return;
    found.set(offset, { name, offset, kind });
  };
  parsed.tree?.iterate({ enter(cursor) {
    const declaration = declarationName(cursor.node);
    if (!declaration) return;
    const name = text.slice(cursor.from, cursor.to), dollar = ext === 'php' && name.startsWith('$');
    add(dollar ? name.slice(1) : name, cursor.from + Number(dollar), /Function|Method/.test(declaration.name) ? 'function' : 'variable');
  } });
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
    let line = 0;
    while (starts[line + 1] <= symbol.offset) line++;
    const value = { ...symbol, file, line, character: symbol.offset - starts[line] };
    const raw = ext === 'py' ? pythonDocstring(text, value.offset, parsed) || precedingComment(text, value.offset, parsed) : precedingComment(text, value.offset, parsed);
    return { ...value, declaration: sourceSignature(text, value, parsed), documentation: parseDocumentation(raw, languageNames[ext]) };
  });
  const occurrences = identifierOccurrences(text, parsed).map(item => ext === 'php' && item.name.startsWith('$') ? { ...item, name: item.name.slice(1), offset: item.offset + 1 } : item);
  return { text, symbols, occurrences, starts };
}

export class SymbolIndex {
  files = new Map();
  versions = new Map();
  async change(file, text) {
    const version = Symbol();
    this.versions.set(file, version);
    if (this.files.get(file)?.text === text) return;
    const result = await analyze(file, text);
    if (this.versions.get(file) === version) this.files.set(file, result);
  }
  remove(file) { this.versions.delete(file); this.files.delete(file); }
  clear() { this.versions.clear(); this.files.clear(); }
  candidates(file, name, exact = true) {
    if (extension(file) === 'php') name = name.replace(/^\$/, '');
    return [...this.files].filter(([path]) => family(path) === family(file)).flatMap(([, value]) => value.symbols)
      .filter(item => exact ? item.name === name : item.name.toLowerCase().startsWith(name.toLowerCase()))
      .sort((a, b) => Number(b.file === file) - Number(a.file === file) || a.file.localeCompare(b.file) || a.offset - b.offset);
  }
  navigate(file, name, offset) {
    if (extension(file) === 'php') name = name.replace(/^\$/, '');
    const definitions = this.candidates(file, name), declarations = new Set(definitions.map(item => `${item.file}:${item.offset}`));
    const source = this.files.get(file);
    if (!source?.occurrences.some(item => item.name === name && item.offset <= offset && offset <= item.offset + name.length)) return { kind: 'definitions', matches: [] };
    if (!definitions.some(item => item.file === file && item.offset <= offset && offset <= item.offset + name.length)) return { kind: 'definitions', matches: definitions };
    const matches = [];
    for (const [path, value] of this.files) {
      if (family(file) !== family(path)) continue;
      for (const item of value.occurrences) {
        if (item.name !== name || declarations.has(`${path}:${item.offset}`)) continue;
        let line = 0;
        while (value.starts[line + 1] <= item.offset) line++;
        matches.push({ file: path, line, character: item.offset - value.starts[line], length: name.length, lineText: value.text.split('\n')[line] });
      }
    }
    return { kind: 'usages', matches, ambiguous: definitions.length > 1 };
  }
  search(query, limit = 500) {
    const matches = [], wanted = query.toLocaleLowerCase();
    if (!wanted) return { matches, truncated: false };
    for (const [file, value] of this.files) {
      let line = 0;
      for (const lineText of value.text.split('\n')) {
        const source = lineText.toLocaleLowerCase();
        for (let at = source.indexOf(wanted); at >= 0; at = source.indexOf(wanted, at + wanted.length)) {
          if (matches.length === limit) return { matches, truncated: true };
          matches.push({ file, line, character: at, length: query.length, lineText });
        }
        line++;
      }
    }
    return { matches, truncated: false };
  }
}
