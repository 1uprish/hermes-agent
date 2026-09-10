import { describe, expect, it, vi } from 'vitest'

import { createMacManChatClient, type MacManChatSnapshot, type MacManChatTransport } from './macman-chat-client'

describe('MacMan chat session continuity', () => {
  it('accepts another message while work is running and records the gateway route', async () => {
    const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
    const transport: MacManChatTransport = {
      close: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(() => () => undefined),
      request: async <T>(method: string, params?: Record<string, unknown>) => {
        requests.push({ method, params })

        if (method === 'session.list') {
          return { sessions: [{ id: 'stored-chat', title: 'MacMan Chat' }] } as T
        }

        if (method === 'session.resume') {
          return {
            inflight: { assistant: 'Working…', streaming: true, user: 'Fix reconnect' },
            messages: [],
            running: true,
            session_id: 'runtime-chat'
          } as T
        }

        if (method === 'prompt.dispatch') {
          return {
            client_message_id: params?.client_message_id,
            confidence: 1,
            dispatch_id: 'dispatch-1',
            reason_code: 'explicit_parallel',
            route: 'parallel',
            state: 'running',
            task_id: 'bg-1'
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

    await client.connect()
    expect(client.getSnapshot().busy).toBe(true)

    await client.send('Meanwhile find flights to Tokyo')

    expect(requests.at(-1)).toEqual({
      method: 'prompt.dispatch',
      params: {
        client_message_id: expect.stringMatching(/^macman-/),
        session_id: 'runtime-chat',
        text: 'Meanwhile find flights to Tokyo'
      }
    })
    expect(client.getSnapshot().messages.at(-1)).toMatchObject({
      dispatch: { route: 'parallel', state: 'running', taskId: 'bg-1' },
      role: 'user',
      text: 'Meanwhile find flights to Tokyo'
    })
  })

  it('projects sanitized live work events and an independent background result', async () => {
    let emit: ((event: { payload?: Record<string, unknown>; session_id?: string; type: string }) => void) | undefined
    const transport: MacManChatTransport = {
      close: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(handler => {
        emit = handler

        return () => undefined
      }),
      request: vi.fn(async (method: string) => {
        if (method === 'session.list') {
          return { sessions: [{ id: 'stored-chat', title: 'MacMan Chat' }] }
        }

        return { messages: [], session_id: 'runtime-chat' }
      }) as MacManChatTransport['request']
    }
    const client = createMacManChatClient(
      {
        getChatConnection: vi.fn().mockResolvedValue({ authMode: 'token', wsUrl: 'ws://macman.test/ws' }),
        getFreshChatConnection: vi.fn()
      },
      () => transport
    )

    await client.connect()
    emit?.({
      payload: { args: { token: 'do-not-render' }, context: 'Opening the signed-in browser', name: 'browser_navigate', tool_call_id: 'tool-1' },
      session_id: 'runtime-chat',
      type: 'tool.start'
    })
    emit?.({
      payload: { kind: 'process', text: 'Checking the page' },
      session_id: 'runtime-chat',
      type: 'status.update'
    })
    emit?.({
      payload: { task_id: 'bg-1', text: 'Flights are ready.' },
      session_id: 'runtime-chat',
      type: 'background.complete'
    })

    expect(client.getSnapshot().activities).toEqual([
      expect.objectContaining({ id: 'tool-1', label: 'Opening the signed-in browser', state: 'running' }),
      expect.objectContaining({ label: 'Checking the page', state: 'running' })
    ])
    expect(JSON.stringify(client.getSnapshot())).not.toContain('do-not-render')
    expect(client.getSnapshot().messages.at(-1)).toMatchObject({
      role: 'assistant',
      taskId: 'bg-1',
      text: 'Flights are ready.'
    })
  })

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

  it('switches the live continuous session and remembers which model exhausted its limit', async () => {
    let emit: ((event: { payload?: Record<string, unknown>; session_id?: string; type: string }) => void) | undefined

    const transport: MacManChatTransport = {
      close: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(handler => {
        emit = handler

        return () => undefined
      }),
      request: vi.fn(async (method: string) => {
        if (method === 'session.list') {
          return { sessions: [{ id: 'stored-chat', title: 'MacMan Chat' }] }
        }

        if (method === 'session.resume') {
          return {
            info: { model: 'gpt-5.5', provider: 'openai-codex' },
            messages: [],
            session_id: 'runtime-chat'
          }
        }

        return { confirm_required: false, value: 'deepseek-v4-pro' }
      }) as MacManChatTransport['request']
    }

    const client = createMacManChatClient(
      {
        getChatConnection: vi.fn().mockResolvedValue({ authMode: 'token', wsUrl: 'ws://macman.test/ws' }),
        getFreshChatConnection: vi.fn()
      },
      () => transport
    )

    await client.connect()
    emit?.({
      payload: { error: 'HTTP 429: The usage limit has been reached', status: 'error' },
      session_id: 'runtime-chat',
      type: 'message.complete'
    })

    expect(client.getSnapshot().limitedModels).toEqual({
      'openai-codex:gpt-5.5': {
        kind: 'exhausted',
        message: 'HTTP 429: The usage limit has been reached',
        model: 'gpt-5.5',
        provider: 'openai-codex'
      }
    })

    await client.switchModel('deepseek', 'deepseek-v4-pro')

    expect(transport.request).toHaveBeenLastCalledWith('config.set', {
      key: 'model',
      session_id: 'runtime-chat',
      value: 'deepseek-v4-pro --provider deepseek --session'
    })
    expect(client.getSnapshot().activeModel).toEqual({ model: 'deepseek-v4-pro', provider: 'deepseek' })
  })

  it('reconnects to the durable session after the chat view is left and reopened', async () => {
    const transport: MacManChatTransport = {
      close: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(() => () => undefined),
      request: vi.fn(async (method: string) => {
        if (method === 'session.list') {
          return { sessions: [{ id: 'stored-chat', title: 'MacMan Chat' }] }
        }

        return { messages: [], session_id: 'runtime-chat' }
      }) as MacManChatTransport['request']
    }

    const client = createMacManChatClient(
      {
        getChatConnection: vi.fn().mockResolvedValue({ authMode: 'token', wsUrl: 'ws://macman.test/ws' }),
        getFreshChatConnection: vi.fn()
      },
      () => transport
    )

    await client.connect()
    client.dispose()
    expect(client.getSnapshot().status).toBe('connecting')

    await client.connect()

    expect(transport.connect).toHaveBeenCalledTimes(2)
    expect(transport.request).toHaveBeenCalledWith('session.resume', {
      cols: 96,
      session_id: 'stored-chat'
    })
    expect(client.getSnapshot().status).toBe('ready')
  })

  it('does not finish a stale connection after the chat view is closed', async () => {
    let finishConnect: (() => void) | undefined

    const transport: MacManChatTransport = {
      close: vi.fn(),
      connect: vi.fn(
        () =>
          new Promise<void>(resolve => {
            finishConnect = resolve
          })
      ),
      onEvent: vi.fn(() => () => undefined),
      request: vi.fn()
    }

    const client = createMacManChatClient(
      {
        getChatConnection: vi.fn().mockResolvedValue({ authMode: 'token', wsUrl: 'ws://macman.test/ws' }),
        getFreshChatConnection: vi.fn()
      },
      () => transport
    )

    const pending = client.connect()
    await vi.waitFor(() => expect(transport.connect).toHaveBeenCalledOnce())
    client.dispose()
    finishConnect?.()
    await pending

    expect(transport.close).toHaveBeenCalledOnce()
    expect(transport.request).not.toHaveBeenCalled()
    expect(client.getSnapshot().status).toBe('connecting')
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
