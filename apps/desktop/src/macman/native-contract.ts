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
  modelName?: string
  modelProvider?: string
  permissions: Record<MacManPermissionId, MacManPermissionStatus>
  wrapper: 'connected' | 'checking' | 'disconnected'
}

export type MacManModelProvider = {
  authenticated: boolean
  cliCommand?: string
  docsUrl?: string
  id: string
  keyEnv?: string
  models: string[]
  name: string
  setup: 'api-key' | 'external' | 'oauth' | 'unavailable'
}

export type MacManModelCatalog = {
  connected: boolean
  current?: { model: string; provider: string }
  providers: MacManModelProvider[]
}

export type MacManModelLoginSession = {
  expiresInSeconds: number
  pollIntervalMs: number
  providerId: string
  sessionId: string
  userCode?: string
}

export type MacManModelLoginResult = {
  message?: string
  status: 'approved' | 'denied' | 'error' | 'expired' | 'pending'
}

export type MacManChatConnection = {
  authMode?: 'oauth' | 'token'
  wsUrl: string
}

export type MacManFreshChatConnection = string | { error?: string; ok: boolean; wsUrl?: string }

export type MacManConnectionId = 'gmail' | 'imessage' | 'whatsapp'

export type MacManConnectionStatus =
  | 'attention'
  | 'connected'
  | 'connecting'
  | 'needs-permission'
  | 'ready'
  | 'syncing'
  | 'unavailable'

export type MacManConnectionSnapshot = {
  account?: string
  capabilities: Array<'attachments' | 'read' | 'reactions' | 'search' | 'send'>
  detail?: string
  id: MacManConnectionId
  lastSyncAt?: string
  name: string
  status: MacManConnectionStatus
}

export type MacManConnectionCatalog = {
  connections: MacManConnectionSnapshot[]
}

export type MacManWhatsAppSetup = {
  accountName?: string
  error?: string
  expiresAt?: string
  pairingId: string
  qrPayload?: string
  status: 'cancelled' | 'connected' | 'error' | 'expired' | 'installing' | 'starting' | 'waiting'
}

export type MacManNativeBridge = {
  applyWhatsAppConnection(pairingId: string): Promise<void>
  authorizeIMessage(): Promise<void>
  cancelModelLogin(sessionId: string): Promise<void>
  cancelWhatsAppConnection(pairingId: string): Promise<void>
  checkForUpdates(): Promise<unknown>
  connectGmail(email: string): Promise<void>
  exportData(data: unknown): Promise<{ canceled: boolean; path?: string }>
  getChatConnection(): Promise<MacManChatConnection>
  getConnectionCatalog(): Promise<MacManConnectionCatalog>
  getFreshChatConnection(): Promise<MacManFreshChatConnection>
  getModelCatalog(): Promise<MacManModelCatalog>
  openLogs(): Promise<{ error?: string; ok: boolean; path?: string }>
  openModelProviderSetup(providerId: string): Promise<{ copiedCommand: boolean; openedUrl: boolean }>
  openSystemSettings(permission: MacManPermissionId): Promise<void>
  pickExcludedPaths(): Promise<string[]>
  pollModelLogin(providerId: string, sessionId: string): Promise<MacManModelLoginResult>
  pollWhatsAppConnection(pairingId: string): Promise<MacManWhatsAppSetup>
  requestPermission(permission: MacManPermissionId): Promise<MacManSnapshot>
  saveModelApiKey(providerId: string, apiKey: string): Promise<MacManModelCatalog>
  selectModel(providerId: string, modelId: string): Promise<{ model: string; provider: string }>
  snapshot(): Promise<MacManSnapshot>
  startWhatsAppConnection(options?: { mode?: 'bot' | 'self-chat' }): Promise<MacManWhatsAppSetup>
  startModelLogin(providerId: string): Promise<MacManModelLoginSession>
}

declare global {
  interface Window {
    macManNative?: MacManNativeBridge
  }
}
