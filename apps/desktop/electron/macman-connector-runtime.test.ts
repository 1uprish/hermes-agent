import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, test } from 'vitest'

import {
  macManConnectorBackendEnvironment,
  macManConnectorResourcesRoot,
  resolveMacManConnectorExecutable,
  runMacManConnector
} from './macman-connector-runtime'

const temporaryDirectories: string[] = []

function resourcesRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'macman-connector-runtime-'))
  temporaryDirectories.push(root)

  return root
}

function executable(root: string, relativePath: string): string {
  const path = join(root, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '#!/bin/sh\n', { mode: 0o755 })

  return path
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('resource resolution follows staged output in development and packaged resources in releases', () => {
  assert.equal(macManConnectorResourcesRoot('/Applications/MacMan.app', '/release/resources', false), '/Applications/MacMan.app/build')
  assert.equal(macManConnectorResourcesRoot('/Applications/MacMan.app', '/release/resources', true), '/release/resources')
})

test('runtime resolution selects the host Gmail binary and universal local connectors', () => {
  const root = resourcesRoot()
  const gmail = executable(root, 'macman-connectors/gmail/gog')
  const imessage = executable(root, 'macman-connectors/imessage/universal/imessage-cli')
  const whatsapp = executable(root, 'macman-connectors/whatsapp/universal/bridge.js')

  assert.equal(resolveMacManConnectorExecutable(root, 'gmail', 'arm64'), gmail)
  assert.equal(resolveMacManConnectorExecutable(root, 'imessage', 'arm64'), imessage)
  assert.equal(resolveMacManConnectorExecutable(root, 'whatsapp', 'arm64'), whatsapp)
  assert.equal(resolveMacManConnectorExecutable(root, 'gmail', 'x64'), gmail)
})

test('MacMan local chat receives only existing connector paths and private state locations', () => {
  const root = resourcesRoot()
  const gmail = executable(root, 'macman-connectors/gmail/gog')
  const imessage = executable(root, 'macman-connectors/imessage/universal/imessage-cli')
  const dataRoot = join(root, 'user-data')

  assert.deepEqual(macManConnectorBackendEnvironment(root, dataRoot, 'arm64'), {
    GOG_HOME: join(dataRoot, 'gmail'),
    MACMAN_IMESSAGE_DATA_DIR: join(dataRoot, 'imessage'),
    pathEntries: [dirname(gmail), dirname(imessage)]
  })
})

test('connector execution captures structured output without a shell', async () => {
  const result = await runMacManConnector(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({ok:true}))'])

  assert.deepEqual(result, { exitCode: 0, stderr: '', stdout: '{"ok":true}' })
})

test('connector execution has a bounded timeout and reports the failure', async () => {
  const result = await runMacManConnector(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 20 })

  assert.notEqual(result.exitCode, 0)
  assert.match(result.stderr, /timed out/i)
})
