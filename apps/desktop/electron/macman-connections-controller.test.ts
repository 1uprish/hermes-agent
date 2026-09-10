import assert from 'node:assert/strict'

import { test } from 'vitest'

import { createMacManConnectionsController } from './macman-connections-controller'

function fakeDependencies(overrides: Record<string, unknown> = {}) {
  const backendRequests: Array<{ body?: unknown; method?: string; path: string }> = []
  const runs: Array<{ args: string[]; executable: string }> = []
  const executables: Record<string, string | null> = {
    gmail: '/bundle/gog',
    imessage: '/bundle/imessage-cli',
    whatsapp: '/bundle/bridge.js'
  }
  const rememberedAccounts: Array<{ connector: string; displayName: string; externalId: string }> = []

  return {
    backendRequests,
    rememberedAccounts,
    runs,
    dependencies: {
      connectorExecutable(id: string) {
        return executables[id] ?? null
      },
      getGmailCredentialsPath() {
        return '/bundle/google-oauth-client.json'
      },
      getGmailHome() {
        return '/user/macman/gmail'
      },
      getIMessageDataDirectory() {
        return '/user/macman/imessage'
      },
      getRememberedAccount(id: string) {
        return rememberedAccounts.find(account => account.connector === id) ?? null
      },
      rememberAccount(account: { connector: string; displayName: string; externalId: string }) {
        rememberedAccounts.push(account)
      },
      async request(request: { body?: unknown; method?: string; path: string }) {
        backendRequests.push(request)

        if (request.path === '/api/messaging/platforms') {
          return {
            platforms: [
              {
                configured: true,
                enabled: true,
                gateway_running: true,
                id: 'whatsapp',
                state: 'running',
                updated_at: '2026-09-10T08:00:00.000Z',
                whatsapp_setup: { mode: 'self-chat' }
              }
            ]
          }
        }

        if (request.path === '/api/messaging/whatsapp/onboarding/start') {
          return { expires_at: '2026-09-10T08:10:00.000Z', pairing_id: 'pair-1', qr_payload: 'qr', status: 'waiting' }
        }

        if (request.path === '/api/messaging/whatsapp/onboarding/pair-1') {
          return { account_name: 'Arv', pairing_id: 'pair-1', status: 'connected' }
        }

        if (request.path === '/api/messaging/whatsapp/onboarding/pair-1/apply') {
          return { ok: true }
        }

        return {}
      },
      async runConnector(executable: string, args: string[]) {
        runs.push({ args, executable })

        if (executable.endsWith('/gog') && args.includes('list')) {
          return { exitCode: 0, stderr: '', stdout: '{"accounts":[{"email":"arv@gmail.com"}]}' }
        }

        return { exitCode: 0, stderr: '', stdout: '{}' }
      },
      ...overrides
    }
  }
}

test('catalog reports provider truth and never treats an unprobed iMessage runtime as connected', async () => {
  const fake = fakeDependencies()
  const controller = createMacManConnectionsController(fake.dependencies)

  assert.deepEqual(await controller.catalog(), {
    connections: [
      {
        capabilities: ['read', 'search', 'send', 'attachments'],
        id: 'whatsapp',
        lastSyncAt: '2026-09-10T08:00:00.000Z',
        name: 'WhatsApp',
        status: 'connected'
      },
      {
        capabilities: ['read', 'search', 'send', 'attachments', 'reactions'],
        detail: 'Authorize the bundled Messages connector to read and send iMessages on this Mac.',
        id: 'imessage',
        name: 'iMessage',
        status: 'needs-permission'
      },
      {
        account: 'arv@gmail.com',
        capabilities: ['read', 'search', 'send', 'attachments'],
        id: 'gmail',
        name: 'Gmail',
        status: 'connected'
      }
    ]
  })
  assert.equal(fake.runs.some(run => run.executable.endsWith('/imessage-cli') && run.args.includes('state')), false)
})

