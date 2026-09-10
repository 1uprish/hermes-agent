export type MacManConnectionId = 'gmail' | 'imessage' | 'whatsapp'
export type MacManConnectionStatus =
  | 'attention'
  | 'connected'
  | 'connecting'
  | 'needs-permission'
  | 'ready'
  | 'syncing'
  | 'unavailable'

export interface MacManConnectionSnapshot {
  account?: string
  capabilities: Array<'attachments' | 'read' | 'reactions' | 'search' | 'send'>
  detail?: string
  id: MacManConnectionId
  lastSyncAt?: string
  name: string
  status: MacManConnectionStatus
}

export interface MacManConnectionCatalog {
  connections: MacManConnectionSnapshot[]
}

export interface MacManWhatsAppSetup {
  accountName?: string
  error?: string
  expiresAt?: string
  pairingId: string
  qrPayload?: string
  status: 'cancelled' | 'connected' | 'error' | 'expired' | 'installing' | 'starting' | 'waiting'
}

interface BackendRequest {
  body?: unknown
  method?: 'DELETE' | 'GET' | 'POST' | 'PUT'
  path: string
}

interface ConnectorRunResult {
  exitCode: number
  stderr: string
  stdout: string
}

export interface MacManConnectionsDependencies {
  connectorExecutable(id: MacManConnectionId): null | string
  getGmailCredentialsPath(): null | string
  getGmailHome(): string
  getIMessageDataDirectory(): string
  request(request: BackendRequest): Promise<unknown>
  runConnector(executable: string, args: string[]): Promise<ConnectorRunResult>
}

const CAPABILITIES = {
  gmail: ['read', 'search', 'send', 'attachments'],
  imessage: ['read', 'search', 'send', 'attachments', 'reactions'],
  whatsapp: ['read', 'search', 'send', 'attachments']
} as const

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseJson(stdout: string): Record<string, unknown> {
  try {
    return record(JSON.parse(stdout))
  } catch {
    return {}
  }
}

function connectorFailure(result: ConnectorRunResult, fallback: string): string {
  return text(result.stderr) || text(result.stdout) || fallback
}

function requireSuccessful(result: ConnectorRunResult, fallback: string): void {
  if (result.exitCode !== 0) {
    throw new Error(connectorFailure(result, fallback))
  }
}

function whatsappSnapshot(value: unknown, bundled: boolean): MacManConnectionSnapshot {
  const platform = record(value)
  const configured = platform.configured === true
  const gatewayRunning = platform.gateway_running === true
  const state = text(platform.state)

  if (!bundled) {
    return {
      capabilities: [...CAPABILITIES.whatsapp],
      detail: 'The WhatsApp runtime is missing from this MacMan release.',
      id: 'whatsapp',
      name: 'WhatsApp',
      status: 'unavailable'
    }
  }

  if (configured && gatewayRunning && ['connected', 'healthy', 'running'].includes(state)) {
    return {
      capabilities: [...CAPABILITIES.whatsapp],
      id: 'whatsapp',
      ...(text(platform.updated_at) ? { lastSyncAt: text(platform.updated_at) } : {}),
      name: 'WhatsApp',
      status: 'connected'
    }
  }

  if (configured) {
    return {
      capabilities: [...CAPABILITIES.whatsapp],
      detail: text(platform.error_message) || 'WhatsApp is linked, but its message gateway is not running.',
      id: 'whatsapp',
      name: 'WhatsApp',
      status: 'attention'
    }
  }

  return {
    capabilities: [...CAPABILITIES.whatsapp],
    detail: 'Scan one QR code to link this Mac as a WhatsApp companion device.',
    id: 'whatsapp',
    name: 'WhatsApp',
    status: 'ready'
  }
}

function unavailable(id: MacManConnectionId, name: string): MacManConnectionSnapshot {
  return {
    capabilities: [...CAPABILITIES[id]],
    detail: `The ${name} runtime is missing from this MacMan release.`,
    id,
    name,
    status: 'unavailable'
  }
}

