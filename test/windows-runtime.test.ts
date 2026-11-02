import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rm, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { prepareWindowsRuntime, windowsRuntimeEnvironment } from '../src/core/windows-runtime.js'

/** Read PE imports without executing the packaged Windows binaries on the test host. */
function importedLibraries(bytes: Buffer): string[] {
  const pe = bytes.readUInt32LE(60), optional = pe + 24
  assert.equal(bytes.toString('ascii', pe, pe + 4), 'PE\0\0')
  const sections = optional + bytes.readUInt16LE(pe + 20)
  const offsetOf = (rva: number): number => {
    for (let n = 0; n < bytes.readUInt16LE(pe + 6); n++) {
      const section = sections + n * 40, start = bytes.readUInt32LE(section + 12)
      const size = Math.max(bytes.readUInt32LE(section + 8), bytes.readUInt32LE(section + 16))
      if (rva >= start && rva < start + size) return bytes.readUInt32LE(section + 20) + rva - start
    }
    throw new Error('Invalid PE import address')
  }
  const directories = optional + (bytes.readUInt16LE(optional) === 0x20b ? 112 : 96)
  const imports: string[] = []
  for (let entry = offsetOf(bytes.readUInt32LE(directories + 8)); bytes.readUInt32LE(entry + 12); entry += 20) {
    const name = offsetOf(bytes.readUInt32LE(entry + 12))
    imports.push(bytes.toString('ascii', name, bytes.indexOf(0, name)).toLowerCase())
  }
  return imports
}

test('both packaged architectures contain verified PE files and every non-system DLL dependency', async () => {
  const root = new URL('../runtime/windows/', import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'))
  const windowsLibraries = new Set(['kernel32.dll', 'ntdll.dll', 'user32.dll', 'advapi32.dll', 'msvcrt.dll', 'ws2_32.dll', 'bcrypt.dll', 'secur32.dll'])
  for (const arch of ['x64', 'arm64']) {
    const files = manifest.files.filter((file: { arch: string }) => file.arch === 'all' || file.arch === arch)
    const names = new Set(files.map((file: { name: string }) => file.name))
    for (const file of files) {
      const bytes = gunzipSync(await readFile(new URL(file.asset, root)))
      assert.equal(bytes.length, file.bytes)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
      assert.equal(bytes.readUInt16LE(bytes.readUInt32LE(60) + 4), arch === 'arm64' && file.name === 'busybox.exe' ? 0xaa64 : 0x8664)
      for (const library of importedLibraries(bytes)) assert.ok(windowsLibraries.has(library) || names.has(library), `${file.name} requires ${library}`)
    }
    for (const applet of manifest.applets) assert.ok(!names.has(applet + '.exe'), `Duplicate command entry: ${applet}`)
  }
})

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'super-code-runtime-')), source = join(root, 'payload'), cacheRoot = join(root, '中文 缓存')
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(source)
  const files = ['bash.exe', 'msys-2.0.dll', 'busybox.exe'].map(name => {
    const bytes = Buffer.from('test payload: ' + name)
    return { name, arch: 'all', asset: name + '.gz', bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), content: bytes }
  })
  for (const file of files) await writeFile(join(source, file.asset), gzipSync(file.content))
  const manifest = { id: 'test-runtime', files: files.map(({ content, ...file }) => file), applets: ['cat', 'find', 'sort', 'env'] }
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest))
  return { source, cacheRoot, manifest, options: { source, cacheRoot, arch: 'x64' } }
}

test('runtime preparation is offline, idempotent and uses hard links for command entries', async t => {
  const f = await fixture(t), runtime = await prepareWindowsRuntime(f.options)
  assert.deepEqual(await prepareWindowsRuntime(f.options), runtime)
  const busybox = await lstat(join(runtime.bin, 'busybox.exe'), { bigint: true })
  for (const name of f.manifest.applets) assert.equal((await lstat(join(runtime.bin, name + '.exe'), { bigint: true })).ino, busybox.ino)
  assert.equal((await lstat(join(runtime.bin, 'bash.exe'), { bigint: true })).ino, (await lstat(join(runtime.bin, 'sh.exe'), { bigint: true })).ino)
  assert.ok((await lstat(join(runtime.root, 'tmp'))).isDirectory())
  assert.equal(await readFile(runtime.bash, 'utf8'), 'test payload: bash.exe')
})

test('parallel preparations publish one complete runtime without partial command entries', async t => {
  const f = await fixture(t)
  const results = await Promise.all(Array.from({ length: 4 }, () => prepareWindowsRuntime(f.options)))
  for (const result of results) assert.deepEqual(result, results[0])
})

test('corrupt packaged or cached bytes stop preparation instead of executing them', async t => {
  const f = await fixture(t)
  await writeFile(join(f.source, 'bash.exe.gz'), gzipSync('wrong bytes'))
  await assert.rejects(prepareWindowsRuntime(f.options), /Corrupt|buffer larger/)
  const fresh = await fixture(t), runtime = await prepareWindowsRuntime(fresh.options)
  await writeFile(runtime.bash, 'damaged')
  await assert.rejects(prepareWindowsRuntime(fresh.options), /failed verification/)
})

test('cache symlinks, unsupported architectures and manifest path traversal are rejected', async t => {
  const f = await fixture(t)
  await assert.rejects(prepareWindowsRuntime({ ...f.options, arch: 'ia32' }), /does not support/)
  await mkdir(f.cacheRoot)
  await symlink(f.source, join(f.cacheRoot, 'test-runtime-x64'), 'junction')
  await assert.rejects(prepareWindowsRuntime(f.options), /Unsafe/)
  f.manifest.files[0]!.asset = '../outside.gz'
  await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.manifest))
  await assert.rejects(prepareWindowsRuntime({ ...f.options, cacheRoot: join(f.cacheRoot, 'other') }), /Invalid/)
})

