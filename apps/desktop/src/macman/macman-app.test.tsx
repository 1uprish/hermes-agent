import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MacManApp, type MacManSnapshot } from './macman-app'

const snapshot: MacManSnapshot = {
  model: 'not-connected',
  permissions: {
    accessibility: 'not-granted',
    screenRecording: 'granted',
    microphone: 'ask-when-used',
    notifications: 'ask-when-used',
    calendar: 'ask-when-used',
    reminders: 'ask-when-used',
    contacts: 'ask-when-used',
    automation: 'per-app',
    fullDiskAccess: 'optional',
    location: 'optional'
  }
}

afterEach(cleanup)

describe('standalone MacMan frontend', () => {
  it('opens on a setup dashboard that explains every access level and status', () => {
    render(<MacManApp snapshot={snapshot} />)

    expect(screen.getByRole('heading', { name: 'Set up MacMan' })).toBeTruthy()
    expect(screen.getByText('Required for computer control')).toBeTruthy()
    expect(screen.getByText('Accessibility')).toBeTruthy()
    expect(screen.getByText('Screen & System Audio Recording')).toBeTruthy()
    expect(screen.getByText('Recommended as you use MacMan')).toBeTruthy()
    expect(screen.getByText('Microphone')).toBeTruthy()
    expect(screen.getByText('Optional capabilities')).toBeTruthy()
    expect(screen.getByText('Full Disk Access')).toBeTruthy()
  })

  it('requests permission without pretending the permission was granted', () => {
    const onRequestPermission = vi.fn()
    render(<MacManApp onRequestPermission={onRequestPermission} snapshot={snapshot} />)

    fireEvent.click(screen.getByRole('button', { name: 'Grant Accessibility' }))

    expect(onRequestPermission).toHaveBeenCalledWith('accessibility')
    expect(screen.getByText('Needs access')).toBeTruthy()
  })

  it('exposes the complete settings map without importing the Hermes settings UI', () => {
    render(<MacManApp initialView="general" snapshot={snapshot} />)

    expect(screen.getByRole('heading', { name: 'General' })).toBeTruthy()
    expect(screen.getByText('Launch MacMan at login')).toBeTruthy()
    expect(screen.getByText('Menu bar access')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Privacy & Safety' }))

    expect(screen.getByRole('heading', { name: 'Privacy & Safety' })).toBeTruthy()
    expect(screen.getByText('Approval level')).toBeTruthy()
    expect(screen.getByText('Excluded apps and folders')).toBeTruthy()
    expect(screen.getByText('Activity history')).toBeTruthy()
  })

  it('shows computer control as ready only when both required grants are present', () => {
    const { rerender } = render(<MacManApp snapshot={snapshot} />)
    expect(screen.getByText('1 of 2 ready')).toBeTruthy()

    rerender(
      <MacManApp
        snapshot={{
          ...snapshot,
          permissions: { ...snapshot.permissions, accessibility: 'granted' }
        }}
      />
    )

    expect(screen.getByText('Computer control ready')).toBeTruthy()
  })
})
