import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MacManModelSetup } from './macman-model-setup'
import type { MacManModelCatalog, MacManNativeBridge } from './native-contract'

const catalog: MacManModelCatalog = {
  connected: false,
  providers: [
    {
      authenticated: false,
      id: 'openai-codex',
      models: ['gpt-5.5', 'gpt-5.6-sol'],
      name: 'ChatGPT',
      setup: 'oauth'
    },
    {
      authenticated: false,
      id: 'openrouter',
      keyEnv: 'OPENROUTER_API_KEY',
      models: ['openrouter/auto'],
      name: 'OpenRouter',
      setup: 'api-key'
    }
  ]
}

function bridge(overrides: Partial<MacManNativeBridge> = {}): MacManNativeBridge {
  return {
    cancelModelLogin: vi.fn(),
    checkForUpdates: vi.fn(),
    exportData: vi.fn(),
    getModelCatalog: vi.fn().mockResolvedValue(catalog),
    openLogs: vi.fn(),
    openModelProviderSetup: vi.fn(),
    openSystemSettings: vi.fn(),
    pickExcludedPaths: vi.fn(),
    pollModelLogin: vi.fn().mockResolvedValue({ status: 'pending' }),
    requestPermission: vi.fn(),
    saveModelApiKey: vi.fn().mockResolvedValue(catalog),
    selectModel: vi.fn(),
    snapshot: vi.fn(),
    startModelLogin: vi.fn(),
    ...overrides
  }
}

afterEach(cleanup)

describe('MacMan-owned model setup', () => {
  it('loads ChatGPT and every provider from the native MacMan catalog', async () => {
    const native = bridge()

    render(<MacManModelSetup bridge={native} onClose={vi.fn()} onConnected={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Choose a model' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in with ChatGPT' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add OpenRouter API key' })).toBeTruthy()
  })

  it('starts ChatGPT login, shows the copied code, and advances to model choice after approval', async () => {
    const authenticated = {
      ...catalog,
      providers: catalog.providers.map(provider =>
        provider.id === 'openai-codex' ? { ...provider, authenticated: true } : provider
      )
    }

    const native = bridge({
      getModelCatalog: vi.fn().mockResolvedValueOnce(catalog).mockResolvedValueOnce(authenticated),
      pollModelLogin: vi.fn().mockResolvedValue({ status: 'approved' }),
      startModelLogin: vi.fn().mockResolvedValue({
        expiresInSeconds: 900,
        pollIntervalMs: 10,
        providerId: 'openai-codex',
        sessionId: 'codex-session',
        userCode: 'ABCD-EFGH'
      })
    })

    render(<MacManModelSetup bridge={native} onClose={vi.fn()} onConnected={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with ChatGPT' }))

    expect(await screen.findByText('ABCD-EFGH')).toBeTruthy()
    expect(screen.getByText(/copied/i)).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Use gpt-5.5' })).toBeTruthy()
  })

  it('saves an API key without exposing it after submission, then offers that provider models', async () => {
    const authenticated = {
      ...catalog,
      providers: catalog.providers.map(provider =>
        provider.id === 'openrouter' ? { ...provider, authenticated: true } : provider
      )
    }

    const native = bridge({ saveModelApiKey: vi.fn().mockResolvedValue(authenticated) })

    render(<MacManModelSetup bridge={native} onClose={vi.fn()} onConnected={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add OpenRouter API key' }))
    fireEvent.change(screen.getByLabelText('OpenRouter API key'), { target: { value: 'secret-value' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save API key' }))

    await waitFor(() => expect(native.saveModelApiKey).toHaveBeenCalledWith('openrouter', 'secret-value'))
    expect(screen.queryByDisplayValue('secret-value')).toBeNull()
    expect(await screen.findByRole('button', { name: 'Use openrouter/auto' })).toBeTruthy()
  })

  it('persists the selected model and closes only after native confirmation', async () => {
    const onClose = vi.fn()
    const onConnected = vi.fn()

    const connectedCatalog = {
      ...catalog,
      providers: catalog.providers.map(provider => ({ ...provider, authenticated: true }))
    }

    const native = bridge({
      getModelCatalog: vi.fn().mockResolvedValue(connectedCatalog),
      selectModel: vi.fn().mockResolvedValue({ model: 'gpt-5.5', provider: 'openai-codex' })
    })

    render(<MacManModelSetup bridge={native} onClose={onClose} onConnected={onConnected} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose ChatGPT model' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use gpt-5.5' }))

    await waitFor(() => expect(native.selectModel).toHaveBeenCalledWith('openai-codex', 'gpt-5.5'))
    expect(onConnected).toHaveBeenCalledWith({ model: 'gpt-5.5', provider: 'openai-codex' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the picker recoverable when the backend cannot load providers', async () => {
    const native = bridge({ getModelCatalog: vi.fn().mockRejectedValue(new Error('backend unavailable')) })

    render(<MacManModelSetup bridge={native} onClose={vi.fn()} onConnected={vi.fn()} />)

    expect(await screen.findByText('backend unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
