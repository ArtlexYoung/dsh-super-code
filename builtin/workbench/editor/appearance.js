export const appearanceDefaults = { fontFamily: 'jetbrains', chineseFontFamily: 'system', fontSize: 14, lineHeight: 1.5, readerMode: false, stickyScroll: true };
export const editorFontSizes = Array.from({ length: 15 }, (_, index) => index + 10);
export const editorLineHeights = [1.2, 1.3, 1.4, 1.5, 1.6, 1.65, 1.7, 1.8, 2];

export const editorFonts = {
  theme: 'var(--wb-latin)',
  system: 'ui-monospace,SFMono-Regular,Menlo,Consolas',
  jetbrains: '"Super Code JetBrains Mono"',
  cascadia: '"Cascadia Code"',
  menlo: 'Menlo',
  consolas: 'Consolas',
};

export function localFontName(value) {
  return typeof value === 'string' && value.startsWith('local:') ? value.slice(6) : null;
}

function validFont(value, chinese) {
  const name = localFontName(value);
  return name !== null ? name.trim().length > 0 && name.length <= 256 && !/[\x00-\x1f\x7f]/.test(name)
    : chinese ? value === 'system' : Object.keys(editorFonts).includes(value);
}

export function readAppearance(value) {
  const result = Object.fromEntries(Object.entries(appearanceDefaults).map(([key, fallback]) => [key, value[key] === undefined ? fallback : value[key]]));
  if (!validFont(result.fontFamily, false) || !validFont(result.chineseFontFamily, true) || !editorFontSizes.includes(result.fontSize)
    || !Number.isFinite(result.lineHeight) || result.lineHeight < editorLineHeights[0] || result.lineHeight > editorLineHeights.at(-1)
    || ![result.readerMode, result.stickyScroll].every(value => typeof value === 'boolean')) throw new Error('WORKBENCH_PREFERENCES_INVALID');
  return result;
}

export function editorAppearance(preferences) {
  const fontFamily = [localFontName(preferences.fontFamily) ? JSON.stringify(localFontName(preferences.fontFamily)) : editorFonts[preferences.fontFamily],
    ...(localFontName(preferences.chineseFontFamily) ? [JSON.stringify(localFontName(preferences.chineseFontFamily))] : []),
    '"Super Code JetBrains Mono","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",monospace'].join(',');
  return {
    fontFamily, '--wb-code-font': fontFamily,
    fontSize: `${preferences.fontSize + (preferences.readerMode ? 1 : 0)}px`,
    // 阅读器文档与代码共用整像素行高，避免恢复滚动时累计子像素取整误差。
    lineHeight: preferences.readerMode ? `${Math.round((preferences.fontSize + 1) * Math.max(1.65, preferences.lineHeight))}px` : String(preferences.lineHeight),
    fontVariantLigatures: 'none', letterSpacing: 'normal',
  };
}