test('successful iMessage authorization creates a durable connection receipt used by the catalog', async () => {
  const fake = fakeDependencies()
  const controller = createMacManConnectionsController(fake.dependencies)

  await controller.authorizeIMessage()

  assert.deepEqual(fake.rememberedAccounts, [
    { connector: 'imessage', displayName: 'Messages on this Mac', externalId: 'local-messages' }
  ])
  assert.deepEqual((await controller.catalog()).connections[1], {
    account: 'Messages on this Mac',
    capabilities: ['read', 'search', 'send', 'attachments', 'reactions'],
    detail: 'Authorized on this Mac. Reconnect if macOS access is later revoked.',
    id: 'imessage',
    name: 'iMessage',
    status: 'connected'
  })
})

test('a missing packaged executable is unavailable instead of silently installing it', async () => {
  const fake = fakeDependencies({ connectorExecutable: () => null })
  const controller = createMacManConnectionsController(fake.dependencies)
  const catalog = await controller.catalog()

  assert.ok(catalog.connections.every(connection => connection.status === 'unavailable'))
  assert.equal(fake.runs.length, 0)
})

test('WhatsApp pairing uses the existing backend onboarding transaction', async () => {
  const fake = fakeDependencies()
  const controller = createMacManConnectionsController(fake.dependencies)

  const started = await controller.startWhatsApp({ mode: 'self-chat' })
  const connected = await controller.pollWhatsApp(started.pairingId)
  await controller.applyWhatsApp(started.pairingId)

  assert.equal(started.qrPayload, 'qr')
  assert.equal(connected.status, 'connected')
  assert.deepEqual(fake.backendRequests.slice(-3), [
    {
      body: { allowed_users: '', mode: 'self-chat' },
      method: 'POST',
      path: '/api/messaging/whatsapp/onboarding/start'
    },
    { path: '/api/messaging/whatsapp/onboarding/pair-1' },
    {
      body: { mode: 'self-chat' },
      method: 'POST',
      path: '/api/messaging/whatsapp/onboarding/pair-1/apply'
    }
  ])
})

test('Gmail setup stores the packaged OAuth client then requests only Gmail read-send access', async () => {
  const fake = fakeDependencies()
  const controller = createMacManConnectionsController(fake.dependencies)

  await controller.connectGmail('arv@gmail.com')

  assert.deepEqual(fake.runs.slice(-2), [
    {
      args: ['--home=/user/macman/gmail', '--no-input', 'auth', 'credentials', 'set', '/bundle/google-oauth-client.json'],
      executable: '/bundle/gog'
    },
    {
      args: [
        '--home=/user/macman/gmail',
        'auth',
        'add',
        'arv@gmail.com',
        '--services=gmail',
        '--gmail-scope=read-send'
      ],
      executable: '/bundle/gog'
    }
  ])
})

test('Gmail setup fails before opening OAuth when the release has no client identity', async () => {
  const fake = fakeDependencies({ getGmailCredentialsPath: () => null })
  const controller = createMacManConnectionsController(fake.dependencies)

  await assert.rejects(() => controller.connectGmail('arv@gmail.com'), /OAuth client.*release/i)
  assert.equal(fake.runs.filter(run => run.executable.endsWith('/gog') && run.args.includes('add')).length, 0)
})

test('Gmail is unavailable before sign-in when the release has no Google OAuth identity', async () => {
  const fake = fakeDependencies({
    getGmailCredentialsPath: () => null,
    runConnector: async (executable: string, args: string[]) => {
      fake.runs.push({ args, executable })
      return { exitCode: 0, stderr: '', stdout: '{"accounts":[]}' }
    }
  })
  const controller = createMacManConnectionsController(fake.dependencies)
  const gmail = (await controller.catalog()).connections.find(connection => connection.id === 'gmail')

  assert.deepEqual(gmail, {
    capabilities: ['read', 'search', 'send', 'attachments'],
    detail: 'Google sign-in is not enabled in this MacMan release.',
    id: 'gmail',
    name: 'Gmail',
    status: 'unavailable'
  })
})

test('iMessage setup invokes the bundled authorization UI from a user action', async () => {
  const fake = fakeDependencies()
  const controller = createMacManConnectionsController(fake.dependencies)

  await controller.authorizeIMessage()

  assert.deepEqual(fake.runs.at(-1), {
    args: ['--data-dir', '/user/macman/imessage', 'authorize'],
    executable: '/bundle/imessage-cli'
  })
})
