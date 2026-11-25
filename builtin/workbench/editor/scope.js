import { StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { foldNodeProp, language, LRLanguage, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';

const functions = new Set('FunctionDeclaration FunctionExpression ArrowFunction MethodDeclaration ConstructorDeclaration FunctionDefinition FunctionItem FunctionDecl MethodDecl'.split(' '));
const types = new Set('ClassDeclaration ClassExpression ClassDefinition ClassSpecifier StructSpecifier InterfaceDeclaration TypeAliasDeclaration StructItem EnumItem EnumDeclaration EnumSpecifier TraitItem ImplItem TypeSpec'.split(' '));
const namespaces = new Set(['NamespaceDefinition', 'NamespaceDeclaration']);
const names = new Set('VariableDefinition TypeDefinition PropertyDefinition VariableName Definition Name DefName FieldName TypeIdentifier BoundIdentifier Identifier FieldIdentifier ScopedIdentifier ScopedTypeIdentifier QualifiedIdentifier NamespaceIdentifier DestructorName'.split(' '));
const declarators = new Set('FunctionDeclarator PointerDeclarator ReferenceDeclarator'.split(' '));
const bindings = new Set('VariableDeclaration Property PropertyDeclaration AssignmentExpression AssignExpression'.split(' '));

function bindingName(node) {
  while (node.parent?.name === 'ParenthesizedExpression') node = node.parent;
  if (!bindings.has(node.parent?.name)) return null;
  for (let child = node.prevSibling; child; child = child.prevSibling) {
    if (child.name === ',') break;
    if (names.has(child.name)) return child;
  }
  return null;
}

function declarationName(node) {
  for (let child = node.firstChild; child; child = child.nextSibling) if (declarators.has(child.name)) return declarationName(child);
  // impl Trait for Store 的接收类型在最后，泛型参数不属于名称。
  if (node.name === 'ImplItem') {
    for (let child = node.lastChild; child; child = child.prevSibling) {
      const name = child.name === 'GenericType' ? child.firstChild : child;
      if (names.has(name?.name)) return name;
    }
    return null;
  }
  for (let child = node.firstChild; child; child = child.nextSibling) if (names.has(child.name)) return child;
  return bindingName(node);
}

export function declarationKind(node) {
  if (functions.has(node.name) || node.name === 'Property' && node.node.getChild('ParamList')) return 'function';
  if (types.has(node.name)) return 'type';
  return namespaces.has(node.name) ? 'namespace' : null;
}

const declarationWrappers = new Set(['ExportDeclaration', 'DecoratedStatement', 'TemplateDeclaration', 'AmbientDeclaration']);

export function declarationStart(node) {
  if (!declarationName(node)) return null;
  while (declarationWrappers.has(node.parent?.name)) node = node.parent;
  return node.from;
}

function namedScope(node, state) {
  const kind = declarationKind(node);
  const name = kind && declarationName(node);
  return name ? { name: state.doc.sliceString(name.from, name.to), kind, head: name.from } : null;
}

export function symbolAtOffset(symbols, offset) {
  let from = 0, to = symbols.length;
  while (from < to) {
    const middle = (from + to) >>> 1;
    if (symbols[middle].offset < offset) from = middle + 1;
    else to = middle;
  }
  const symbol = symbols[from];
  return symbol?.offset === offset ? symbol : null;
}

export function symbolKind(kind, owner) {
  if (kind === 'namespace') return 'type';
  return kind === 'function' && owner === 'type' ? 'method' : kind;
}

export function outlineScopes(state, symbols) {
  const result = new Map();
  if (!(state?.facet(language) instanceof LRLanguage) || !symbols.length) return result;
  const tree = syntaxTree(state), ready = syntaxTreeAvailable(state, tree.length), stack = [];
  let next = 0;
  // 声明索引按源码位置排序。每个节点只处理落在它范围内的符号。
  function readUntil(end) {
    while (next < symbols.length && symbols[next].offset < end) {
      const { offset, name, kind } = symbols[next++];
      const inner = stack.at(-1), own = inner?.head === offset, parent = own ? stack.at(-2) : inner;
      if (!inner || (kind !== 'variable' && kind !== 'function') || (!ready && !syntaxTreeAvailable(state, offset + name.length))
        || state.doc.sliceString(offset, offset + name.length) !== name) continue;
      const displayKind = symbolKind(own && inner.kind !== 'function' ? inner.kind : kind, parent?.kind);
      const local = displayKind === 'variable' && parent?.kind === 'function';
      const { depth = 0, path = '' } = parent ?? {};
      if (path || local || displayKind !== kind) result.set(offset, { kind: displayKind, depth, parent: path, local });
    }
  }
  tree.iterate({
    enter(node) {
      readUntil(node.from);
      if (next === symbols.length || symbols[next].offset >= node.to) return false;
      const kind = declarationKind(node);
      if (!kind) return;
      const definition = declarationName(node.node);
      const head = definition?.from;
      const name = definition ? state.doc.sliceString(head, definition.to) : '';
      const indexed = !!name && symbolAtOffset(symbols, head)?.name === name;
      const parent = stack.at(-1);
      const path = name && parent?.path ? `${parent.path}.${name}` : name || parent?.path || '';
      stack.push({ type: node.type, from: node.from, head, kind, path, depth: (parent?.depth ?? 0) + Number(indexed) });
    },
    leave(node) {
      readUntil(node.to);
      const scope = stack.at(-1);
      if (scope?.type === node.type && scope.from === node.from) stack.pop();
    },
  });
  return result;
}

function foldedBlock(node, state) {
  if (/comment|string/i.test(node.name)) return null;
  const fold = node.type.prop(foldNodeProp)?.(node, state);
  if (!fold || state.doc.lineAt(fold.from).number === state.doc.lineAt(fold.to).number) return null;
  return { from: fold.from, to: fold.to, header: node.from };
}

/** 只沿当前位置的语法祖先链读取，不触发全文解析或项目索引。 */
export function readScope(state, head = state.selection.main.head) {
  const path = [], tree = syntaxTree(state);
  const before = head === state.doc.length ? tree.resolveInner(head, -1) : null;
  // EOF 的缺失闭合符仍有真实错误节点；完整闭合后的光标属于文件顶层。
  const start = before?.lastChild?.type.isError ? before : tree.resolveInner(head, 1);
  let block = null;
  for (let node = start; node; node = node.parent) {
    block ||= foldedBlock(node, state);
    const scope = namedScope(node, state);
    if (scope) path.push(scope);
  }
  return { path: path.reverse(), block, ready: !state.facet(language) || syntaxTreeAvailable(state, head) };
}

export function siblingDeclarations(state, symbols, parents) {
  return symbols.filter(symbol => {
    if (state.doc.sliceString(symbol.offset, symbol.offset + symbol.name.length) !== symbol.name) return false;
    const path = readScope(state, symbol.offset).path;
    if (path.at(-1)?.head === symbol.offset) path.pop();
    return path.length === parents.length && path.every((scope, index) => scope.head === parents[index].head);
  });
}

function samePath(left, right) {
  return left.length === right.length && left.every((scope, index) => {
    const other = right[index];
    return scope.head === other.head && scope.name === other.name && scope.kind === other.kind;
  });
}

function reuseScope(previous, next) {
  if (!previous) return next;
  const { path, block } = previous;
  if (samePath(path, next.path)) next.path = path;
  if (next.block?.from === block?.from && next.block?.to === block?.to && next.block?.header === block?.header) next.block = block;
  return next.path === path && next.block === block && next.ready === previous.ready ? previous : next;
}

export const scopeContext = StateField.define({
  create: readScope,
  update(value, transaction) {
    if (!transaction.docChanged && !transaction.selection && syntaxTree(transaction.startState) === syntaxTree(transaction.state)) return value;
    return reuseScope(value, readScope(transaction.state));
  },
});

const listeners = new WeakMap(), readingScopes = new WeakMap();

function notify(view) { for (const listener of listeners.get(view) || []) listener(); }

function readingScope(view) {
  const current = readingScopes.get(view);
  return current?.doc === view.state.doc && current.selection === view.state.selection ? current : null;
}

export function displayScope(view) {
  return readingScope(view)?.context ?? view.state.field(scopeContext);
}

export function readingScopeHead(view) { return readingScope(view)?.head ?? null; }

export function updateReadingScope(view, head) {
  const current = readingScopes.get(view);
  view.dom.toggleAttribute('data-reading-viewport', head !== null);
  if (head === null) {
    if (readingScopes.delete(view)) notify(view);
    return;
  }
  const { state } = view, tree = syntaxTree(state);
  if (current?.head === head && current.tree === tree && current.doc === state.doc && current.selection === state.selection) return;
  const previous = current?.context;
  const context = reuseScope(previous, { ...readScope(state, head), reading: true });
  readingScopes.set(view, { head, tree, doc: state.doc, selection: state.selection, context });
  if (context !== previous) notify(view);
}

export function observeScope(view, listener) {
  if (!listeners.has(view)) listeners.set(view, new Set());
  const group = listeners.get(view);
  group.add(listener);
  return () => { group.delete(listener); if (!group.size) listeners.delete(view); };
}

export const scopeTracking = [scopeContext, EditorView.updateListener.of(update => {
  const { view, startState, state } = update;
  if (update.selectionSet && readingScopes.has(view)) updateReadingScope(view, null);
  else if (syntaxTree(startState) !== syntaxTree(state)
    || !readingScopes.has(view) && startState.field(scopeContext, false) !== state.field(scopeContext, false)) notify(view);
})];
