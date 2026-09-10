import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MacManChat } from './macman-chat'
import type { MacManChatClient, MacManChatSnapshot } from './macman-chat-client'
import { MacManThinkingMark } from './macman-thinking-mark'

const readySnapshot: MacManChatSnapshot = {
  busy: false,
  error: undefined,
  messages: [
    { id: 'user-1', role: 'user', text: 'Remember this conversation.' },
    { id: 'assistant-1', role: 'assistant', text: 'I will keep this chat together.' }
  ],
  status: 'ready'
}

function fakeClient(connectedSnapshot = readySnapshot) {
  let listener: ((snapshot: MacManChatSnapshot) => void) | undefined

  const client: MacManChatClient = {
    connect: vi.fn(async () => listener?.(connectedSnapshot)),
    dispose: vi.fn(),
    getSnapshot: vi.fn(() => ({ busy: false, messages: [], status: 'connecting' as const })),
    retry: vi.fn(),
    send: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(next => {
      listener = next

      return () => {
        listener = undefined
      }
    })
  }

  return client
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MacMan continuous chat', () => {
  it('hydrates the durable conversation and submits the next turn through its own composer', async () => {
    const client = fakeClient()

    render(<MacManChat client={client} />)

    expect(await screen.findByText('I will keep this chat together.')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: 'Message MacMan' }), {
      target: { value: 'Continue from where we left off.' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(client.send).toHaveBeenCalledWith('Continue from where we left off.'))
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message MacMan' }).value).toBe('')
  })

  it('uses the MacMan mark as an accessible thinking state', async () => {
    const client = fakeClient({ ...readySnapshot, busy: true })

    const { container } = render(<MacManChat client={client} />)
    const indicator = await screen.findByRole('status', { name: 'MacMan is thinking' })

    expect(indicator.querySelector('img')?.getAttribute('src')).toBe('./macman-mark-transparent.png')
    expect(container.querySelector('.mm-chat-thinking span')).toBeNull()
  })

  it('starts the particle canvas when the cached mark loads immediately', async () => {
    const pixels = new Uint8ClampedArray(48 * 48 * 4)

    for (let y = 12; y < 36; y += 1) {
      for (let x = 12; x < 36; x += 1) {
        const offset = (y * 48 + x) * 4
        pixels[offset] = 255
        pixels[offset + 1] = 255
        pixels[offset + 2] = 255
        pixels[offset + 3] = 255
      }
    }

    const context = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fill: vi.fn(),
      fillStyle: '',
      getImageData: vi.fn(() => ({ data: pixels })),
      globalAlpha: 1,
      setTransform: vi.fn()
    }

    class CachedImage {
      decoding = ''
      onload: (() => void) | null = null

      set src(_value: string) {
        this.onload?.()
      }
    }

    vi.stubGlobal('Image', CachedImage)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)

    const { container } = render(<MacManThinkingMark />)

    await waitFor(() => expect(container.querySelector('.mm-chat-thinking.is-ready')).toBeTruthy())
  })
})
