import { useCallback, useEffect, useRef, useState } from 'react'

import { DEFAULT_MACMAN_SNAPSHOT, MacManApp, type MacManSettingsAction } from './macman-app'
import { MacManChat } from './macman-chat'
import { createMacManChatClient } from './macman-chat-client'
import {
  DEFAULT_MACMAN_MEMORY_SETTINGS,
  ensureLocalMemory,
  type MacManMemorySetting,
  saveMacManMemorySetting
} from './macman-memory'
import { MacManModelSetup } from './macman-model-setup'
import type { MacManModelCatalog, MacManNativeBridge, MacManPermissionId, MacManSnapshot } from './native-contract'

type MacManRootProps = {
  bridge?: MacManNativeBridge | null
}

function disconnectedSnapshot(error?: unknown): MacManSnapshot {
  return {
    ...DEFAULT_MACMAN_SNAPSHOT,
    error: error instanceof Error ? error.message : error ? String(error) : undefined,
    permissions: { ...DEFAULT_MACMAN_SNAPSHOT.permissions },
    wrapper: 'disconnected'
  }
}

export function MacManRoot({ bridge = window.macManNative ?? null }: MacManRootProps) {
  const [snapshot, setSnapshot] = useState<MacManSnapshot>(() =>
    bridge ? { ...DEFAULT_MACMAN_SNAPSHOT, wrapper: 'checking' } : disconnectedSnapshot()
  )

  const requestGeneration = useRef(0)
  const [chatClient] = useState(() => createMacManChatClient(bridge ?? undefined))
  const [modelSetupOpen, setModelSetupOpen] = useState(false)
  const [memorySettings, setMemorySettings] = useState(DEFAULT_MACMAN_MEMORY_SETTINGS)
  const [settingsNotice, setSettingsNotice] = useState<string>()
  const latestModelCatalog = useRef<MacManModelCatalog | undefined>(undefined)
  const memorySetupGeneration = useRef(0)
  const memorySetupQueue = useRef<Promise<void>>(Promise.resolve())
  const memorySetupSignature = useRef<string | undefined>(undefined)

  const configureMemory = useCallback((catalog: MacManModelCatalog, force = false) => {
    const signature = `${catalog.current?.provider ?? ''}:${catalog.current?.model ?? ''}`

    if (!force && memorySetupSignature.current === signature) {
      return
    }

    memorySetupSignature.current = signature
    const generation = ++memorySetupGeneration.current
    setMemorySettings(current => ({ ...current, status: 'setting-up' }))
    memorySetupQueue.current = memorySetupQueue.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const next = await ensureLocalMemory(catalog)

          if (generation === memorySetupGeneration.current) {
            setMemorySettings(next)
          }
        } catch (error) {
          if (generation === memorySetupGeneration.current) {
            setMemorySettings({
              enabled: true,
              learnFromConversations: true,
              status: 'basic',
              useSavedMemories: true,
              detail: `Using basic local memory because enhanced setup could not be checked: ${error instanceof Error ? error.message : String(error)}`
            })
          }
        }
      })
  }, [])

  const commitLatest = useCallback(async (operation: () => Promise<MacManSnapshot>) => {
    const generation = ++requestGeneration.current

    try {
      const next = await operation()

      if (generation === requestGeneration.current) {
        setSnapshot(current => ({
          ...next,
          model: current.model,
          modelName: current.modelName,
          modelProvider: current.modelProvider
        }))
      }
    } catch (error) {
      if (generation === requestGeneration.current) {
        setSnapshot(disconnectedSnapshot(error))
      }
    }
  }, [])

  const refresh = useCallback(() => {
    if (!bridge) {
      setSnapshot(disconnectedSnapshot())

      return
    }

    void commitLatest(() => bridge.snapshot())
  }, [bridge, commitLatest])

  const requestPermission = useCallback(
    (permission: MacManPermissionId) => {
      if (!bridge) {
        return
      }

      void commitLatest(() => bridge.requestPermission(permission))
    },
    [bridge, commitLatest]
  )

  const openSystemSettings = useCallback(
    (permission: MacManPermissionId) => {
      if (!bridge) {
        return
      }

      void bridge
        .openSystemSettings(permission)
        .then(refresh)
        .catch(error => setSnapshot(disconnectedSnapshot(error)))
    },
    [bridge, refresh]
  )

  const refreshModel = useCallback(() => {
    if (!bridge) {
      return
    }

    void bridge
      .getModelCatalog()
      .then(catalog => {
        latestModelCatalog.current = catalog
        configureMemory(catalog)
        const currentProvider = catalog.providers.find(provider => provider.id === catalog.current?.provider)

        setSnapshot(current => ({
          ...current,
          model: catalog.current ? 'connected' : 'not-connected',
          modelName: catalog.current?.model,
          modelProvider: currentProvider?.name ?? catalog.current?.provider
        }))
      })
      .catch(() => undefined)
  }, [bridge, configureMemory])

  const changeMemorySetting = useCallback(
    (setting: MacManMemorySetting, value: boolean) => {
      const previous = memorySettings
      setMemorySettings(current => ({ ...current, [setting]: value }))
      setSettingsNotice(undefined)

      void saveMacManMemorySetting(previous, setting, value)
        .then(next => {
          setMemorySettings(next)

          if (setting === 'enabled' && value && latestModelCatalog.current) {
            memorySetupSignature.current = undefined
            configureMemory(latestModelCatalog.current, true)
          } else {
            setSettingsNotice('Memory changes apply to new conversations.')
          }
        })
        .catch(error => {
          setMemorySettings(previous)
          setSettingsNotice(error instanceof Error ? error.message : String(error))
        })
    },
    [configureMemory, memorySettings]
  )

  const loadModelCatalog = useCallback(() => {
    if (!bridge) {
      return Promise.reject(new Error('The MacMan wrapper is not connected.'))
    }

    return bridge.getModelCatalog()
  }, [bridge])

  const showActiveChatModel = useCallback((selection: { model: string; provider: string }) => {
    setSnapshot(current => ({
      ...current,
      model: 'connected',
      modelName: selection.model,
      modelProvider: selection.provider
    }))
  }, [])

  const runSettingsAction = useCallback(
    async (action: MacManSettingsAction) => {
      if (!bridge) {
        setSettingsNotice('The MacMan wrapper is not connected.')

        return
      }

      setSettingsNotice(undefined)

      try {
        if (action === 'check-updates') {
          const result = await bridge.checkForUpdates()
          const response = result && typeof result === 'object' ? (result as Record<string, unknown>) : {}

          setSettingsNotice(
            typeof response.message === 'string'
              ? response.message
              : response.available === true
                ? 'A MacMan update is available.'
                : 'MacMan is up to date.'
          )

          return
        }

        if (action === 'manage-exclusions') {
          const paths = await bridge.pickExcludedPaths()

          if (paths.length > 0) {
            window.localStorage.setItem('macman:setting:excluded-paths', JSON.stringify(paths))
            setSettingsNotice(`${paths.length} exclusion${paths.length === 1 ? '' : 's'} saved.`)
          }

          return
        }

        if (action === 'open-logs') {
          const result = await bridge.openLogs()

          if (!result.ok) {
            throw new Error(result.error || 'MacMan could not open its logs.')
          }

          setSettingsNotice('Opened MacMan logs in Finder.')

          return
        }

        if (action === 'export-data') {
          const settings: Record<string, string> = {}

          for (let index = 0; index < window.localStorage.length; index += 1) {
            const key = window.localStorage.key(index)

            if (key?.startsWith('macman:')) {
              settings[key] = window.localStorage.getItem(key) ?? ''
            }
          }

          const result = await bridge.exportData({
            exportedAt: new Date().toISOString(),
            model: snapshot.modelName ? { name: snapshot.modelName, provider: snapshot.modelProvider } : null,
            permissions: snapshot.permissions,
            settings
          })

          if (!result.canceled) {
            setSettingsNotice('Exported MacMan settings without credentials or task content.')
          }

          return
        }

        if (action === 'reset-data') {
          if (!window.confirm('Reset MacMan settings? Your model credentials and task data will not be removed.')) {
            return
          }

          const keys = Array.from({ length: window.localStorage.length }, (_value, index) =>
            window.localStorage.key(index)
          ).filter((key): key is string => Boolean(key?.startsWith('macman:')))

          keys.forEach(key => window.localStorage.removeItem(key))
          window.location.reload()

          return
        }

        const permission =
          action === 'connect-messages'
            ? 'fullDiskAccess'
            : action === 'connect-calendar'
              ? 'calendar'
              : 'reminders'

        await bridge.requestPermission(permission)
        setSettingsNotice('Opened the exact macOS permission pane for MacMan.')
      } catch (error) {
        setSettingsNotice(error instanceof Error ? error.message : String(error))
      }
    },
    [bridge, snapshot.modelName, snapshot.modelProvider, snapshot.permissions]
  )

  useEffect(() => {
    refresh()
    refreshModel()

    const refreshAll = () => {
      refresh()
      refreshModel()
    }

    window.addEventListener('focus', refreshAll)

    return () => {
      window.removeEventListener('focus', refreshAll)
    }
  }, [refresh, refreshModel])

  return (
    <>
      <MacManApp
        chat={
          <MacManChat
            client={chatClient}
            loadModelCatalog={bridge ? loadModelCatalog : undefined}
            onActiveModelChange={showActiveChatModel}
            onManageModels={() => setModelSetupOpen(true)}
          />
        }
        memorySettings={memorySettings}
        onMemorySettingChange={changeMemorySetting}
        onOpenModelSetup={() => setModelSetupOpen(true)}
        onOpenSystemSettings={openSystemSettings}
        onRefresh={refresh}
        onRequestPermission={requestPermission}
        onSettingsAction={action => void runSettingsAction(action)}
        settingsNotice={settingsNotice}
        snapshot={snapshot}
      />
      {bridge && modelSetupOpen ? (
        <MacManModelSetup
          bridge={bridge}
          onClose={() => setModelSetupOpen(false)}
          onConnected={selection => {
            showActiveChatModel(selection)
            void chatClient.switchModel(selection.provider, selection.model).catch(error => {
              setSettingsNotice(error instanceof Error ? error.message : String(error))
            })
            refreshModel()
          }}
        />
      ) : null}
    </>
  )
}
