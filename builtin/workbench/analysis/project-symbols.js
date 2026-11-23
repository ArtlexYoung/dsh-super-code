const kinds = ['function', 'variable', 'property', 'selector', 'tag', 'schema'];
export function compact(symbols) {
  const positions = new Uint32Array(symbols.length * 3), types = new Uint8Array(symbols.length);
  symbols.forEach((symbol, i) => { positions.set([symbol.offset, symbol.line, symbol.character], i * 3); types[i] = kinds.indexOf(symbol.kind); });
  // 复制名称，避免字符串切片继续持有整份源码；数字位置以紧凑数组存储。
  return { symbols: JSON.parse(JSON.stringify(symbols.map(symbol => symbol.name))), positions, kinds: types };
}
export function symbolAt(entry, i, file) {
  return { name: entry.symbols[i], offset: entry.positions[i * 3], line: entry.positions[i * 3 + 1], character: entry.positions[i * 3 + 2], kind: kinds[entry.kinds[i]], file };
}

export async function projectSymbols(files, query, limit, signal) {
  signal?.throwIfAborted();
  const words = query.trim().toLowerCase().split(/\s+/u), matches = [];
  let checked = 0;
  for (const [file, entry] of files) {
    for (const [i, name] of entry.symbols.entries()) {
      if (++checked % 500 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
      if (!words.every(word => `${name} ${file}`.toLowerCase().includes(word))) continue;
      if (matches.length >= limit) return { matches, truncated: true, indexed: files.size };
      matches.push(symbolAt(entry, i, file));
    }
  }
  return { matches, truncated: false, indexed: files.size };
}
