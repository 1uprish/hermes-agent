import { describe, expect, it, vi } from 'vitest'

import { ensureLocalMemory, type MacManMemoryApi, saveMacManMemorySetting } from './macman-memory'
import type { MacManModelCatalog } from './native-contract'

const openAiCatalog: MacManModelCatalog = {
  connected: true,
  current: { model: 'gpt-4o-mini', provider: 'openai' },
  providers: [
    {
      authenticated: true,
      id: 'openai',
      keyEnv: 'OPENAI_API_KEY',
      models: ['gpt-4o-mini'],
      name: 'OpenAI',
      setup: 'api-key'
    }
  ]
}

function api(overrides: Partial<MacManMemoryApi> = {}): MacManMemoryApi {
  return {
    getConfig: vi.fn().mockResolvedValue({ memory: {} }),
    getProviderConfig: vi.fn().mockResolvedValue({
      docs_url: '',
      fields: [],
      label: 'Hindsight',
      name: 'hindsight'
    }),
    getStatus: vi.fn().mockResolvedValue({
      active: '',
      builtin_files: { memory: 0, user: 0 },
      providers: []
    }),
    saveConfig: vi.fn().mockResolvedValue({ ok: true }),
    saveProviderConfig: vi.fn().mockResolvedValue({ active: 'hindsight', ok: true }),
    setupProvider: vi.fn().mockResolvedValue({ ok: true, provider: 'hindsight', results: [] }),
    ...overrides
  }
}

describe('MacMan local memory integration', () => {
  it('installs embedded Hindsight and reuses the current API-key pointer without copying the secret', async () => {
    const memoryApi = api()

    const result = await ensureLocalMemory(openAiCatalog, memoryApi)

    const expected = expect.objectContaining({
      auto_recall: true,
      auto_retain: true,
      llm_key_env: 'OPENAI_API_KEY',
      llm_model: 'gpt-4o-mini',
      llm_provider: 'openai',
      mode: 'local_embedded'
    })

    expect(memoryApi.setupProvider).toHaveBeenCalledWith('hindsight', expected)
    expect(memoryApi.saveProviderConfig).toHaveBeenCalledWith('hindsight', expected)
    expect(result).toMatchObject({
      enabled: true,
      learnFromConversations: true,
      status: 'ready',
      useSavedMemories: true
    })
  })

  it('never turns an OAuth-only ChatGPT connection into a cloud memory bill', async () => {
    const memoryApi = api()

    const catalog: MacManModelCatalog = {
      connected: true,
      current: { model: 'gpt-5.5', provider: 'openai-codex' },
      providers: [
        {
          authenticated: true,
          id: 'openai-codex',
          models: ['gpt-5.5'],
          name: 'ChatGPT',
          setup: 'oauth'
        }
      ]
    }

    const result = await ensureLocalMemory(catalog, memoryApi)

    expect(memoryApi.setupProvider).not.toHaveBeenCalled()
    expect(memoryApi.saveProviderConfig).not.toHaveBeenCalled()
    expect(result.status).toBe('basic')
    expect(result.detail).toContain('basic local memory')
  })

  it('fails back to basic local memory when embedded setup cannot complete', async () => {
    const memoryApi = api({ setupProvider: vi.fn().mockRejectedValue(new Error('install failed')) })

    const result = await ensureLocalMemory(openAiCatalog, memoryApi)

    expect(memoryApi.saveProviderConfig).not.toHaveBeenCalled()
    expect(result.status).toBe('basic')
    expect(result.detail).toContain('install failed')
  })

  it('reads an already-active local provider without reinstalling it', async () => {
    const memoryApi = api({
      getProviderConfig: vi.fn().mockResolvedValue({
        docs_url: '',
        fields: [
          { key: 'mode', value: 'local_embedded' },
          { key: 'auto_retain', value: false },
          { key: 'auto_recall', value: true }
        ],
        label: 'Hindsight',
        name: 'hindsight'
      }),
      getStatus: vi.fn().mockResolvedValue({
        active: 'hindsight',
        builtin_files: { memory: 12, user: 8 },
        providers: []
      })
    })

    const result = await ensureLocalMemory(openAiCatalog, memoryApi)

    expect(memoryApi.setupProvider).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      learnFromConversations: false,
      status: 'ready',
      useSavedMemories: true
    })
  })

  it('turns off both provider activity and built-in prompt injection', async () => {
    const memoryApi = api({
      getStatus: vi.fn().mockResolvedValue({
        active: 'hindsight',
        builtin_files: { memory: 12, user: 8 },
        providers: []
      })
    })

    const result = await saveMacManMemorySetting(
      {
        enabled: true,
        learnFromConversations: true,
        status: 'ready',
        useSavedMemories: true
      },
      'enabled',
      false,
      memoryApi
    )

    expect(memoryApi.saveProviderConfig).toHaveBeenCalledWith('hindsight', {
      auto_recall: false,
      auto_retain: false
    })
    expect(memoryApi.saveConfig).toHaveBeenLastCalledWith({ memory: { provider: '' } })
    expect(result.status).toBe('disabled')
  })
})
