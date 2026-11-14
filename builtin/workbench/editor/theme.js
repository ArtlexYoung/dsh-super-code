import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export function editorTheme(palette) {
  const idea = palette === 'idea';
  return [EditorView.theme({
    '&': { height: '100%', fontSize: '13px', color: 'var(--wb-text)', backgroundColor: 'var(--wb-bg)', isolation: 'isolate' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--wb-mono)', lineHeight: 'var(--wb-code-leading)', overflow: 'auto' },
    '.cm-content': { padding: '12px 0', caretColor: 'var(--wb-caret)', outline: 'none' },
    '.cm-line': { padding: '0 6px' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0 2px' },
    '.cm-gutters': { backgroundColor: 'var(--wb-gutter)', color: 'var(--wb-muted)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'var(--wb-active-line)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--wb-hover)', color: 'var(--wb-text)' },
    '.cm-cursor,.cm-dropCursor': { borderLeftWidth: idea ? '2px' : '1.5px', borderLeftColor: 'var(--wb-caret)' },
    '&.cm-focused .cm-selectionBackground,.cm-selectionBackground,::selection': { backgroundColor: 'var(--wb-selection)' },
    '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb,var(--wb-accent) 13%,transparent)' },
    '.cm-tooltip': { border: '1px solid var(--wb-line)', backgroundColor: 'var(--wb-bg)', color: 'var(--wb-text)', borderRadius: 'var(--wb-popup-radius)', boxShadow: '0 5px 22px #0002' },
    '.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--wb-hover)', color: 'var(--wb-text)' },
    '.cm-completionIcon': { color: 'var(--wb-accent)' },
    '.cm-completionDetail': { color: 'var(--wb-muted)', fontStyle: idea ? 'italic' : 'normal' },
    '.cm-panels': { background: 'var(--wb-surface)', color: 'var(--wb-text)' },
    '.cm-panels-top': { borderBottom: '1px solid var(--wb-line)' },
    '.cm-search': { padding: '6px 9px', fontFamily: 'var(--wb-font)', fontSize: '11px' },
    '.cm-textfield': { background: 'var(--wb-bg)', color: 'var(--wb-text)', border: '1px solid var(--wb-line)', borderRadius: 'var(--wb-radius)', fontFamily: 'inherit' },
    '.cm-button': { background: 'var(--wb-chrome)', color: 'var(--wb-text)', border: '1px solid var(--wb-line)', borderRadius: 'var(--wb-radius)', fontFamily: 'inherit' },
    '.cm-button:hover': { background: 'var(--wb-hover)' },
    '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb,var(--wb-accent) 20%,transparent)' },
    '.cm-searchMatch-selected': { backgroundColor: 'var(--wb-selection)', outline: '1px solid var(--wb-accent)' },
  }), syntaxHighlighting(HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--wb-keyword)' },
    { tag: [tags.controlKeyword, tags.moduleKeyword], color: 'var(--wb-control)' },
    { tag: [tags.string, tags.regexp], color: 'var(--wb-string)' }, { tag: tags.number, color: 'var(--wb-number)' },
    { tag: [tags.bool, tags.null], color: 'var(--wb-keyword)' },
    { tag: [tags.variableName, tags.self], color: 'var(--wb-variable)' },
    { tag: [tags.propertyName, tags.attributeName], color: 'var(--wb-property)' },
    { tag: tags.constant(tags.variableName), color: 'var(--wb-constant)' },
    { tag: [tags.operator, tags.punctuation], color: 'var(--wb-operator)' },
    { tag: [tags.typeName, tags.className], color: 'var(--wb-type)' }, { tag: tags.comment, color: 'var(--wb-comment)', fontStyle: idea ? 'italic' : 'normal' },
    { tag: tags.function(tags.variableName), color: 'var(--wb-function)' },
  ]))];
}
