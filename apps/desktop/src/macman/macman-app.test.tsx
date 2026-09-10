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
  },
  wrapper: 'disconnected'
}

afterEach(cleanup)

describe('standalone MacMan frontend', () => {
  it('opens on a setup dashboard that explains every access level and status', () => {
    const { container } = render(<MacManApp snapshot={snapshot} />)

    expect(screen.getByRole('heading', { name: 'Set up MacMan' })).toBeTruthy()
    expect(container.querySelector('.mm-brand-logo')?.getAttribute('src')).toBe('./macman-mark-transparent.png')
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

  it('routes every permission control to its explicit native owner', () => {
    const onOpenSystemSettings = vi.fn()
    const onRequestPermission = vi.fn()

    render(
      <MacManApp
        onOpenSystemSettings={onOpenSystemSettings}
        onRequestPermission={onRequestPermission}
        snapshot={snapshot}
      />
    )

    for (const name of [
      'Grant Accessibility',
      'Set up Microphone',
      'Set up Notifications'
    ]) {
      fireEvent.click(screen.getByRole('button', { name }))
    }

    expect(onRequestPermission).toHaveBeenCalledWith('accessibility')
    expect(onRequestPermission).toHaveBeenCalledWith('microphone')
    expect(onRequestPermission).toHaveBeenCalledWith('notifications')

    for (const [name, permission] of [
      ['Open Calendar settings', 'calendar'],
      ['Open Reminders settings', 'reminders'],
      ['Open Contacts settings', 'contacts'],
      ['Open App Automation settings', 'automation'],
      ['Open Full Disk Access settings', 'fullDiskAccess'],
      ['Open Location settings', 'location']
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(onOpenSystemSettings).toHaveBeenCalledWith(permission)
    }
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

  it('does not claim runtime health until the wrapper reports it', () => {
    const { rerender } = render(<MacManApp initialView="advanced" snapshot={snapshot} />)

    expect(screen.getByText('Not connected')).toBeTruthy()
    expect(screen.queryByText('Healthy')).toBeNull()

    rerender(<MacManApp initialView="advanced" snapshot={{ ...snapshot, wrapper: 'connected' }} />)
    expect(screen.getByText('Connected')).toBeTruthy()
  })

  it('keeps model choice available after a model is connected', () => {
    const onOpenModelSetup = vi.fn()

    render(
      <MacManApp
        onOpenModelSetup={onOpenModelSetup}
        snapshot={{ ...snapshot, model: 'connected', modelName: 'gpt-5.5', modelProvider: 'ChatGPT' }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Change model' }))
    expect(onOpenModelSetup).toHaveBeenCalledOnce()
    expect(screen.getByText('ChatGPT · gpt-5.5')).toBeTruthy()
  })

  it('routes every command-style settings button to a real owner', () => {
    const onSettingsAction = vi.fn()
    render(<MacManApp initialView="general" onSettingsAction={onSettingsAction} snapshot={snapshot} />)

    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(onSettingsAction).toHaveBeenCalledWith('check-updates')

    fireEvent.click(screen.getByRole('button', { name: 'Privacy & Safety' }))
    fireEvent.click(screen.getByRole('button', { name: 'Manage exclusions' }))
    expect(onSettingsAction).toHaveBeenCalledWith('manage-exclusions')

    fireEvent.click(screen.getByRole('button', { name: 'Connections' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set up Messages' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set up Calendar' }))
    expect(onSettingsAction).toHaveBeenCalledWith('connect-messages')
    expect(onSettingsAction).toHaveBeenCalledWith('connect-calendar')

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open logs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export MacMan data' }))
    expect(onSettingsAction).toHaveBeenCalledWith('open-logs')
    expect(onSettingsAction).toHaveBeenCalledWith('export-data')
  })

  it('gates the MacMan chat until setup is ready, then opens the chat instead of settings', () => {
    const chat = <section><h1>MacMan chat</h1></section>
    const { rerender } = render(<MacManApp chat={chat} snapshot={snapshot} />)

    expect(screen.queryByRole('button', { name: "Let's go to MacMan" })).toBeNull()
    expect(screen.getByRole('button', { name: 'Finish required permissions' }).hasAttribute('disabled')).toBe(true)

    rerender(
      <MacManApp
        chat={chat}
        snapshot={{
          ...snapshot,
          model: 'connected',
          permissions: { ...snapshot.permissions, accessibility: 'granted' }
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: "Let's go to MacMan" }))

    expect(screen.getByRole('heading', { name: 'MacMan chat' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'General' })).toBeNull()

    rerender(<MacManApp chat={chat} snapshot={snapshot} />)
    expect(screen.getByRole('heading', { name: 'Set up MacMan' })).toBeTruthy()
  })
})
