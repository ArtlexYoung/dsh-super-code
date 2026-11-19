import React, { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { displayScope, observeScope, symbolKind } from '../editor/scope.js';
import { message } from '../locales.js';
import { Icon } from './Icon.jsx';

export function ScopePath({ view, file, workbench, inline, Button, t }) {
  const nav = useRef(null);
  const subscribe = useCallback(listener => observeScope(view, listener), [view]);
  const { path, ready, reading } = useSyncExternalStore(subscribe, () => displayScope(view));
  useLayoutEffect(() => {
    const element = nav.current;
    if (!element) return;
    const reveal = () => { element.scrollLeft = element.scrollWidth; };
    reveal();
    const resize = new ResizeObserver(reveal);
    resize.observe(element);
    return () => resize.disconnect();
  }, [path, inline, ready, reading]);
  if (inline && ready && !path.length) return null;
  const title = t('currentScope');
  const jump = scope => {
    const line = view.state.doc.lineAt(scope.head);
    view.focus();
    void workbench.visit({ file, line: line.number - 1, character: scope.head - line.from }).catch(workbench.fail);
  };
  return <nav ref={nav} className={`sc-wb-scope-path sc-wb-scope-${inline ? 'inline' : 'footer'}`} aria-label={title} data-reading={reading}>
    {ready && path.length ? <>
      {reading && <span className="sc-wb-scope-reader" role="img" aria-label={t('readingLocation')} title={t('readingLocation')}>
        <Icon name="reader" /><span aria-hidden="true">{t('readingLocation')}</span>
      </span>}
      {path.map((scope, index) => <React.Fragment key={scope.head}>
        <i className="sc-wb-path-separator" aria-hidden="true" />
        <Button aria-current={index === path.length - 1 ? 'location' : undefined} aria-label={message(t, 'scopeJump', { name: scope.name })} onClick={() => jump(scope)}>
          <Icon name={symbolKind(scope.kind, path[index - 1]?.kind)} /><span>{scope.name}</span>
        </Button>
      </React.Fragment>)}
    </> : <span className="sc-wb-scope-status">{t(ready ? 'fileScope' : 'scopeParsing')}</span>}
  </nav>;
}
