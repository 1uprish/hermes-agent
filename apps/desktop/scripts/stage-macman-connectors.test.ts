import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test } from 'vitest'

import {
  MACMAN_CONNECTOR_ARTIFACTS,
  rewriteAbsoluteSymlinks,
  selectMacManConnectorArtifacts,
  stageMacManGmailOAuthClient,
  verifyMacManConnectorArtifact
} from './stage-macman-connectors.mjs'

test('runtime staging rewrites host-absolute links to relocatable in-bundle links', () => {
  const directory = mkdtempSync(join(tmpdir(), 'macman-runtime-links-'))
  const source = join(directory, 'source')
  const destination = join(directory, 'destination')

  try {
    mkdirSync(join(source, 'bin'), { recursive: true })
    mkdirSync(join(destination, 'bin'), { recursive: true })
    writeFileSync(join(source, 'bin', 'python3.11'), '')
    writeFileSync(join(destination, 'bin', 'python3.11'), '')
    symlinkSync(join(source, 'bin', 'python3.11'), join(destination, 'bin', 'python3'))

    rewriteAbsoluteSymlinks(destination, source, destination)

    assert.equal(readlinkSync(join(destination, 'bin', 'python3')), 'python3.11')
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

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

test('release packaging accepts only a Google desktop OAuth identity and stages it privately', () => {
  const directory = mkdtempSync(join(tmpdir(), 'macman-google-oauth-'))
  const source = join(directory, 'desktop-client.json')
  const destination = join(directory, 'bundle')
  const identity = {
    installed: {
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      client_id: 'macman.apps.googleusercontent.com',
      client_secret: 'build-secret',
      token_uri: 'https://oauth2.googleapis.com/token'
    }
  }

  try {
    writeFileSync(source, JSON.stringify(identity))
    const staged = stageMacManGmailOAuthClient(source, destination)

    assert.deepEqual(JSON.parse(readFileSync(staged, 'utf8')), identity)
    assert.equal(statSync(staged).mode & 0o777, 0o600)

    writeFileSync(source, JSON.stringify({ web: identity.installed }))
    assert.throws(() => stageMacManGmailOAuthClient(source, destination), /desktop OAuth client/i)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})
