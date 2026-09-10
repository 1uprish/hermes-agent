import assert from 'node:assert/strict'

import { test } from 'vitest'

import { createMacManModelBridgeController } from './macman-model-bridge'

function fakeModelBackend() {
  let apiKeySaved = false
  let selected: null | { model: string; provider: string } = null
  const events: Array<{ body?: unknown; method?: string; path: string }> = []
  const opened: string[] = []
  const copied: string[] = []
  const terminals: string[] = []

  const request = async (input: { body?: unknown; method?: string; path: string }) => {
    events.push(input)

    if (input.path === '/api/providers/oauth') {
      return {
        providers: [
          {
            id: 'openai-codex',
            name: 'ChatGPT or Codex Subscription',
            flow: 'device_code',
            docs_url: 'https://platform.openai.com/docs',
            cli_command: 'hermes auth add openai-codex',
            status: { logged_in: false }
          },
          {
            id: 'qwen-oauth',
            name: 'Qwen',
            flow: 'external',
            docs_url: 'https://example.com/qwen',
            cli_command: 'hermes auth add qwen-oauth',
            status: { logged_in: false }
          }
        ]
      }
    }

    if (input.path.startsWith('/api/model/options')) {
      return {
        model: selected?.model,
        provider: selected?.provider,
        providers: [
          {
            authenticated: false,
            auth_type: 'oauth_external',
            models: ['gpt-5.5', 'gpt-5.6-sol'],
            name: 'OpenAI Codex',
            slug: 'openai-codex'
          },
          {
            authenticated: apiKeySaved,
            auth_type: 'api_key',
            key_env: 'OPENROUTER_API_KEY',
            models: ['openrouter/auto'],
            name: 'OpenRouter',
            slug: 'openrouter'
          },
          {
            authenticated: false,
            auth_type: 'aws_sdk',
            models: [],
            name: 'AWS Bedrock',
            slug: 'bedrock'
          }
        ]
      }
    }

    if (input.path === '/api/model/info') {
      if (!selected) {
        throw new Error('No inference provider configured')
      }

      return selected
    }

    if (input.path === '/api/providers/oauth/openai-codex/start') {
      return {
        expires_in: 900,
        flow: 'device_code',
        poll_interval: 5,
        session_id: 'codex-session',
        user_code: 'ABCD-EFGH',
        verification_url: 'https://auth.openai.com/device'
      }
    }

    if (input.path === '/api/providers/oauth/openai-codex/poll/codex-session') {
      return { session_id: 'codex-session', status: 'approved' }
    }

    if (input.path === '/api/env' && input.method === 'PUT') {
      apiKeySaved = true

      return { ok: true }
    }

    if (input.path === '/api/model/set' && input.method === 'POST') {
      const body = input.body as { model: string; provider: string }
      selected = { model: body.model, provider: body.provider }

      return { ok: true, ...selected }
    }

    throw new Error(`Unexpected request ${input.method ?? 'GET'} ${input.path}`)
  }

  return {
    copied,
    events,
    opened,
    terminals,
    controller: createMacManModelBridgeController({
      copyText: value => copied.push(value),
      openExternal: async url => {
        opened.push(url)
      },
      openTerminal: async () => {
        terminals.push('opened')
      },
      request
    })
  }
}

test('MacMan builds its own provider catalog from the existing Hermes provider routes', async () => {
  const fake = fakeModelBackend()

  const catalog = await fake.controller.catalog()

  assert.equal(catalog.connected, false)
  assert.deepEqual(
    catalog.providers.map(provider => [provider.id, provider.name, provider.setup]),
    [
      ['openai-codex', 'ChatGPT', 'oauth'],
      ['bedrock', 'AWS Bedrock', 'external'],
      ['openrouter', 'OpenRouter', 'api-key'],
      ['qwen-oauth', 'Qwen', 'external']
    ]
  )
})

test('providers without inline credentials retain the existing Hermes model setup path', async () => {
  const fake = fakeModelBackend()
  const result = await fake.controller.openProviderSetup('bedrock')

  assert.deepEqual(result, { copiedCommand: true, openedUrl: false })
  assert.deepEqual(fake.copied, ['hermes model'])
  assert.deepEqual(fake.terminals, ['opened'])
})

test('external provider setup copies its existing command and opens Terminal plus documentation', async () => {
  const fake = fakeModelBackend()

  const result = await fake.controller.openProviderSetup('qwen-oauth')

  assert.deepEqual(result, { copiedCommand: true, openedUrl: true })
  assert.deepEqual(fake.copied, ['hermes auth add qwen-oauth'])
  assert.deepEqual(fake.terminals, ['opened'])
  assert.deepEqual(fake.opened, ['https://example.com/qwen'])
})

test('ChatGPT login opens the browser with its code already copied and polls the existing session route', async () => {
  const fake = fakeModelBackend()

  const session = await fake.controller.startLogin('openai-codex')
  const result = await fake.controller.pollLogin(session.providerId, session.sessionId)

  assert.deepEqual(fake.copied, ['ABCD-EFGH'])
  assert.deepEqual(fake.opened, ['https://auth.openai.com/device'])
  assert.equal(session.userCode, 'ABCD-EFGH')
  assert.equal(result.status, 'approved')
})

test('API keys and model selections are validated against the live catalog before writing', async () => {
  const fake = fakeModelBackend()

  const catalog = await fake.controller.saveApiKey('openrouter', 'secret-value')
  assert.equal(catalog.providers.find(provider => provider.id === 'openrouter')?.authenticated, true)
  assert.deepEqual(fake.events.find(event => event.path === '/api/env')?.body, {
    key: 'OPENROUTER_API_KEY',
    value: 'secret-value'
  })

  const selected = await fake.controller.selectModel('openrouter', 'openrouter/auto')
  assert.deepEqual(selected, { model: 'openrouter/auto', provider: 'openrouter' })

  await assert.rejects(() => fake.controller.selectModel('openrouter', '../../other-model'), /not offered/i)
})

test('unknown provider ids are rejected before browser, clipboard, or backend side effects', async () => {
  const fake = fakeModelBackend()
  const eventCount = fake.events.length

  await assert.rejects(() => fake.controller.startLogin('../../shell'), /unknown provider/i)
  assert.equal(fake.events.length, eventCount + 1, 'only the provider catalog read is allowed')
  assert.deepEqual(fake.opened, [])
  assert.deepEqual(fake.copied, [])
})
