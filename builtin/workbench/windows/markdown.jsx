import React, { useEffect, useMemo, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { loadLanguage } from '../editor/languages.js';

async function highlightBlock(code, active) {
  const name = [...code.classList].find(name => name.startsWith('language-'))?.slice(9);
  if (!name) return;
  const support = await loadLanguage(name), parser = (support.language || support).parser;
  if (!parser || !active()) return;
  const text = code.textContent, parsing = parser.startParse(text);
  let tree, yielding = performance.now();
  while (!(tree = parsing.advance())) if (performance.now() - yielding >= 12) {
    await new Promise(resolve => setTimeout(resolve, 0));
    if (!active()) return;
    yielding = performance.now();
  }
  if (!active()) return;
  const content = document.createDocumentFragment(); let end = 0;
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    content.append(text.slice(end, from));
    const span = document.createElement('span'); span.className = classes; span.textContent = text.slice(from, to);
    content.append(span); end = to;
  });
  content.append(text.slice(end)); code.replaceChildren(content);
}

/** 工作台文档需要保留项目相对链接，解析后的 HTML 在进入 DOM 前统一清理。 */
export function SafeMarkdown({ text }) {
  const root = useRef(null);
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true })), [text]);
  useEffect(() => {
    let active = true;
    for (const code of root.current.querySelectorAll('pre>code')) {
      void highlightBlock(code, () => active).catch(() => { if (active) code.dataset.highlight = 'unavailable'; });
    }
    return () => { active = false; };
  }, [html]);
  return <div ref={root} className="sc-wb-markdown-content" dangerouslySetInnerHTML={{ __html: html }} />;
}
