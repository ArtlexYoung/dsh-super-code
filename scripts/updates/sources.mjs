import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, posix } from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';

export const execute = promisify(execFile);
export const sources = [
  { id: 'mattpocock', repo: 'mattpocock/skills', prefix: '', manifest: '.claude-plugin/plugin.json' },
  { id: 'pstack', repo: 'cursor/plugins', prefix: 'pstack', manifest: 'pstack/.cursor-plugin/plugin.json' },
  { id: 'oil-ui', repo: 'oil-oil/oil-ui', prefix: '', manifest: 'SKILL.md' },
  { id: 'openspec', repo: 'Fission-AI/OpenSpec', prefix: '', manifest: 'package.json' },
];
export const hash = data => createHash('sha256').update(data).digest('hex');
export const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
export async function command(file, args, cwd, options = {}) {
  if (file === 'npm' && process.env.npm_execpath) return command(process.execPath, [process.env.npm_execpath, ...args], cwd, options);
  if (file === 'npm' && process.platform === 'win32') throw new Error('Run maintenance through npm run updates:check or npm run updates:apply on Windows');
  return (await execute(file, args, { cwd, timeout: 180000, maxBuffer: 16 * 1024 * 1024, ...options })).stdout.trim();
}
export async function github(path, raw = false) {
  const result = await command('gh', ['api', path, ...(raw ? ['-H', 'Accept: application/vnd.github.raw+json'] : [])]);
  return raw ? result : JSON.parse(result);
}
export function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) throw new Error('Missing Skill frontmatter');
  return yaml.load(match[1]);
}
export function safePath(path) {
  if (typeof path !== 'string' || !path || /[\\:<>"|?*\x00-\x1f\x7f]/.test(path) || posix.isAbsolute(path) || path.split('/').some(part => ['..', '.', '.git'].includes(part.toLowerCase()) || !part || /[. ]$/.test(part) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part))) throw new Error(`Invalid upstream path: ${path}`);
  return path;
}

export async function inspectSource(root, source) {
  const current = await readJson(join(root, 'builtin/skills', source.id, 'distribution.json'));
  const commit = await github(`repos/${source.repo}/commits/HEAD`);
  const manifest = await github(`repos/${source.repo}/contents/${source.manifest}?ref=${commit.sha}`, true);
  const metadata = source.id === 'oil-ui' ? frontmatter(manifest).metadata : JSON.parse(manifest);
  const license = await github(`repos/${source.repo}/contents/${source.prefix ? source.prefix + '/' : ''}LICENSE?ref=${commit.sha}`, true);
  const version = metadata.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version) || !license.includes('MIT License')) throw new Error(`Unrecognized version or license: ${source.id}`);
  if (license.trim() !== (await readFile(join(root, 'builtin/skills', source.id, 'LICENSE'), 'utf8')).trim()) throw new Error(`License text changed; review ${source.id} before updating`);
  if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error('Invalid upstream revision');
  const changed = current.revision !== commit.sha;
  const blocked = !changed ? undefined : source.id === 'pstack' ? 'PStack host adapter is pinned to its reviewed revision; review overrides before upgrading'
    : version.split('.')[0] !== current.version.split('.')[0] ? 'Major Skill update requires a compatibility review'
    : source.id === 'openspec' && version !== (await readJson(join(root, 'package.json'))).dependencies['@fission-ai/openspec'] ? 'OpenSpec Skills and bundled CLI must be upgraded together' : undefined;
  return { ...source, currentVersion: current.version, currentRevision: current.revision, version, revision: commit.sha,
    license: 'MIT', changed, ...(blocked ? { blocked } : {}) };
}

