import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { appearanceDefaults, editorAppearance } from './appearance.js';
import { readerStructure } from './reader-structure.js';

export function editorTheme(palette, appearance = appearanceDefaults) {
  const idea = palette === 'idea';
  const codeInset = 'var(--wb-code-inset,6px)';
  return [appearance.readerMode ? [EditorView.lineWrapping, readerStructure(palette)] : [], EditorView.theme({
    '&': { height: '100%', color: 'var(--wb-text)', backgroundColor: 'var(--wb-bg)', isolation: 'isolate', '--wb-code-inset': idea ? '8px' : '10px', ...editorAppearance(appearance) },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit', overflow: 'auto', containerType: appearance.readerMode ? 'inline-size' : 'normal' },
    '.cm-content': { padding: idea ? '9px 0' : '7px 0', caretColor: 'var(--wb-caret)', outline: 'none' },
    '.cm-line': { padding: `0 ${codeInset}` },
    '.cm-line.cm-reader-declaration': { boxShadow: 'inset 0 1px var(--wb-declaration-line)' },
    '.cm-reader-bracket[data-bracket-color="0"]': { color: 'var(--wb-nesting-outer)' },
    '.cm-reader-bracket[data-bracket-color="1"]': { color: 'var(--wb-nesting-middle)' },
    '.cm-reader-bracket[data-bracket-color="2"]': { color: 'var(--wb-nesting-inner)' },
    '.cm-lineWrapping .cm-line[data-indent-columns]': {
      '--wb-wrap-indent': `min(calc(var(--indent-columns)*1ch + ${idea ? '2ch' : '0ch'}),20cqi)`,
      paddingLeft: `calc(${codeInset} + var(--wb-wrap-indent))`, textIndent: 'calc(-1 * var(--wb-wrap-indent))',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: idea ? '0 3px 0 9px' : '0 3px 0 10px', fontVariantNumeric: 'tabular-nums' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0 1px' },
    '.cm-fold-chevron': { display: 'inline-block', position: 'relative', width: '12px', height: '12px', verticalAlign: 'middle', color: 'var(--wb-muted)',
      border: idea ? '1px solid currentColor' : 'none', borderRadius: idea ? '3px' : '0' },
    '.cm-fold-chevron[data-open=true]': { opacity: idea ? '.72' : '.42' },
    '.cm-gutters:hover .cm-fold-chevron,.cm-fold-chevron:hover': { opacity: '1' },
    '.cm-fold-chevron:before': idea
      ? { content: '""', position: 'absolute', inset: '4.5px 2px auto', height: '1px', backgroundColor: 'currentColor' }
      : { content: '""', position: 'absolute', width: '5px', height: '5px', left: '3px', top: '2px', borderRight: '1.25px solid currentColor', borderBottom: '1.25px solid currentColor', transform: 'rotate(45deg)' },
    ...(idea ? { '.cm-fold-chevron[data-open=false]:after': { content: '""', position: 'absolute', inset: '2px auto 2px 4.5px', width: '1px', backgroundColor: 'currentColor' } }
      : { '.cm-fold-chevron[data-open=false]:before': { left: '2px', top: '3px', transform: 'rotate(-45deg)' } }),
    '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--wb-text)', backgroundColor: 'var(--wb-hover)' },
    '.cm-sticky-fold': { borderRadius: idea ? '4px' : '0' },
    '.cm-sticky-fold:hover': { backgroundColor: 'var(--wb-hover)' },
    '.cm-sticky-fold .cm-fold-chevron[data-open=true]': { opacity: idea ? '.72' : '0' },
    '.cm-sticky:hover .cm-sticky-fold .cm-fold-chevron,.cm-sticky-fold:focus-visible .cm-fold-chevron': { opacity: '1' },
    ...(idea ? {
      '&[data-reading-viewport] .cm-sticky-row:last-child .cm-sticky-number': { color: 'var(--wb-text)' },
      '&[data-reading-viewport] .cm-line[data-active-indent]': {
        '--wb-active-guide': 'color-mix(in srgb,var(--wb-accent) 42%,var(--wb-indent-active))', '--wb-active-guide-width': '2px',
      },
    } : {
      '.cm-sticky-line:hover .cm-sticky-text': { textDecoration: 'underline', textDecorationColor: 'var(--wb-muted)', textUnderlineOffset: '3px' },
    }),
    '.cm-foldPlaceholder': { display: 'inline', minHeight: '0', verticalAlign: 'baseline', font: 'inherit', fontSize: '.86em', lineHeight: '1', color: 'var(--wb-muted)',
      backgroundColor: idea ? 'var(--wb-surface)' : 'transparent', border: '1px solid var(--wb-line)', borderRadius: idea ? '4px' : '1px', padding: '0 4px', margin: '0 2px', userSelect: 'none' },
    '.cm-foldPlaceholder:hover,.cm-foldPlaceholder:focus-visible': { color: 'var(--wb-text)', borderColor: 'var(--wb-accent)' },
    '.cm-foldPlaceholder:focus-visible': { outline: '1px solid var(--wb-accent)', outlineOffset: '1px' },
    '.cm-line[data-indent-columns]': { backgroundImage: 'repeating-linear-gradient(to right,var(--wb-indent) 0 1px,transparent 1px calc(var(--indent-unit)*1ch))', backgroundPosition: `${codeInset} 0`, backgroundSize: 'calc(var(--indent-columns)*1ch) 100%', backgroundRepeat: 'no-repeat' },
    '.cm-line[data-active-indent]': { backgroundImage: 'linear-gradient(var(--wb-active-guide,var(--wb-indent-active)),var(--wb-active-guide,var(--wb-indent-active))),repeating-linear-gradient(to right,var(--wb-indent) 0 1px,transparent 1px calc(var(--indent-unit)*1ch))', backgroundPosition: `calc(${codeInset} + var(--active-indent)*1ch) 0,${codeInset} 0`, backgroundSize: 'var(--wb-active-guide-width,1px) 100%,calc(var(--indent-columns)*1ch) 100%', backgroundRepeat: 'no-repeat' },
    '.cm-gutters': { backgroundColor: 'var(--wb-gutter)', color: 'var(--wb-muted)', border: 'none', borderRight: idea ? '1px solid var(--wb-line)' : 'none' },
    '.cm-activeLine': { backgroundColor: idea ? 'var(--wb-active-line)' : 'transparent', boxShadow: idea ? 'none' : 'inset 0 0 0 1px var(--wb-active-line)' },
    '.cm-activeLineGutter': { backgroundColor: idea ? 'var(--wb-active-line)' : 'transparent', color: 'var(--wb-text)' },
    '.cm-cursor,.cm-dropCursor': { borderLeftWidth: idea ? '2px' : '1.5px', borderLeftColor: 'var(--wb-caret)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground,.cm-selectionBackground': { backgroundColor: 'var(--wb-selection)' },
    '.cm-content[data-has-selection] .cm-activeLine': idea ? { backgroundColor: 'transparent' } : { boxShadow: 'none' },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--wb-bracket)', outline: '1px solid var(--wb-bracket-line)', outlineOffset: '-1px', color: 'inherit' },
    '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'color-mix(in srgb,#d53c3c 16%,transparent)', outline: '1px solid #d53c3c', outlineOffset: '-1px' },
    '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb,var(--wb-accent) 13%,transparent)' },
    '.cm-selectionMatch-main': { outline: '1px solid color-mix(in srgb,var(--wb-accent) 65%,transparent)', outlineOffset: '-1px' },
    '&[data-reading-viewport] .cm-selectionMatch,&:has(.sc-wb-find) .cm-selectionMatch': { backgroundColor: 'transparent', outline: 'none' },
    '.cm-tooltip': { border: '1px solid var(--wb-input-line)', backgroundColor: 'var(--wb-bg)', color: 'var(--wb-text)', borderRadius: 'var(--wb-popup-radius)', boxShadow: 'var(--wb-shadow)' },
    '.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--wb-selected)', color: 'var(--wb-selected-text)' },
    '.cm-completionIcon': { color: 'var(--wb-accent)' },
    '.cm-completionDetail': { color: 'var(--wb-muted)', fontStyle: idea ? 'italic' : 'normal' },
    '.cm-panels': { background: 'var(--wb-surface)', color: 'var(--wb-text)' },
    '.cm-panels-top': { borderBottom: '1px solid var(--wb-line)' },
    '.cm-panels-bottom': { borderTop: '1px solid var(--wb-line)' },
    '.cm-search': { padding: '6px 9px', fontFamily: 'var(--wb-font)', fontSize: '11px' },
    '.cm-textfield': { background: 'var(--wb-input)', color: 'var(--wb-text)', border: '1px solid var(--wb-input-line)', borderRadius: 'var(--wb-radius)', fontFamily: 'inherit' },
    '.cm-button': { background: 'var(--wb-chrome)', color: 'var(--wb-text)', border: '1px solid var(--wb-line)', borderRadius: 'var(--wb-radius)', fontFamily: 'inherit' },
    '.cm-button:hover': { background: 'var(--wb-hover)' },
    '.cm-searchMatch': { backgroundColor: 'var(--wb-find-match,#ffe9ac)' },
    '.cm-searchMatch-selected': { backgroundColor: 'var(--wb-find-current,#ffd37c)', outline: '1px solid var(--wb-find-outline,#956515)', outlineOffset: '-1px' },
  }), syntaxHighlighting(HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--wb-keyword)' },
    { tag: [tags.controlKeyword, tags.moduleKeyword], color: 'var(--wb-control)' },
    { tag: [tags.string, tags.regexp], color: 'var(--wb-string)' }, { tag: tags.number, color: 'var(--wb-number)' },
    { tag: [tags.bool, tags.null], color: 'var(--wb-keyword)' },
    { tag: [tags.variableName, tags.self], color: 'var(--wb-variable)' },
    { tag: [tags.propertyName, tags.attributeName], color: 'var(--wb-property)' },
    { tag: tags.constant(tags.variableName), color: 'var(--wb-constant)' },
    { tag: [tags.operator, tags.punctuation], color: 'var(--wb-operator)' },
    { tag: [tags.typeName, tags.className], color: 'var(--wb-type)' },
    { tag: tags.comment, color: appearance.readerMode ? 'color-mix(in srgb,var(--wb-comment) 75%,var(--wb-text))' : 'var(--wb-comment)', fontStyle: idea && !appearance.readerMode ? 'italic' : 'normal', fontSynthesis: 'none' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--wb-function)' },
    { tag: [tags.definition(tags.className), tags.definition(tags.typeName)], color: 'var(--wb-type)', fontWeight: idea ? '600' : 'inherit' },
    { tag: [tags.definition(tags.function(tags.variableName)), tags.definition(tags.function(tags.propertyName))], color: 'var(--wb-function)', fontWeight: idea ? '600' : 'inherit' },
  ]))];
}
