import { codeFolding, foldGutter } from '@codemirror/language';

export function foldMarker(open) {
  const marker = document.createElement('span');
  marker.className = 'cm-fold-chevron';
  marker.dataset.open = String(open);
  marker.setAttribute('aria-hidden', 'true');
  return marker;
}

export function folding(t) {
  return [foldGutter({ markerDOM(open) {
    const marker = foldMarker(open);
    marker.title = t(open ? 'foldCode' : 'unfoldCode');
    return marker;
  } }), codeFolding({ placeholderDOM(editor, expand) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-foldPlaceholder';
    button.textContent = '…';
    button.title = t('unfoldCode');
    button.setAttribute('aria-label', button.title);
    // WebKit 的原生选区可能在按下期间重绘折叠占位，导致后续 click 丢失。
    button.onpointerdown = event => { if (event.button === 0) event.preventDefault(); };
    button.onclick = event => { expand(event); editor.focus(); };
    return button;
  } })];
}
