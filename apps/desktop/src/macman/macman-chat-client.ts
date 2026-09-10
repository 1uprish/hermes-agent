import type { MacManChatConnection, MacManFreshChatConnection } from './native-contract'

const MACMAN_CHAT_TITLE = 'MacMan Chat'

export interface MacManChatMessage {
  id: string
  role: 'assistant' | 'user'
  text: string
}

export interface MacManChatSnapshot {
  busy: boolean
  error?: string
  messages: MacManChatMessage[]
  status: 'connecting' | 'error' | 'ready'
}

export interface MacManChatClient {
  connect(): Promise<void>
  dispose(): void
  getSnapshot(): MacManChatSnapshot
  retry(): Promise<void>
  send(text: string): Promise<void>
  subscribe(listener: (snapshot: MacManChatSnapshot) => void): () => void
}

interface MacManGatewayHost {
  getChatConnection(): Promise<MacManChatConnection>
  getFreshChatConnection(): Promise<MacManFreshChatConnection>
}

interface MacManGatewayEvent {
  payload?: Record<string, unknown>
  session_id?: string
  type: string
}

export interface MacManChatTransport {
  close(): void
  connect(wsUrl: string): Promise<void>
  onDisconnect?(handler: (message: string) => void): () => void
  onEvent(handler: (event: MacManGatewayEvent) => void): () => void
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>
}

export type MacManChatTransportFactory = () => MacManChatTransport

type PendingRequest = {
  reject(error: Error): void
  resolve(value: unknown): void
  timer: ReturnType<typeof setTimeout>
}

class MacManWebSocketTransport implements MacManChatTransport {
  private disconnectHandlers = new Set<(message: string) => void>()
  private eventHandlers = new Set<(event: MacManGatewayEvent) => void>()
  private nextRequestId = 0
  private pending = new Map<string, PendingRequest>()
  private socket?: WebSocket

  async connect(wsUrl: string): Promise<void> {
    let url: URL

    try {
      url = new URL(wsUrl)
    } catch {
      throw new Error('MacMan received an invalid chat connection.')
    }

    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      throw new Error('MacMan received an invalid chat connection.')
    }

    const socket = new WebSocket(wsUrl)
    this.socket = socket

    socket.addEventListener('message', event => this.handleMessage(event.data))
    socket.addEventListener('close', () => {
      if (this.socket !== socket) {
        return
      }

      this.socket = undefined
      this.rejectPending('MacMan lost its chat connection.')
      this.disconnectHandlers.forEach(handler => handler('MacMan lost its chat connection.'))
    })

    await new Promise<void>((resolve, reject) => {
      let settled = false

      const timer = setTimeout(() => {
        if (settled) {
          return
        }

        settled = true
        socket.close()
        reject(new Error('MacMan could not connect to its chat service.'))
      }, 15_000)

      const finish = (operation: () => void) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timer)
        socket.removeEventListener('open', onOpen)
        socket.removeEventListener('error', onError)
        operation()
      }

      const onOpen = () => finish(resolve)
      const onError = () => finish(() => reject(new Error('MacMan could not connect to its chat service.')))

