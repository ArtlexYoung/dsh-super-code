import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export function editorTheme(palette) {
  const idea = palette === 'idea';
  return [EditorView.theme({
    '&': { height: '100%', fontSize: '13px', color: 'var(--wb-text)', backgroundColor: 'var(--wb-bg)', isolation: 'isolate' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', lineHeight: '1.75', overflow: 'auto' },
    '.cm-content': { padding: '14px 0', caretColor: 'var(--wb-accent)', outline: 'none' },
    '.cm-line': { padding: '0 16px' },
    '.cm-gutters': { backgroundColor: 'var(--wb-surface)', color: 'var(--wb-muted)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb,var(--wb-accent) 4%,transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--wb-hover)', color: 'var(--wb-text)' },
    '.cm-cursor,.cm-dropCursor': { borderLeftWidth: idea ? '2px' : '1.5px', borderLeftColor: 'var(--wb-accent)' },
    '&.cm-focused .cm-selectionBackground,.cm-selectionBackground,::selection': { backgroundColor: 'var(--wb-selection)' },
    '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb,var(--wb-accent) 13%,transparent)' },
    '.cm-tooltip': { border: '1px solid var(--wb-line)', backgroundColor: 'var(--wb-bg)', color: 'var(--wb-text)', borderRadius: '7px', boxShadow: '0 5px 22px #0002' },
    '.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--wb-hover)', color: 'var(--wb-text)' },
    '.cm-panels': { background: 'var(--wb-surface)', color: 'var(--wb-text)' },
  }), syntaxHighlighting(HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--wb-keyword)' },
    { tag: [tags.string, tags.regexp], color: 'var(--wb-string)' }, { tag: [tags.number, tags.bool, tags.null], color: 'var(--wb-number)' },
    { tag: [tags.typeName, tags.className], color: 'var(--wb-type)' }, { tag: tags.comment, color: 'var(--wb-comment)', fontStyle: 'italic' },
    { tag: tags.function(tags.variableName), color: 'var(--wb-function)' },
  ]))];
}
