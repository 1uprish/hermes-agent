type BackendRequest = {
  body?: unknown
  method?: 'DELETE' | 'GET' | 'POST' | 'PUT'
  path: string
}

type BackendRequestHandler = (request: BackendRequest) => Promise<unknown>

type OAuthProviderRecord = {
  cliCommand?: string
  docsUrl?: string
  flow?: 'device_code' | 'external' | 'pkce'
  id: string
  loggedIn: boolean
  name: string
}

type ModelOptionRecord = {
  authenticated: boolean
  authType?: string
  docsUrl?: string
  id: string
  keyEnv?: string
  models: string[]
  name: string
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

export type MacManModelBridgeDependencies = {
  copyText(value: string): void
  openExternal(url: string): Promise<unknown>
  openTerminal(): Promise<unknown>
  request: BackendRequestHandler
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map(text).filter(Boolean)
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function safeExternalUrl(value: unknown): string {
  const url = text(value)
  const parsed = new URL(url)

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Provider returned an unsupported sign-in URL')
  }

  return parsed.toString()
}

function parseOAuthProviders(response: unknown): OAuthProviderRecord[] {
  return array(record(response).providers).flatMap(value => {
    const provider = record(value)
    const id = text(provider.id)
    const name = text(provider.name)

    if (!id || !name) {
      return []
    }

    const flow = text(provider.flow)
    const status = record(provider.status)

    return [
      {
        cliCommand: text(provider.cli_command) || undefined,
        docsUrl: text(provider.docs_url) || undefined,
        flow: flow === 'device_code' || flow === 'external' || flow === 'pkce' ? flow : undefined,
        id,
        loggedIn: status.logged_in === true,
        name
      }
    ]
  })
}

function parseModelOptions(response: unknown): {
  current?: { model: string; provider: string }
  providers: ModelOptionRecord[]
} {
  const body = record(response)
  const provider = text(body.provider)
  const model = text(body.model)

  return {
    current: provider && model ? { model, provider } : undefined,
    providers: array(body.providers).flatMap(value => {
      const option = record(value)
      const id = text(option.slug)
      const name = text(option.name)

      if (!id || !name) {
        return []
      }

      return [
        {
          authenticated: option.authenticated === true,
          authType: text(option.auth_type) || undefined,
          docsUrl: text(option.docs_url) || undefined,
          id,
          keyEnv: text(option.key_env) || undefined,
          models: stringArray(option.models),
          name
        }
      ]
    })
  }
}

function setupKind(option: ModelOptionRecord | undefined, oauth: OAuthProviderRecord | undefined) {
  if (oauth?.flow === 'device_code' || oauth?.flow === 'pkce') {
    return 'oauth' as const
  }

  if (option?.keyEnv && option.authType === 'api_key') {
    return 'api-key' as const
  }

  if (oauth?.flow === 'external' || option?.authType?.includes('external')) {
    return 'external' as const
  }

  if (option) {
    return 'external' as const
  }

  return 'unavailable' as const
}

function displayName(id: string, option?: ModelOptionRecord, oauth?: OAuthProviderRecord): string {
  if (id === 'openai-codex') {
    return 'ChatGPT'
  }

  return option?.name || oauth?.name || id
}

function providerOrder(provider: MacManModelProvider): string {
  const first = provider.id === 'openai-codex' ? '0' : provider.authenticated ? '1' : '2'

  return `${first}:${provider.name.toLocaleLowerCase()}`
}

function mergeProviders(options: ModelOptionRecord[], oauthProviders: OAuthProviderRecord[]): MacManModelProvider[] {
  const optionsById = new Map(options.map(option => [option.id, option]))
  const oauthById = new Map(oauthProviders.map(provider => [provider.id, provider]))
  const ids = new Set([...optionsById.keys(), ...oauthById.keys()])

  return [...ids]
    .map(id => {
      const option = optionsById.get(id)
      const oauth = oauthById.get(id)

      return {
        authenticated: option?.authenticated === true || oauth?.loggedIn === true,
        cliCommand: oauth?.cliCommand || (option && setupKind(option, oauth) === 'external' ? 'hermes model' : undefined),
        docsUrl: oauth?.docsUrl || option?.docsUrl,
        id,
        keyEnv: option?.keyEnv,
        models: option?.models ?? [],
        name: displayName(id, option, oauth),
        setup: setupKind(option, oauth)
      }
    })
    .sort((left, right) => providerOrder(left).localeCompare(providerOrder(right)))
}

function assertId(value: string, label: string): string {
  const normalized = text(value)

  if (!normalized || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(normalized)) {
    throw new Error(`Invalid ${label}`)
  }

  return normalized
}

export function createMacManModelBridgeController(dependencies: MacManModelBridgeDependencies) {
  async function oauthProviders(): Promise<OAuthProviderRecord[]> {
    return parseOAuthProviders(await dependencies.request({ path: '/api/providers/oauth' }))
  }

  async function modelOptions(): Promise<ReturnType<typeof parseModelOptions>> {
    return parseModelOptions(
      await dependencies.request({ path: '/api/model/options?include_unconfigured=1&explicit_only=0' })
    )
  }

  async function catalog(): Promise<MacManModelCatalog> {
    const [oauth, options] = await Promise.all([oauthProviders(), modelOptions()])
    let current = options.current

    try {
      const info = record(await dependencies.request({ path: '/api/model/info' }))
      const provider = text(info.provider)
      const model = text(info.model)

      if (provider && model) {
        current = { model, provider }
      }
    } catch {
      // An unconfigured runtime reports model/info as an error. Provider setup
      // must still render from the two catalog endpoints.
    }

    return {
      connected: Boolean(current),
      current,
      providers: mergeProviders(options.providers, oauth)
    }
  }

  return {
    async cancelLogin(sessionId: string): Promise<void> {
      const safeSessionId = assertId(sessionId, 'login session')

      await dependencies.request({
        method: 'DELETE',
        path: `/api/providers/oauth/sessions/${encodeURIComponent(safeSessionId)}`
      })
    },

    catalog,

    async openProviderSetup(providerId: string) {
      const safeProviderId = assertId(providerId, 'provider')
      const provider = (await catalog()).providers.find(candidate => candidate.id === safeProviderId)

      if (!provider) {
        throw new Error('Unknown provider')
      }

      let copiedCommand = false
      let openedUrl = false

      if (provider.cliCommand) {
        dependencies.copyText(provider.cliCommand)
        await dependencies.openTerminal()
        copiedCommand = true
      }

      if (provider.docsUrl) {
        await dependencies.openExternal(safeExternalUrl(provider.docsUrl))
        openedUrl = true
      }

      if (!copiedCommand && !openedUrl) {
        throw new Error('Provider setup documentation is unavailable')
      }

      return { copiedCommand, openedUrl }
    },

    async pollLogin(providerId: string, sessionId: string) {
      const safeProviderId = assertId(providerId, 'provider')
      const safeSessionId = assertId(sessionId, 'login session')

      const response = record(
        await dependencies.request({
          path: `/api/providers/oauth/${encodeURIComponent(safeProviderId)}/poll/${encodeURIComponent(safeSessionId)}`
        })
      )

      const status = text(response.status)

      if (!['approved', 'denied', 'error', 'expired', 'pending'].includes(status)) {
        throw new Error('Provider returned an invalid login status')
      }

      return {
        message: text(response.error_message) || undefined,
        status: status as 'approved' | 'denied' | 'error' | 'expired' | 'pending'
      }
    },

    async saveApiKey(providerId: string, rawApiKey: string): Promise<MacManModelCatalog> {
      const safeProviderId = assertId(providerId, 'provider')
      const apiKey = rawApiKey.trim()

      if (!apiKey) {
        throw new Error('Enter an API key first')
      }

      const option = (await modelOptions()).providers.find(provider => provider.id === safeProviderId)

      if (!option?.keyEnv || option.authType !== 'api_key') {
        throw new Error('This provider does not accept an API key here')
      }

      await dependencies.request({
        body: { key: option.keyEnv, value: apiKey },
        method: 'PUT',
        path: '/api/env'
      })

      return catalog()
    },

    async selectModel(providerId: string, modelId: string) {
      const safeProviderId = assertId(providerId, 'provider')
      const model = text(modelId)
      const liveCatalog = await catalog()
      const provider = liveCatalog.providers.find(candidate => candidate.id === safeProviderId)

      if (!provider?.authenticated) {
        throw new Error('Provider is not connected')
      }

      if (!model || !provider.models.includes(model)) {
        throw new Error('That model is not offered by this provider')
      }

      const response = record(
        await dependencies.request({
          body: { model, provider: safeProviderId, scope: 'main' },
          method: 'POST',
          path: '/api/model/set'
        })
      )

      return {
        model: text(response.model) || model,
        provider: text(response.provider) || safeProviderId
      }
    },

    async startLogin(providerId: string) {
      const requestedProviderId = text(providerId)
      const provider = (await oauthProviders()).find(candidate => candidate.id === requestedProviderId)

      if (!provider) {
        throw new Error('Unknown provider')
      }

      const safeProviderId = assertId(provider.id, 'provider')

      if (provider.flow !== 'device_code' && provider.flow !== 'pkce') {
        throw new Error('This provider uses external setup')
      }

      const response = record(
        await dependencies.request({
          body: {},
          method: 'POST',
          path: `/api/providers/oauth/${encodeURIComponent(safeProviderId)}/start`
        })
      )

      const sessionId = assertId(text(response.session_id), 'login session')
      const flow = text(response.flow)
      const userCode = text(response.user_code)
      const externalUrl = safeExternalUrl(flow === 'device_code' ? response.verification_url : response.auth_url)

      if (userCode) {
        dependencies.copyText(userCode)
      }

      await dependencies.openExternal(externalUrl)

      return {
        expiresInSeconds: Math.max(1, Number(response.expires_in) || 900),
        pollIntervalMs: Math.max(1_000, Number(response.poll_interval) * 1_000 || 2_000),
        providerId: safeProviderId,
        sessionId,
        userCode: userCode || undefined
      }
    }
  }
}

export type MacManModelBridgeController = ReturnType<typeof createMacManModelBridgeController>
