import { EditorState, StateEffect, StateField, Prec, Compartment, Text } from '@codemirror/state';
import { EditorView, keymap, tooltips } from '@codemirror/view';
import { autocompletion, completeAnyWord } from '@codemirror/autocomplete';
import { editorSetup, editingCommands, editorPointerEvents } from './input.js';
import { loadLanguage, syntaxSuggestions } from './languages.js';
import { bindingsOf } from './preferences.js';
import { editorTheme } from './theme.js';
import { editorAppearance } from './appearance.js';
import { signatureTooltip, wordAt } from './code-info.js';
import { selectionExtension } from '../assistant/selection-extension.js';
import { stickyLines, viewportOptions } from './sticky.js';
import { folding } from './folding.js';
import { indentGuides } from './guides.js';
import { readerDocumentsExtension } from './reader.js';
import { scopeTracking } from './scope.js';
import { parameterInfo } from './parameters.js';
import { fileSearch } from './find.js';

const rememberScroll = StateEffect.define();
const scrollPosition = StateField.define({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(rememberScroll)) return effect.value;
    if (transaction.selection && !transaction.selection.eq(transaction.startState.selection)) return null;
    return value?.map(transaction.changes) ?? null;
  },
});

function editorConfiguration(value) {
  return {
    keys: JSON.stringify([value.keymap, value.shortcuts]),
    theme: JSON.stringify([value.palette, value.readerMode, editorAppearance(value)]),
    sticky: value.stickyScroll, reader: value.readerMode,
  };
}

export function createEditor({ parent, tooltipParent, index, t, changed, commands, assistant, receiving = () => false, currentFile }) {
  const keys = new Compartment(), theme = new Compartment(), readonly = new Compartment(), viewport = new Compartment(), reader = new Compartment();
  const stickyHeaders = stickyLines(t, line => commands.visit({ file: currentFile(), line }));
  const viewportConfig = ({ stickyScroll, readerMode }) => stickyScroll || readerMode ? [stickyHeaders, viewportOptions.of({ stickyScroll, readerMode })] : [];
  const preferencesByState = new WeakMap();
  let view = null, configured = null;
  const bound = () => ({ ...editingCommands, ...commands });
  async function complete(context) {
    const word = context.matchBefore(/[\p{L}\p{N}_$]+/u);
    if (!word && !context.explicit) return null;
    const file = currentFile(), seen = new Set();
    const options = [
      ...(await index.candidates(file, word?.text || '', false)).map(item => ({ label: item.name, type: item.kind, detail: `${item.file}:${item.line + 1}`, boost: 10 })),
      ...syntaxSuggestions(file, t), ...(completeAnyWord(context)?.options || []),
    ].filter(item => { if (seen.has(item.label)) return false; seen.add(item.label); return true; });
    return { from: word?.from ?? context.pos, to: wordAt(context.state.doc, context.pos).to, options, validFor: /^[\p{L}\p{N}_$]*$/u };
  }
  async function state(file, source, preferences) {
    const language = await loadLanguage(file);
    // 语言加载期间其他视图仍可编辑，构造状态时才读取文本和本视图选区。
    const { text, saved } = source();
    const extensions = [
      editorSetup, language, scrollPosition, indentGuides, scopeTracking, theme.of(editorTheme(preferences.palette, preferences)), readonly.of(EditorState.readOnly.of(false)), tooltips({ parent: tooltipParent }), fileSearch(t),
      folding(t),
      viewport.of(viewportConfig(preferences)),
      reader.of(preferences.readerMode ? readerDocumentsExtension(file, t) : []),
      EditorView.contentAttributes.of(view => view.state.selection.ranges.some(range => !range.empty) ? { 'data-has-selection': '' } : {}),
      EditorState.lineSeparator.of(text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n'),
      EditorView.contentAttributes.of({ 'aria-label': t('title') }), autocompletion(), EditorState.languageData.of(() => [{ autocomplete: complete }]),
      keys.of(Prec.highest(keymap.of(bindingsOf(preferences, bound())))),
      Prec.highest(EditorView.domEventHandlers(editorPointerEvents(commands.definition))),
      signatureTooltip(async (_route, input) => { await index.change(input.file, input.text); return index.describe(await index.resolve(input.file, input.word, input.offset)); }, currentFile, t), parameterInfo(index, currentFile, t),
      selectionExtension(assistant.threads(file), assistant.open, assistant.select, t),
      EditorView.updateListener.of(update => { if (!receiving()) assistant.update(update); changed(update); }),
    ];
    // 重挂载时保留文档、选区和撤销历史，重新绑定当前页面的气泡容器与事件。
    const ready = saved ? saved.update({ effects: StateEffect.reconfigure.of(extensions) }).state : EditorState.create({ doc: Text.of(text.split(/\r\n?|\n/)), extensions });
    preferencesByState.set(ready, preferences);
    return ready;
  }
  function configure(value) {
    if (!view) return;
    const next = editorConfiguration(value);
    const effects = [];
    if (next.keys !== configured?.keys) effects.push(keys.reconfigure(Prec.highest(keymap.of(bindingsOf(value, bound())))));
    if (next.theme !== configured?.theme) effects.push(theme.reconfigure(editorTheme(value.palette, value)));
    if (next.sticky !== configured?.sticky || next.reader !== configured?.reader) effects.push(viewport.reconfigure(viewportConfig(value)));
    if (next.reader !== configured?.reader) effects.push(reader.reconfigure(value.readerMode ? readerDocumentsExtension(currentFile(), t) : []));
    if (effects.length) view.dispatch({ effects });
    configured = next;
  }
  return {
    get view() { return view; },
    move(nextParent, nextTooltips) { parent = nextParent; tooltipParent = nextTooltips; if (view) parent.append(view.dom); },
    state,
    // 原生快照保存文档锚点，随未激活文件的事务一起映射，不按旧像素猜位置。
    capture() { return view.state.update({ effects: rememberScroll.of(view.scrollSnapshot()) }).state; },
    show(state) {
      if (view) view.setState(state); else view = new EditorView({ parent, state });
      // 恢复的状态会保留旧 Compartment，先应用此次偏好，再按变化更新。
      configured = null; configure(preferencesByState.get(state));
      const savedScroll = state.field(scrollPosition);
      if (savedScroll) view.dispatch({ effects: savedScroll });
      else if (state.selection.main.head !== 0) view.dispatch({ effects: EditorView.scrollIntoView(state.selection.main, { y: 'center' }) });
      else view.scrollDOM.scrollTo(0, 0);
    },
    readonly(value) { view?.dispatch({ effects: readonly.reconfigure(EditorState.readOnly.of(value)) }); },
    preferences: configure,
    dispose() { view?.destroy(); view = null; configured = null; },
  };
}
