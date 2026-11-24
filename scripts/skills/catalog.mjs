import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

const root = new URL('../../', import.meta.url);
export async function workflowCatalog() {
  const packages = [];
  for (const [id, title, directory] of [
    ['mattpocock', 'Matt Pocock', 'skills'], ['pstack', 'PStack', 'dsh/skills'],
    ['openspec', 'OpenSpec', 'skills'], ['oil-ui', 'oil-ui', ''],
  ]) {
    const base = new URL(`builtin/skills/${id}/`, root);
    const distribution = JSON.parse(await readFile(new URL('distribution.json', base), 'utf8'));
    const names = directory ? (await readdir(new URL(directory + '/', base), { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort() : ['oil-ui'];
    const skills = [];
    for (const name of names) {
      const path = directory ? `${directory}/${name}/SKILL.md` : 'SKILL.md';
      const text = await readFile(new URL(path, base), 'utf8');
      const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
      const metadata = header && yaml.load(header[1]);
      if (!metadata || typeof metadata.name !== 'string' || typeof metadata.description !== 'string') throw new Error(`Invalid Skill metadata: ${id}/${path}`);
      skills.push({ id: `${id}/${name}`, name: metadata.name, description: metadata.description.trim(),
        path: `${id}/${path}`, userInvocable: metadata['user-invocable'] !== false,
        sections: [...text.slice(header[0].length).matchAll(/^##\s+(.+)$/gm)].slice(0, 8).map(match => match[1].trim()) });
    }
    packages.push({ id, title, version: distribution.version, source: distribution.source, revision: distribution.revision, skills });
  }
  return packages;
}

export async function buildCatalog(check = false) {
  const output = new URL('builtin/workflows/catalog.json', root);
  const content = JSON.stringify(await workflowCatalog(), null, 2) + '\n';
  if (check) {
    if (await readFile(output, 'utf8') !== content) throw new Error('Workflow catalog is stale; run npm run skills:build');
    return;
  }
  await writeFile(output, content);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildCatalog(process.argv.includes('--check'));
