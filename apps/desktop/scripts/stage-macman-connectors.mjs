#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isMain } from './utils.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(here, '..')
const repositoryRoot = resolve(desktopRoot, '../..')

const MACMAN_RUNTIME_SOURCE_DIRECTORIES = Object.freeze([
  'acp_adapter',
  'agent',
  'assets',
  'cron',
  'gateway',
  'hermes_cli',
  'locales',
  'optional-mcps',
  'optional-skills',
  'plugins',
  'providers',
  'skills',
  'tools',
  'tui_gateway'
])

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

  const destination =
    artifact.id === 'gmail'
      ? join(destinationRoot, artifact.id, artifact.binary)
      : join(destinationRoot, artifact.id, artifact.arch, artifact.binary)
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

function pythonRuntimeLayout(pythonExecutable) {
  const script = [
    'import json, site, sys',
    'print(json.dumps({"base_prefix": sys.base_prefix, "site_packages": site.getsitepackages()}))'
  ].join('; ')
  const result = spawnSync(pythonExecutable, ['-c', script], { encoding: 'utf8' })

  if (result.status !== 0) {
    throw new Error(`Could not inspect MacMan Python runtime: ${(result.stderr || result.stdout || '').trim()}`)
  }

  const parsed = JSON.parse(result.stdout)
  const sitePackages = parsed.site_packages?.find(candidate => candidate.includes(`${sep}site-packages`))

  if (!parsed.base_prefix || !sitePackages || !existsSync(join(parsed.base_prefix, 'bin', 'python3.11'))) {
    throw new Error('MacMan requires a CPython 3.11 environment with installed project dependencies')
  }

  return { basePrefix: parsed.base_prefix, sitePackages }
}

export function rewriteAbsoluteSymlinks(root, sourceRoot, destinationRoot) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const candidate = join(root, entry.name)

    if (entry.isDirectory()) {
      rewriteAbsoluteSymlinks(candidate, sourceRoot, destinationRoot)
      continue
    }

    if (!lstatSync(candidate).isSymbolicLink()) {
      continue
    }

    const target = readlinkSync(candidate)

    if (!isAbsolute(target)) {
      continue
    }

    const sourceRelativeTarget = relative(sourceRoot, target)

    if (isAbsolute(sourceRelativeTarget) || sourceRelativeTarget.split(sep).includes('..')) {
      throw new Error(`MacMan runtime symlink escapes its source: ${candidate} -> ${target}`)
    }

    const packagedTarget = join(destinationRoot, sourceRelativeTarget)
    rmSync(candidate)
    symlinkSync(relative(dirname(candidate), packagedTarget), candidate)
  }
}

