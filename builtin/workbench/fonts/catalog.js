import { localFontName } from '../editor/appearance.js';

const commonFonts = ['Menlo', 'Monaco', 'Consolas', 'Cascadia Code', 'Cascadia Mono', 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'DejaVu Sans Mono', 'Liberation Mono', 'Ubuntu Mono', 'Courier New',
  'PingFang SC', '苹方-简', 'Hiragino Sans GB', 'Songti SC', '宋体-简', 'Heiti SC', 'Microsoft YaHei', 'Microsoft YaHei UI', 'SimSun', 'NSimSun', 'SimHei', 'DengXian', 'KaiTi', 'FangSong',
  'Noto Sans CJK SC', 'Noto Serif CJK SC', 'Noto Sans SC', 'Noto Serif SC', 'Source Han Sans SC', 'Source Han Serif SC', 'Sarasa Mono SC', 'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei'];
const legacyKeys = { Menlo: 'menlo', Consolas: 'consolas', 'Cascadia Code': 'cascadia' };

function uniqueFamilies(values) {
  const unique = new Map();
  for (const raw of values) if (typeof raw === 'string') {
    const name = raw.trim();
    if (name && name.length <= 256 && !/[\x00-\x1f\x7f]/.test(name)) unique.set(name.toLowerCase(), name);
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b, 'en'));
}

export async function fontAvailable(name) {
  try { await new FontFace('Super Code font probe', `local(${JSON.stringify(name)})`).load(); return true; }
  catch { return false; }
}

async function browserFonts({ queryLocalFonts, permissions }, full) {
  if (!queryLocalFonts) return null;
  if (!full) {
    try { if ((await permissions?.query({ name: 'local-fonts' }))?.state !== 'granted') return null; }
    catch { return null; }
  }
  return uniqueFamilies((await queryLocalFonts()).map(font => font.family));
}

/** 后端只是候选来源，必须核对当前浏览器所在电脑，避免远程连接列出服务器字体。 */
export async function detectFonts({ host, signal, full = false, environment = { queryLocalFonts: globalThis.queryLocalFonts?.bind(globalThis), permissions: globalThis.navigator?.permissions }, available = fontAvailable, selected = [] }) {
  signal?.throwIfAborted();
  let failed = false;
  try {
    const families = await browserFonts(environment, full); signal?.throwIfAborted();
    if (families) return { families, complete: true, failed: false };
  } catch { signal?.throwIfAborted(); failed = true; }
  let candidates = [];
  try { candidates = await host(signal); } catch { signal?.throwIfAborted(); failed = true; }
  const names = uniqueFamilies([...commonFonts, ...candidates, ...selected]), families = [];
  for (let index = 0; index < names.length; index += 16) {
    signal?.throwIfAborted();
    const batch = names.slice(index, index + 16);
    const found = await Promise.all(batch.map(async name => await available(name) ? name : null));
    families.push(...found.filter(Boolean));
  }
  signal?.throwIfAborted();
  return { families, complete: false, failed };
}

export function fontChoices(families, selected, chinese, t) {
  const choices = chinese ? [['system', t('chineseFontSystem')]] : ['jetbrains', 'theme', 'system'].map(key => [key, t(`editorFont_${key}`)]);
  choices.push(...families.map(name => [chinese ? `local:${name}` : legacyKeys[name] || `local:${name}`, name]));
  if (!choices.some(([key]) => key === selected)) {
    const name = localFontName(selected) || t(`editorFont_${selected}`);
    choices.push([selected, `${name} · ${t('fontUnavailable')}`]);
  }
  return choices;
}
