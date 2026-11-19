import React, { useId } from 'react';

const symbols = {
  compass: <><path d="M20 3 25 15 37 20 25 25 20 37 15 25 3 20 15 15Z" /><path d="m20 10 4 10-4 10-4-10Z" className="sc-art-highlight" /><circle cx="20" cy="20" r="3" /></>,
  scroll: <><path d="M10 7h21v24H10V7ZM7 7h6v6H7Zm21 18h6v6h-6Z" /><path d="M16 14h10M16 19h10M16 24h6" className="sc-art-line" /><path d="M10 31h18v3H10Z" className="sc-art-highlight" /></>,
  flask: <><path d="M15 4h10v5h-2v9l10 14v4H7v-4l10-14V9h-2Z" /><path d="m13 26-5 8h24l-5-8Z" className="sc-art-highlight" /><path d="M18 10h4M15 28h4M23 31h3" className="sc-art-line" /></>,
  forge: <><path d="M7 8h12v5h16v5l-7 5H14l-7-5Zm8 15h11v9H12v-4h3Z" /><path d="M5 32h28v4H5Z" className="sc-art-highlight" /><path d="m24 3 3 3-8 8-3-3Z" /></>,
  tower: <><path d="M9 4h6v6h4V4h5v6h4V4h5v12h-3v20H12V16H9Z" /><path d="M18 26h6v10h-6ZM19 17h5v5h-5Z" className="sc-art-highlight" /><path d="M8 36h27" className="sc-art-line" /></>,
  camp: <><path d="m20 6 17 27H3Z" /><path d="m20 15 9 18H11Z" className="sc-art-highlight" /><path d="M20 6v27M4 36h32M15 3l5 3 5-3" className="sc-art-line" /></>,
  flag: <><path d="M11 5v30M11 6h22l-6 7 6 7H11" /><path d="M11 6h11v7H11Zm11 7h7l4 7H22Z" className="sc-art-highlight" /><path d="m5 35 6-5 7 5Z" /></>,
};

export function Landmark({ name, className = '' }) {
  return <svg className={`sc-flow-landmark ${className}`} viewBox="0 0 40 40" aria-hidden="true" focusable="false">{symbols[name] || symbols.compass}</svg>;
}

export function mapPoints(count, mobile = false) {
  if (mobile) return Array.from({ length: count }, (_, index) => [index % 2 ? 258 : 100, 75 + index * 142]);
  if (count === 3) return [[150, 270], [500, 138], [850, 270]];
  const positions = count === 4 ? [[120, 268], [370, 132], [625, 278], [875, 150]] : [[100, 275], [300, 130], [500, 285], [700, 132], [900, 270]];
  return positions;
}

export function Landscape({ count, completed, mobile = false }) {
  const id = useId().replaceAll(':', ''), points = mapPoints(count, mobile);
  const height = mobile ? 75 + (count - 1) * 142 + 120 : 440;
  return <svg className={`sc-flow-landscape${mobile ? ' sc-flow-landscape-mobile' : ''}`} viewBox={`0 0 ${mobile ? 360 : 1000} ${height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs><pattern id={`${id}-grid`} width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="currentColor" /></pattern>
      <g id={`${id}-tree`}><path d="M-3 7h6v11h-6Z" className="sc-map-trunk" /><path d="M-12 7v-5h5v-8h4v-7h6v7h4v8h5v5Z" className="sc-map-tree" /><path d="M0-13h3v7h4v8h5v5H0Z" className="sc-map-tree-shade" /></g>
      <g id={`${id}-rock`}><path d="m-12 8 5-15 12-4 10 19Z" className="sc-map-rock" /><path d="M-7-7 0 1l-2 7" fill="none" stroke="currentColor" opacity=".3" /></g>
    </defs>
    <rect width="100%" height="100%" fill={`url(#${id}-grid)`} opacity=".15" />
    {!mobile && <><path d="M-40 152 40 121 90 60 190 40 260 68 365 24 470 55 550 30 657 61 765 40 865 65 940 130 1040 158 1020 330 928 368 810 345 705 405 615 365 515 394 410 366 305 395 213 358 115 378 31 319-40 330Z" className="sc-map-shore" transform="translate(0 13)" />
      <path d="M-40 152 40 121 90 60 190 40 260 68 365 24 470 55 550 30 657 61 765 40 865 65 940 130 1040 158 1020 330 928 368 810 345 705 405 615 365 515 394 410 366 305 395 213 358 115 378 31 319-40 330Z" className="sc-map-ground" />
      <path d="m445-10-15 80 40 45-15 45 55 45-32 38 63 53-24 55 20 110" className="sc-map-river" />
      <path d="m490 224 46-15m-43 23 47-14m-44 22 48-14" className="sc-map-bridge" />
      <path d="m58 176 20-50 100-31 49 15M590 89l55-11 79 17 68-20M658 335l46 23 75-16M134 325l52-17 65 19" className="sc-map-contour" />
      {[[130, 100], [153, 119], [173, 99], [245, 300], [265, 314], [590, 100], [610, 85], [791, 285], [810, 300]].map(([x, y]) => <use key={`${x}-${y}`} href={`#${id}-tree`} transform={`translate(${x} ${y})`} />)}
      {[[64, 220], [350, 326], [830, 112], [916, 192]].map(([x, y]) => <use key={x} href={`#${id}-rock`} transform={`translate(${x} ${y})`} />)}
    </>}
    {mobile && <><path d={`M35 0 330 0 310 ${height} 25 ${height} 45 490 15 330 50 180Z`} className="sc-map-ground" />
      <path d={`M190-10 165 120 210 250 170 370 210 490 170 630 200 ${height}`} className="sc-map-river" />
      {points.map(([x, y], index) => <use key={index} href={`#${id}-tree`} transform={`translate(${index % 2 ? 55 : 302} ${y + 55})`} />)}
    </>}
    {points.slice(1).map(([x, y], index) => {
      const [previousX, previousY] = points[index];
      const curve = mobile ? `M${previousX} ${previousY} C${previousX} ${y},${x} ${previousY},${x} ${y}` : `M${previousX} ${previousY} C${previousX + 85} ${previousY},${x - 85} ${y},${x} ${y}`;
      return <g key={index}><path d={curve} className="sc-map-path-bed" /><path d={curve} className="sc-map-path" data-complete={completed.includes(index)} /></g>;
    })}
  </svg>;
}
