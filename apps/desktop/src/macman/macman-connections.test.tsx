import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MacManConnections } from './macman-connections'
import type { MacManConnectionCatalog, MacManNativeBridge } from './native-contract'

vi.mock('qrcode', () => ({
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,macman-qr')
}))

const catalog: MacManConnectionCatalog = {
  connections: [
    {
      capabilities: ['read', 'search', 'send', 'attachments'],
      detail: 'Scan one QR code to link this Mac.',
      id: 'whatsapp',
      name: 'WhatsApp',
      status: 'ready'
    },
    {
      capabilities: ['read', 'search', 'send', 'attachments', 'reactions'],
      detail: 'Automation permission is still required.',
      id: 'imessage',
      name: 'iMessage',
      status: 'needs-permission'
    },
    {
      account: 'arv@gmail.com',
      capabilities: ['read', 'search', 'send', 'attachments'],
      id: 'gmail',
      name: 'Gmail',
      status: 'connected'
    }
  ]
}

type ConnectionsBridge = Pick<
  MacManNativeBridge,
  | 'applyWhatsAppConnection'
  | 'authorizeIMessage'
  | 'cancelWhatsAppConnection'
  | 'connectGmail'
  | 'getConnectionCatalog'
  | 'pollWhatsAppConnection'
  | 'startWhatsAppConnection'
>

function bridge(overrides: Partial<ConnectionsBridge> = {}): ConnectionsBridge {
  return {
    applyWhatsAppConnection: vi.fn(),
    authorizeIMessage: vi.fn(),
    cancelWhatsAppConnection: vi.fn(),
    connectGmail: vi.fn(),
    getConnectionCatalog: vi.fn().mockResolvedValue(catalog),
    pollWhatsAppConnection: vi.fn(),
    startWhatsAppConnection: vi.fn(),
    ...overrides
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('MacMan first-class connections', () => {
  it('renders authoritative state and capability coverage for every bundled connection', async () => {
    const native = bridge()
    render(<MacManConnections bridge={native} />)

    expect(await screen.findByRole('heading', { name: 'Your connections' })).toBeTruthy()
    expect(screen.getByText('WhatsApp')).toBeTruthy()
    expect(screen.getByText('iMessage')).toBeTruthy()
    expect(screen.getByText('Gmail')).toBeTruthy()
    expect(screen.getByText('arv@gmail.com')).toBeTruthy()
    expect(screen.getAllByText('Search').length).toBe(3)
    expect(screen.getByText('Needs permission')).toBeTruthy()
    expect(screen.getByText('Connected')).toBeTruthy()
  })

  it('pairs WhatsApp with one QR flow, applies it once, and refreshes truth', async () => {
    const native = bridge({
      getConnectionCatalog: vi.fn().mockResolvedValue(catalog),
      pollWhatsAppConnection: vi.fn().mockResolvedValue({ pairingId: 'pair-1', status: 'connected' }),
      startWhatsAppConnection: vi.fn().mockResolvedValue({
        expiresAt: '2026-09-10T08:10:00.000Z',
        pairingId: 'pair-1',
        qrPayload: 'qr-payload',
        status: 'waiting'
      })
    })

    render(<MacManConnections bridge={native} pollIntervalMs={1} />)
    await screen.findByText('WhatsApp')
    fireEvent.click(screen.getByRole('button', { name: 'Connect WhatsApp' }))

    expect(await screen.findByRole('dialog', { name: 'Connect WhatsApp' })).toBeTruthy()
    expect((await screen.findByAltText('WhatsApp pairing code')).getAttribute('src')).toBe(
      'data:image/png;base64,macman-qr'
    )

    await waitFor(() => expect(native.applyWhatsAppConnection).toHaveBeenCalledWith('pair-1'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Connect WhatsApp' })).toBeNull())
    expect(native.getConnectionCatalog).toHaveBeenCalledTimes(2)
  })

  it('cancels an unfinished WhatsApp pairing when the user closes it', async () => {
    const native = bridge({
      pollWhatsAppConnection: vi.fn().mockResolvedValue({ pairingId: 'pair-1', status: 'waiting' }),
      startWhatsAppConnection: vi.fn().mockResolvedValue({ pairingId: 'pair-1', qrPayload: 'qr', status: 'waiting' })
    })

    render(<MacManConnections bridge={native} pollIntervalMs={10_000} />)
    await screen.findByText('WhatsApp')
    fireEvent.click(screen.getByRole('button', { name: 'Connect WhatsApp' }))
    await screen.findByRole('dialog', { name: 'Connect WhatsApp' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel WhatsApp setup' }))

    await waitFor(() => expect(native.cancelWhatsAppConnection).toHaveBeenCalledWith('pair-1'))
  })

  it('starts iMessage authorization only from the explicit setup button', async () => {
    const native = bridge()
    render(<MacManConnections bridge={native} />)

    await screen.findByText('iMessage')
    expect(native.authorizeIMessage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Set up iMessage' }))

    await waitFor(() => expect(native.authorizeIMessage).toHaveBeenCalledOnce())
  })

  it('collects the Gmail identity before opening least-privilege Google sign-in', async () => {
    const disconnectedCatalog: MacManConnectionCatalog = {
      connections: catalog.connections.map(connection =>
        connection.id === 'gmail' ? { ...connection, account: undefined, status: 'ready' } : connection
      )
    }
    const native = bridge({ getConnectionCatalog: vi.fn().mockResolvedValue(disconnectedCatalog) })
    render(<MacManConnections bridge={native} />)

    await screen.findByText('Gmail')
    fireEvent.click(screen.getByRole('button', { name: 'Connect Gmail' }))
    fireEvent.change(screen.getByLabelText('Google account email'), { target: { value: 'ARV@GMAIL.COM' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))

    await waitFor(() => expect(native.connectGmail).toHaveBeenCalledWith('arv@gmail.com'))
  })
})
