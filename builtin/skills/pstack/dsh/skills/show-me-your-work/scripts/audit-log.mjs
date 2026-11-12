#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const header = 'ts\tphase\tdecision\twhy\tevidence\tresult'

/** Check a reproducible prefix; claim/evidence review remains the reviewer's job. */
export function auditLog(text, throughRow, expectedHash) {
  if (!text.endsWith('\n')) throw new Error('Log must end in a newline before taking a snapshot')
  const lines = text.match(/[^\n]*\n/g)
  if (!lines || lines[0].replace(/\r?\n$/, '') !== header) throw new Error('Invalid decision-log header')
  const totalRows = lines.length - 1
  const bound = throughRow ?? totalRows
  if (!Number.isSafeInteger(bound) || bound < 0 || bound > totalRows) throw new RangeError('Invalid snapshot row bound')
  if (expectedHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedHash)) throw new TypeError('Invalid snapshot hash')
  let previous = -Infinity
  for (let index = 1; index <= bound; index++) {
    const cells = lines[index].replace(/\r?\n$/, '').split('\t')
    if (cells.length !== 6) throw new Error(`Row ${index}: expected six columns`)
    if (cells.some(cell => !cell || cell !== cell.trim())) throw new Error(`Empty or padded cell in row ${index}`)
    if (cells.some(cell => /[\u0000-\u001f\u007f]/.test(cell))) throw new Error(`Control character in row ${index}`)
    if (cells.some(cell => /^[=+@-]/.test(cell))) throw new Error(`Unescaped spreadsheet formula prefix in row ${index}`)
    const timestamp = Date.parse(cells[0])
    if (!/^\d{4}-\d{2}-\d{2}T/.test(cells[0]) || !Number.isFinite(timestamp) || timestamp < previous) throw new Error(`Timestamp invalid or out of order in row ${index}`)
    previous = timestamp
  }
  const snapshotSha256 = createHash('sha256').update(lines.slice(0, bound + 1).join('')).digest('hex')
  if (expectedHash !== undefined && snapshotSha256 !== expectedHash) throw new Error('Snapshot changed before the recorded row bound')
  return { totalRows, throughRow: bound, snapshotSha256, claimsVerified: false }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [path, through, expectedHash, ...extra] = process.argv.slice(2)
    if (!path || extra.length || (through !== undefined && !/^(0|[1-9]\d*)$/.test(through))) throw new Error('Usage: audit-log.mjs LOG [THROUGH_ROW [EXPECTED_SHA256]]')
    console.log(JSON.stringify(auditLog(await readFile(path, 'utf8'), through === undefined ? undefined : Number(through), expectedHash)))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
  }
}
