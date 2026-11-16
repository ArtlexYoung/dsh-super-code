import { build } from 'esbuild'

// 宿主通过同步 factory 提供 React 和客户端包；只包装构建产物，不解析源码。
await build({
  entryPoints: ['client/index.js'],
  outfile: 'dist/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  minifySyntax: true,
  minifyWhitespace: true,
  external: ['react', '@deepseek-ai/*'],
  loader: { '.css': 'text' },
  banner: { js: ";(globalThis.window || globalThis).__ModuleLoader__.load({ id: 'dsh-super-code', factory: (require) => {\nconst module = { exports: {} };" },
  footer: { js: 'return module.exports;\n} });' },
})
