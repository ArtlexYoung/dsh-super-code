import React from 'react';

const paths = {
  close: 'm5 5 10 10M15 5 5 15', minimize: 'M4 10h12', maximize: 'M4 4h12v12H4Z',
  restore: 'M7 7V3h10v10h-4M3 7h10v10H3Z',
  splitRight: 'M3 4h14v12H3Zm7 0v12', splitDown: 'M3 4h14v12H3Zm0 6h14',
  pin: 'm7 3 7 2-2 3 1 4-4-1-4 6 1-7-3-2 4-2Z', unpin: 'm3 3 14 14M8 4l6 1-2 3m0 4-3-1-4 6 1-7-3-2',
  plus: 'M10 4v12M4 10h12', minus: 'M4 10h12', arrowRight: 'M3 10h14m-5-5 5 5-5 5', arrowLeft: 'M17 10H3m5-5-5 5 5 5',
  stop: 'M5 5h10v10H5Z', diff: 'M3 3h6v14H3Zm8 0h6v14h-6M5 7h2m-2 3h2m6-3h2m-2 3h2m-2 3h2',
  newFile: 'M4 2h8l4 4v4M12 2v5h4M4 2v16h5m5-6v6m-3-3h6', folder: 'M2 4h6l2 2h8v11H2Z',
  copy: 'M7 7h10v11H7ZM4 14H2V2h11v2', paste: 'M7 4H4v14h12V4h-3M7 2h6v4H7Zm0 7h6m-6 3h6m-6 3h4',
  link: 'm8 12 4-4m-6 5-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m2 1 1-1a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0',
  trash: 'M3 5h14M7 5V2h6v3M5 5l1 13h8l1-13M8 8v7m4-7v7',
  files: 'M3 3h6l2 2h6v12H3Zm3 6h8m-8 4h6', conversation: 'M3 3h14v10H8l-5 4Zm3 4h8m-8 3h5',
  outline: 'M3.5 3v14m0-12h4m-4 5h4m-4 5h4M9.5 3h7v4h-7Zm0 5h7v4h-7Zm0 5h7v4h-7Z',
  quick: 'M3 3h14v10h-6l-4 4v-4H3Zm8 2L7 9h3l-1 3 4-4h-3Z',
  changes: 'M3 2h10l4 4v12H3Zm10 0v5h4M6 10h5m-2-2v4m-3 3h8',
  scrollLeft: 'm10 5-5 5 5 5m6-10-5 5 5 5', scrollRight: 'm4 5 5 5-5 5m6-10 5 5-5 5',
  up: 'M10 16V4m-5 5 5-5 5 5', down: 'M10 4v12m-5-5 5 5 5-5',
  replace: 'M3 5h11m-3-3 3 3-3 3M17 15H6m3-3-3 3 3 3M3 11h3m8-2h3',
  back: 'M14 4 8 10l6 6M8 10h10', forward: 'm6 4 6 6-6 6M2 10h10',
  find: 'M13.5 13.5 18 18M15 8.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z',
  search: 'M4 3h10v4M4 3v14h6M7 6h4m-4 3h2m5 6 4 3m-2-7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  definition: 'M3 5h8v12H3ZM6 8h3m-3 3h3m5-8 4 4-4 4m-4-4h8',
  complete: 'm5 4-3 6 3 6m10-12 3 6-3 6M12 3 8 17',
  git: 'M5 3v10a4 4 0 0 0 4 4h5M5 7h6a4 4 0 0 0 4-4M3 3h4m6 0h4m-3 12v4',
  refresh: 'M17 8a7 7 0 0 0-12-4L2 7m0-5v5h5m-4 5a7 7 0 0 0 12 4l3-3m0 5v-5h-5',
  window: 'M9 3H3v14h14v-6M11 2h7v7m0-7-9 9',
  settings: 'M4 3v14m6-14v14m6-14v14M2 6h4m2 7h4m2-6h4',
  save: 'M3 2h12l3 3v13H3ZM6 2v6h8V2M6 18v-7h9v7M12 4v2',
  reader: 'M2 10c2-3.2 4.8-5.5 8-5.5s6 2.3 8 5.5c-2 3.2-4.8 5.5-8 5.5S4 13.2 2 10Zm10.3 0a2.3 2.3 0 1 1-4.6 0 2.3 2.3 0 0 1 4.6 0Z',
  focus: 'M3 7V3h4m6 0h4v4m0 6v4h-4m-6 0H3v-4M7 10h6',
  focusReturn: 'M3 3l4 4m6 0 4-4m0 14-4-4m-6 0-4 4M3 7h4V3m6 0v4h4m0 6h-4v4m-6 0v-4H3',
  reading: 'M10 5C8 3 5 3 2 4v12c3-1 6-1 8 1m0-12c2-2 5-2 8-1v12c-3-1-6-1-8 1ZM5 7h2m-2 3h2m6-3h2m-2 3h2',
};
const vscode = {
  files: 'M7 2h7l3 3v11H7Zm7 0v4h3M4 5H2v14h11v-2',
  conversation: 'M2 3h16v11H7l-5 4Zm4 4h8m-8 3h6',
  refresh: 'M16 7a6 6 0 1 0 0 6M16 2v5h-5',
  outline: 'M3 4h3m2 0h9M3 10h3m2 0h9M3 16h3m2 0h9',
  quick: 'M3 4h14v9h-5l-5 4v-4H3Zm5 2 3 3-3 3m4 0h3',
  changes: 'M4 2h9l4 4v12H4Zm9 0v5h4M7 10h7m-4-3v6m-3 3h7',
  back: 'm9 4-6 6 6 6M3 10h14', forward: 'm11 4 6 6-6 6M3 10h14',
  definition: 'M3 4h9v13H3Zm9 3h6m-3-3 3 3-3 3M6 8h3m-3 3h3m-3 3h3',
  git: 'M5 6v8m0-4h6a4 4 0 0 0 4-4M7 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm0 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM17 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  settings: 'm8 2-1 3-3-1-2 4 2 2-2 2 2 4 3-1 1 3h4l1-3 3 1 2-4-2-2 2-2-2-4-3 1-1-3ZM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  save: 'M3 3h12l2 2v12H3ZM6 3v5h8V3M6 17v-6h8v6',
  reader: 'm2 10 5-5h6l5 5-5 5H7Zm8-3 3 3-3 3-3-3Z',
  focus: 'M3 3h14v14H3Zm4 4h6m-6 3h6m-6 3h6',
  focusReturn: 'M3 3h14v14H3Zm4 0v14m6-14v14m-4-5h2m-2-3h2',
  reading: 'M2 3h6l2 2 2-2h6v13h-6l-2 2-2-2H2Zm8 2v13M5 7h2m-2 3h2m6-3h2m-2 3h2',
};

