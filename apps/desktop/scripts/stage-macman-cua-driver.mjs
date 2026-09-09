import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const CUA_DRIVER_VERSION = '0.22.1'
export const CUA_DRIVER_ARCHIVE_SHA256 = '2abf82826fede4bb2ec748e1a10d6e4d92ef36fc39bbd86e3b47bd8cbbd447d6'
export const CUA_DRIVER_ARCHIVE_URL =
  `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${CUA_DRIVER_VERSION}/` +
  `cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-universal-binary.tar.gz`

export function isMacManDarwinPack(context) {
  return context?.electronPlatformName === 'darwin' && context?.productFilename === 'MacMan'
}

async function sha256(filePath) {
  const bytes = await readFile(filePath)
  return createHash('sha256').update(bytes).digest('hex')
}

async function downloadPinnedArchive(destination) {
  const partial = `${destination}.partial-${process.pid}`
  await rm(partial, { force: true })
  const response = await fetch(CUA_DRIVER_ARCHIVE_URL, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`download failed with HTTP ${response.status}`)
  }

  try {
    await pipeline(response.body, createWriteStream(partial, { mode: 0o600 }))
    const digest = await sha256(partial)
    if (digest !== CUA_DRIVER_ARCHIVE_SHA256) {
      throw new Error(`download checksum ${digest} does not match pinned ${CUA_DRIVER_ARCHIVE_SHA256}`)
    }
    await rename(partial, destination)
  } finally {
    await rm(partial, { force: true })
  }
}

async function readVersion(binaryPath) {
  const { stdout, stderr } = await execFileAsync(binaryPath, ['--version'])
  return `${stdout}${stderr}`.trim()
}

async function inspectArchitectures(binaryPath) {
  const { stdout } = await execFileAsync('/usr/bin/lipo', ['-archs', binaryPath])
  return stdout.trim().split(/\s+/).filter(Boolean)
}

export async function validateStagedCuaDriver(binaryPath, inspectors = { inspectArchitectures, readVersion }) {
  await access(binaryPath)
  const fileStat = await stat(binaryPath)
  const executable = (fileStat.mode & 0o111) !== 0
  const [version, architectures] = await Promise.all([
    inspectors.readVersion(binaryPath),
    inspectors.inspectArchitectures(binaryPath)
  ])
  const hasPinnedVersion = version === `cua-driver ${CUA_DRIVER_VERSION}`
  const universal = architectures.includes('x86_64') && architectures.includes('arm64')

  if (!executable || !hasPinnedVersion || !universal) {
    throw new Error(
      `Expected cua-driver ${CUA_DRIVER_VERSION}, executable, universal x86_64+arm64; ` +
        `got version=${JSON.stringify(version)} executable=${executable} architectures=${architectures.join(',')}`
    )
  }
}

async function ensureArchive(cachePath) {
  await mkdir(path.dirname(cachePath), { recursive: true })
  try {
    if ((await sha256(cachePath)) === CUA_DRIVER_ARCHIVE_SHA256) return
  } catch {
    // Missing or unreadable cache entries are replaced below.
  }
  await rm(cachePath, { force: true })
  await downloadPinnedArchive(cachePath)
}

async function stageNativeSdkPackage(extractRoot, desktopRoot, packageName) {
  const packageRoot = path.join(desktopRoot, 'dist', 'node_modules', '@trycua', packageName)
  await mkdir(packageRoot, { recursive: true })
  await Promise.all([
    copyFile(path.join(extractRoot, 'libcua_driver_sdk.dylib'), path.join(packageRoot, 'libcua_driver_sdk.dylib')),
    copyFile(
      path.join(extractRoot, 'cua_driver_node_runtime.node'),
      path.join(packageRoot, 'cua_driver_node_runtime.node')
    ),
    writeFile(
      path.join(packageRoot, 'package.json'),
      `${JSON.stringify({ name: `@trycua/${packageName}`, private: true, version: CUA_DRIVER_VERSION }, null, 2)}\n`,
      'utf8'
    )
  ])
}

/** Stage the immutable Cua release payload used by the MacMan build flavor. */
export async function stageMacManCuaDriver(desktopRoot) {
  const cachePath = path.join(desktopRoot, 'build', 'cua-driver-cache', `cua-driver-${CUA_DRIVER_VERSION}.tar.gz`)
  const outputRoot = path.join(desktopRoot, 'build', 'macman-cua')
  const binaryPath = path.join(outputRoot, 'cua-driver')
  const extractRoot = await mkdtemp(path.join(os.tmpdir(), 'macman-cua-driver-'))

  try {
    await ensureArchive(cachePath)
    await execFileAsync('/usr/bin/tar', [
      '-xzf',
      cachePath,
      '-C',
      extractRoot,
      'cua-driver',
      'libcua_driver_sdk.dylib',
      'cua_driver_node_runtime.node'
    ])
    await mkdir(outputRoot, { recursive: true })
    await copyFile(path.join(extractRoot, 'cua-driver'), binaryPath)
    await chmod(binaryPath, 0o755)
    await Promise.all([
      stageNativeSdkPackage(extractRoot, desktopRoot, 'cua-driver-darwin-arm64'),
      stageNativeSdkPackage(extractRoot, desktopRoot, 'cua-driver-darwin-x64')
    ])
    await validateStagedCuaDriver(binaryPath)
    return binaryPath
  } finally {
    await rm(extractRoot, { force: true, recursive: true })
  }
}
