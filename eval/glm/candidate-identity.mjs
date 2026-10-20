import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

export const sha256 = value => createHash('sha256').update(value).digest('hex')

/** Validate the package actually loaded by this profile, before any model call. */
export async function verifyCandidate(profile, manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const installed = await realpath(join(profile, 'node_modules/dsh-super-code'))
  const pkg = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
  if (pkg.name !== manifest.package.name || pkg.version !== manifest.package.version) {
    throw new Error(`Candidate identity mismatch: expected ${manifest.package.version}, installed ${pkg.version}`)
  }
  const tarball = isAbsolute(manifest.package.tarball) ? manifest.package.tarball
    : resolve(manifestPath, '..', manifest.package.tarball)
  if (sha256(await readFile(tarball)) !== manifest.artifacts.tarball_sha256) {
    throw new Error('Candidate tarball hash mismatch')
  }
  const files = manifest.artifacts.package_files
  if (!files || !Object.hasOwn(files, 'lib/dsh/super-code.js')) {
    throw new Error('Candidate manifest lacks installed runtime fingerprints; rebuild it before evaluation')
  }
  for (const [file, expected] of Object.entries(files)) {
    if (isAbsolute(file) || file.split('/').includes('..')) throw new Error('Invalid candidate artifact path')
    if (sha256(await readFile(join(installed, file))) !== expected) {
      throw new Error(`Candidate installed artifact mismatch: ${file}`)
    }
  }
  return { manifest, installation: { path: installed, name: pkg.name, version: pkg.version,
    verified_files: Object.keys(files).length, tarball_sha256: manifest.artifacts.tarball_sha256,
    runtime_sha256: files['lib/dsh/super-code.js'] } }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const result = await verifyCandidate(process.argv[2], process.argv[3])
  process.stdout.write(JSON.stringify(result.installation) + '\n')
}
