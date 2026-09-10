import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { test } from 'vitest'

import {
  MACMAN_CONNECTOR_ARTIFACTS,
  selectMacManConnectorArtifacts,
  verifyMacManConnectorArtifact
} from './stage-macman-connectors.mjs'

test('MacMan packages local iMessage, Gmail, and WhatsApp runtimes instead of installing during a task', () => {
  const artifacts = selectMacManConnectorArtifacts({ arch: 'arm64', platform: 'darwin' })

  assert.deepEqual(
    artifacts.map(artifact => artifact.id),
    ['gmail', 'imessage', 'whatsapp']
  )
  assert.match(artifacts.find(artifact => artifact.id === 'gmail')?.url ?? '', /darwin_arm64/)
  assert.equal(artifacts.find(artifact => artifact.id === 'imessage')?.arch, 'universal')
  assert.equal(artifacts.find(artifact => artifact.id === 'whatsapp')?.source, 'workspace')
  assert.ok(artifacts.every(artifact => artifact.source === 'workspace' || /^[a-f0-9]{64}$/.test(artifact.sha256)))
})

test('Gmail packaging resolves the matching binary for Intel without changing the other connectors', () => {
  const artifacts = selectMacManConnectorArtifacts({ arch: 'x64', platform: 'darwin' })

  assert.match(artifacts.find(artifact => artifact.id === 'gmail')?.url ?? '', /darwin_amd64/)
  assert.equal(artifacts.find(artifact => artifact.id === 'imessage')?.arch, 'universal')
  assert.equal(artifacts.find(artifact => artifact.id === 'whatsapp')?.source, 'workspace')
})

test('connector artifacts fail closed when downloaded bytes do not match the pinned digest', () => {
  const bytes = Buffer.from('signed connector bytes')
  const expected = createHash('sha256').update(bytes).digest('hex')

  assert.doesNotThrow(() => verifyMacManConnectorArtifact(bytes, { id: 'test', sha256: expected }))
  assert.throws(
    () => verifyMacManConnectorArtifact(Buffer.from('tampered'), { id: 'test', sha256: expected }),
    /checksum mismatch/i
  )
})

test('the pinned catalog contains both supported Mac architectures', () => {
  const gmailArchitectures = MACMAN_CONNECTOR_ARTIFACTS.filter(artifact => artifact.id === 'gmail').map(
    artifact => artifact.arch
  )

  assert.deepEqual(gmailArchitectures.sort(), ['arm64', 'x64'])
  assert.throws(
    () => selectMacManConnectorArtifacts({ arch: 'arm64', platform: 'linux' }),
    /macOS-only/i
  )
})
