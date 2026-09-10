import {
  getHermesConfigRecord,
  getMemoryProviderRuntimeConfig,
  getMemoryStatus,
  type HermesConfigRecord,
  type MemoryProviderConfig,
  type MemoryProviderSetupResponse,
  type MemoryStatusResponse,
  saveHermesConfig,
  saveMemoryProviderRuntimeConfig,
  setupMemoryProvider
} from '@/hermes'

import type { MacManModelCatalog, MacManModelProvider } from './native-contract'

export type MacManMemorySetting = 'enabled' | 'learnFromConversations' | 'useSavedMemories'
export type MacManMemoryStatus = 'basic' | 'disabled' | 'loading' | 'ready' | 'setting-up'

export interface MacManMemorySettings {
  detail?: string
  enabled: boolean
  learnFromConversations: boolean
  status: MacManMemoryStatus
  useSavedMemories: boolean
}

export interface MacManMemoryApi {
  getConfig(): Promise<HermesConfigRecord>
  getProviderConfig(provider: string): Promise<MemoryProviderConfig>
  getStatus(): Promise<MemoryStatusResponse>
  saveConfig(config: HermesConfigRecord): Promise<{ ok: boolean }>
  saveProviderConfig(provider: string, values: Record<string, unknown>): Promise<{ active: string; ok: boolean }>
  setupProvider(provider: string, values: Record<string, unknown>): Promise<MemoryProviderSetupResponse>
}

export const DEFAULT_MACMAN_MEMORY_SETTINGS: MacManMemorySettings = {
  enabled: true,
  learnFromConversations: true,
  status: 'loading',
  useSavedMemories: true
}

const DEFAULT_MEMORY_API: MacManMemoryApi = {
  getConfig: () => getHermesConfigRecord(),
  getProviderConfig: provider => getMemoryProviderRuntimeConfig(provider),
  getStatus: () => getMemoryStatus(),
  saveConfig: config => saveHermesConfig(config),
  saveProviderConfig: (provider, values) => saveMemoryProviderRuntimeConfig(provider, values),
  setupProvider: (provider, values) => setupMemoryProvider(provider, values)
}

const HINDSIGHT_PROVIDER_BY_MODEL_PROVIDER: Record<string, string> = {
  anthropic: 'anthropic',
  gemini: 'gemini',
  google: 'gemini',
  groq: 'groq',
  lmstudio: 'lmstudio',
  minimax: 'minimax',
  ollama: 'ollama',
  openai: 'openai',
  openrouter: 'openrouter'
}

const LOCAL_MODEL_PROVIDERS = new Set(['lmstudio', 'ollama'])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    if (value.toLocaleLowerCase() === 'true') {
      return true
    }

    if (value.toLocaleLowerCase() === 'false') {
      return false
    }
  }

  return fallback
}

function providerForCurrentModel(catalog: MacManModelCatalog): MacManModelProvider | undefined {
  return catalog.providers.find(provider => provider.id === catalog.current?.provider)
}

export function localHindsightConfig(catalog: MacManModelCatalog): Record<string, unknown> | null {
  const current = catalog.current
  const provider = providerForCurrentModel(catalog)

  if (!current || !provider?.authenticated) {
    return null
  }

  const llmProvider = HINDSIGHT_PROVIDER_BY_MODEL_PROVIDER[current.provider]

  if (!llmProvider) {
    return null
  }

  const localProvider = LOCAL_MODEL_PROVIDERS.has(llmProvider)
  const keyEnv = provider.keyEnv?.trim()

  if (!localProvider && (!keyEnv || !/^[A-Z][A-Z0-9_]{1,127}$/.test(keyEnv))) {
    return null
  }

  return {
    auto_recall: true,
    auto_retain: true,
    bank_id: 'macman',
    llm_key_env: keyEnv ?? '',
    llm_model: current.model,
    llm_provider: llmProvider,
    memory_mode: 'hybrid',
    mode: 'local_embedded',
    recall_budget: 'mid'
  }
}

function providerValues(config: MemoryProviderConfig): Record<string, unknown> {
  return Object.fromEntries(config.fields.map(field => [field.key, field.value]))
}

function basicMemory(detail: string): MacManMemorySettings {
  return {
    enabled: true,
    learnFromConversations: true,
    status: 'basic',
    useSavedMemories: true,
    detail
  }
}

export async function ensureLocalMemory(
  catalog: MacManModelCatalog,
  api: MacManMemoryApi = DEFAULT_MEMORY_API
): Promise<MacManMemorySettings> {
  const [config, status] = await Promise.all([api.getConfig(), api.getStatus()])
  const memory = record(config.memory)
  const enabled = memory.memory_enabled !== false || memory.user_profile_enabled !== false

  if (!enabled) {
    if (status.active) {
      await api.saveConfig({ memory: { provider: '' } })
    }

    return {
      enabled: false,
      learnFromConversations: false,
      status: 'disabled',
      useSavedMemories: false
    }
  }

  if (status.active === 'hindsight') {
    const values = providerValues(await api.getProviderConfig('hindsight'))

    if (values.mode === 'local_embedded') {
      return {
        enabled: true,
        learnFromConversations: booleanValue(values.auto_retain, true),
        status: 'ready',
        useSavedMemories: booleanValue(values.auto_recall, true)
      }
    }
  }

  if (status.active && status.active !== 'hindsight') {
    return basicMemory('Using your existing memory setup. MacMan did not replace it.')
  }

  const values = localHindsightConfig(catalog)

  if (!values) {
    if (status.active === 'hindsight') {
      await api.saveConfig({ memory: { provider: '' } })
    }

    return basicMemory('Using basic local memory. Your current model sign-in cannot be reused by enhanced local memory.')
  }

  try {
    const setup = await api.setupProvider('hindsight', values)

    if (!setup.ok) {
      const message = setup.results.find(result => result.status === 'failed')?.stderr
      throw new Error(message || 'Local memory setup did not complete.')
    }

    await api.saveProviderConfig('hindsight', values)

    return {
      enabled: true,
      learnFromConversations: true,
      status: 'ready',
      useSavedMemories: true
    }
  } catch (error) {
    if (status.active === 'hindsight') {
      await api.saveConfig({ memory: { provider: '' } })
    }

    const message = error instanceof Error ? error.message : String(error)

    return basicMemory(`Using basic local memory because enhanced setup failed: ${message}`)
  }
}

export async function saveMacManMemorySetting(
  current: MacManMemorySettings,
  setting: MacManMemorySetting,
  value: boolean,
  api: MacManMemoryApi = DEFAULT_MEMORY_API
): Promise<MacManMemorySettings> {
  const next = { ...current, [setting]: value }
  const enabled = setting === 'enabled' ? value : current.enabled
  const status = await api.getStatus()

  if (setting === 'enabled') {
    await api.saveConfig({
      memory: {
        memory_enabled: value,
        provider: value ? status.active : '',
        user_profile_enabled: value
      }
    })
  }

  if (status.active === 'hindsight') {
    await api.saveProviderConfig('hindsight', {
      auto_recall: enabled && next.useSavedMemories,
      auto_retain: enabled && next.learnFromConversations
    })

    if (!enabled) {
      await api.saveConfig({ memory: { provider: '' } })
    }
  }

  return {
    ...next,
    enabled,
    learnFromConversations: enabled && next.learnFromConversations,
    status: enabled ? current.status : 'disabled',
    useSavedMemories: enabled && next.useSavedMemories
  }
}
