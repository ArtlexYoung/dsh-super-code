import { Prec } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { language, LRLanguage, syntaxTree } from '@codemirror/language';
import { declarationKind, declarationStart } from './scope.js';

const divider = Decoration.line({ class: 'cm-reader-declaration' });
const brackets = new Map([['(', ')'], ['[', ']'], ['{', '}'], ['InterpolationStart', 'InterpolationEnd']]);
const delimiters = new Set([...brackets.keys(), ...brackets.values()]);
const bracketColors = [0, 1, 2].map(color => Decoration.mark({ class: 'cm-reader-bracket', attributes: { 'data-bracket-color': String(color) } }));
// 括号可能在接收者或类型旁边。只查节点两端，避免枚举类或函数的全部子节点。
const EDGE_CHILDREN = 4;

function declarationMarks(tree, range, marks, doc) {
  const lines = new Set();
  tree.iterate({ ...range, enter(cursor) {
    if (cursor.from >= range.to) return false;
    const node = cursor.node;
    if (!declarationKind(node)) return;
    const start = declarationStart(node);
    if (start === null || start < range.from) return;
    const line = doc.lineAt(start);
    if (line.number === 1 || lines.has(line.from) || /\S/.test(doc.sliceString(line.from, start))) return;
    const previous = doc.line(line.number - 1);
    // 空行与文档本身已经区分声明；分隔线不插进文档及其声明之间。
    if (/^\s*(?:$|\/\/|\/\*|\*|#)/.test(previous.text)) return;
    lines.add(line.from);
    marks.push(divider.range(line.from));
  } });
}

function edgeDelimiter(node, direction) {
  for (let count = 0; node && count < EDGE_CHILDREN; count++, node = node[direction]) {
    if (node.type.isError) return null;
    if (delimiters.has(node.name) && node.from < node.to) return node;
  }
  return null;
}

function bracketMarks(tree, range, marks) {
  const boundaries = [];
  tree.iterate({ ...range, enter(cursor) {
    if (cursor.type.isError) return false;
    const node = cursor.node;
    const open = edgeDelimiter(node.firstChild, 'nextSibling');
    const expected = open && brackets.get(open.name);
    if (!expected || open.from >= range.to) return;
    const close = edgeDelimiter(node.lastChild, 'prevSibling');
    if (close?.name !== expected || close.from < open.to || close.to <= range.from) return;
    boundaries.push({ from: open.to - 1, opening: true }, { from: close.from, opening: false });
  } });
  // 同一节点的括号不一定包住接收者。按源码位置计算深度，接收者中的括号不会多算一层。
  boundaries.sort((a, b) => a.from - b.from);
  let depth = 0;
  for (const { from, opening } of boundaries) {
    if (!opening) depth--;
    if (from >= range.from && from < range.to) marks.push(bracketColors[depth % bracketColors.length].range(from, from + 1));
    if (opening) depth++;
  }
}

function readingStructure(collect) {
  function draw(view) {
    const { state, visibleRanges } = view;
    if (!(state.facet(language) instanceof LRLanguage)) return Decoration.none;
    const tree = syntaxTree(state), marks = [];
    for (const range of visibleRanges) collect(tree, range, marks, state.doc);
    return Decoration.set(marks, true);
  }
  return ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = draw(view); }
    update(update) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = draw(update.view);
    }
  }, { decorations: plugin => plugin.decorations });
}

const declarations = readingStructure(declarationMarks);
// 括号标记需要位于语法高亮的内层，显示字符自己的层级颜色。
const bracketPairs = Prec.highest(readingStructure(bracketMarks));
export const readerStructure = palette => palette === 'idea' ? declarations : bracketPairs;
