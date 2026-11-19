import React, { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { loadLanguage } from '../editor/languages.js';
import { editorTheme } from '../editor/theme.js';
import { editorSetup } from '../editor/input.js';
import { errorText } from '../locales.js';

export function LibrarySource({ target, preferences, t }) {
  const parent = useRef(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true, editor;
    const source = target.library;
    void loadLanguage(source.language === 'cpp' ? 'source.cpp' : source.path).then(language => {
      if (!active) return;
      const state = EditorState.create({ doc: source.text, extensions: [editorSetup, language, editorTheme(preferences.palette, preferences), EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.contentAttributes.of({ 'aria-label': t('librarySource') })] });
      editor = new EditorView({ state, parent: parent.current });
      const line = state.doc.line(Math.min(state.doc.lines, target.line + 1)), from = Math.min(line.to, line.from + target.character);
      editor.dispatch({ selection: { anchor: from, head: Math.min(state.doc.length, from + target.name.length) }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
    }).catch(failure => { if (active) setError(errorText(failure, t)); });
    return () => { active = false; editor?.destroy(); };
  }, [target, preferences, t]);
  return <section className="sc-wb-library"><header><strong>{target.library.path}</strong><span>{t('libraryReadonly')}</span></header>{error && <p role="alert">{error}</p>}<div className="sc-wb-library-editor" ref={parent} /></section>;
}
