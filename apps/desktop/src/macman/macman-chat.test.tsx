import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MacManChat } from './macman-chat'
import type { MacManChatClient, MacManChatSnapshot } from './macman-chat-client'

const readySnapshot: MacManChatSnapshot = {
  busy: false,
  error: undefined,
  messages: [
    { id: 'user-1', role: 'user', text: 'Remember this conversation.' },
    { id: 'assistant-1', role: 'assistant', text: 'I will keep this chat together.' }
  ],
  status: 'ready'
}

function fakeClient() {
  let listener: ((snapshot: MacManChatSnapshot) => void) | undefined

  const client: MacManChatClient = {
    connect: vi.fn(async () => listener?.(readySnapshot)),
    dispose: vi.fn(),
    getSnapshot: vi.fn(() => ({ busy: false, messages: [], status: 'connecting' })),
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

afterEach(cleanup)

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
})
