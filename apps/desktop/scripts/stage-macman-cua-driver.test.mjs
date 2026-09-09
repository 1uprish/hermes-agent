import assert from 'node:assert/strict'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { CUA_DRIVER_VERSION, isMacManDarwinPack, validateStagedCuaDriver } from './stage-macman-cua-driver.mjs'

test('the MacMan packaging gate is exact and macOS-only', () => {
  assert.equal(isMacManDarwinPack({ electronPlatformName: 'darwin', productFilename: 'MacMan' }), true)
  assert.equal(isMacManDarwinPack({ electronPlatformName: 'win32', productFilename: 'MacMan' }), false)
  assert.equal(isMacManDarwinPack({ electronPlatformName: 'darwin', productFilename: 'Hermes' }), false)
})

test('a staged Cua Driver must be executable, pinned, and universal', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'macman-cua-stage-test-'))
  const binaryPath = path.join(directory, 'cua-driver')
  await writeFile(binaryPath, 'fixture')
  await chmod(binaryPath, 0o755)

  await assert.doesNotReject(
    validateStagedCuaDriver(binaryPath, {
      inspectArchitectures: async () => ['x86_64', 'arm64'],
      readVersion: async () => `cua-driver ${CUA_DRIVER_VERSION}`
    })
  )

  await assert.rejects(
    validateStagedCuaDriver(binaryPath, {
      inspectArchitectures: async () => ['arm64'],
      readVersion: async () => 'cua-driver 0.21.0'
    }),
    /expected cua-driver 0\.22\.1.*universal/i
  )
})
