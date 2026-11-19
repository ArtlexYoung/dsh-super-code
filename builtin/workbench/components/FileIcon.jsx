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
    kind = 'folder'; content = <>
      <g data-icon-theme="idea"><path d={open ? 'M2 6V4h6l2 2h7v3H6L3 16H2Zm4 3h13l-3 7H3Z' : 'M2 4h6l2 2h8v10H2Z'} fill="currentColor" opacity=".9" /></g>
      <g data-icon-theme="vscode"><path d={open ? 'M2 7V4h6l2 2h7v3M2 7l2 9h13l2-7H6l-2 7' : 'M2 4h6l2 2h8v10H2Zm0 4h16'} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></g>
    </>;
  } else {
    const [, label, type] = types.find(([pattern]) => pattern.test(path)) || [null, '·', 'file'];
    kind = type; content = <>
      <g data-icon-theme="idea"><path d="M5 2h7l4 4v12H5Zm7 0v5h4" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" opacity=".7" />
        <rect x="1" y="8" width="15" height="10" rx="2" fill="currentColor" /><text x="8.5" y="15.5" textAnchor="middle" fill="var(--wb-icon-on)" fontSize="7" fontFamily="sans-serif" fontWeight="700">{label}</text></g>
      <g data-icon-theme="vscode">{['typescript', 'javascript'].includes(type) ? <><rect x="2" y="2" width="16" height="16" fill="currentColor" /><text x="16.5" y="15.5" textAnchor="end" fill="var(--wb-icon-on)" fontSize="9" fontFamily="sans-serif" fontWeight="600">{label}</text></>
        : <><path d="M4 2h8l4 4v12H4Zm8 0v5h4" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" /><text x="10" y="14" textAnchor="middle" fill="currentColor" fontSize="7" fontFamily="ui-monospace,monospace" fontWeight="700">{label}</text></>}</g>
    </>;
  }
  return <svg className="sc-wb-file-icon" data-kind={kind} width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">{content}</svg>;
}
