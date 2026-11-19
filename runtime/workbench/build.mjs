import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const worker = await build({
  absWorkingDir: fileURLToPath(root), entryPoints: ['builtin/workbench/analysis/worker.js'], bundle: true, write: false,
  format: 'iife', platform: 'browser', target: ['safari16', 'chrome110'], minify: true, sourcemap: false, legalComments: 'eof', metafile: true,
});
const workbench = await build({
  absWorkingDir: fileURLToPath(root), entryPoints: ['builtin/workbench/index.jsx'], bundle: true, write: false,
  format: 'cjs', platform: 'browser', target: 'es2022', minifySyntax: true, minifyWhitespace: true,
  external: ['react', 'react-dom', '@deepseek-ai/*'], loader: { '.css': 'text', '.woff2': 'dataurl' }, legalComments: 'eof', metafile: true,
  define: { __WORKBENCH_ANALYSIS_WORKER__: JSON.stringify(worker.outputFiles[0].text) },
});
const built = await build({
  absWorkingDir: fileURLToPath(root), entryPoints: ['client/index.js'], bundle: true, write: false,
  format: 'cjs', platform: 'browser', target: 'es2022', minifySyntax: true, minifyWhitespace: true,
  external: ['react', 'react-dom', '@deepseek-ai/*', 'super-code-workbench'], loader: { '.css': 'text' }, legalComments: 'eof', metafile: true,
});
const git = await build({
  absWorkingDir: fileURLToPath(root), entryPoints: ['builtin/git/index.js'], bundle: true, write: false,
  format: 'cjs', platform: 'node', target: 'node22', minify: true, sourcemap: false, legalComments: 'eof', metafile: true,
});
const windowClient = await build({
  absWorkingDir: fileURLToPath(root), entryPoints: ['builtin/workbench/windows/index.jsx'], bundle: true, write: false,
  format: 'iife', platform: 'browser', target: ['safari16', 'chrome110'], minify: true, sourcemap: false,
  loader: { '.css': 'text', '.woff2': 'dataurl' }, legalComments: 'eof', metafile: true,
  define: { __WORKBENCH_ANALYSIS_WORKER__: JSON.stringify(worker.outputFiles[0].text), 'process.env.NODE_ENV': '"production"' },
  external: ['@deepseek-ai/*'],
});
const bundle = `;(globalThis.window || globalThis).__ModuleLoader__.load({ id: 'dsh-super-code', factory: (hostRequire) => {
let workbench;
const require = id => id === 'super-code-workbench' ? (workbench ||= (() => { const module = { exports: {} }; const exports = module.exports; ${workbench.outputFiles[0].text}\nreturn module.exports })()) : hostRequire(id);
const module = { exports: {} };
${built.outputFiles[0].text}
return module.exports;
} });\n`;
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/client.js', root), bundle);
await writeFile(new URL('dist/git.cjs', root), git.outputFiles[0].contents);
await writeFile(new URL('dist/window.js', root), windowClient.outputFiles[0].contents);
const packages = [...new Set([built, workbench, git, worker, windowClient].flatMap(result => Object.keys(result.metafile.inputs)).map(path => path.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean))].sort();
const notices = [`JetBrains Mono\nSIL Open Font License 1.1\n\n${await readFile(new URL('builtin/workbench/fonts/OFL.txt', root), 'utf8')}`];
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
console.log(`Built window: ${windowClient.outputFiles[0].contents.length} bytes`);