test('malformed manifests fail with a clear error before creating a cache', async t => {
  const f = await fixture(t)
  for (const manifest of [null, [], { ...f.manifest, id: 123 }, { ...f.manifest, files: [null] },
    { ...f.manifest, applets: [123] }, { ...f.manifest, applets: ['cat', 'cat'] },
    { ...f.manifest, applets: ['busybox'] }, { ...f.manifest, applets: ['bash'] },
    { ...f.manifest, applets: ['sh'] }, { ...f.manifest, applets: ['../cat'] },
    { ...f.manifest, applets: ['bash.exe'] }, { ...f.manifest, files: Array(21).fill(f.manifest.files[0]) },
  ]) {
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest))
    await assert.rejects(prepareWindowsRuntime(f.options), /Invalid bundled Bash manifest/)
    await assert.rejects(lstat(f.cacheRoot), { code: 'ENOENT' })
  }
})

test('missing payloads and interrupted preparation leave no published or staging runtime', async t => {
  const f = await fixture(t)
  await unlink(join(f.source, 'bash.exe.gz'))
  await assert.rejects(prepareWindowsRuntime(f.options), { code: 'ENOENT' })
  assert.deepEqual(await readdir(f.cacheRoot), [])
  await writeFile(join(f.source, 'manifest.json'), JSON.stringify({ ...f.manifest, files: f.manifest.files.slice(1) }))
  await assert.rejects(prepareWindowsRuntime(f.options), /Incomplete/)
  await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.manifest))
  await assert.rejects(prepareWindowsRuntime({ ...f.options, cacheRoot: 'relative-cache' }), /absolute path/)
})

test('replaced command entries and symbolic executable paths cannot reuse a prepared cache', async t => {
  const f = await fixture(t), runtime = await prepareWindowsRuntime(f.options)
  const entry = join(runtime.bin, 'cat.exe')
  await unlink(entry)
  await writeFile(entry, 'test payload: busybox.exe')
  await assert.rejects(prepareWindowsRuntime(f.options), /Invalid bundled Bash command entry/)
  const fresh = await fixture(t), other = await prepareWindowsRuntime(fresh.options)
  await unlink(other.bash)
  await symlink(join(other.bin, 'busybox.exe'), other.bash)
  await assert.rejects(prepareWindowsRuntime(fresh.options), /failed verification/)
})

test('subprocess environment preserves developer paths and supplied data without copying ambient credentials', () => {
  const runtime = { root: 'C:\\Runtime', bin: 'C:\\Runtime\\usr\\bin', bash: 'C:\\Runtime\\usr\\bin\\bash.exe', version: 'test', arch: 'x64' }
  const supplied = { Path: 'C:\\Node;C:\\Tools', SC_EXPLICIT: 'value', BASH_ENV: 'bad.sh' }
  const before = { ...process.env }, env = windowsRuntimeEnvironment(runtime, supplied)
  assert.equal(env.PATH, 'C:\\Runtime\\usr\\bin;C:\\Node;C:\\Tools')
  assert.equal(env.Path, undefined)
  assert.equal(env.BASH_ENV, '')
  assert.equal(env.BB_GLOBBING, '0')
  assert.equal(env.BB_OVERRIDE_APPLETS, 'bash,sh')
  assert.equal(env.SC_EXPLICIT, 'value')
  // Compare digests so a failure never prints credential-bearing environment values.
  const fingerprint = (env: NodeJS.ProcessEnv) => createHash('sha256').update(JSON.stringify({ ...env })).digest('hex')
  assert.equal(fingerprint(process.env), fingerprint(before))
  assert.equal(supplied.BASH_ENV, 'bad.sh')
})

test('Windows PATH aliases follow Node precedence and explicit empty paths do not restore the ambient PATH', () => {
  const runtime = { root: 'C:\\Runtime', bin: 'C:\\Runtime\\usr\\bin', bash: 'C:\\Runtime\\usr\\bin\\bash.exe', version: 'test', arch: 'x64' }
  const aliases = windowsRuntimeEnvironment(runtime, { Path: 'C:\\Ignored', PATH: 'C:\\Explicit' })
  assert.equal(aliases.PATH, runtime.bin + ';C:\\Explicit')
  assert.equal(aliases.Path, undefined)
  for (const PATH of ['', undefined]) assert.equal(windowsRuntimeEnvironment(runtime, { PATH }).PATH, runtime.bin + ';')
})

test('ambient startup files, shell options and exported functions cannot affect a command', () => {
  const runtime = { root: 'C:\\Runtime', bin: 'C:\\Runtime\\usr\\bin', bash: 'C:\\Runtime\\usr\\bin\\bash.exe', version: 'test', arch: 'x64' }
  const values = { SC_BASH_HOST_ONLY: 'host-only-fixture', BASH_ENV: 'startup.sh', ENV: 'startup.sh', SHELLOPTS: 'xtrace',
    BASHOPTS: 'expand_aliases', 'BASH_FUNC_example%%': '() { :; }', 'bash_func_lower%%': '() { :; }' }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  try {
    Object.assign(process.env, values)
    const env = windowsRuntimeEnvironment(runtime)
    assert.equal(Object.hasOwn(env, 'SC_BASH_HOST_ONLY'), false)
    assert.equal(env.BASH_ENV, '')
    assert.equal(env.ENV, '')
    for (const key of ['SHELLOPTS', 'BASHOPTS', 'BASH_FUNC_example%%', 'bash_func_lower%%']) {
      assert.ok(Object.hasOwn(env, key), `${key} must mask the ambient value`)
      assert.equal(env[key], undefined)
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
