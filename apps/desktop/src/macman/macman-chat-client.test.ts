import { describe, expect, it, vi } from 'vitest'

import { createMacManChatClient, type MacManChatSnapshot, type MacManChatTransport } from './macman-chat-client'

describe('MacMan chat session continuity', () => {
  it('resumes the named durable chat and keeps later turns on its runtime session', async () => {
    const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
    let disconnect: ((message: string) => void) | undefined
    let emit: ((event: { payload?: Record<string, unknown>; session_id?: string; type: string }) => void) | undefined

    const transport: MacManChatTransport = {
      close: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      onDisconnect: vi.fn(handler => {
        disconnect = handler

        return () => undefined
      }),
      onEvent: vi.fn(handler => {
        emit = handler

        return () => undefined
      }),
      request: async <T>(method: string, params?: Record<string, unknown>) => {
        requests.push({ method, params })

        if (method === 'session.list') {
          return { sessions: [{ id: 'stored-chat', title: 'MacMan Chat' }] } as T
        }

        if (method === 'session.resume') {
          return {
            messages: [
              { content: 'Earlier question', role: 'user', row_id: 1 },
              { content: 'Earlier answer', role: 'assistant', row_id: 2 }
            ],
            session_id: 'runtime-chat'
          } as T
        }

        return {} as T
      }
    }

    const client = createMacManChatClient(
      {
        getChatConnection: vi.fn().mockResolvedValue({ authMode: 'token', wsUrl: 'ws://macman.test/ws' }),
        getFreshChatConnection: vi.fn()
      },
      () => transport
    )

    let latest: MacManChatSnapshot = client.getSnapshot()
    client.subscribe(snapshot => (latest = snapshot))

    await client.connect()

    expect(requests.map(request => request.method)).toEqual(['session.list', 'session.resume'])
    expect(latest.messages.map(message => message.text)).toEqual(['Earlier question', 'Earlier answer'])

    await client.send('Next question')
    expect(requests.at(-1)).toEqual({
      method: 'prompt.submit',
      params: { session_id: 'runtime-chat', text: 'Next question' }
    })

    emit?.({ payload: {}, session_id: 'runtime-chat', type: 'message.start' })
    emit?.({ payload: { text: 'Next ' }, session_id: 'runtime-chat', type: 'message.delta' })
    emit?.({
      payload: { text: 'Next answer', status: 'complete' },
      session_id: 'runtime-chat',
      type: 'message.complete'
    })

    expect(latest.busy).toBe(false)
    expect(latest.messages.at(-1)).toMatchObject({ role: 'assistant', text: 'Next answer' })

    disconnect?.('Connection dropped.')
    expect(latest).toMatchObject({ busy: false, error: 'Connection dropped.', status: 'error' })
  })

  it('fails visibly before opening a socket when the wrapper returns an invalid URL', async () => {
    const client = createMacManChatClient({
      getChatConnection: vi.fn().mockResolvedValue({ authMode: 'token', wsUrl: 'not-a-websocket' }),
      getFreshChatConnection: vi.fn()
    })

    await client.connect()

    expect(client.getSnapshot()).toMatchObject({
      busy: false,
      error: 'MacMan received an invalid chat connection.',
      status: 'error'
    })
  })
})
