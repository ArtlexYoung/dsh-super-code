import { Facet, Prec, StateEffect, StateField } from '@codemirror/state';
import { ViewPlugin, closeHoverTooltips, keymap, showTooltip } from '@codemirror/view';
import { language, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { loadLanguage } from './languages.js';
import { signatureTree, symbolCard, wordAt } from './code-info.js';
import { errorText, message } from '../locales.js';

const lists = /^(?:ArgList|ArgumentList|Arguments)$/;
const calls = /^(?:CallExpression|CallExpr|MethodInvocation|NewExpression|ObjectCreationExpression)$/;
const parameters = /^(?:ParamList|ParameterList|Parameters|FormalParameters)$/;
const generic = /^(?:InstantiationExpression|ParameterizedExpr|GenericFunction)$/;

export function callAt(state) {
  const head = state.selection.main.head;
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty || !syntaxTreeAvailable(state, head)) return null;
  const list = enclosingArguments(state, head);
  if (!list) return null;
  const callee = callName(state, list.node);
  return callee ? { ...callee, from: list.node.from, to: list.end, ...argumentAt(state, list.node) } : null;
}

function enclosingArguments(state, head) {
  for (let node = syntaxTree(state).resolveInner(head, -1); node; node = node.parent) {
    if (/comment/i.test(node.name)) return null;
    if (!lists.test(node.name) || !calls.test(node.parent?.name)) continue;
    const end = node.lastChild?.name === ')' ? node.lastChild.from : node.to;
    if (head <= node.from || head > end) continue;
    return { node, end };
  }
  return null;
}

function callName(state, list) {
  let callee = list.prevSibling;
  while (callee && generic.test(callee.name)) callee = callee.firstChild;
  if (!callee) return null;
  const name = wordAt(state.doc, callee.to).word;
  return name ? { name, offset: callee.to - name.length, member: /Member|Field|Selector|Scoped|MethodName/.test(callee.name) } : null;
}

const namedArguments = { python: 'AssignOp', php: ':' };
function argumentAt(state, list) {
  let argument = 0, from = list.from + 1, spread = false;
  for (let child = list.firstChild; child && child.from < state.selection.main.head; child = child.nextSibling) {
    if (child.name === ',' && child.to <= state.selection.main.head) { argument++; from = child.to; }
    if (/^(?:Spread|SpreadExpression|SpreadElement|VariadicArgument|\*)$/.test(child.name)) spread = true;
  }
  const argumentNode = list.childAfter(from), name = argumentNode?.name === 'NamedArgument' ? argumentNode.firstChild : argumentNode;
  const operator = namedArguments[state.facet(language)?.name];
  const keyword = operator && name?.nextSibling?.name === operator ? state.doc.sliceString(name.from, name.to) : null;
  return { argument, keyword, spread };
}

function parameterSource(declaration, support) {
  const tree = signatureTree(declaration, support);
  if (tree && /^(?:javascript|typescript)$/.test(support.name) && !/^(?:FunctionDeclaration|VariableDeclaration)$/.test(tree.topNode.firstChild?.name)) {
    // 方法片段须在类中解析；前缀仅用于语法上下文，显示位置仍指向原签名。
    const prefix = 'class Signature { ', text = prefix + declaration + ' {} }', wrapped = signatureTree(text, support);
    const method = wrapped.topNode.getChild('ClassDeclaration')?.getChild('ClassBody')?.getChild('MethodDeclaration');
    if (method?.from === prefix.length) return { tree: wrapped, text, offset: prefix.length };
  }
  return { tree, text: declaration, offset: 0 };
}

function parameterRanges(declaration, support) {
  const { tree, text, offset } = parameterSource(declaration, support);
  if (!tree) return [];
  let list;
  tree.iterate({ enter(node) {
    if (/^(?:TypeParamList|TypeParams|TemplateParameterList)$/.test(node.name)) return false;
    if (!list && parameters.test(node.name)) { list = node.node; return false; }
  } });
  if (!list) return [];
  const ranges = [];
  let from = list.from + 1;
  const add = to => {
    const part = text.slice(from, to), raw = part.trim(), start = from + part.indexOf(raw);
    if (!raw || ['void', '/'].includes(raw)) return;
    let name;
    tree.iterate({ from: start, to: start + raw.length, enter(node) {
      if (name === undefined && /^(?:VariableName|VariableDefinition|Definition|DefName|BoundIdentifier|Identifier)$/.test(node.name)) name = text.slice(node.from, node.to).replace(/^\$/, '');
    } });
    const range = { from: start - offset, to: start + raw.length - offset, raw, name };
    const names = support.name === 'go' ? tree.resolveInner(start, 1).parent?.getChildren('DefName') || [] : [];
    if (names.length > 1) for (const name of names) ranges.push({ ...range, name: text.slice(name.from, name.to) });
    else ranges.push(range);
  };
  for (let child = list.firstChild; child; child = child.nextSibling) {
    if (child.name === ',') { add(child.from); from = child.to; }
  }
  add(list.lastChild?.name === ')' ? list.lastChild.from : list.to);
  return ranges;
}

export function parameterRange(declaration, support, call) {
  if (call.spread) return null;
  const ranges = parameterRanges(declaration, support);
  // 基础索引不解析隐式接收者或展开后的实参数量，无法可靠对应时只展示完整签名。
  if (call.member && /^(?:&\s*)?(?:mut\s+)?(?:self|cls)\b/.test(ranges[0]?.raw || '')) return null;
  const range = call.keyword ? ranges.find(item => item.name === call.keyword) : positionalParameter(ranges, call.argument);
  return range ? { from: range.from, to: range.to, name: range.name } : null;
}