function gmailAccounts(value: Record<string, unknown>): string[] {
  return array(value.accounts).flatMap(account => {
    if (typeof account === 'string') {
      return text(account) ? [text(account)] : []
    }

    const email = text(record(account).email) || text(record(account).account)
    return email ? [email] : []
  })
}

function whatsappSetup(value: unknown): MacManWhatsAppSetup {
  const response = record(value)
  const pairingId = text(response.pairing_id)
  const status = text(response.status)
  const statuses = new Set(['cancelled', 'connected', 'error', 'expired', 'installing', 'starting', 'waiting'])

  if (!pairingId || !statuses.has(status)) {
    throw new Error('WhatsApp setup returned an invalid response')
  }

  return {
    ...(text(response.account_name) ? { accountName: text(response.account_name) } : {}),
    ...(text(response.error) ? { error: text(response.error) } : {}),
    ...(text(response.expires_at) ? { expiresAt: text(response.expires_at) } : {}),
    pairingId,
    ...(text(response.qr_payload) ? { qrPayload: text(response.qr_payload) } : {}),
    status: status as MacManWhatsAppSetup['status']
  }
}

function assertPairingId(value: string): string {
  const id = text(value)

  if (!id || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
    throw new Error('Invalid WhatsApp pairing session')
  }

  return id
}

