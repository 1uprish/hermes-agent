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

  it('stages attachments before a busy send and forces the intact bundle into the queue', async () => {
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
          return { messages: [], running: true, session_id: 'runtime-chat' } as T
        }

        if (method === 'image.attach') {
          return { attached: true, path: params?.path, text: '[User attached image: design.png]' } as T
        }

        if (method === 'file.attach') {
          return { attached: true, ref_text: '@file:notes.txt' } as T
        }

        return {
          client_message_id: params?.client_message_id,
          route: 'queue',
          state: 'queued'
        } as T
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
    await client.send('Use these in the brief', [
      { kind: 'image', name: 'design.png', path: '/tmp/design.png' },
      { kind: 'file', name: 'notes.txt', path: '/tmp/notes.txt' }
    ])

    expect(requests.slice(-3)).toEqual([
      { method: 'image.attach', params: { path: '/tmp/design.png', session_id: 'runtime-chat' } },
      { method: 'file.attach', params: { name: 'notes.txt', path: '/tmp/notes.txt', session_id: 'runtime-chat' } },
      {
        method: 'prompt.dispatch',
        params: {
          client_message_id: expect.stringMatching(/^macman-/),
          requested_route: 'queue',
          session_id: 'runtime-chat',
          text: 'Use these in the brief\n\n[User attached image: design.png]\n@file:notes.txt'
        }
      }
    ])
    expect(client.getSnapshot().messages.at(-1)).toMatchObject({
      attachments: [{ name: 'design.png' }, { name: 'notes.txt' }],
      dispatch: { route: 'queue', state: 'queued' },
      text: 'Use these in the brief'
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
      expect.objectContaining({ label: 'Checking the page', state: 'running' }),
      expect.objectContaining({ id: 'bg-1', label: 'Parallel task finished', state: 'complete' })
    ])
    expect(JSON.stringify(client.getSnapshot())).not.toContain('do-not-render')
    expect(client.getSnapshot().messages.at(-1)).toMatchObject({
      role: 'assistant',
      taskId: 'bg-1',
      text: 'Flights are ready.'
    })
  })

  it('summarizes interim and todo events without exposing secrets or unbounded output', async () => {
    let emit: ((event: { payload?: Record<string, unknown>; session_id?: string; type: string }) => void) | undefined
    const transport: MacManChatTransport = {
      close: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(handler => {
        emit = handler

        return () => undefined
      }),
      request: vi.fn(async (method: string) =>
        method === 'session.list'
          ? { sessions: [{ id: 'stored-chat', title: 'MacMan Chat' }] }
          : { messages: [], session_id: 'runtime-chat' }
      ) as MacManChatTransport['request']
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
      payload: { text: `Checking account with Authorization: Bearer secret-token ${'x'.repeat(600)}` },
      session_id: 'runtime-chat',
      type: 'message.interim'
    })
    emit?.({
      payload: {
        revision: 3,
        todos: [
          { content: 'Open Messages', id: '1', status: 'completed' },
          { content: 'Send the note', id: '2', status: 'in_progress' }
        ]
      },
      session_id: 'runtime-chat',
      type: 'todo.updated'
    })

    const serialized = JSON.stringify(client.getSnapshot().activities)
    expect(serialized).not.toContain('secret-token')
    expect(serialized.length).toBeLessThan(700)
    expect(client.getSnapshot().activities).toEqual([
      expect.objectContaining({ id: 'interim-current', kind: 'status', state: 'running' }),
      expect.objectContaining({ id: 'todo-3', kind: 'task', label: '1 of 2 steps complete', state: 'running' })
    ])
  })

  it('interrupts foreground work and answers a pending approval through the runtime session', async () => {
    let emit: ((event: { payload?: Record<string, unknown>; session_id?: string; type: string }) => void) | undefined
    const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
    const transport: MacManChatTransport = {
      close: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
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
          return { messages: [], running: true, session_id: 'runtime-chat' } as T
        }

        return { status: 'resolved' } as T
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
    emit?.({
      payload: {
        choices: ['once', 'deny'],
        command: 'open -a Messages',
        description: 'Allow MacMan to control Messages',
        request_id: 'approval-1'
      },
      session_id: 'runtime-chat',
      type: 'approval.request'
    })

    expect(client.getSnapshot().pendingInput).toMatchObject({
      description: 'Allow MacMan to control Messages',
      kind: 'approval',
      requestId: 'approval-1'
    })

    await client.respondToInput('once')
    await client.interrupt()

    expect(requests.slice(-2)).toEqual([
      {
        method: 'approval.respond',
        params: { choice: 'once', request_id: 'approval-1', session_id: 'runtime-chat' }
      },
      { method: 'session.interrupt', params: { session_id: 'runtime-chat' } }
    ])
    expect(client.getSnapshot().pendingInput).toBeUndefined()
    expect(client.getSnapshot().busy).toBe(false)
  })

  it('restores pending clarification from session resume', async () => {
    const transport: MacManChatTransport = {
      close: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(() => () => undefined),
      request: vi.fn(async (method: string) => {
        if (method === 'session.list') {
          return { sessions: [{ id: 'stored-chat', title: 'MacMan Chat' }] }
        }

        return {
          messages: [],
          pending_clarify: {
            choices: ['Staging', 'Production'],
            question: 'Which deployment target?',
            request_id: 'clarify-1'
          },
          running: true,
          session_id: 'runtime-chat'
        }
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

    expect(client.getSnapshot().pendingInput).toEqual({
      choices: ['Staging', 'Production'],
      description: 'Which deployment target?',
      kind: 'clarify',
      requestId: 'clarify-1'
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
      method: 'prompt.dispatch',
      params: {
        client_message_id: expect.stringMatching(/^macman-/),
        session_id: 'runtime-chat',
        text: 'Next question'
      }
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

  it('automatically reconnects and retries an unacknowledged dispatch with the same client id', async () => {
    vi.useFakeTimers()
    const requests: Array<{ client: number; method: string; params?: Record<string, unknown> }> = []
    const disconnects: Array<((message: string) => void) | undefined> = []
    const transports = [0, 1].map(client => ({
      close: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      onDisconnect: vi.fn((handler: (message: string) => void) => {
        disconnects[client] = handler

        return () => undefined
      }),
      onEvent: vi.fn(() => () => undefined),
      request: vi.fn(async (method: string, params?: Record<string, unknown>) => {
        requests.push({ client, method, params })

        if (method === 'session.list') {
          return { sessions: [{ id: 'stored-chat', title: 'MacMan Chat' }] }
        }

        if (method === 'session.resume') {
          return { messages: [], session_id: 'runtime-chat' }
        }

        if (client === 0 && method === 'prompt.dispatch') {
          return new Promise(() => undefined)
        }

        return {
          client_message_id: params?.client_message_id,
          route: 'foreground',
          state: 'running'
        }
      })
    }))
    let nextTransport = 0
    const client = createMacManChatClient(
      {
        getChatConnection: vi.fn().mockResolvedValue({ authMode: 'token', wsUrl: 'ws://macman.test/ws' }),
        getFreshChatConnection: vi.fn()
      },
      () => transports[nextTransport++] as MacManChatTransport
    )

    try {
      await client.connect()
      const firstSend = client.send('Do not lose this')
      await vi.waitFor(() => expect(requests.filter(call => call.method === 'prompt.dispatch')).toHaveLength(1))
      const originalId = requests.find(call => call.method === 'prompt.dispatch')?.params?.client_message_id

      disconnects[0]?.('Connection dropped.')
      await vi.advanceTimersByTimeAsync(500)
      await vi.waitFor(() => expect(transports[1].connect).toHaveBeenCalledOnce())

      const dispatches = requests.filter(call => call.method === 'prompt.dispatch')
      expect(dispatches).toHaveLength(2)
      expect(dispatches[1].params?.client_message_id).toBe(originalId)
      expect(client.getSnapshot()).toMatchObject({ error: undefined, status: 'ready' })
      expect(client.getSnapshot().messages.filter(message => message.text === 'Do not lose this')).toHaveLength(1)
      void firstSend
    } finally {
      client.dispose()
      vi.useRealTimers()
    }
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
