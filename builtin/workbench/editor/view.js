import { EditorState, StateEffect, Prec, Compartment } from '@codemirror/state';
import { EditorView, keymap, tooltips } from '@codemirror/view';
import { autocompletion, completeAnyWord } from '@codemirror/autocomplete';
import { search } from '@codemirror/search';
import { editorSetup, editingCommands, editorPointerEvents } from './input.js';
import { loadLanguage, syntaxSuggestions } from './languages.js';
import { bindingsOf } from './preferences.js';
import { editorTheme } from './theme.js';
import { signatureTooltip } from './code-info.js';
import { selectionExtension } from '../assistant/selection-extension.js';

export function createEditor({ parent, tooltipParent, index, t, changed, commands, assistant, currentFile }) {
  const keys = new Compartment(), theme = new Compartment();
  let view = null;
  const bound = () => ({ ...editingCommands, ...commands });
  async function complete(context) {
    const word = context.matchBefore(/[\p{L}\p{N}_$]+/u);
    if (!word && !context.explicit) return null;
    const file = currentFile(), seen = new Set();
    const options = [
      ...index.candidates(file, word?.text || '', false).map(item => ({ label: item.name, type: item.kind, detail: `${item.file}:${item.line + 1}`, boost: 10 })),
      ...syntaxSuggestions(file, t), ...(completeAnyWord(context)?.options || []),
    ].filter(item => { if (seen.has(item.label)) return false; seen.add(item.label); return true; });
    const suffix = /^[\p{L}\p{N}_$]*/u.exec(context.state.sliceDoc(context.pos))[0];
    return { from: word?.from ?? context.pos, to: context.pos + suffix.length, options, validFor: /^[\p{L}\p{N}_$]*$/u };
  }
  async function state(file, text, preferences, saved) {
    const language = await loadLanguage(file);
    const extensions = [
      editorSetup, language, theme.of(editorTheme(preferences.palette)), tooltips({ parent: tooltipParent }), search({ top: true }),
      EditorView.contentAttributes.of({ 'aria-label': t('title') }), autocompletion(), EditorState.languageData.of(() => [{ autocomplete: complete }]),
      keys.of(Prec.highest(keymap.of(bindingsOf(preferences, bound())))),
      Prec.highest(EditorView.domEventHandlers(editorPointerEvents(commands.definition))),
      signatureTooltip(async (_route, input) => { await index.change(input.file, input.text); return index.candidates(input.file, input.word); }, currentFile, t),
      selectionExtension(assistant.threads(file), assistant.open, assistant.select, t),
      EditorView.updateListener.of(update => { assistant.update(update); changed(update); }),
    ];
    // 重挂载时保留文档、选区和撤销历史，重新绑定当前页面的气泡容器与事件。
    return saved ? saved.update({ effects: StateEffect.reconfigure.of(extensions) }).state : EditorState.create({ doc: text, extensions });
  }
  return {
    get view() { return view; },
    state,
    show(state) { if (view) view.setState(state); else view = new EditorView({ parent, state }); },
    preferences(value) { view?.dispatch({ effects: [keys.reconfigure(Prec.highest(keymap.of(bindingsOf(value, bound())))), theme.reconfigure(editorTheme(value.palette))] }); },
    dispose() { view?.destroy(); view = null; },
  };
}
