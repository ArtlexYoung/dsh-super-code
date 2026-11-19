import React, { useDeferredValue, useEffect, useMemo, useRef } from 'react';
import { locateMarkdownTarget, markdownTargets } from '../editor/markdown-links.js';
import { SafeMarkdown } from '../windows/markdown.jsx';

const headingId = value => value.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s+/g, '-');

export function MarkdownPreview({ document, file, cwd, workbench, list, revealDirectory, t }) {
  const source = useDeferredValue(document), text = useMemo(() => source?.toString() || '', [source]);
  const opening = useRef(null);
  useEffect(() => () => opening.current?.abort(), [file]);
  return <article className="sc-wb-markdown" aria-label={t('markdownPreview')} onClickCapture={event => {
    const link = event.target.closest('a[href]');
    const href = link?.getAttribute('href');
    if (!href) return;
    if (href.startsWith('#')) {
      event.preventDefault(); event.stopPropagation();
      let fragment;
      try { fragment = decodeURIComponent(href.slice(1)); } catch { return; }
      const target = [...event.currentTarget.querySelectorAll('[id],h1,h2,h3,h4,h5,h6')].find(node => node.id === fragment || /^H[1-6]$/.test(node.tagName) && headingId(node.textContent) === fragment);
      target?.scrollIntoView({ block: 'start' });
      return;
    }
    const targets = markdownTargets(href, file, cwd);
    if (!targets) {
      if (/^(?:https?:)?\/\//i.test(href)) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      return;
    }
    event.preventDefault(); event.stopPropagation();
    opening.current?.abort();
    const abort = new AbortController(); opening.current = abort;
    void locateMarkdownTarget(targets, list, abort.signal).then(({ type, ...target }) => {
      if (abort.signal.aborted) return;
      if (type === 'directory') revealDirectory(target.file);
      else return workbench.visit(target);
    }).catch(error => { if (!abort.signal.aborted) workbench.fail(error); });
  }}><SafeMarkdown text={text} /></article>;
}
