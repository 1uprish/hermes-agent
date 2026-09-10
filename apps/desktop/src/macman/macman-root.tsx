import { useCallback, useEffect, useRef, useState } from 'react'

import { DEFAULT_MACMAN_SNAPSHOT, MacManApp } from './macman-app'
import type { MacManNativeBridge, MacManPermissionId, MacManSnapshot } from './native-contract'

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

  const commitLatest = useCallback(async (operation: () => Promise<MacManSnapshot>) => {
    const generation = ++requestGeneration.current

    try {
      const next = await operation()

      if (generation === requestGeneration.current) {
        setSnapshot(next)
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

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)

    return () => {
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])

  return (
    <MacManApp
      onOpenSystemSettings={openSystemSettings}
      onRefresh={refresh}
      onRequestPermission={requestPermission}
      snapshot={snapshot}
    />
  )
}
