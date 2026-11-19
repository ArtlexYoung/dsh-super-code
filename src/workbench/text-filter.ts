const WORDS = 64;

/** 按连续 ASCII 片段排除不可能的匹配，保留 Unicode 可折叠为 s、k 的 ſ、K。 */
export function textFilter(text: string): Uint32Array {
  const bits = new Uint32Array(WORDS);
  let first = -1, second = -1;
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code > 127) {
      if (code === 0x017f) code = 0x73;
      else if (code === 0x212a) code = 0x6b;
      else { first = second = -1; continue; }
    } else if (code >= 65 && code <= 90) code += 32;
    if (first >= 0) { const hash = (first * 961 + second * 31 + code) % (WORDS * 32); bits[hash >>> 5] = bits[hash >>> 5]! | 1 << (hash & 31); }
    first = second; second = code;
  }
  return bits;
}

export function mayContain(filter: Uint32Array | undefined, query: string): boolean {
  if (!filter || /[^\x00-\x7f]|[\r\n]/.test(query) || query.length < 3) return true;
  const text = query.toLowerCase();
  for (let i = 2; i < text.length; i++) {
    const hash = (text.charCodeAt(i - 2) * 961 + text.charCodeAt(i - 1) * 31 + text.charCodeAt(i)) % (WORDS * 32);
    if (!(filter[hash >>> 5]! & 1 << (hash & 31))) return false;
  }
  return true;
}
