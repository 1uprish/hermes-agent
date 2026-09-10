import type { MacManCuaHostSnapshot } from './macman-cua-host'

export type MacManNativePermissionId =
  | 'accessibility'
  | 'screenRecording'
  | 'microphone'
  | 'notifications'
  | 'calendar'
  | 'reminders'
  | 'contacts'
  | 'automation'
  | 'fullDiskAccess'
  | 'location'

type NativePermissionStatus = 'granted' | 'not-granted' | 'ask-when-used' | 'per-app' | 'optional' | 'unavailable'

type MacManNativeSnapshot = {
  error?: string
  model: 'not-connected'
  permissions: Record<MacManNativePermissionId, NativePermissionStatus>
  wrapper: 'connected' | 'disconnected'
}

type MicrophoneStatus = 'denied' | 'granted' | 'not-determined' | 'restricted' | 'unknown'

type MacManCuaControllerLike = {
  refreshPermissions(): Promise<MacManCuaHostSnapshot>
  requestPermissionsFromUserAction(): Promise<MacManCuaHostSnapshot>
}

export type MacManNativeBridgeDependencies = {
  getCuaController(): Promise<MacManCuaControllerLike | null>
  getMicrophoneStatus(): MicrophoneStatus
  openExternal(url: string): Promise<unknown>
  requestMicrophone(): Promise<boolean>
}

export const MACMAN_PERMISSION_SETTINGS_URLS: Record<MacManNativePermissionId, string> = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  notifications: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
  calendar: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars',
  reminders: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders',
  contacts: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  fullDiskAccess: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  location: 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices'
}

const PERMISSION_IDS = new Set(Object.keys(MACMAN_PERMISSION_SETTINGS_URLS))

function assertPermissionId(permission: unknown): asserts permission is MacManNativePermissionId {
  if (typeof permission !== 'string' || !PERMISSION_IDS.has(permission)) {
    throw new Error(`Unsupported permission: ${String(permission)}`)
  }
}

function microphoneStatus(status: MicrophoneStatus): NativePermissionStatus {
  if (status === 'granted') {
    return 'granted'
  }

  if (status === 'denied' || status === 'restricted') {
    return 'not-granted'
  }

  if (status === 'not-determined') {
    return 'ask-when-used'
  }

  return 'unavailable'
}

function basePermissions(): Record<MacManNativePermissionId, NativePermissionStatus> {
  return {
    accessibility: 'unavailable',
    screenRecording: 'unavailable',
    microphone: 'unavailable',
    notifications: 'ask-when-used',
    calendar: 'ask-when-used',
    reminders: 'ask-when-used',
    contacts: 'ask-when-used',
    automation: 'per-app',
    fullDiskAccess: 'optional',
    location: 'optional'
  }
}

function connectedSnapshot(
  cua: MacManCuaHostSnapshot,
  nativeMicrophoneStatus: MicrophoneStatus
): MacManNativeSnapshot {
  return {
    model: 'not-connected',
    permissions: {
      ...basePermissions(),
      accessibility: cua.permissions.accessibility ? 'granted' : 'not-granted',
      screenRecording: cua.permissions.screenRecording ? 'granted' : 'not-granted',
      microphone: microphoneStatus(nativeMicrophoneStatus)
    },
    wrapper: 'connected'
  }
}

function disconnectedSnapshot(error: unknown, nativeMicrophoneStatus: MicrophoneStatus): MacManNativeSnapshot {
  return {
    error: error instanceof Error ? error.message : String(error),
    model: 'not-connected',
    permissions: {
      ...basePermissions(),
      microphone: microphoneStatus(nativeMicrophoneStatus)
    },
    wrapper: 'disconnected'
  }
}

export function createMacManNativeBridgeController(dependencies: MacManNativeBridgeDependencies) {
  async function controller(): Promise<MacManCuaControllerLike> {
    const active = await dependencies.getCuaController()

    if (!active) {
      throw new Error('MacMan native permission service is unavailable')
    }

    return active
  }

  async function snapshot(): Promise<MacManNativeSnapshot> {
    try {
      const cua = await (await controller()).refreshPermissions()

      return connectedSnapshot(cua, dependencies.getMicrophoneStatus())
    } catch (error) {
      return disconnectedSnapshot(error, dependencies.getMicrophoneStatus())
    }
  }

  return {
    async openSystemSettings(permission: MacManNativePermissionId): Promise<void> {
      assertPermissionId(permission)
      await dependencies.openExternal(MACMAN_PERMISSION_SETTINGS_URLS[permission])
    },

    async requestPermission(permission: MacManNativePermissionId): Promise<MacManNativeSnapshot> {
      assertPermissionId(permission)

      if (permission === 'accessibility' || permission === 'screenRecording') {
        try {
          const cua = await (await controller()).requestPermissionsFromUserAction()

          return connectedSnapshot(cua, dependencies.getMicrophoneStatus())
        } catch (error) {
          return disconnectedSnapshot(error, dependencies.getMicrophoneStatus())
        }
      }

      if (permission === 'microphone') {
        await dependencies.requestMicrophone()

        return snapshot()
      }

      await dependencies.openExternal(MACMAN_PERMISSION_SETTINGS_URLS[permission])

      return snapshot()
    },

    snapshot
  }
}

export type MacManNativeBridgeController = ReturnType<typeof createMacManNativeBridgeController>
