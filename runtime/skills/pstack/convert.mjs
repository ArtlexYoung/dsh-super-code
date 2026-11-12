import { readFile, readdir, mkdir, writeFile, chmod, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import paths, { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { adaptMarkdown, relativeTargets } from './adapt.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const pack = resolve(repo, 'builtin/skills/pstack')
const output = resolve(pack, 'dsh')
const sha = data => createHash('sha256').update(data).digest('hex')

export function generatedPath(root, file, pathApi = paths) {
  const target = pathApi.resolve(root, file)
  const local = pathApi.relative(root, target).replaceAll('\\', '/')
  if (!local || pathApi.isAbsolute(local) || local === '..' || local.startsWith('../')) throw new Error(`Invalid output path: ${file}`)
  return target
}

// Node deliberately refuses to strip TypeScript under node_modules. Compile at
// packaging time so installed helpers need neither a loader nor a writable copy.
function compileStatechart(files) {
  const prefix = 'skills/statechart/scripts/'
  const sources = new Set([...files.keys()].filter(path => path.startsWith(prefix) && path.endsWith('.ts') && !path.startsWith(prefix + 'test/')))
  for (const source of sources) {
    const result = ts.transpileModule(files.get(source).toString('utf8'), {
      fileName: source,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      transformers: { before: [context => node => {
        const visit = child => {
          if (ts.isStringLiteral(child) && sources.has(paths.posix.normalize(paths.posix.join(paths.posix.dirname(source), child.text)))) {
            return context.factory.createStringLiteral(child.text.replace(/\.ts$/, '.mjs'))
          }
          return ts.visitEachChild(child, visit, context)
        }
        return ts.visitNode(node, visit)
      }] },
    })
    files.set(source.replace(/\.ts$/, '.mjs'), Buffer.from(result.outputText))
  }
}

export async function convertedFiles() {
  const distribution = JSON.parse(await readFile(resolve(pack, 'distribution.json'), 'utf8'))
  if (distribution.revision !== '63912a91d52c43946f974f2aaf661334a6116a82') throw new Error('Review the adapter against this new PStack revision before generating it')
  const files = new Map(), manifest = { source: distribution.source, revision: distribution.revision, adapterVersion: 1, minimumDshVersion: '0.2.1-alpha.1', files: {} }
  for (const [source, record] of Object.entries(distribution.files)) {
    const content = await readFile(resolve(pack, record.path))
    if (sha(content) !== record.sha256) throw new Error(`Upstream changed without provenance review: ${source}`)
    let adapted
    try { adapted = await readFile(resolve(here, 'overrides', record.path)) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    const next = record.path.endsWith('.md')
      ? Buffer.from(adaptMarkdown(record.path, (adapted ?? content).toString('utf8')))
      : adapted ?? content
    files.set(record.path, next)
    manifest.files[record.path] = { upstreamSha256: record.sha256, sha256: sha(next), mode: adapted ? 'host-workflow' : sha(next) === record.sha256 ? 'unchanged' : 'host-translation' }
  }
  for (const name of ['DSH.md', 'authoring.md']) files.set(name, await readFile(resolve(here, name)))
  for (const entry of await readdir(resolve(here, 'overrides'), { recursive: true, withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Symlink in PStack overrides')
    if (!entry.isFile()) continue
    const absolute = resolve(entry.parentPath, entry.name)
    const path = relative(resolve(here, 'overrides'), absolute).replaceAll('\\', '/')
    if (!files.has(path)) files.set(path, await readFile(absolute))
  }
  compileStatechart(files)
  for (const [path, data] of files) {
    if (!manifest.files[path]) manifest.files[path] = { sha256: sha(data), mode: 'host-addition' }
  }
  const issues = []
  for (const [path, data] of files) {
    if (!path.endsWith('.md') || path.startsWith('docs/')) continue
    const text = data.toString('utf8')
    const forbidden = /~\/\.cursor|agent-transcripts|subagent_type|run_in_background|cloud_base_branch|environment: ["']cloud|pstack-models\.mdc|cursor-team-kit|SendToUser|update_state|grok-4\.|claude-opus-5|Cursor's|Cursor cloud|`Task`|\/loop(?:\s|`)|(?<![\w/-])pstack\/skills\/|a built-in, not a pstack skill|root agent's store|execution playbook from trunk|fast or standard speed/
    if (forbidden.test(text)) issues.push(`Unhandled host dependency in ${path}: ${text.match(forbidden)[0]}`)
    for (const target of relativeTargets(path, text)) {
      if (target.startsWith('../')) issues.push(`Reference escapes adapted package: ${path} -> ${target}`)
      if (!files.has(target) && ![...files.keys()].some(key => key.startsWith(target.replace(/\/$/, '') + '/'))) issues.push(`Missing adapted reference: ${path} -> ${target}`)
    }
  }
  if (issues.length) throw new Error(issues.join('\n'))
  files.set('adaptation.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'))
  return files
}

export async function build(check = false) {
  const files = await convertedFiles()
  for (const [path, content] of files) {
    const target = generatedPath(output, path)
    if (check) {
      const saved = await readFile(target)
      if (!saved.equals(content)) throw new Error(`Generated PStack is stale: ${path}; run npm run skills:build`)
      if (process.platform !== 'win32' && content.subarray(0, 2).toString() === '#!' && ((await stat(target)).mode & 0o111) === 0) throw new Error(`Generated helper is not executable: ${path}`)
    } else {
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content)
      await chmod(target, content.subarray(0, 2).toString() === '#!' ? 0o755 : 0o644)
    }
  }
  if (check) {
    const paths = await readdir(output, { recursive: true, withFileTypes: true })
    for (const entry of paths) {
      if (entry.isSymbolicLink()) throw new Error('Symlink in generated package')
      if (entry.isFile() && !files.has(relative(output, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/'))) throw new Error(`Stale generated file: ${entry.name}`)
    }
  }
  return { files: files.size, skills: [...files.keys()].filter(path => /^skills\/[^/]+\/SKILL\.md$/.test(path)).length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await build(process.argv.includes('--check')))) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
