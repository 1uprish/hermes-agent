export type MacManPermissionId =
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

export type MacManPermissionStatus =
  | 'granted'
  | 'not-granted'
  | 'ask-when-used'
  | 'per-app'
  | 'optional'
  | 'unavailable'

export type MacManSnapshot = {
  error?: string
  model: 'connected' | 'not-connected' | 'checking'
  permissions: Record<MacManPermissionId, MacManPermissionStatus>
  wrapper: 'connected' | 'checking' | 'disconnected'
}

export type MacManNativeBridge = {
  openSystemSettings(permission: MacManPermissionId): Promise<void>
  requestPermission(permission: MacManPermissionId): Promise<MacManSnapshot>
  snapshot(): Promise<MacManSnapshot>
}

declare global {
  interface Window {
    macManNative?: MacManNativeBridge
  }
}