function positionalParameter(ranges, argument) {
  const spread = ranges.findIndex(item => /(?:^|\s)\.\.\.|^\*/.test(item.raw));
  const range = ranges[spread >= 0 && argument >= spread ? spread : argument];
  return !range || range.raw === '*' || range.raw.startsWith('**') ? null : range;
}

const openInfo = Facet.define({ combine: values => values[0] });
const requestInfo = StateEffect.define(), setInfo = StateEffect.define();
export function showParameters(view) {
  if (!view.state.facet(openInfo)) return false;
  view.dispatch({ effects: [closeHoverTooltips, requestInfo.of(true)] }); return true;
}

function renderInfo(dom, call, result, state, t) {
  const label = document.createElement('p'); label.className = 'documentation-candidates';
  label.textContent = message(t, 'parameterPosition', { name: call.name, count: call.argument + 1 });
  dom.replaceChildren(label);
  if (result?.kind === 'ready' && result.items.length) {
    if (result.items.length > 1) label.textContent += ' · ' + t('candidates') + ' ' + result.items.length;
    for (const { item, language } of result.items) dom.append(symbolCard(item, language, t, state, { active: parameterRange(item.declaration, language, call), compact: true }));
    return;
  }
  const note = document.createElement('p'); note.className = 'documentation-card'; note.setAttribute('role', 'status');
  note.textContent = !result ? t('loading') : result.kind === 'error' ? t('parameterFailed') + ' ' + result.message : t('parameterMissing'); dom.append(note);
}

class ParameterInfo {
  constructor(view, index, getFile, t) {
    this.view = view; this.index = index; this.getFile = getFile; this.t = t; this.call = null;
    this.create = () => {
      const dom = document.createElement('div'); dom.className = 'signature-tooltip parameter-tooltip'; dom.setAttribute('role', 'tooltip');
      let rendered = [];
      const update = () => {
        const call = this.call, value = this.request;
        if (!call || !value) return;
        const next = [value.result, call.argument, call.keyword, call.spread, this.view.themeClasses];
        if (next.every((value, i) => value === rendered[i])) return;
        rendered = next; renderInfo(dom, call, value.result, this.view.state, this.t);
      };
      update(); return { dom, update };
    };
  }
  update(update) {
    const effect = update.transactions.flatMap(transaction => transaction.effects).find(effect => effect.is(requestInfo));
    if (effect) this.close();
    if (effect?.value || this.call && (update.docChanged || update.selectionSet)) void this.refresh();
  }
  async load(request) {
    try {
      await this.index.change(request.file, request.doc.toString()); request.abort.signal.throwIfAborted();
      const symbols = await this.index.describe(await this.index.resolve(request.file, request.name, request.offset, request.abort.signal), request.abort.signal);
      const items = await Promise.all(symbols.map(async item => { const support = await loadLanguage(item.file); return { item, language: support.language || support }; }));
      request.result = { kind: 'ready', items };
    } catch (error) { if (!request.abort.signal.aborted) request.result = { kind: 'error', message: errorText(error, this.t) }; }
  }
  async refresh() {
    const call = callAt(this.view.state), doc = this.view.state.doc, file = this.getFile();
    this.call = call;
    if (!call) { this.close(); return; }
    if (!this.request || this.request.doc !== doc || this.request.file !== file || this.request.from !== call.from) {
      this.request?.abort.abort();
      const request = { doc, file, from: call.from, name: call.name, offset: call.offset, abort: new AbortController(), result: null };
      this.request = request; request.work = this.load(request);
    }
    const request = this.request;
    // 编辑器更新监听中不能递归派发；同一调用内移动光标复用正在读取的签名。
    await Promise.resolve();
    if (this.call !== call) return;
    const loading = !request.result;
    this.publish(call);
    if (!loading) return;
    await request.work;
    if (this.call === call) this.publish(call);
  }
  publish(call) { this.view.dispatch({ effects: setInfo.of({ pos: this.view.state.selection.main.head, above: true, create: this.create, call }) }); }
  close() { this.call = null; this.request?.abort.abort(); this.request = null; }
  destroy() { this.close(); }
}

export function parameterInfo(index, getFile, t) {
  const state = StateField.define({
    create: () => null,
    update(value, transaction) {
      if (value && (transaction.docChanged || transaction.selection && callAt(transaction.state)?.from !== value.call.from)) value = null;
      for (const effect of transaction.effects) {
        if (effect.is(setInfo)) value = effect.value;
        if (effect.is(requestInfo) && !effect.value) value = null;
      }
      return value;
    },
    provide: field => showTooltip.from(field),
  });
  const plugin = ViewPlugin.define(view => new ParameterInfo(view, index, getFile, t), {
    eventHandlers: { blur() { if (this.call) this.view.dispatch({ effects: [requestInfo.of(false), setInfo.of(null)] }); } },
  });
  return [state, plugin, openInfo.of(true),
    Prec.highest(keymap.of([{ key: 'Escape', run(view) {
      if (!view.plugin(plugin)?.call) return false;
      view.dispatch({ effects: [requestInfo.of(false), setInfo.of(null)] }); return true;
    } }]))];
}
