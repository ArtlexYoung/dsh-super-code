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
const git = await build({
  absWorkingDir: fileURLToPath(root), entryPoints: ['builtin/git/index.js'], bundle: true, write: false,
  format: 'cjs', platform: 'node', target: 'node22', minify: true, sourcemap: false, legalComments: 'eof', metafile: true,
});
const base = source.slice(from + start.length, to);
const bundle = `;(globalThis.window||globalThis).__ModuleLoader__.load({id:'dsh-super-code',factory:require=>{\nconst base=(()=>{${base}\n})();\nconst builtin=(()=>{const module={exports:{}};const exports=module.exports;${built.outputFiles[0].text}\nreturn module.exports})();\nreturn {...base,apply(ctx){base.apply(ctx,builtin.descriptors);builtin.apply(ctx,{Button:base.workbenchControls.Button,Select:base.workbenchControls.Select})}};\n}});\n`;
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/client.js', root), bundle);
await writeFile(new URL('dist/git.cjs', root), git.outputFiles[0].contents);
const packages = [...new Set([...Object.keys(built.metafile.inputs), ...Object.keys(git.metafile.inputs)].map(path => path.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean))].sort();
const notices = [];
for (const path of packages) {
  const directory = new URL(path + '/', root), manifest = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'));
  const license = (await readdir(directory)).find(name => /^licen[cs]e(?:[.-]|$)/i.test(name));
  const provided = manifest.name === 'clean-git-ref' && manifest.version === '2.0.1' ? new URL('runtime/workbench/licenses/clean-git-ref.txt', root) : undefined;
  const embedded = manifest.name === 'diff3' && manifest.version === '0.0.3'
    ? (await Promise.all(['diff3.js', 'onp.js'].map(async file => (await readFile(new URL(file, directory), 'utf8')).split(/\n(?:var onp|\/\*\*)/)[0]))).join('\n\n') : '';
  if (!license && !provided && !embedded) throw new Error(`Missing license for bundled package ${manifest.name}`);
  notices.push(`${manifest.name} ${manifest.version}\n${manifest.license}\n\n${embedded || await readFile(license ? new URL(license, directory) : provided, 'utf8')}`);
}
await writeFile(new URL('dist/THIRD_PARTY_NOTICES.txt', root), notices.join('\n\n--------------------\n\n') + '\n');
console.log(`Built client: ${Buffer.byteLength(bundle)} bytes`);
console.log(`Built Git: ${git.outputFiles[0].contents.length} bytes`);