export function createMacManConnectionsController(dependencies: MacManConnectionsDependencies) {
  async function probeIMessage(): Promise<MacManConnectionSnapshot> {
    const executable = dependencies.connectorExecutable('imessage')

    if (!executable) {
      return unavailable('imessage', 'iMessage')
    }

    const result = await dependencies.runConnector(executable, [
      '--data-dir',
      dependencies.getIMessageDataDirectory(),
      '--json',
      '--no-events',
      'state'
    ])

    if (result.exitCode !== 0) {
      return {
        capabilities: [...CAPABILITIES.imessage],
        detail: connectorFailure(result, 'iMessage permissions have not been checked.'),
        id: 'imessage',
        name: 'iMessage',
        status: 'needs-permission'
      }
    }

    const permissions = record(parseJson(result.stdout).permissions)
    const missing = [
      ['Accessibility', permissions.accessibility],
      ['Contacts', permissions.contacts],
      ['Messages Data', permissions.messagesData ?? permissions.messages_data],
      ['Automation', permissions.automation]
    ].filter(([, granted]) => granted !== true)

    if (missing.length > 0) {
      return {
        capabilities: [...CAPABILITIES.imessage],
        detail: `${missing.map(([name]) => name).join(', ')} permission${missing.length === 1 ? ' is' : 's are'} still required.`,
        id: 'imessage',
        name: 'iMessage',
        status: 'needs-permission'
      }
    }

    return {
      capabilities: [...CAPABILITIES.imessage],
      detail: 'Uses the Apple ID currently signed in to Messages on this Mac.',
      id: 'imessage',
      name: 'iMessage',
      status: 'connected'
    }
  }

  async function probeGmail(): Promise<MacManConnectionSnapshot> {
    const executable = dependencies.connectorExecutable('gmail')

    if (!executable) {
      return unavailable('gmail', 'Gmail')
    }

    const result = await dependencies.runConnector(executable, [
      `--home=${dependencies.getGmailHome()}`,
      '--json',
      '--no-input',
      'auth',
      'list'
    ])

    if (result.exitCode !== 0) {
      return {
        capabilities: [...CAPABILITIES.gmail],
        detail: connectorFailure(result, 'Gmail authentication could not be checked.'),
        id: 'gmail',
        name: 'Gmail',
        status: 'attention'
      }
    }

    const accounts = gmailAccounts(parseJson(result.stdout))

    return accounts.length > 0
      ? {
          account: accounts[0],
          capabilities: [...CAPABILITIES.gmail],
          id: 'gmail',
          name: 'Gmail',
          status: 'connected'
        }
      : {
          capabilities: [...CAPABILITIES.gmail],
          detail: 'Sign in with Google to read, search, and send Gmail.',
          id: 'gmail',
          name: 'Gmail',
          status: 'ready'
        }
  }

  return {
    async applyWhatsApp(pairingId: string): Promise<void> {
      const id = assertPairingId(pairingId)
      await dependencies.request({
        body: { mode: 'self-chat' },
        method: 'POST',
        path: `/api/messaging/whatsapp/onboarding/${encodeURIComponent(id)}/apply`
      })
    },

    async authorizeIMessage(): Promise<void> {
      const executable = dependencies.connectorExecutable('imessage')

      if (!executable) {
        throw new Error('The iMessage runtime is missing from this MacMan release')
      }

      const result = await dependencies.runConnector(executable, [
        '--data-dir',
        dependencies.getIMessageDataDirectory(),
        'authorize'
      ])
      requireSuccessful(result, 'iMessage authorization failed')
    },

    async cancelWhatsApp(pairingId: string): Promise<void> {
      const id = assertPairingId(pairingId)
      await dependencies.request({
        method: 'DELETE',
        path: `/api/messaging/whatsapp/onboarding/${encodeURIComponent(id)}`
      })
    },

    async catalog(): Promise<MacManConnectionCatalog> {
      const whatsappExecutable = dependencies.connectorExecutable('whatsapp')
      let whatsappPlatform: unknown

      if (whatsappExecutable) {
        try {
          const response = record(await dependencies.request({ path: '/api/messaging/platforms' }))
          whatsappPlatform = array(response.platforms).find(value => text(record(value).id) === 'whatsapp')
        } catch (error) {
          whatsappPlatform = { configured: false, error_message: error instanceof Error ? error.message : String(error) }
        }
      }

      const [imessage, gmail] = await Promise.all([probeIMessage(), probeGmail()])

      return {
        connections: [whatsappSnapshot(whatsappPlatform, Boolean(whatsappExecutable)), imessage, gmail]
      }
    },

    async connectGmail(emailValue: string): Promise<void> {
      const email = text(emailValue).toLocaleLowerCase()

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Enter a valid Google account email')
      }

      const executable = dependencies.connectorExecutable('gmail')

      if (!executable) {
        throw new Error('The Gmail runtime is missing from this MacMan release')
      }

      const credentials = dependencies.getGmailCredentialsPath()

      if (!credentials) {
        throw new Error('The Google OAuth client identity is missing from this MacMan release')
      }

      const home = `--home=${dependencies.getGmailHome()}`
      const credentialsResult = await dependencies.runConnector(executable, [
        home,
        '--no-input',
        'auth',
        'credentials',
        'set',
        credentials
      ])
      requireSuccessful(credentialsResult, 'MacMan could not configure Google OAuth')

      const loginResult = await dependencies.runConnector(executable, [
        home,
        'auth',
        'add',
        email,
        '--services=gmail',
        '--gmail-scope=read-send'
      ])
      requireSuccessful(loginResult, 'Google sign-in did not complete')
    },

    async pollWhatsApp(pairingId: string): Promise<MacManWhatsAppSetup> {
      const id = assertPairingId(pairingId)
      return whatsappSetup(
        await dependencies.request({ path: `/api/messaging/whatsapp/onboarding/${encodeURIComponent(id)}` })
      )
    },

    async startWhatsApp({ mode = 'self-chat' }: { mode?: 'bot' | 'self-chat' } = {}): Promise<MacManWhatsAppSetup> {
      if (!dependencies.connectorExecutable('whatsapp')) {
        throw new Error('The WhatsApp runtime is missing from this MacMan release')
      }

      return whatsappSetup(
        await dependencies.request({
          body: { allowed_users: '', mode },
          method: 'POST',
          path: '/api/messaging/whatsapp/onboarding/start'
        })
      )
    }
  }
}

export type MacManConnectionsController = ReturnType<typeof createMacManConnectionsController>
