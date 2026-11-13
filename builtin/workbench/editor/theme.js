import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export function editorTheme(palette) {
  const idea = palette === 'idea';
  const colors = Object.fromEntries(Object.entries({ keyword: idea ? '#8755b8' : '#a047b0', string: '#29805b', number: '#a96a2e', type: idea ? '#277a93' : '#267f99', comment: '#7a858f', function: idea ? '#7e6928' : '#856e2b' })
    .map(([name, color]) => [name, `color-mix(in srgb,${color} 75%,var(--wb-text))`]));
  return [EditorView.theme({
    '&': { height: '100%', fontSize: '13px', color: 'var(--wb-text)', backgroundColor: 'var(--wb-bg)', isolation: 'isolate' },
    '.cm-scroller': { fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', lineHeight: '1.75', overflow: 'auto' },
    '.cm-content': { padding: '14px 0', caretColor: 'var(--wb-accent)' },
    '.cm-line': { padding: '0 16px' },
    '.cm-gutters': { backgroundColor: 'var(--wb-surface)', color: 'var(--wb-muted)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb,var(--wb-accent) 4%,transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--wb-hover)', color: 'var(--wb-text)' },
    '.cm-cursor,.cm-dropCursor': { borderLeftWidth: idea ? '2px' : '1.5px', borderLeftColor: 'var(--wb-accent)' },
    '&.cm-focused .cm-selectionBackground,.cm-selectionBackground,::selection': { backgroundColor: idea ? 'var(--wb-selection-idea)' : 'var(--wb-selection-vscode)' },
    '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb,var(--wb-accent) 13%,transparent)' },
    '.cm-tooltip': { border: '1px solid var(--wb-line)', backgroundColor: 'var(--wb-bg)', color: 'var(--wb-text)', borderRadius: '7px', boxShadow: '0 5px 22px #0002' },
    '.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--wb-hover)', color: 'var(--wb-text)' },
    '.cm-panels': { background: 'var(--wb-surface)', color: 'var(--wb-text)' },
  }), syntaxHighlighting(HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: colors.keyword },
    { tag: [tags.string, tags.regexp], color: colors.string }, { tag: [tags.number, tags.bool, tags.null], color: colors.number },
    { tag: [tags.typeName, tags.className], color: colors.type }, { tag: tags.comment, color: colors.comment, fontStyle: 'italic' },
    { tag: tags.function(tags.variableName), color: colors.function },
  ]))];
}
