const identifiers = /^(?:VariableDefinition|TypeDefinition|PropertyDefinition|DefName|BoundIdentifier|Definition|Identifier|VariableName|FieldName|Name|variableName\.definition)$/;
const declarations = /^(?:AmbientFunctionDeclaration|FunctionDeclaration|FunctionDefinition|FunctionDecl|FunctionItem|MethodDeclaration|MethodDecl|MethodDefinition|ClassDeclaration|ClassDefinition|InterfaceDeclaration|StructItem|EnumItem|TypeAliasDeclaration|VariableDeclaration|LetDeclaration|ConstItem|VarSpec|VarDecl|InitDeclarator|VariableDeclarator)$/;
const parameters = /^(?:ParamList|ParameterList|Parameters|FormalParameters|Parameter|FormalParameter|ParameterDeclaration)$/;
const loops = /^(?:ForOfSpec|ForInSpec)$/;
const scopes = /^(?:FunctionDefinition|ClassDefinition|MethodDeclaration|FunctionExpression|ArrowFunction|LambdaExpression)$/;
const goScopes = /^(?:Block|FunctionDecl|MethodDecl|FunctionLit|IfStatement|ForStatement|SwitchStatement|SelectStatement|ExpressionCase|TypeCase|CommunicationCase)$/;
const externalBindings = /^(?:UseList|GlobalDeclaration|ScopeStatement)$/;

function firstName(parent) {
  if (loops.test(parent.name)) return null;
  const cursor = parent.cursor();
  for (;;) {
    const skip = parameters.test(cursor.name) || /^(?:Block|Body|CompoundStatement)$/.test(cursor.name);
    if (!skip && identifiers.test(cursor.name)) return cursor.from;
    // 游标可能移到兄弟声明，结束位置限定在本声明内。
    if (!cursor.next(!skip) || cursor.from >= parent.to) return undefined;
  }
}

function declarationName(node) {
  if (!identifiers.test(node.name)) return null;
  if (node.name === 'variableName.definition') return node;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parameters.test(parent.name) || /Expression|Block|Body|Program|Script|SourceFile/.test(parent.name)) return null;
    if (!declarations.test(parent.name) && !loops.test(parent.name)) continue;
    if (node.name === 'VariableDefinition') return parent;
    return firstName(parent) === node.from ? parent : null;
  }
  return null;
}

const assignments = {
  go: node => node.name === 'DefName' && /^(?:VarDecl|VarSpec|ConstSpec)$/.test(node.parent?.name) ? node.parent : null,
  php: node => node.name === 'VariableName' && node.parent?.name === 'AssignmentExpression' && node.parent.firstChild.from === node.from ? node.parent : null,
  py(node) {
    if (node.name !== 'VariableName' || node.parent?.name !== 'AssignStatement') return null;
    const parent = node.parent, operator = parent.getChild('AssignOp');
    // 多目标和链式赋值均绑定左侧名字，右侧的普通变量只是用法。
    return node.to <= (operator?.from ?? parent.to) || node.nextSibling?.name === 'AssignOp' ? parent : null;
  },
};

function parameterNames(node, ext) {
  if (externalBindings.test(node.name)) return node.getChildren('VariableName');
  if (ext === 'go') return node.getChildren('Parameter').flatMap(child => child.getChildren('DefName'));
  const result = [];
  let first = true;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (ext === 'php') { const name = child.getChild('VariableName'); if (name) result.push(name); }
    else if (child.name === ',') first = true;
    else if (first && child.name === 'VariableName') { result.push(child); first = false; }
  }
  return result;
}

function bindParameters(node, text, ext, bound) {
  if (!['py', 'php', 'go'].includes(ext)) return;
  if (!/^(?:ParamList|Parameters)$/.test(node.name) && !externalBindings.test(node.name)) return;
  const names = bound(node.parent);
  for (const name of parameterNames(node, ext)) names.add(text.slice(name.from, name.to));
}

function declarationKind(node, declaration) {
  if (/Function|Method/.test(declaration.name)) return 'function';
  let next = node.nextSibling;
  while (next && /^(?:TypeAnnotation|.*Comment)$/.test(next.name)) next = next.nextSibling;
  if (!/^(?:Equals|AssignOp|=|:=)$/.test(next?.name)) return 'variable';
  next = next.nextSibling;
  while (next) {
    if (/Comment$/.test(next.name)) next = next.nextSibling;
    else if (next.name === 'ParenthesizedExpression') next = next.firstChild?.nextSibling;
    else break;
  }
  return /^(?:ArrowFunction|FunctionExpression|LambdaExpression|FunctionLiteral|ClosureExpression)$/.test(next?.name) ? 'function' : 'variable';
}

export function sourceDeclarations(tree, text, ext) {
  const result = [], bindings = new Map(), implicit = ['py', 'php', 'go'].includes(ext);
  const scopeNames = ext === 'go' ? goScopes : scopes;
  const bound = node => {
    let scope = node;
    while (scope && !scopeNames.test(scope.name)) scope = scope.parent;
    // Go 函数体与参数属于同一声明作用域，内部代码块仍各自独立。
    if (ext === 'go' && scope?.name === 'Block' && /^(?:FunctionDecl|MethodDecl|FunctionLit)$/.test(scope.parent?.name)) scope = scope.parent;
    const key = scope ? `${scope.name}:${scope.from}` : 'file';
    if (!bindings.has(key)) bindings.set(key, new Set());
    return bindings.get(key);
  };
  tree?.iterate({ enter(cursor) {
    const node = cursor.node;
    bindParameters(node, text, ext, bound);
    const assigned = assignments[ext]?.(node);
    const declaration = assigned || declarationName(node);
    if (!declaration) return;
    const raw = text.slice(node.from, node.to), dollar = ext === 'php' && raw.startsWith('$');
    // 解析器会为未输入的声明名称生成零长度占位节点。
    if (!raw) return;
    if (implicit) {
      const names = bound(declaration.parent);
      if (assigned && names.has(raw)) return;
      names.add(raw);
    }
    result.push({ name: dollar ? raw.slice(1) : raw, offset: node.from + Number(dollar), kind: declarationKind(node, declaration) });
  } });
  return result;
}
