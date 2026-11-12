/** Files maintained by Finder and Explorer, not Skill or recovery content. */
import type { Dirent } from 'node:fs'

export function isDirectoryMetadata(entry: Dirent): boolean {
  return entry.isFile() && /^(?:\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(entry.name)
}
