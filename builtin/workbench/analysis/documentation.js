function cleanComment(raw) {
  if (!/^\s*(?:\/\*|\/\/|#)/.test(raw)) return raw.trim();
  return raw.split('\n').map(line => line.trim().replace(/^\/\*\*?\s?/, '').replace(/\*\/$/, '').replace(/^(?:\*|\/\/[/!]?|#)\s?/, '')).join('\n').trim();
}

function xmlDocumentation(text) {
  const plain = value => value.replace(/<\/?(?:para|c|code|see|paramref)\b[^>]*>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(text);
  if (!summary) return null;
  const params = [...text.matchAll(/<param\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/param>/g)].map(match => ({ name: match[1], type: '', description: plain(match[2]).trim() }));
  const returns = /<returns>([\s\S]*?)<\/returns>/.exec(text);
  return { description: plain(summary[1]).trim(), params, returns: returns ? { type: '', description: plain(returns[1]).trim() } : null, extra: [] };
}

function pythonDocumentation(text) {
  const description = [], params = [], extra = [];
  let section = 'description', current = null, returns = null;
  for (const line of text.split('\n')) {
    if (/^(?:Args|Arguments|Parameters):\s*$/.test(line)) { section = 'params'; current = null; continue; }
    if (/^Returns:\s*$/.test(line)) { section = 'returns'; current = null; continue; }
    if (/^\S.*:\s*$/.test(line)) { section = 'extra'; extra.push(line); current = null; continue; }
    const param = section === 'params' && /^\s+([\w*]+)(?:\s+\(([^)]+)\))?:\s*(.*)$/.exec(line);
    if (param) { current = { name: param[1], type: param[2] || '', description: param[3] }; params.push(current); }
    else if (section === 'returns' && !returns && line.trim()) {
      const result = /^\s*([^:]+):\s*(.*)$/.exec(line);
      returns = { type: result?.[1] || '', description: result?.[2] ?? line.trim() }; current = returns;
    } else if (current && line.trim()) current.description += '\n' + line.trim();
    else if (section === 'description') description.push(line);
    else if (line.trim()) extra.push(line);
  }
  return { description: description.join('\n').trim(), params, returns, extra };
}

export function parseDocumentation(raw, language = '') {
  const text = cleanComment(raw);
  const xml = xmlDocumentation(text);
  if (xml) return { ...xml, raw: text };
  if (language === 'Python' && /^(?:Args|Arguments|Parameters|Returns):\s*$/m.test(text)) return { ...pythonDocumentation(text), raw: text };
  const description = [], params = [], extra = [];
  let current = description, returns = null;
  for (const line of text.split('\n')) {
    const param = /^@param\s+(?:\{([^}]+)\}\s*)?(\S+)\s*(?:-\s*)?(.*)$/.exec(line);
    const phpParam = language === 'PHP' && /^@param\s+(\S+)\s+(\$\S+)\s*(.*)$/.exec(line);
    const result = /^@returns?\s*(?:\{([^}]+)\}\s*)?(.*)$/.exec(line);
    if (phpParam) { param[1] = phpParam[1]; param[2] = phpParam[2]; param[3] = phpParam[3]; }
    if (param) {
      const item = { type: param[1] || '', name: param[2], description: param[3] }; params.push(item); current = item;
    } else if (result) {
      const phpReturn = language === 'PHP' && /^(\S+)\s*(.*)$/.exec(result[2]);
      returns = { type: result[1] || phpReturn?.[1] || '', description: phpReturn?.[2] ?? result[2] }; current = returns;
    }
    else if (/^@/.test(line)) { extra.push(line); current = extra; }
    else if (Array.isArray(current)) current.push(line);
    else current.description += (current.description ? '\n' : '') + line;
  }
  for (const item of params) item.description = item.description.trim();
  if (returns) returns.description = returns.description.trim();
  return { description: description.join('\n').trim(), params, returns, extra, raw: text };
}
