#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isMain } from './utils.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(here, '..')
const repositoryRoot = resolve(desktopRoot, '../..')

export const MACMAN_CONNECTOR_ARTIFACTS = Object.freeze([
  {
    arch: 'arm64',
    binary: 'gog',
    id: 'gmail',
    sha256: '387062a590d470d0b13b1c79cab72c5908bfc42abc5cf68243bf3f12fc30acda',
    source: 'release',
    url: 'https://github.com/openclaw/gogcli/releases/download/v0.39.1/gogcli_0.39.1_darwin_arm64.tar.gz',
    version: '0.39.1'
  },
  {
    arch: 'x64',
    binary: 'gog',
    id: 'gmail',
    sha256: 'e927ddf46cbee95fd4f1cb0946458fcbfff68fe68754121c310cd3aa5aca286c',
    source: 'release',
    url: 'https://github.com/openclaw/gogcli/releases/download/v0.39.1/gogcli_0.39.1_darwin_amd64.tar.gz',
    version: '0.39.1'
  },
  {
    arch: 'universal',
    binary: 'imessage-cli',
    id: 'imessage',
    sha256: '7629c828593faef7e324cd86a94df2e8fdbe7ae48c7b6f8d22167589627a77e6',
    source: 'release',
    url: 'https://github.com/beeper/platform-imessage/releases/download/v0.24.4/imessage-cli-0.24.4-macos-universal.tar.gz',
    version: '0.24.4'
  },
  {
    arch: 'universal',
    id: 'whatsapp',
    source: 'workspace',
    version: '7.0.0-rc13'
  }
])

export function selectMacManConnectorArtifacts({ arch, platform }) {
  if (platform !== 'darwin') {
    throw new Error(`MacMan connectors are macOS-only; received ${platform}`)
  }

  if (arch !== 'arm64' && arch !== 'x64') {
    throw new Error(`Unsupported MacMan architecture: ${arch}`)
  }

  return MACMAN_CONNECTOR_ARTIFACTS.filter(artifact => artifact.arch === arch || artifact.arch === 'universal').sort(
    (left, right) => left.id.localeCompare(right.id)
  )
}

export function verifyMacManConnectorArtifact(bytes, artifact) {
  const actual = createHash('sha256').update(bytes).digest('hex')

  if (actual !== artifact.sha256) {
    throw new Error(`Checksum mismatch for ${artifact.id}: expected ${artifact.sha256}, received ${actual}`)
  }
}

function assertSafeArchiveEntries(archivePath) {
  const listed = spawnSync('tar', ['-tzf', archivePath], { encoding: 'utf8' })

  if (listed.status !== 0) {
    throw new Error(`Could not inspect ${basename(archivePath)}: ${(listed.stderr || listed.stdout || '').trim()}`)
  }

  for (const rawEntry of listed.stdout.split(/\r?\n/)) {
    const entry = rawEntry.trim()

    if (!entry) {
      continue
    }

    const parts = entry.split('/').filter(Boolean)

    if (isAbsolute(entry) || parts.includes('..')) {
      throw new Error(`Unsafe path in ${basename(archivePath)}: ${entry}`)
    }
  }
}

function findNamedFile(root, filename) {
  const pending = [root]

  while (pending.length > 0) {
    const directory = pending.shift()

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)

      if (entry.isDirectory()) {
        pending.push(path)
      } else if (entry.isFile() && entry.name === filename) {
        return path
      }
    }
  }

  return null
}

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' })

  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}: ${url}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

async function stageReleaseArtifact(artifact, destinationRoot, temporaryRoot) {
  const archivePath = join(temporaryRoot, `${artifact.id}-${artifact.arch}.tar.gz`)
  const bytes = await download(artifact.url)
  verifyMacManConnectorArtifact(bytes, artifact)
  writeFileSync(archivePath, bytes, { mode: 0o600 })
  assertSafeArchiveEntries(archivePath)

  const extracted = join(temporaryRoot, `${artifact.id}-${artifact.arch}`)
  mkdirSync(extracted, { mode: 0o700, recursive: true })
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', extracted], { encoding: 'utf8' })

  if (result.status !== 0) {
    throw new Error(`Could not extract ${artifact.id}: ${(result.stderr || result.stdout || '').trim()}`)
  }

  const binary = findNamedFile(extracted, artifact.binary)

  if (!binary) {
    throw new Error(`${artifact.id} archive did not contain ${artifact.binary}`)
  }

  const destination = join(destinationRoot, artifact.id, artifact.arch, artifact.binary)
  mkdirSync(dirname(destination), { mode: 0o755, recursive: true })
  cpSync(binary, destination)
  chmodSync(destination, 0o755)

  return relative(destinationRoot, destination).split(sep).join('/')
}

function stageWhatsApp(destinationRoot) {
  const source = join(repositoryRoot, 'scripts', 'whatsapp-bridge')
  const destination = join(destinationRoot, 'whatsapp', 'universal')

  if (!existsSync(join(source, 'package-lock.json'))) {
    throw new Error(`WhatsApp bridge lockfile is missing at ${source}`)
  }

  mkdirSync(destination, { mode: 0o755, recursive: true })
  cpSync(source, destination, {
    filter: path => !path.includes(`${sep}node_modules${sep}`) && !path.endsWith('.test.mjs'),
    recursive: true
  })

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npm, ['ci', '--omit=dev', '--ignore-scripts'], {
    cwd: destination,
    encoding: 'utf8',
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' }
  })

  if (result.status !== 0) {
    throw new Error(`Could not stage WhatsApp dependencies: ${(result.stderr || result.stdout || '').trim()}`)
  }

  return relative(destinationRoot, join(destination, 'bridge.js')).split(sep).join('/')
}

export async function stageMacManConnectors({
  arch = process.arch,
  destinationRoot = join(desktopRoot, 'build', 'macman-connectors'),
  platform = process.platform
} = {}) {
  const artifacts = selectMacManConnectorArtifacts({ arch, platform })
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'macman-connector-stage-'))

  rmSync(destinationRoot, { force: true, recursive: true })
  mkdirSync(destinationRoot, { mode: 0o755, recursive: true })

  try {
    const manifest = []

    for (const artifact of artifacts) {
      const executable =
        artifact.source === 'workspace'
          ? stageWhatsApp(destinationRoot)
          : await stageReleaseArtifact(artifact, destinationRoot, temporaryRoot)

      manifest.push({
        arch: artifact.arch,
        executable,
        id: artifact.id,
        sha256: artifact.sha256 ?? null,
        version: artifact.version
      })
    }

    writeFileSync(join(destinationRoot, 'manifest.json'), `${JSON.stringify({ connectors: manifest }, null, 2)}\n`, {
      mode: 0o644
    })

    return manifest
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true })
  }
}

if (isMain(import.meta.url)) {
  stageMacManConnectors()
    .then(manifest => {
      console.log(`[macman-connectors] staged ${manifest.map(entry => `${entry.id}@${entry.version}`).join(', ')}`)
    })
    .catch(error => {
      console.error(`[macman-connectors] ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    })
}
