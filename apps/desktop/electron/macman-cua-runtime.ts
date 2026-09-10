import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { CuaDriverLike } from '@trycua/cua-driver'

import {
  createMacManCuaHostController,
  type MacManCuaHostSnapshot,
  type MacManEmbeddedHost,
  type MacManPermissionStatus
} from './macman-cua-host'
import { MACMAN_BUNDLE_ID } from './macman-distribution'

const PERMISSION_POLL_MS = 1_500

type DestroyableCuaDriver = CuaDriverLike & { uniffiDestroy(): void }

type RuntimeLogger = (message: string) => void

type CuaSdk = {
  CuaDriver: { connect(socketPath: string): CuaDriverLike }
  currentMacOsPermissionStatus(): MacManPermissionStatus
  EmbeddedCuaDriverHost: new (binaryPath: string, hostBundleId: string) => MacManEmbeddedHost
}

type CuaElectronSdk = {
  hasRequiredMacOSPermissions(status: MacManPermissionStatus): boolean
  openMacOSScreenRecordingSettings(): Promise<void>
  requestMacOSPermissions(): MacManPermissionStatus
}

export function resolveBundledCuaSdkEntries(resourcesPath: string): { electron: string; root: string } {
  const sdkDist = path.join(resourcesPath, 'macman-cua-sdk', 'node_modules', '@trycua', 'cua-driver', 'dist')

  if (sdkDist.includes('app.asar')) {
    throw new Error(`MacMan Cua SDK must load outside ASAR: ${sdkDist}`)
  }

  return {
    electron: pathToFileURL(path.join(sdkDist, 'electron.js')).href,
    root: pathToFileURL(path.join(sdkDist, 'index.js')).href
  }
}

async function loadBundledCuaSdk(resourcesPath: string): Promise<{ electron: CuaElectronSdk; root: CuaSdk }> {
  const entries = resolveBundledCuaSdkEntries(resourcesPath)

  for (const entry of Object.values(entries)) {
    const filePath = new URL(entry)

    if (!fs.existsSync(filePath)) {
      throw new Error(`MacMan Cua SDK resource is missing: ${filePath.pathname}`)
    }
  }

  const [root, electron] = await Promise.all([import(entries.root), import(entries.electron)])

  return { electron: electron as CuaElectronSdk, root: root as CuaSdk }
}

export function resolveBundledCuaDriver(resourcesPath: string): string {
  const binaryPath = path.join(resourcesPath, 'cua-driver')

  if (binaryPath.includes('app.asar') || !fs.existsSync(binaryPath)) {
    throw new Error(`MacMan Cua Driver is missing outside ASAR: ${binaryPath}`)
  }

  fs.accessSync(binaryPath, fs.constants.X_OK)

  return binaryPath
}

/**
 * Supervises MacMan's private driver from current permission truth. Startup
 * never prompts; only an explicit renderer action may request access.
 */
export async function startMacManCuaPermissionService(options: { log: RuntimeLogger; resourcesPath: string }) {
  const binaryPath = resolveBundledCuaDriver(options.resourcesPath)
  const { electron, root } = await loadBundledCuaSdk(options.resourcesPath)
  const { CuaDriver, currentMacOsPermissionStatus, EmbeddedCuaDriverHost } = root
  const { hasRequiredMacOSPermissions, openMacOSScreenRecordingSettings, requestMacOSPermissions } = electron

  const controller = createMacManCuaHostController({
    connect: socketPath => CuaDriver.connect(socketPath) as DestroyableCuaDriver,
    createHost: () => new EmbeddedCuaDriverHost(binaryPath, MACMAN_BUNDLE_ID),
    hasRequiredPermissions: hasRequiredMacOSPermissions,
    hostBundleId: MACMAN_BUNDLE_ID,
    openScreenRecordingSettings: openMacOSScreenRecordingSettings,
    readPermissions: currentMacOsPermissionStatus,
    requestPermissions: requestMacOSPermissions
  })

  let stopped = false
  let pollTimer: NodeJS.Timeout | undefined
  let pollInFlight = false

  function describe(snapshot: MacManCuaHostSnapshot): void {
    const grants = `accessibility=${snapshot.permissions.accessibility} screenRecording=${snapshot.permissions.screenRecording}`

    if (snapshot.connection) {
      options.log(
        `[macman-cua] running embedded generation=${snapshot.connection.generation} ` +
          `pid=${snapshot.connection.pid} host=${MACMAN_BUNDLE_ID} ${grants}`
      )
    } else {
      options.log(`[macman-cua] ${snapshot.state} ${grants}`)
    }
  }

  function clearPoll(): void {
    if (pollTimer) {
      clearInterval(pollTimer)
    }

    pollTimer = undefined
  }

  async function refresh(): Promise<void> {
    if (stopped || pollInFlight) {
      return
    }

    pollInFlight = true

    try {
      const snapshot = await controller.refreshPermissions()
      describe(snapshot)

      if (snapshot.state === 'running') {
        clearPoll()
      }
    } catch (error) {
      clearPoll()
      options.log(`[macman-cua] permission refresh failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      pollInFlight = false
    }
  }

  const initial = await controller.refreshPermissions()
  describe(initial)

  if (initial.state === 'permission-required') {
    pollTimer = setInterval(() => void refresh(), PERMISSION_POLL_MS)
    pollTimer.unref()
  }

  return {
    controller,
    async stop(): Promise<void> {
      stopped = true
      clearPoll()
      await controller.stop()
    }
  }
}

export type MacManCuaPermissionService = Awaited<ReturnType<typeof startMacManCuaPermissionService>>
