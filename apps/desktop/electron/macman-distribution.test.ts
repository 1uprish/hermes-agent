import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  applicationNameForDistribution,
  readMacManDistribution,
  userDataPathForDistribution
} from './macman-distribution'

test('the signed resource marker, not Electron package metadata, identifies a MacMan distribution', async () => {
  const resourcesPath = await mkdtemp(path.join(os.tmpdir(), 'macman-distribution-test-'))
  await mkdir(resourcesPath, { recursive: true })
  await writeFile(
    path.join(resourcesPath, 'macman-distribution.json'),
    JSON.stringify({ bundleId: 'com.macman.app', cuaDriverVersion: '0.22.1', productName: 'MacMan', schemaVersion: 1 })
  )

  assert.deepEqual(readMacManDistribution(resourcesPath), {
    bundleId: 'com.macman.app',
    cuaDriverVersion: '0.22.1',
    productName: 'MacMan',
    schemaVersion: 1
  })
  assert.equal(readMacManDistribution(path.join(resourcesPath, 'missing')), null)
})

test('MacMan distribution identity wins over the Hermes source-package name', () => {
  assert.equal(applicationNameForDistribution(null, 'Hermes'), 'Hermes')
  assert.equal(
    applicationNameForDistribution(
      {
        bundleId: 'com.macman.app',
        cuaDriverVersion: '0.22.1',
        productName: 'MacMan',
        schemaVersion: 1
      },
      'Hermes'
    ),
    'MacMan'
  )
})

test('MacMan gets a distinct singleton and browser-data directory', () => {
  const distribution = {
    bundleId: 'com.macman.app',
    cuaDriverVersion: '0.22.1',
    productName: 'MacMan',
    schemaVersion: 1
  } as const

  assert.equal(
    userDataPathForDistribution(distribution, '/Users/test/Library/Application Support'),
    path.join('/Users/test/Library/Application Support', 'MacMan')
  )
  assert.equal(userDataPathForDistribution(null, '/Users/test/Library/Application Support'), null)
})
