import { IconCheck, IconChevronLeft, IconExternalLink, IconKey, IconLoader2, IconX } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  MacManModelCatalog,
  MacManModelLoginSession,
  MacManModelProvider,
  MacManNativeBridge
} from './native-contract'

type MacManModelSetupProps = {
  bridge: MacManNativeBridge
  initialProviderId?: string
  onClose: () => void
  onConnected: (selection: { model: string; provider: string }) => void
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function providerAction(provider: MacManModelProvider): string {
  if (provider.authenticated) {
    return `Choose ${provider.name} model`
  }

  if (provider.setup === 'oauth') {
    return `Sign in with ${provider.name}`
  }

  if (provider.setup === 'api-key') {
    return `Add ${provider.name} API key`
  }

  return `Open ${provider.name} setup`
}

export function MacManModelSetup({ bridge, initialProviderId, onClose, onConnected }: MacManModelSetupProps) {
  const [catalog, setCatalog] = useState<MacManModelCatalog | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [keyProviderId, setKeyProviderId] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [login, setLogin] = useState<MacManModelLoginSession | null>(null)
  const [lastLoginCode, setLastLoginCode] = useState<string | null>(null)
  const [setupNotice, setSetupNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const initialProviderHandled = useRef(false)
  const pollTimer = useRef<number | null>(null)

  const schedulePoll = useCallback(
    (session: MacManModelLoginSession, request: number) => {
      pollTimer.current = window.setTimeout(async () => {
        if (request !== generation.current) {
          return
        }

        try {
          const result = await bridge.pollModelLogin(session.providerId, session.sessionId)

          if (request !== generation.current) {
            return
          }

          if (result.status === 'pending') {
            schedulePoll(session, request)

            return
          }

          if (result.status !== 'approved') {
            setLogin(null)
            setError(result.message || `Sign-in ${result.status}.`)

            return
          }

          const next = await bridge.getModelCatalog()

          if (request === generation.current) {
            setCatalog(next)
            setLogin(null)
            setLastLoginCode(session.userCode ?? null)
            setSelectedProviderId(session.providerId)
          }
        } catch (cause) {
          if (request === generation.current) {
            setLogin(null)
            setError(message(cause))
          }
        }
      }, session.pollIntervalMs)
    },
    [bridge]
  )

  const chooseProvider = useCallback(async (provider: MacManModelProvider) => {
    setError(null)

    if (provider.authenticated) {
      setSelectedProviderId(provider.id)

      return
    }

    if (provider.setup === 'api-key') {
      setKeyProviderId(provider.id)

      return
    }

    if (provider.setup === 'external') {
      try {
        const result = await bridge.openModelProviderSetup(provider.id)

        setSetupNotice(
          result.copiedCommand
            ? `${provider.name} setup command copied. Paste it into the Terminal window that just opened.`
            : `Opened ${provider.name} setup in your browser.`
        )
      } catch (cause) {
        setError(message(cause))
      }

      return
    }

    if (provider.setup !== 'oauth') {
      setError(`${provider.name} setup is not available in this build.`)

      return
    }

    const request = ++generation.current

    setBusy(true)

    try {
      const session = await bridge.startModelLogin(provider.id)

      if (request === generation.current) {
        setLogin(session)
        schedulePoll(session, request)
      }
    } catch (cause) {
      if (request === generation.current) {
        setError(message(cause))
      }
    } finally {
      if (request === generation.current) {
        setBusy(false)
      }
    }
  }, [bridge, schedulePoll])

  const loadCatalog = useCallback(async () => {
    const request = ++generation.current

    setBusy(true)
    setError(null)

    try {
      const next = await bridge.getModelCatalog()

      if (request === generation.current) {
        setCatalog(next)

        const initialProvider = initialProviderId
          ? next.providers.find(provider => provider.id === initialProviderId)
          : undefined

        if (initialProvider && !initialProviderHandled.current) {
          initialProviderHandled.current = true
          void chooseProvider(initialProvider)
        }
      }
    } catch (cause) {
      if (request === generation.current) {
        setError(message(cause))
      }
    } finally {
      if (request === generation.current) {
        setBusy(false)
      }
    }
  }, [bridge, chooseProvider, initialProviderId])

  useEffect(() => {
    void loadCatalog()

    return () => {
      if (pollTimer.current !== null) {
        window.clearTimeout(pollTimer.current)
      }
    }
  }, [loadCatalog])

  async function saveApiKey() {
    if (!keyProviderId) {
      return
    }

    const request = ++generation.current

    setBusy(true)
    setError(null)

    try {
      const next = await bridge.saveModelApiKey(keyProviderId, apiKey)

      if (request === generation.current) {
        setApiKey('')
        setCatalog(next)
        setKeyProviderId(null)
        setSelectedProviderId(keyProviderId)
      }
    } catch (cause) {
      if (request === generation.current) {
        setError(message(cause))
      }
    } finally {
      if (request === generation.current) {
        setBusy(false)
      }
    }
  }

  async function selectModel(providerId: string, modelId: string) {
    setBusy(true)
    setError(null)

    try {
      const selection = await bridge.selectModel(providerId, modelId)

      onConnected(selection)
      onClose()
    } catch (cause) {
      setError(message(cause))
      setBusy(false)
    }
  }

  async function cancelLogin() {
    const active = login

    generation.current += 1

    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current)
      pollTimer.current = null
    }

    setLogin(null)

    if (active) {
      await bridge.cancelModelLogin(active.sessionId).catch(() => undefined)
    }
  }

  const selectedProvider = catalog?.providers.find(provider => provider.id === selectedProviderId)
  const keyProvider = catalog?.providers.find(provider => provider.id === keyProviderId)

  return (
    <div className="mm-modal-backdrop" role="presentation">
      <section aria-labelledby="model-setup-title" aria-modal="true" className="mm-model-dialog" role="dialog">
        <header className="mm-model-dialog-header">
          {selectedProvider || keyProvider ? (
            <button
              aria-label="Back to providers"
              className="mm-icon-button"
              onClick={() => {
                setSelectedProviderId(null)
                setKeyProviderId(null)
                setApiKey('')
                setError(null)
              }}
              type="button"
            >
              <IconChevronLeft aria-hidden size={19} stroke={1.8} />
            </button>
          ) : (
            <span className="mm-model-dialog-spacer" />
          )}
          <div>
            <span className="mm-eyebrow">INTELLIGENCE</span>
            <h1 id="model-setup-title">{selectedProvider ? `Choose a ${selectedProvider.name} model` : 'Choose a model'}</h1>
          </div>
          <button aria-label="Close model setup" className="mm-icon-button" onClick={onClose} type="button">
            <IconX aria-hidden size={19} stroke={1.8} />
          </button>
        </header>

        {error ? (
          <div className="mm-model-error" role="alert">
            <span>{error}</span>
            {!catalog ? (
              <button className="mm-button mm-button--small" onClick={() => void loadCatalog()} type="button">
                Try again
              </button>
            ) : null}
          </div>
        ) : null}

        {setupNotice ? (
          <div className="mm-model-success" role="status">
            {setupNotice}
          </div>
        ) : null}

        {login ? (
          <div className="mm-login-waiting">
            <IconLoader2 aria-hidden className="mm-spin" size={28} stroke={1.7} />
            <h2>Finish signing in in your browser</h2>
            {login.userCode ? (
              <>
                <code>{login.userCode}</code>
                <p>The code is copied. Paste it in the browser and come straight back.</p>
              </>
            ) : (
              <p>MacMan will continue as soon as the provider approves the login.</p>
            )}
            <button className="mm-button mm-button--quiet" onClick={() => void cancelLogin()} type="button">
              Cancel sign-in
            </button>
          </div>
        ) : keyProvider ? (
          <form
            className="mm-model-key-form"
            onSubmit={event => {
              event.preventDefault()
              void saveApiKey()
            }}
          >
            <span className="mm-model-provider-icon">
              <IconKey aria-hidden size={22} stroke={1.7} />
            </span>
            <h2>Connect {keyProvider.name}</h2>
            <p>The key is sent directly to the local MacMan runtime and is never shown again.</p>
            <label htmlFor="macman-provider-key">{keyProvider.name} API key</label>
            <input
              autoComplete="off"
              autoFocus
              id="macman-provider-key"
              onChange={event => setApiKey(event.currentTarget.value)}
              placeholder="Paste API key"
              type="password"
              value={apiKey}
            />
            <button className="mm-button mm-button--primary" disabled={busy || !apiKey.trim()} type="submit">
              {busy ? 'Saving…' : 'Save API key'}
            </button>
          </form>
        ) : selectedProvider ? (
          <div className="mm-model-list">
            {lastLoginCode ? (
              <div className="mm-model-success" role="status">
                Signed in with copied code <code>{lastLoginCode}</code>
              </div>
            ) : null}
            {selectedProvider.models.length > 0 ? (
              selectedProvider.models.map(model => (
                <button
                  aria-label={`Use ${model}`}
                  className="mm-model-row"
                  disabled={busy}
                  key={model}
                  onClick={() => void selectModel(selectedProvider.id, model)}
                  type="button"
                >
                  <span>
                    <strong>{model}</strong>
                    <small>{selectedProvider.name}</small>
                  </span>
                  <IconCheck aria-hidden size={18} stroke={1.8} />
                </button>
              ))
            ) : (
              <div className="mm-model-empty">No models were returned by this provider. Try refreshing.</div>
            )}
          </div>
        ) : catalog ? (
          <div className="mm-provider-list">
            <p className="mm-model-intro">Use your ChatGPT subscription, another provider account, an API key, or a local model.</p>
            {catalog.providers.map(provider => (
              <button
                aria-label={providerAction(provider)}
                className="mm-provider-row"
                disabled={busy}
                key={provider.id}
                onClick={() => void chooseProvider(provider)}
                type="button"
              >
                <span className="mm-model-provider-icon">
                  {provider.authenticated ? <IconCheck aria-hidden size={19} stroke={2} /> : <IconKey aria-hidden size={19} stroke={1.7} />}
                </span>
                <span className="mm-provider-copy">
                  <strong>{provider.name}</strong>
                  <small>
                    {provider.authenticated
                      ? 'Connected. Choose the model MacMan should use.'
                      : provider.setup === 'oauth'
                        ? 'Sign in in your browser. No API key needed.'
                        : provider.setup === 'api-key'
                          ? 'Connect with an API key.'
                          : 'Finish setup with the provider.'}
                  </small>
                </span>
                <span className="mm-provider-action">
                  {provider.authenticated ? 'Choose model' : provider.setup === 'external' ? 'Open setup' : 'Connect'}
                  {provider.setup === 'external' ? <IconExternalLink aria-hidden size={15} stroke={1.8} /> : null}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mm-model-loading">
            <IconLoader2 aria-hidden className="mm-spin" size={25} stroke={1.7} />
            <span>Loading providers…</span>
          </div>
        )}
      </section>
    </div>
  )
}
