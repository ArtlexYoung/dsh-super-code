import React from 'react';

const paths = {
  replace: 'M3 5h11m-3-3 3 3-3 3M17 15H6m3-3-3 3 3 3M3 11h3m8-2h3',
  back: 'M14 4 8 10l6 6M8 10h10', forward: 'm6 4 6 6-6 6M2 10h10',
  find: 'M13.5 13.5 18 18M15 8.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z',
  search: 'M4 3h10v4M4 3v14h6M7 6h4m-4 3h2m5 6 4 3m-2-7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  definition: 'M3 5h8v12H3ZM6 8h3m-3 3h3m5-8 4 4-4 4m-4-4h8',
  complete: 'm5 4-3 6 3 6m10-12 3 6-3 6M12 3 8 17',
  git: 'M5 3v10a4 4 0 0 0 4 4h5M5 7h6a4 4 0 0 0 4-4M3 3h4m6 0h4m-3 12v4',
  refresh: 'M17 8a7 7 0 0 0-12-4L2 7m0-5v5h5m-4 5a7 7 0 0 0 12 4l3-3m0 5v-5h-5',
  settings: 'M4 3v14m6-14v14m6-14v14M2 6h4m2 7h4m2-6h4',
  save: 'M3 2h12l3 3v13H3ZM6 2v6h8V2M6 18v-7h9v7M12 4v2',
  reading: 'M10 5C8 3 5 3 2 4v12c3-1 6-1 8 1m0-12c2-2 5-2 8-1v12c-3-1-6-1-8 1ZM5 7h2m-2 3h2m6-3h2m-2 3h2',
};
const vscode = {
  back: 'm9 4-6 6 6 6M3 10h14', forward: 'm11 4 6 6-6 6M3 10h14',
  definition: 'M3 4h9v13H3Zm9 3h6m-3-3 3 3-3 3M6 8h3m-3 3h3m-3 3h3',
  git: 'M5 6v8m0-4h6a4 4 0 0 0 4-4M7 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm0 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM17 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  settings: 'm8 2-1 3-3-1-2 4 2 2-2 2 2 4 3-1 1 3h4l1-3 3 1 2-4-2-2 2-2-2-4-3 1-1-3ZM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  save: 'M3 3h12l2 2v12H3ZM6 3v5h8V3M6 17v-6h8v6',
  reading: 'M2 3h6l2 2 2-2h6v13h-6l-2 2-2-2H2Zm8 2v13M5 7h2m-2 3h2m6-3h2m-2 3h2',
};

export function Icon({ name }) {
  return <svg className="sc-wb-icon" data-icon={name} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
    {name === 'chevron' ? <path d="m6 8 4 4 4-4" /> : name === 'function' || name === 'variable' ? <>
      <g data-icon-theme="idea"><circle cx="10" cy="10" r="7" fill="currentColor" opacity=".18" stroke="none" /><text x="10" y="13.5" textAnchor="middle" fill="currentColor" stroke="none" fontSize="11">{name === 'function' ? 'ƒ' : 'v'}</text></g>
      <g data-icon-theme="vscode"><path d="m10 2 7 4v8l-7 4-7-4V6Zm-7 4 7 4 7-4m-7 4v8" /></g>
    </> : <><g data-icon-theme="idea"><path d={paths[name]} /></g><g data-icon-theme="vscode"><path d={vscode[name] || paths[name]} /></g></>}
  </svg>;
}
