import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MacManNativeBridge } from './native-contract'
import { MacManRoot } from './macman-root'

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

afterEach(cleanup)

describe('MacMan wrapper root', () => {
  it('hydrates the standalone renderer from the native permission snapshot', async () => {
    const bridge: MacManNativeBridge = {
      openSystemSettings: vi.fn(),
      requestPermission: vi.fn(),
      snapshot: vi.fn().mockResolvedValue(missingAccess)
    }

    render(<MacManRoot bridge={bridge} />)

    expect(await screen.findByText('Wrapper connected')).toBeTruthy()
    expect(screen.getByText('1 of 2 ready')).toBeTruthy()
    expect(bridge.snapshot).toHaveBeenCalledOnce()
  })

  it('uses the returned native snapshot after a grant instead of updating optimistically', async () => {
    const granted = {
      ...missingAccess,
      permissions: { ...missingAccess.permissions, accessibility: 'granted' as const }
    }
    const bridge: MacManNativeBridge = {
      openSystemSettings: vi.fn(),
      requestPermission: vi.fn().mockResolvedValue(granted),
      snapshot: vi.fn().mockResolvedValue(missingAccess)
    }

    render(<MacManRoot bridge={bridge} />)
    await screen.findByText('Wrapper connected')
    fireEvent.click(screen.getByRole('button', { name: 'Grant Accessibility' }))

    expect(bridge.requestPermission).toHaveBeenCalledWith('accessibility')
    await waitFor(() => expect(screen.getByText('Computer control ready')).toBeTruthy())
  })

  it('stays usable and visibly disconnected when the preload bridge is unavailable', async () => {
    render(<MacManRoot bridge={null} />)

    expect(screen.getByText('Wrapper not connected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Grant Accessibility' }))
    expect(screen.getAllByText('Needs access').length).toBeGreaterThan(0)
  })

  it('refreshes permission truth when the window regains focus', async () => {
    const bridge: MacManNativeBridge = {
      openSystemSettings: vi.fn(),
      requestPermission: vi.fn(),
      snapshot: vi.fn().mockResolvedValue(missingAccess)
    }

    render(<MacManRoot bridge={bridge} />)
    await screen.findByText('Wrapper connected')
    window.dispatchEvent(new Event('focus'))

    await waitFor(() => expect(bridge.snapshot).toHaveBeenCalledTimes(2))
  })

  it('does not let a stale launch snapshot overwrite a newer focus refresh', async () => {
    let resolveLaunch: ((snapshot: typeof missingAccess) => void) | undefined
    const ready = {
      ...missingAccess,
      permissions: { ...missingAccess.permissions, accessibility: 'granted' as const }
    }
    const bridge: MacManNativeBridge = {
      openSystemSettings: vi.fn(),
      requestPermission: vi.fn(),
      snapshot: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<typeof missingAccess>(resolve => {
              resolveLaunch = resolve
            })
        )
        .mockResolvedValueOnce(ready)
    }

    render(<MacManRoot bridge={bridge} />)
    await waitFor(() => expect(bridge.snapshot).toHaveBeenCalledOnce())
    window.dispatchEvent(new Event('focus'))
    expect(await screen.findByText('Computer control ready')).toBeTruthy()

    resolveLaunch?.(missingAccess)
    await Promise.resolve()
    expect(screen.getByText('Computer control ready')).toBeTruthy()
  })
})
