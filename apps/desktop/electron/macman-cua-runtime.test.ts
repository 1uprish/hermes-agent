import assert from 'node:assert/strict'
import path from 'node:path'

import { test } from 'vitest'

import { resolveBundledCuaSdkEntries } from './macman-cua-runtime'

test('the Cua SDK loads from an ordinary resource directory outside ASAR', () => {
  assert.deepEqual(resolveBundledCuaSdkEntries('/Applications/MacMan.app/Contents/Resources'), {
    electron:
      'file:///Applications/MacMan.app/Contents/Resources/macman-cua-sdk/node_modules/@trycua/cua-driver/dist/electron.js',
    root: 'file:///Applications/MacMan.app/Contents/Resources/macman-cua-sdk/node_modules/@trycua/cua-driver/dist/index.js'
  })

  assert.throws(() => resolveBundledCuaSdkEntries(path.join('/tmp', 'app.asar', 'Resources')), /outside ASAR/i)
})
