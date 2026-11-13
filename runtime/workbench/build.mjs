import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const source = await readFile(new URL('client/index.js', root), 'utf8');
const start = "factory: (require) => {", end = '\n} })';
const from = source.indexOf(start), to = source.lastIndexOf(end);
if (from < 0 || to < from) throw new Error('Client factory boundary changed; update the workbench build entry');
const built = await build({
  absWorkingDir: fileURLToPath(root), entryPoints: ['builtin/workbench/index.jsx'], bundle: true, write: false,
  format: 'cjs', platform: 'browser', target: ['safari16', 'chrome110'], minify: true, sourcemap: false,
  external: ['react', 'react-dom'], loader: { '.css': 'text' }, legalComments: 'eof', metafile: true,
});
const base = source.slice(from + start.length, to);
const bundle = `;(globalThis.window||globalThis).__ModuleLoader__.load({id:'dsh-super-code',factory:require=>{\nconst base=(()=>{${base}\n})();\nconst builtin=(()=>{const module={exports:{}};const exports=module.exports;${built.outputFiles[0].text}\nreturn module.exports})();\nreturn {...base,apply(ctx){base.apply(ctx,builtin.descriptors);builtin.apply(ctx,{Button:base.workbenchControls.Button,Select:base.workbenchControls.Select})}};\n}});\n`;
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/client.js', root), bundle);
const packages = [...new Set(Object.keys(built.metafile.inputs).map(path => path.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean))].sort();
const notices = [];
for (const path of packages) {
  const directory = new URL(path + '/', root), manifest = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'));
  const license = (await readdir(directory)).find(name => /^licen[cs]e(?:\.|$)/i.test(name));
  if (!license) throw new Error(`Missing license for bundled package ${manifest.name}`);
  notices.push(`${manifest.name} ${manifest.version}\n${manifest.license}\n\n${await readFile(new URL(license, directory), 'utf8')}`);
}
await writeFile(new URL('dist/THIRD_PARTY_NOTICES.txt', root), notices.join('\n\n--------------------\n\n') + '\n');
console.log(`Built client: ${Buffer.byteLength(bundle)} bytes`);