export const blobHash = content => createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
async function readBlob(root, source, entry, target, cache) {
  for (const path of [join(root, 'builtin/skills', source.id, target), join(cache, entry.sha)]) {
    try { const content = await readFile(path); if (blobHash(content) === entry.sha) return content; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const blob = await github(`repos/${source.repo}/git/blobs/${entry.sha}`);
  if (blob.encoding !== 'base64') throw new Error(`Unsupported blob encoding: ${entry.path}`);
  const content = Buffer.from(blob.content, 'base64');
  if (content.length !== entry.size || blobHash(content) !== entry.sha) throw new Error(`Upstream integrity mismatch: ${entry.path}`);
  await mkdir(cache, { recursive: true }); await writeFile(join(cache, entry.sha), content);
  return content;
}

export function adaptOil(text) {
  const withoutTools = text.replace(/^allowed-tools:\r?\n(?:[ \t].*\r?\n)+/m, '');
  const update = /^## 开始前\r?\n[\s\S]*?(?=^## )/m;
  if (!update.test(withoutTools)) throw new Error('oil-ui updater section changed; adapter needs review');
  return withoutTools.replace(update, '## 内置版本\n\n本副本由 dsh-super-code 提供，随插件升级，不单独检查更新或改写 Skill 安装目录。来源、固定版本与许可证见 [UPSTREAM.md](UPSTREAM.md)。其余流程按需使用；脚本和可选外部服务仍受宿主权限及用户授权约束。\n\n');
}

export function mappings(source, paths, manifest) {
  if (source.id === 'mattpocock') {
    if (!Array.isArray(manifest.skills)) throw new Error('Matt plugin layout changed');
    const roots = manifest.skills.map(path => safePath(path.replace(/^\.\//, '')));
    if (new Set(roots.map(path => posix.basename(path))).size !== roots.length) throw new Error('Duplicate Matt Skill names');
    return paths.flatMap(path => {
      if (path === 'LICENSE') return [[path, path]];
      const root = roots.find(root => path.startsWith(root + '/'));
      return root ? [[path, `skills/${posix.basename(root)}/${path.slice(root.length + 1)}`]] : [];
    });
  }
  if (source.id === 'oil-ui') return paths.filter(path => ['SKILL.md', 'LICENSE'].includes(path) || /^(?:references|scripts|assets)\//.test(path))
    .filter(path => !/^(?:assets\/(?:readme|vendor)\/|scripts\/check_update\.)/.test(path)).map(path => [path, path]);
  if (source.id === 'pstack') return paths.filter(path => path.startsWith('pstack/')).map(path => [path, path.slice(7)])
    .filter(([, path]) => path === 'LICENSE' || /^(?:skills|agents|docs|assets)\//.test(path));
  return paths.filter(path => path === 'LICENSE' || path.startsWith('skills/')).map(path => [path, path]);
}

export async function prepareSource(root, source, scratch, cache = join(root, '.development/updates/blobs')) {
  if (source.blocked || source.id === 'pstack') throw new Error(source.blocked || 'Review PStack adapter before updating');
  const output = join(scratch, source.id, 'bundle');
  await mkdir(output, { recursive: true });
  const tree = await github(`repos/${source.repo}/git/trees/${source.revision}?recursive=1`);
  if (tree.truncated) throw new Error(`Truncated upstream tree: ${source.id}`);
  const manifestText = await github(`repos/${source.repo}/contents/${source.manifest}?ref=${source.revision}`, true);
  const manifest = source.id === 'oil-ui' ? frontmatter(manifestText).metadata : JSON.parse(manifestText);
  const mapping = mappings(source, tree.tree.filter(entry => entry.type !== 'tree').map(entry => entry.path), manifest);
  const files = {}, skills = [], current = await readJson(join(root, 'builtin/skills', source.id, 'distribution.json'));
  const targets = new Set(); let bytes = 0;
  for (const [upstream, target] of mapping) {
    safePath(upstream); safePath(target);
    const entry = tree.tree.find(entry => entry.path === upstream);
    bytes += entry.size || 0;
    if (!['100644', '100755'].includes(entry.mode) || !Number.isSafeInteger(entry.size) || bytes > 25 * 1024 * 1024 || targets.has(target.toLowerCase())) throw new Error(`Unexpected upstream file, collision or size: ${upstream}`);
    targets.add(target.toLowerCase());
  }
  for (let offset = 0; offset < mapping.length; offset += 4) await Promise.all(mapping.slice(offset, offset + 4).map(async ([upstream, target]) => {
    const entry = tree.tree.find(entry => entry.path === upstream);
    const original = await readBlob(root, source, entry, target, cache), content = source.id === 'oil-ui' && target === 'SKILL.md' ? Buffer.from(adaptOil(original.toString())) : original;
    if (/(?:^|\/)SKILL\.md$/.test(target)) {
      const metadata = frontmatter(content.toString());
      if (typeof metadata.name !== 'string' || typeof metadata.description !== 'string') throw new Error(`Invalid Skill: ${target}`);
      skills.push(metadata.name);
    }
    files[upstream] = { path: target, sha256: hash(content), ...(content.equals(original) ? {} : { upstreamSha256: hash(original) }) };
    await mkdir(dirname(join(output, target)), { recursive: true });
    await writeFile(join(output, target), content, { mode: entry.mode === '100755' ? 0o755 : 0o644 });
  }));
  if (!skills.length || !files.LICENSE) throw new Error(`Missing Skill distribution: ${source.id}`);
  if (!(await readFile(join(output, 'LICENSE'), 'utf8')).includes('MIT License')) throw new Error('License changed during preparation');
  const distribution = { source: current.source, version: source.version, revision: source.revision, skills: skills.sort(), files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) };
  await writeFile(join(output, 'distribution.json'), JSON.stringify(distribution, null, 2) + '\n');
  let provenance = (await readFile(join(root, 'builtin/skills', source.id, 'UPSTREAM.md'), 'utf8')).replaceAll(current.revision, source.revision).replaceAll(current.version, source.version);
  if (source.id === 'oil-ui' && !targets.has('scripts/recommend_once.py')) provenance = provenance.replace(" The upstream one-time Pro recommendation script writes a marker in the user's local state directory.", '');
  provenance = provenance.replace(/\nBundled resource count:.*\n/g, '\n');
  await writeFile(join(output, 'UPSTREAM.md'), provenance.trimEnd() + `\n\nBundled resource count: ${mapping.length}; Skills: ${skills.length}. Exact files and SHA-256 records are in distribution.json.\n`);
  return { directory: output, bytes, files: mapping.length, skills: skills.length };
}
