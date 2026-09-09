import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MacManPermissionSnapshot } from '@/store/macman-setup'

import { MacManSetupCenter } from './macman-setup'

const missingAccess: MacManPermissionSnapshot = {
  permissions: { accessibility: false, screenRecording: false },
  state: 'permission-required',
  supported: true
}

const readyAccess: MacManPermissionSnapshot = {
  permissions: { accessibility: true, screenRecording: true },
  state: 'running',
  supported: true
}

afterEach(cleanup)

describe('MacMan Setup Center', () => {
  it('shows core readiness and keeps optional permissions contextual', () => {
    render(
      <MacManSetupCenter
        loading={false}
        modelReady={false}
        mode="onboarding"
        onComplete={vi.fn()}
        onGrantAccess={vi.fn()}
        onOpenProvider={vi.fn()}
        onRefresh={vi.fn()}
        snapshot={missingAccess}
      />
    )

    expect(screen.getByRole('heading', { name: 'Set up MacMan' })).toBeTruthy()
    expect(screen.getByText('Model')).toBeTruthy()
    expect(screen.getByText('Accessibility')).toBeTruthy()
    expect(screen.getByText('Screen & System Audio Recording')).toBeTruthy()
    expect(screen.getByText('Microphone')).toBeTruthy()
    expect(screen.getByText('Notifications')).toBeTruthy()
    expect(screen.getAllByText('Asked when used').length).toBeGreaterThanOrEqual(2)
  })

  it('opens provider setup and retries host-owned permissions from their rows', () => {
    const onGrantAccess = vi.fn()
    const onOpenProvider = vi.fn()

    render(
      <MacManSetupCenter
        loading={false}
        modelReady={false}
        mode="onboarding"
        onComplete={vi.fn()}
        onGrantAccess={onGrantAccess}
        onOpenProvider={onOpenProvider}
        onRefresh={vi.fn()}
        snapshot={missingAccess}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Connect model' }))
    fireEvent.click(screen.getByRole('button', { name: 'Grant Mac access' }))

    expect(onOpenProvider).toHaveBeenCalledOnce()
    expect(onGrantAccess).toHaveBeenCalledOnce()
  })

  it('finishes full setup when model and computer control are ready', () => {
    const onComplete = vi.fn()

    render(
      <MacManSetupCenter
        loading={false}
        modelReady
        mode="onboarding"
        onComplete={onComplete}
        onGrantAccess={vi.fn()}
        onOpenProvider={vi.fn()}
        onRefresh={vi.fn()}
        snapshot={readyAccess}
      />
    )

    expect(screen.getByText('Ready to chat and control this Mac')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('allows a configured model to continue without computer control', () => {
    const onComplete = vi.fn()

    render(
      <MacManSetupCenter
        loading={false}
        modelReady
        mode="onboarding"
        onComplete={onComplete}
        onGrantAccess={vi.fn()}
        onOpenProvider={vi.fn()}
        onRefresh={vi.fn()}
        snapshot={missingAccess}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Continue with chat only' }))
    expect(onComplete).toHaveBeenCalledOnce()
  })
})
