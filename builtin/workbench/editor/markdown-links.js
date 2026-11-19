import { fileTarget } from '../file-links.js';

const absolute = value => value.startsWith('/') || /^[a-z]:\//i.test(value);
const directory = value => value.slice(0, Math.max(0, value.lastIndexOf('/')));

export function markdownTargets(address, file, cwd) {
  const raw = address.split(/[?#]/, 1)[0];
  if (!raw || /^(?:[/\\]{2}|[a-z][a-z\d+.-]*:)/i.test(raw) && !/^[a-z]:[/\\]/i.test(raw)) return null;
  let path;
  try { path = decodeURIComponent(raw).replaceAll('\\', '/'); }
  catch { return []; }
  if (path.includes('\0') || path.startsWith('//')) return [];
  const line = Number(/#L([1-9]\d*)(?:-L[1-9]\d*)?$/i.exec(address)?.[1]);
  const options = Number.isSafeInteger(line) ? { line } : undefined;
  const fromRoot = fileTarget(path, options, { cwd, current: '' });
  const candidates = absolute(path) ? [fromRoot] : [
    fileTarget(path, options, { current: directory(file) }),
    ...(/^(?:\.\.?)(?:\/|$)/.test(path) ? [] : [fromRoot]),
  ];
  const valid = candidates.map(target => ({ ...target, file: target.file.replace(/\/+$/, '') }));
  return valid.filter(({ file }, i) => !absolute(file) && !file.split('/').includes('..') && !/^[a-z]:/i.test(file) && (i === 0 || file !== valid[0].file));
}

export async function locateMarkdownTarget(targets, list, signal) {
  for (const target of targets) {
    signal.throwIfAborted();
    if (!target.file) return { ...target, type: 'directory' };
    try {
      const { entries } = await list(directory(target.file), signal);
      signal.throwIfAborted();
      const entry = entries.find(entry => entry.path === target.file);
      if (entry) return { ...target, type: entry.type };
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code) && !/(?:not found|not a directory)$/i.test(error.message)) throw error;
    }
  }
  throw new Error('WORKBENCH_LINK_NOT_FOUND');
}
