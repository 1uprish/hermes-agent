import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MacManRoot } from './macman-root'
import type { MacManNativeBridge } from './native-contract'

const missingAccess = {
  model: 'not-connected' as const,
  permissions: {
    accessibility: 'not-granted' as const,
    screenRecording: 'granted' as const,
    microphone: 'ask-when-used' as const,
    notifications: 'ask-when-used' as const,
    calendar: 'ask-when-used' as const,
    reminders: 'ask-when-used' as const,
    contacts: 'ask-when-used' as const,
    automation: 'per-app' as const,
    fullDiskAccess: 'optional' as const,
    location: 'optional' as const
  },
  wrapper: 'connected' as const
}

function bridge(overrides: Partial<MacManNativeBridge> = {}): MacManNativeBridge {
  return {
    applyWhatsAppConnection: vi.fn(),
    authorizeIMessage: vi.fn(),
    cancelModelLogin: vi.fn(),
    cancelWhatsAppConnection: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue({ available: false }),
    connectGmail: vi.fn(),
    exportData: vi.fn().mockResolvedValue({ canceled: false }),
    getChatConnection: vi.fn().mockResolvedValue({ authMode: 'token', wsUrl: 'ws://macman.test/ws' }),
    getConnectionCatalog: vi.fn().mockResolvedValue({ connections: [] }),
    getFreshChatConnection: vi.fn().mockResolvedValue({ ok: true, wsUrl: 'ws://macman.test/ws' }),
    getModelCatalog: vi.fn().mockResolvedValue({ connected: false, providers: [] }),
    openLogs: vi.fn().mockResolvedValue({ ok: true }),
    openModelProviderSetup: vi.fn(),
    openSystemSettings: vi.fn(),
    pickChatAttachments: vi.fn().mockResolvedValue([]),
    pickExcludedPaths: vi.fn().mockResolvedValue([]),
    pollModelLogin: vi.fn(),
    pollWhatsAppConnection: vi.fn(),
    requestPermission: vi.fn(),
    saveModelApiKey: vi.fn(),
    selectModel: vi.fn(),
    snapshot: vi.fn().mockResolvedValue(missingAccess),
    startModelLogin: vi.fn(),
    startWhatsAppConnection: vi.fn(),
    ...overrides
  }
}

afterEach(cleanup)

describe('MacMan wrapper root', () => {
  it('hydrates the standalone renderer from the native permission snapshot', async () => {
    const native = bridge()

    render(<MacManRoot bridge={native} />)

    expect(await screen.findByText('Wrapper connected')).toBeTruthy()
    expect(screen.getByText('1 of 2 ready')).toBeTruthy()
    expect(native.snapshot).toHaveBeenCalledOnce()
  })

  it('uses the returned native snapshot after a grant instead of updating optimistically', async () => {
    const granted = {
      ...missingAccess,
      permissions: { ...missingAccess.permissions, accessibility: 'granted' as const }
    }

    const native = bridge({ requestPermission: vi.fn().mockResolvedValue(granted) })

    render(<MacManRoot bridge={native} />)
    await screen.findByText('Wrapper connected')
    fireEvent.click(screen.getByRole('button', { name: 'Grant Accessibility' }))

    expect(native.requestPermission).toHaveBeenCalledWith('accessibility')

    await waitFor(() => expect(screen.getByText('Computer control ready')).toBeTruthy())
  })

  it('stays usable and visibly disconnected when the preload bridge is unavailable', async () => {
    render(<MacManRoot bridge={null} />)

    expect(screen.getByText('Wrapper not connected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Grant Accessibility' }))
    expect(screen.getAllByText('Needs access').length).toBeGreaterThan(0)
  })

  it('refreshes permission truth when the window regains focus', async () => {
    const native = bridge()

    render(<MacManRoot bridge={native} />)
    await screen.findByText('Wrapper connected')
    window.dispatchEvent(new Event('focus'))

    await waitFor(() => expect(native.snapshot).toHaveBeenCalledTimes(2))
  })

  it('does not let a stale launch snapshot overwrite a newer focus refresh', async () => {
    let resolveLaunch: ((snapshot: typeof missingAccess) => void) | undefined

    const ready = {
      ...missingAccess,
      permissions: { ...missingAccess.permissions, accessibility: 'granted' as const }
    }

    const native = bridge({
      snapshot: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<typeof missingAccess>(resolve => {
              resolveLaunch = resolve
            })
        )
        .mockResolvedValueOnce(ready)
    })

    render(<MacManRoot bridge={native} />)
    await waitFor(() => expect(native.snapshot).toHaveBeenCalledOnce())
    window.dispatchEvent(new Event('focus'))

    expect(await screen.findByText('Computer control ready')).toBeTruthy()

    resolveLaunch?.(missingAccess)
    await Promise.resolve()

    expect(screen.getByText('Computer control ready')).toBeTruthy()
  })

  it('routes command settings through the narrow native bridge', async () => {
    const native = bridge({
      getConnectionCatalog: vi.fn().mockResolvedValue({
        connections: [
          {
            capabilities: ['read', 'search', 'send'],
            id: 'imessage',
            name: 'iMessage',
            status: 'needs-permission'
          }
        ]
      })
    })

    render(<MacManRoot bridge={native} />)
    await screen.findByText('Wrapper connected')
    fireEvent.click(screen.getByRole('button', { name: 'General' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(native.checkForUpdates).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole('button', { name: 'Connections' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Set up iMessage' }))
    await waitFor(() => expect(native.authorizeIMessage).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open logs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export MacMan data' }))
    await waitFor(() => {
      expect(native.openLogs).toHaveBeenCalledOnce()
      expect(native.exportData).toHaveBeenCalledOnce()
    })
  })
})