      socket.addEventListener('open', onOpen)
      socket.addEventListener('error', onError)
    })
  }

  close(): void {
    const socket = this.socket
    this.socket = undefined
    socket?.close()
    this.rejectPending('MacMan closed its chat connection.')
  }

  onDisconnect(handler: (message: string) => void): () => void {
    this.disconnectHandlers.add(handler)

    return () => this.disconnectHandlers.delete(handler)
  }

  onEvent(handler: (event: MacManGatewayEvent) => void): () => void {
    this.eventHandlers.add(handler)

    return () => this.eventHandlers.delete(handler)
  }

  request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const socket = this.socket

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('MacMan chat is not connected.'))
    }

    const id = `macman-${++this.nextRequestId}`

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`MacMan chat timed out while running ${method}.`))
        }
      }, 120_000)

      this.pending.set(id, {
        reject,
        resolve: value => resolve(value as T),
        timer
      })

      try {
        socket.send(JSON.stringify({ id, jsonrpc: '2.0', method, params }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private handleMessage(raw: unknown): void {
    let frame: {
      error?: { message?: string }
      id?: null | number | string
      method?: string
      params?: MacManGatewayEvent
      result?: unknown
    }

    try {
      frame = JSON.parse(typeof raw === 'string' ? raw : String(raw))
    } catch {
      return
    }

    if (frame.id !== undefined && frame.id !== null) {
      const pending = this.pending.get(String(frame.id))

      if (!pending) {
        return
      }

      clearTimeout(pending.timer)
      this.pending.delete(String(frame.id))

      if (frame.error) {
        pending.reject(new Error(frame.error.message || 'MacMan chat request failed.'))
      } else {
        pending.resolve(frame.result)
      }

      return
    }

    if (frame.method === 'event' && frame.params?.type) {
      this.eventHandlers.forEach(handler => handler(frame.params as MacManGatewayEvent))
    }
  }

  private rejectPending(message: string): void {
    const error = new Error(message)

    this.pending.forEach(pending => {
      clearTimeout(pending.timer)
      pending.reject(error)
    })
    this.pending.clear()
  }
}

interface StoredSessionRow {
  id?: string
  resolved_id?: string
  root_title?: string
  title?: string
}

interface SessionMessage {
  content?: unknown
  display_content?: unknown
  role?: string
  row_id?: number
  text?: unknown
}

interface SessionStart {
  messages?: SessionMessage[]
  session_id: string
  stored_session_id?: string
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map(part => {
      if (typeof part === 'string') {
        return part
      }

      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        return part.text
      }

      return ''
    })
    .join('')
}

function visibleMessageText(message: SessionMessage): string {
  return textFromContent(message.display_content) || textFromContent(message.content) || textFromContent(message.text)
}

function hydrateMessages(messages: SessionMessage[] = []): MacManChatMessage[] {
  return messages.flatMap((message, index) => {
    if (message.role !== 'user' && message.role !== 'assistant') {
      return []
    }

    const text = visibleMessageText(message).trim()

    return text
      ? [{ id: `stored-${message.row_id ?? index}`, role: message.role, text } satisfies MacManChatMessage]
      : []
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class MacManChatGatewayClient implements MacManChatClient {
  private gateway?: MacManChatTransport
  private connectFlight?: Promise<void>
  private listeners = new Set<(snapshot: MacManChatSnapshot) => void>()
  private runtimeSessionId?: string
  private state: MacManChatSnapshot = { busy: false, messages: [], status: 'connecting' }
  private streamMessageId?: string

  constructor(
    private readonly host?: MacManGatewayHost,
    private readonly createTransport: MacManChatTransportFactory = () => new MacManWebSocketTransport()
  ) {}

  connect(): Promise<void> {
    if (this.state.status === 'ready') {
      return Promise.resolve()
    }

    if (this.connectFlight) {
      return this.connectFlight
    }

    this.publish({ ...this.state, error: undefined, status: 'connecting' })
    this.connectFlight = this.open().finally(() => {
      this.connectFlight = undefined
    })

    return this.connectFlight
  }

  dispose(): void {
    const gateway = this.gateway
    this.gateway = undefined
    this.runtimeSessionId = undefined
    this.streamMessageId = undefined
    gateway?.close()
  }

  getSnapshot(): MacManChatSnapshot {
    return this.state
  }

  async retry(): Promise<void> {
    this.dispose()
    await this.connect()
  }

  async send(text: string): Promise<void> {
    const prompt = text.trim()

    if (!prompt || !this.gateway || !this.runtimeSessionId || this.state.status !== 'ready' || this.state.busy) {
      return
    }

    this.streamMessageId = undefined
    this.publish({
      ...this.state,
      busy: true,
      error: undefined,
      messages: [...this.state.messages, { id: `user-${crypto.randomUUID()}`, role: 'user', text: prompt }]
    })

    try {
      await this.gateway.request('prompt.submit', { session_id: this.runtimeSessionId, text: prompt })
    } catch (error) {
      this.publish({ ...this.state, busy: false, error: errorMessage(error) })
    }
  }

  subscribe(listener: (snapshot: MacManChatSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)

    return () => this.listeners.delete(listener)
  }

  private appendAssistantDelta(text: string): void {
    if (!text) {
      return
    }

    if (!this.streamMessageId) {
      this.streamMessageId = `assistant-${crypto.randomUUID()}`
      this.publish({
        ...this.state,
        messages: [...this.state.messages, { id: this.streamMessageId, role: 'assistant', text }]
      })

      return
    }

    const streamMessageId = this.streamMessageId
    this.publish({
      ...this.state,
      messages: this.state.messages.map(message =>
        message.id === streamMessageId ? { ...message, text: message.text + text } : message
      )
    })
  }

  private completeAssistant(payload: Record<string, unknown>): void {
    const finalText = textFromContent(payload.text) || textFromContent(payload.rendered)

    if (finalText && !this.streamMessageId) {
      this.appendAssistantDelta(finalText)
    } else if (finalText && this.streamMessageId) {
      const streamMessageId = this.streamMessageId
      this.publish({
        ...this.state,
        messages: this.state.messages.map(message =>
          message.id === streamMessageId ? { ...message, text: finalText } : message
        )
      })
    }

    const failed = payload.status === 'error'
    this.streamMessageId = undefined
    this.publish({
      ...this.state,
      busy: false,
      error: failed ? textFromContent(payload.error) || 'MacMan could not finish that response.' : undefined
    })
  }

  private handleEvent(event: MacManGatewayEvent): void {
    if (!this.runtimeSessionId || event.session_id !== this.runtimeSessionId) {
      return
    }

    const payload = event.payload ?? {}

    if (event.type === 'message.start') {
      this.streamMessageId = undefined
      this.publish({ ...this.state, busy: true, error: undefined })
    } else if (event.type === 'message.delta') {
      this.appendAssistantDelta(textFromContent(payload.text))
    } else if (event.type === 'message.complete') {
      this.completeAssistant(payload)
    } else if (event.type === 'error') {
      this.streamMessageId = undefined
      this.publish({
        ...this.state,
        busy: false,
        error: textFromContent(payload.message) || textFromContent(payload.error) || 'MacMan hit an unexpected error.'
      })
    }
  }

  private async open(): Promise<void> {
    if (!this.host) {
      this.publish({ ...this.state, error: 'The MacMan chat service is not available.', status: 'error' })

      return
    }

    try {
      const connection = await this.host.getChatConnection()
      let wsUrl = connection.wsUrl

      if (connection.authMode === 'oauth') {
        const fresh = await this.host.getFreshChatConnection()
        const freshUrl = typeof fresh === 'string' ? fresh : fresh.wsUrl

        if (!freshUrl || (typeof fresh !== 'string' && !fresh.ok)) {
          throw new Error(
            (typeof fresh === 'string' ? undefined : fresh.error) || 'MacMan could not refresh its chat connection.'
          )
        }

        wsUrl = freshUrl
      }

      const gateway = this.createTransport()

      gateway.onEvent(event => this.handleEvent(event))
      gateway.onDisconnect?.(message => {
        if (this.gateway === gateway) {
          this.gateway = undefined
          this.runtimeSessionId = undefined
          this.publish({ ...this.state, busy: false, error: message, status: 'error' })
        }
      })
      await gateway.connect(wsUrl)
      this.gateway = gateway

      const listing = await gateway.request<{ sessions?: StoredSessionRow[] }>('session.list', {
        include_hidden: true,
        limit: 20,
        title: MACMAN_CHAT_TITLE
      })

      const stored = listing.sessions?.find(
        session => session.root_title === MACMAN_CHAT_TITLE || session.title === MACMAN_CHAT_TITLE
      )

      const session = stored?.id
        ? await gateway.request<SessionStart>('session.resume', {
            cols: 96,
            session_id: stored.resolved_id ?? stored.id
          })
        : await gateway.request<SessionStart>('session.create', {
            cols: 96,
            source: 'desktop',
            title: MACMAN_CHAT_TITLE
          })

      this.runtimeSessionId = session.session_id
      this.publish({
        busy: false,
        error: undefined,
        messages: hydrateMessages(session.messages),
        status: 'ready'
      })
    } catch (error) {
      this.gateway?.close()
      this.gateway = undefined
      this.publish({ ...this.state, busy: false, error: errorMessage(error), status: 'error' })
    }
  }

  private publish(next: MacManChatSnapshot): void {
    this.state = next
    this.listeners.forEach(listener => listener(next))
  }
}

export function createMacManChatClient(
  host?: MacManGatewayHost,
  createTransport?: MacManChatTransportFactory
): MacManChatClient {
  return new MacManChatGatewayClient(host, createTransport)
}
