import { IconCheck, IconChevronDown, IconKey, IconRefresh } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  MacManActiveModel,
  MacManModelLimit,
  MacManModelSwitchResult
} from './macman-chat-client'
import type { MacManModelCatalog, MacManModelProvider } from './native-contract'

interface MacManModelSelectorProps {
  activeModel?: MacManActiveModel
  busy: boolean
  limitedModels?: Record<string, MacManModelLimit>
  loadCatalog: () => Promise<MacManModelCatalog>
  onManageModels?: (providerId?: string) => void
  onSelectModel: (provider: string, model: string, confirmExpensiveModel?: boolean) => Promise<MacManModelSwitchResult>
}

interface PendingConfirmation extends MacManActiveModel {
  message: string
}

function limitKey(provider: string, model: string): string {
  return `${provider}:${model}`
}

function providerConnectionLabel(provider: MacManModelProvider): string {
  return provider.setup === 'api-key' ? 'API key connected' : 'Signed in'
}

function limitLabel(limit?: MacManModelLimit): string | undefined {
  return limit?.kind === 'exhausted' ? 'Limit reached' : limit ? 'Rate limited' : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function MacManModelSelector({
  activeModel,
  busy,
  limitedModels = {},
  loadCatalog,
  onManageModels,
  onSelectModel
}: MacManModelSelectorProps) {
  const [catalog, setCatalog] = useState<MacManModelCatalog>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>()
  const [switchingKey, setSwitchingKey] = useState<string>()
  const generation = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++generation.current
    setLoading(true)
    setError(undefined)

    try {
      const next = await loadCatalog()

      if (request === generation.current) {
        setCatalog(next)
      }
    } catch (cause) {
      if (request === generation.current) {
        setError(errorMessage(cause))
      }
    } finally {
      if (request === generation.current) {
        setLoading(false)
      }
    }
  }, [loadCatalog])

  useEffect(() => {
    if (!open) {
      return
    }

    void refresh()

    const closeFromPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-macman-model-selector]')) {
        setOpen(false)
      }
    }

    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeFromPointer)
    document.addEventListener('keydown', closeFromKeyboard)

    return () => {
      document.removeEventListener('pointerdown', closeFromPointer)
      document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [open, refresh])

  async function select(provider: string, model: string, confirmExpensiveModel = false) {
    const key = limitKey(provider, model)
    setSwitchingKey(key)
    setError(undefined)

    try {
      const result = confirmExpensiveModel
        ? await onSelectModel(provider, model, true)
        : await onSelectModel(provider, model)

      if (result.confirmRequired) {
        setPendingConfirmation({
          message: result.confirmationMessage ?? 'Confirm this model switch?',
          model,
          provider
        })
      } else {
        setPendingConfirmation(undefined)
        setOpen(false)
      }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSwitchingKey(undefined)
    }
  }

  const connectedProviders = catalog?.providers.filter(provider => provider.authenticated && provider.models.length > 0) ?? []

  const chatGptProvider = catalog?.providers.find(
    provider => provider.id === 'openai-codex' && !provider.authenticated && provider.setup === 'oauth'
  )

  const activeLimit = activeModel ? limitedModels[limitKey(activeModel.provider, activeModel.model)] : undefined

  return (
    <div className="mm-chat-model-selector" data-macman-model-selector>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Choose model, currently ${activeModel?.model ?? 'none'}`}
        className={`mm-chat-model-trigger${activeLimit ? ' is-limited' : ''}`}
        disabled={busy}
        onClick={() => setOpen(current => !current)}
        type="button"
      >
        <span aria-hidden className="mm-provider-glyph">
          {(activeModel?.provider ?? 'M').slice(0, 1).toUpperCase()}
        </span>
        <span>{activeModel?.model ?? 'Choose model'}</span>
        {activeLimit ? <span className="mm-chat-model-trigger-limit">{limitLabel(activeLimit)}</span> : null}
        <IconChevronDown aria-hidden size={14} stroke={1.9} />
      </button>

      {open ? (
        <section aria-label="Choose a model" className="mm-chat-model-popover" role="dialog">
          <header className="mm-chat-model-popover-header">
            <span>
              <strong>Models</strong>
              <small>Models and accounts</small>
            </span>
            <button aria-label="Refresh models" disabled={loading} onClick={() => void refresh()} type="button">
              <IconRefresh aria-hidden className={loading ? 'mm-spin' : undefined} size={15} stroke={1.8} />
            </button>
          </header>

          {pendingConfirmation ? (
            <div className="mm-chat-model-confirm" role="alert">
              <strong>Confirm model switch</strong>
              <p>{pendingConfirmation.message}</p>
              <span>
                <button onClick={() => setPendingConfirmation(undefined)} type="button">
                  Cancel
                </button>
                <button
                  disabled={Boolean(switchingKey)}
                  onClick={() => void select(pendingConfirmation.provider, pendingConfirmation.model, true)}
                  type="button"
                >
                  Use anyway
                </button>
              </span>
            </div>
          ) : null}

          {error ? (
            <div className="mm-chat-model-error" role="alert">
              {error}
            </div>
          ) : null}

          <div className="mm-chat-model-list">
            {loading && !catalog ? <p className="mm-chat-model-placeholder">Checking connected models…</p> : null}
            {!loading && catalog && connectedProviders.length === 0 ? (
              <p className="mm-chat-model-placeholder">No model provider is connected yet.</p>
            ) : null}
            {chatGptProvider && onManageModels ? (
              <button
                aria-label="Sign in with ChatGPT"
                className="mm-chat-model-connect"
                onClick={() => {
                  setOpen(false)
                  onManageModels(chatGptProvider.id)
                }}
                type="button"
              >
                <span aria-hidden className="mm-provider-glyph">C</span>
                <span>
                  <strong>ChatGPT</strong>
                  <small>Use your subscription · no API key</small>
                </span>
                <span>Sign in</span>
              </button>
            ) : null}
            {connectedProviders.map(provider => (
              <section className="mm-chat-model-group" key={provider.id}>
                <header>
                  <span aria-hidden className="mm-provider-glyph">
                    {provider.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{provider.name}</strong>
                    <small>{providerConnectionLabel(provider)}</small>
                  </span>
                </header>
                {provider.models.map(model => {
                  const key = limitKey(provider.id, model)
                  const limit = limitedModels[key]
                  const active = activeModel?.provider === provider.id && activeModel.model === model

                  return (
                    <button
                      aria-label={`Use ${model}`}
                      className={`mm-chat-model-option${active ? ' is-active' : ''}${limit ? ' is-limited' : ''}`}
                      disabled={Boolean(switchingKey)}
                      key={model}
                      onClick={() => void select(provider.id, model)}
                      type="button"
                    >
                      <span>
                        <strong>{model}</strong>
                        {limit ? <small>{limitLabel(limit)}</small> : null}
                      </span>
                      {switchingKey === key ? (
                        <span className="mm-chat-model-switching">Switching…</span>
                      ) : active ? (
                        <IconCheck aria-hidden size={17} stroke={2} />
                      ) : null}
                    </button>
                  )
                })}
              </section>
            ))}
          </div>

          {onManageModels ? (
            <button
              className="mm-chat-model-manage"
              onClick={() => {
                setOpen(false)
                onManageModels()
              }}
              type="button"
            >
              <IconKey aria-hidden size={15} stroke={1.8} />
              Manage providers and API keys
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