export function stageMacManRuntime({
  connectorRoot,
  destinationRoot = join(desktopRoot, 'build', 'macman-runtime'),
  pythonExecutable = process.env.MACMAN_RUNTIME_PYTHON?.trim() || join(repositoryRoot, '.venv', 'bin', 'python'),
  sourceRoot = repositoryRoot
} = {}) {
  if (!existsSync(pythonExecutable)) {
    throw new Error(`MacMan runtime Python is missing at ${pythonExecutable}; run uv sync first`)
  }

  const layout = pythonRuntimeLayout(pythonExecutable)
  const pythonRoot = join(destinationRoot, 'python')
  const packagedSitePackages = join(destinationRoot, 'site-packages')
  const packagedSource = join(destinationRoot, 'source')

  rmSync(destinationRoot, { force: true, recursive: true })
  mkdirSync(destinationRoot, { mode: 0o755, recursive: true })
  cpSync(layout.basePrefix, pythonRoot, { dereference: true, recursive: true })
  rewriteAbsoluteSymlinks(pythonRoot, layout.basePrefix, pythonRoot)
  writeFileSync(
    join(pythonRoot, 'bin', 'hermes'),
    '#!/bin/sh\nSCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$SCRIPT_DIR/python3.11" -m hermes_cli.main "$@"\n',
    { mode: 0o755 }
  )
  cpSync(layout.sitePackages, packagedSitePackages, {
    filter: candidate => {
      const name = basename(candidate)

      return !name.startsWith('__editable__.hermes_agent-') && !name.startsWith('__editable___hermes_agent_')
    },
    recursive: true
  })
  rewriteAbsoluteSymlinks(packagedSitePackages, layout.sitePackages, packagedSitePackages)

  mkdirSync(packagedSource, { mode: 0o755, recursive: true })

  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith('.py') || ['pyproject.toml', 'VERSION'].includes(entry.name))) {
      cpSync(join(sourceRoot, entry.name), join(packagedSource, entry.name))
    }
  }

  for (const directory of MACMAN_RUNTIME_SOURCE_DIRECTORIES) {
    const source = join(sourceRoot, directory)

    if (existsSync(source)) {
      cpSync(source, join(packagedSource, directory), { recursive: true })
    }
  }

  const stagedWhatsApp = connectorRoot && join(connectorRoot, 'whatsapp', 'universal')

  if (!stagedWhatsApp || !existsSync(join(stagedWhatsApp, 'node_modules'))) {
    throw new Error('Stage the MacMan WhatsApp connector before staging the bundled runtime')
  }

  const packagedScripts = join(packagedSource, 'scripts')
  mkdirSync(packagedScripts, { mode: 0o755, recursive: true })
  symlinkSync(relative(packagedScripts, stagedWhatsApp), join(packagedScripts, 'whatsapp-bridge'), 'dir')

  const probe = spawnSync(join(pythonRoot, 'bin', 'python3.11'), ['-c', 'import hermes_cli.main, fastapi, uvicorn'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONHOME: pythonRoot,
      PYTHONNOUSERSITE: '1',
      PYTHONPATH: `${packagedSource}${sep === '\\' ? ';' : ':'}${packagedSitePackages}`
    }
  })

  if (probe.status !== 0) {
    throw new Error(`Bundled MacMan runtime failed its import probe: ${(probe.stderr || probe.stdout || '').trim()}`)
  }

  writeFileSync(
    join(destinationRoot, 'manifest.json'),
    `${JSON.stringify({ python: '3.11', source: 'MacMan release', selfContained: true }, null, 2)}\n`,
    { mode: 0o644 }
  )

  return destinationRoot
}

export function stageMacManGmailOAuthClient(sourcePath, destinationRoot) {
  let payload

  try {
    payload = JSON.parse(readFileSync(resolve(sourcePath), 'utf8'))
  } catch (error) {
    throw new Error(`Could not read the MacMan Google OAuth identity: ${error instanceof Error ? error.message : String(error)}`)
  }

  const installed = payload?.installed
  const required = ['auth_uri', 'client_id', 'client_secret', 'token_uri']

  if (!installed || required.some(field => typeof installed[field] !== 'string' || !installed[field].trim())) {
    throw new Error('MacMan requires a Google desktop OAuth client JSON with an installed application identity')
  }

  const destination = join(destinationRoot, 'gmail', 'oauth-client.json')
  mkdirSync(dirname(destination), { mode: 0o755, recursive: true })
  writeFileSync(destination, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })

  return destination
}

export async function stageMacManConnectors({
  arch = process.arch,
  destinationRoot = join(desktopRoot, 'build', 'macman-connectors'),
  gmailOAuthClientPath = process.env.MACMAN_GOOGLE_OAUTH_CLIENT_JSON?.trim() || null,
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

    if (gmailOAuthClientPath) {
      stageMacManGmailOAuthClient(gmailOAuthClientPath, destinationRoot)
    }

    writeFileSync(join(destinationRoot, 'manifest.json'), `${JSON.stringify({ connectors: manifest }, null, 2)}\n`, {
      mode: 0o644
    })

    stageMacManRuntime({ connectorRoot: destinationRoot })

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
