import { createRequire } from 'node:module'

// 库随插件打包，宿主无需安装 Git；类型仅用于开发编译。
export const library: {
  git: typeof import('isomorphic-git')
  diff: Pick<typeof import('diff'), 'diffLines'>
  http: typeof import('isomorphic-git/http/node').default
} = createRequire(import.meta.url)('../../../dist/git.cjs')
