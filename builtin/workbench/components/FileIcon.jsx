import React from 'react';

const types = [
  [/\.[cm]?tsx?$/i, 'TS', 'typescript'], [/\.[cm]?jsx?$/i, 'JS', 'javascript'], [/\.pyi?$/i, 'PY', 'python'],
  [/\.java$/i, 'J', 'java'], [/\.(c|h|cc|cpp|cxx|hpp)$/i, 'C', 'native'], [/\.go$/i, 'GO', 'go'],
  [/\.rs$/i, 'RS', 'rust'], [/\.(json|ya?ml|toml)$/i, '{}', 'config'], [/\.(css|scss|html?|vue|svelte)$/i, '◇', 'web'],
  [/\.(md|txt)$/i, '≡', 'text'], [/\.(sh|bash|zsh|ps1|cmd|bat)$/i, '›_', 'shell'],
  [/\.(svg|png|jpe?g|gif|webp|ico)$/i, '▧', 'image'],
];

export function FileIcon({ path = '', directory, open, pinned }) {
  let kind, content;
  if (pinned) {
    kind = 'pin'; content = <path d="m7 2 8 3-3 3 1 5-3-1-4 6 1-7-4-2 4-2Z" fill="currentColor" />;
  } else if (directory) {
    kind = 'folder'; content = <path d={open ? 'M2 6V4h6l2 2h7v3H6L3 16H2Zm4 3h13l-3 7H3Z' : 'M2 5h6l2 2h8v9H2Z'} fill="currentColor" opacity=".9" />;
  } else {
    const [, label, type] = types.find(([pattern]) => pattern.test(path)) || [null, '·', 'file'];
    kind = type; content = <><path d="M4 2h8l4 4v12H4Zm8 0v5h4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /><text x="10" y="14" textAnchor="middle" fill="currentColor" fontSize="7" fontFamily="ui-monospace,monospace" fontWeight="700">{label}</text></>;
  }
  return <svg className="sc-wb-file-icon" data-kind={kind} viewBox="0 0 20 20" aria-hidden="true">{content}</svg>;
}