const symbolIcons = {
  type: { label: 'T', path: 'M3 3h7v6H3Zm7 3h4v9m-4-3h7v5h-7Z' },
  function: { label: 'ƒ', path: 'M14 3h-2a2 2 0 0 0-2 2L8 15a2 2 0 0 1-2 2H4M6 8h8' },
  method: { label: 'm', path: 'm7 5-5 5 5 5m6-10 5 5-5 5m-4-5h2' },
  variable: { label: 'v', path: 'm10 2 7 4v8l-7 4-7-4V6Zm-7 4 7 4 7-4m-7 4v8' },
};

export function Icon({ name }) {
  const symbol = symbolIcons[name];
  return <svg className="sc-wb-icon" data-icon={name} width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
    {name === 'chevron' ? <path d="m6 8 4 4 4-4" /> : symbol ? <>
      <g data-icon-theme="idea"><circle cx="10" cy="10" r="7" fill="currentColor" opacity=".18" stroke="none" /><text x="10" y="13.5" textAnchor="middle" fill="currentColor" stroke="none" fontSize="11">{symbol.label}</text></g>
      <g data-icon-theme="vscode"><path d={symbol.path} /></g>
    </> : <><g data-icon-theme="idea"><path d={paths[name]} /></g><g data-icon-theme="vscode"><path d={vscode[name] || paths[name]} /></g></>}
  </svg>;
}
