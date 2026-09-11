import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import { test } from 'vitest'

interface MacManBuilderConfig {
  mac?: {
    binaries?: string[]
  }
}

const require = createRequire(import.meta.url)

test('MacMan packaging signs concrete bundled connector paths', () => {
  const config = require('../electron-builder.macman.cjs') as MacManBuilderConfig
  const binaries = config.mac?.binaries ?? []

  assert.deepEqual(binaries, [
    'Contents/Resources/cua-driver',
    'Contents/Resources/macman-runtime/python/bin/python3.11',
    'Contents/Resources/macman-connectors/gmail/gog',
    'Contents/Resources/macman-connectors/imessage/universal/imessage-cli'
  ])
  assert.ok(binaries.every(binary => !binary.includes('*')))
})
