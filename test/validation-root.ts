import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep artifacts outside the package; isolated runners can select their writable source directory.
export const validationRoot = process.env.SUPER_CODE_TEST_ROOT
  ? resolve(process.env.SUPER_CODE_TEST_ROOT)
  : fileURLToPath(new URL('../../source/validation/dsh-super-code/unit/', import.meta.url))
