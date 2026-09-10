import type { MacManChatConnection, MacManFreshChatConnection } from './native-contract'

const MACMAN_CHAT_TITLE = 'MacMan Chat'

export interface MacManChatMessage {
  dispatch?: MacManDispatchReceipt
  id: string
  role: 'assistant' | 'user'
  taskId?: string
  text: string
}

export type MacManDispatchRoute = 'foreground' | 'parallel' | 'queue' | 'redirect' | 'steer'

export interface MacManDispatchReceipt {
  clientMessageId?: string
  dispatchId?: string
  route: MacManDispatchRoute | 'routing'
  state: 'failed' | 'queued' | 'routing' | 'running'
  taskId?: string
}

export interface MacManActivity {
  id: string
  kind: 'status' | 'task' | 'tool'
  label: string
  state: 'complete' | 'failed' | 'running'
}

export interface MacManPendingInput {
  choices?: string[]
  command?: string
  description: string
  envVar?: string
  kind: 'approval' | 'clarify' | 'secret' | 'sudo'
  requestId?: string
}

export interface MacManActiveModel {
  model: string
  provider: string
}

export interface MacManModelLimit {
  kind: 'exhausted' | 'rate-limited'
  message: string
  model: string
  provider: string
}

export interface MacManModelSwitchResult {
  confirmationMessage?: string
  confirmRequired: boolean
  deferred?: boolean
}

export interface MacManChatSnapshot {
  activeModel?: MacManActiveModel
  activities?: MacManActivity[]
  busy: boolean
  error?: string
  limitedModels?: Record<string, MacManModelLimit>
  messages: MacManChatMessage[]
  pendingInput?: MacManPendingInput
  status: 'connecting' | 'error' | 'ready'
}

export interface MacManChatClient {
  connect(): Promise<void>
  dispose(): void
  getSnapshot(): MacManChatSnapshot
  interrupt(): Promise<void>
  retry(): Promise<void>
  respondToInput(value: string): Promise<void>
  send(text: string): Promise<void>
  subscribe(listener: (snapshot: MacManChatSnapshot) => void): () => void
  switchModel(provider: string, model: string, confirmExpensiveModel?: boolean): Promise<MacManModelSwitchResult>
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

interface PendingDispatch {
  clientMessageId: string
  localMessageId: string
  text: string
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
  inflight?: {
    assistant?: string
    streaming?: boolean
    user?: string
  }
  info?: Record<string, unknown>
  messages?: SessionMessage[]
  pending_approval?: Record<string, unknown>
  pending_clarify?: Record<string, unknown>
  queued?: { user?: string }
  running?: boolean
  session_id: string
  stored_session_id?: string
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringChoices(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const choices = value.flatMap(choice => {
    const text = stringValue(choice)

    return text ? [text] : []
  })

  return choices.length ? choices : undefined
}

function pendingInput(
  kind: MacManPendingInput['kind'],
  payload: Record<string, unknown>
): MacManPendingInput | undefined {
  const requestId = stringValue(payload.request_id)

  if (kind === 'approval') {
    return {
      choices: stringChoices(payload.choices) ?? ['once', 'deny'],
      command: stringValue(payload.command),
      description: stringValue(payload.description) ?? 'MacMan needs your approval to continue.',
      kind,
      requestId
    }
  }

  if (kind === 'clarify') {
    const description = stringValue(payload.question)

    return description
      ? { choices: stringChoices(payload.choices), description, kind, requestId }
      : undefined
  }

  if (kind === 'sudo') {
    return { description: 'Enter your Mac password to continue.', kind, requestId }
  }

  const envVar = stringValue(payload.env_var)

  return {
    description: stringValue(payload.prompt) ?? (envVar ? `Enter ${envVar} to continue.` : 'Enter the requested secret to continue.'),
    envVar,
    kind,
    requestId
  }
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

function hydrateLiveMessages(session: SessionStart): MacManChatMessage[] {
  const messages = hydrateMessages(session.messages)
  const inflightUser = session.inflight?.user?.trim()
  const inflightAssistant = session.inflight?.assistant?.trim()
  const lastUser = [...messages].reverse().find(message => message.role === 'user')
  const lastAssistant = [...messages].reverse().find(message => message.role === 'assistant')

  if (inflightUser && lastUser?.text !== inflightUser) {
    messages.push({ id: 'live-inflight-user', role: 'user', text: inflightUser })
  }

  if (inflightAssistant && lastAssistant?.text !== inflightAssistant) {
    messages.push({ id: 'live-inflight-assistant', role: 'assistant', text: inflightAssistant })
  }

  const queuedUser = session.queued?.user?.trim()
  if (queuedUser) {
    messages.push({
      dispatch: { route: 'queue', state: 'queued' },
      id: 'live-queued-user',
      role: 'user',
      text: queuedUser
    })
  }

  return messages
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function modelSelection(value: unknown): MacManActiveModel | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const info = value as Record<string, unknown>
  const model = typeof info.model === 'string' ? info.model.trim() : ''
  const provider = typeof info.provider === 'string' ? info.provider.trim() : ''

  return model && provider ? { model, provider } : undefined
}

function modelKey(selection: MacManActiveModel): string {
  return `${selection.provider}:${selection.model}`
}

function modelLimitKind(message: string): MacManModelLimit['kind'] | undefined {
  if (/usage limit|out of credits|insufficient[_ ]quota|credit balance/i.test(message)) {
    return 'exhausted'
  }

  return /\b429\b|rate limit/i.test(message) ? 'rate-limited' : undefined
}

class MacManChatGatewayClient implements MacManChatClient {
  private gateway?: MacManChatTransport
  private connectFlight?: Promise<void>
  private connectionGeneration = 0
  private listeners = new Set<(snapshot: MacManChatSnapshot) => void>()
  private pendingDispatches = new Map<string, PendingDispatch>()
  private reconnectAttempt = 0
  private reconnectEnabled = false
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private runtimeSessionId?: string
  private state: MacManChatSnapshot = {
    activities: [],
    busy: false,
    limitedModels: {},
    messages: [],
    status: 'connecting'
  }
  private streamMessageId?: string

  constructor(
    private readonly host?: MacManGatewayHost,
    private readonly createTransport: MacManChatTransportFactory = () => new MacManWebSocketTransport()
  ) {}

  connect(): Promise<void> {
    if (this.state.status === 'ready' && this.gateway && this.runtimeSessionId) {
      return Promise.resolve()
    }

    if (this.connectFlight) {
      return this.connectFlight
    }

    this.publish({ ...this.state, error: undefined, status: 'connecting' })

    const generation = ++this.connectionGeneration

    const flight = this.open(generation).finally(() => {
      if (this.connectFlight === flight) {
        this.connectFlight = undefined
      }
    })

    this.connectFlight = flight

    return flight
  }

  dispose(): void {
    this.reconnectEnabled = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    this.connectionGeneration += 1
    this.connectFlight = undefined
    const gateway = this.gateway
    this.gateway = undefined
    this.runtimeSessionId = undefined
    this.streamMessageId = undefined
    gateway?.close()
    this.publish({ ...this.state, busy: false, error: undefined, status: 'connecting' })
  }

  getSnapshot(): MacManChatSnapshot {
    return this.state
  }

  async interrupt(): Promise<void> {
    if (!this.gateway || !this.runtimeSessionId || this.state.status !== 'ready') {
      return
    }

    await this.gateway.request('session.interrupt', { session_id: this.runtimeSessionId })
    this.streamMessageId = undefined
    this.publish({ ...this.state, busy: false, pendingInput: undefined })
  }

  async retry(): Promise<void> {
    this.dispose()
    await this.connect()
  }

  async respondToInput(value: string): Promise<void> {
    const input = this.state.pendingInput
    const response = value.trim()

    if (!input || !response || !this.gateway || !this.runtimeSessionId || this.state.status !== 'ready') {
      return
    }

    const common = {
      ...(input.requestId ? { request_id: input.requestId } : {}),
      session_id: this.runtimeSessionId
    }
    const requests: Record<MacManPendingInput['kind'], { method: string; params: Record<string, unknown> }> = {
      approval: { method: 'approval.respond', params: { choice: response, ...common } },
      clarify: { method: 'clarify.respond', params: { answer: response, ...common } },
      secret: { method: 'secret.respond', params: { value: response, ...common } },
      sudo: { method: 'sudo.respond', params: { password: response, ...common } }
    }
    const request = requests[input.kind]

    await this.gateway.request(request.method, request.params)

    if (this.state.pendingInput === input) {
      this.publish({ ...this.state, pendingInput: undefined })
    }
  }

  async send(text: string): Promise<void> {
    const prompt = text.trim()

    if (!prompt || !this.gateway || !this.runtimeSessionId || this.state.status !== 'ready') {
      return
    }

    const wasBusy = this.state.busy
    const clientMessageId = `macman-${crypto.randomUUID()}`
    const localMessageId = `user-${clientMessageId}`
    const pending = { clientMessageId, localMessageId, text: prompt }
    this.pendingDispatches.set(clientMessageId, pending)
    this.publish({
      ...this.state,
      busy: true,
      error: undefined,
      messages: [
        ...this.state.messages,
        {
          dispatch: { clientMessageId, route: 'routing', state: 'routing' },
          id: localMessageId,
          role: 'user',
          text: prompt
        }
      ]
    })

    await this.dispatchPending(pending, wasBusy)
  }

  private async dispatchPending(pending: PendingDispatch, wasBusy = this.state.busy): Promise<void> {
    const gateway = this.gateway
    const runtimeSessionId = this.runtimeSessionId

    if (!gateway || !runtimeSessionId || this.state.status !== 'ready') {
      return
    }

    try {
      const receipt = await gateway.request<{
        client_message_id?: string
        dispatch_id?: string
        route?: MacManDispatchRoute
        state?: 'failed' | 'queued' | 'running'
        task_id?: string
      }>('prompt.dispatch', {
        client_message_id: pending.clientMessageId,
        session_id: runtimeSessionId,
        text: pending.text
      })
      this.pendingDispatches.delete(pending.clientMessageId)
      this.applyDispatchReceipt(receipt)
    } catch (error) {
      if (this.gateway !== gateway) {
        return
      }

      const message = errorMessage(error)
      this.pendingDispatches.delete(pending.clientMessageId)
      this.publish({
        ...this.state,
        busy: wasBusy,
        error: message,
        limitedModels: this.limitsAfterError(message),
        messages: this.state.messages.map(item =>
          item.id === pending.localMessageId
            ? { ...item, dispatch: { ...item.dispatch!, route: 'routing', state: 'failed' } }
            : item
        )
      })
    }
  }

  subscribe(listener: (snapshot: MacManChatSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)

    return () => this.listeners.delete(listener)
  }

  async switchModel(
    provider: string,
    model: string,
    confirmExpensiveModel = false
  ): Promise<MacManModelSwitchResult> {
    const cleanProvider = provider.trim()
    const cleanModel = model.trim()

    if (!this.gateway || !this.runtimeSessionId || this.state.status !== 'ready') {
      throw new Error('MacMan chat is not connected.')
    }

    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(cleanProvider) || !cleanModel || /\s/.test(cleanModel)) {
      throw new Error('MacMan received an invalid model selection.')
    }

    const response = await this.gateway.request<{
      confirm_message?: string
      confirm_required?: boolean
      deferred?: boolean
    }>('config.set', {
      key: 'model',
      session_id: this.runtimeSessionId,
      value: `${cleanModel} --provider ${cleanProvider} --session`,
      ...(confirmExpensiveModel ? { confirm_expensive_model: true } : {})
    })

    if (response.confirm_required) {
      return {
        confirmationMessage: response.confirm_message?.trim() || 'Confirm this model switch?',
        confirmRequired: true
      }
    }

    this.publish({
      ...this.state,
      activeModel: { model: cleanModel, provider: cleanProvider },
      error: undefined
    })

    return { confirmRequired: false, deferred: response.deferred }
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

  private applyDispatchReceipt(payload: Record<string, unknown>): void {
    const clientMessageId = typeof payload.client_message_id === 'string' ? payload.client_message_id : ''
    const route = typeof payload.route === 'string' ? payload.route as MacManDispatchRoute : undefined
    const state = typeof payload.state === 'string' ? payload.state as MacManDispatchReceipt['state'] : undefined

    if (!clientMessageId || !route || !state) {
      return
    }

    this.pendingDispatches.delete(clientMessageId)

    this.publish({
      ...this.state,
      messages: this.state.messages.map(message =>
        message.dispatch?.clientMessageId === clientMessageId
          ? {
              ...message,
              dispatch: {
                clientMessageId,
                dispatchId: typeof payload.dispatch_id === 'string' ? payload.dispatch_id : undefined,
                route,
                state,
                taskId: typeof payload.task_id === 'string' ? payload.task_id : undefined
              }
            }
          : message
      )
    })
  }

  private upsertActivity(activity: MacManActivity): void {
    const current = this.state.activities ?? []
    const found = current.some(item => item.id === activity.id)
    const next = found
      ? current.map(item => item.id === activity.id ? activity : item)
      : [...current, activity]

    this.publish({ ...this.state, activities: next.slice(-40) })
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
    const failureMessage = failed ? textFromContent(payload.error) || 'MacMan could not finish that response.' : undefined
    this.streamMessageId = undefined
    this.publish({
      ...this.state,
      busy: false,
      error: failureMessage,
      limitedModels: failureMessage ? this.limitsAfterError(failureMessage) : this.limitsAfterSuccess()
    })
  }

  private handleEvent(event: MacManGatewayEvent): void {
    if (!this.runtimeSessionId || event.session_id !== this.runtimeSessionId) {
      return
    }

    const payload = event.payload ?? {}

    if (event.type === 'dispatch.accepted') {
      this.applyDispatchReceipt(payload)
    } else if (event.type === 'message.start') {
      this.streamMessageId = undefined
      this.publish({ ...this.state, busy: true, error: undefined })
    } else if (event.type === 'message.delta') {
      this.appendAssistantDelta(textFromContent(payload.text))
    } else if (event.type === 'message.complete') {
      this.completeAssistant(payload)
    } else if (event.type === 'approval.request') {
      this.publish({ ...this.state, pendingInput: pendingInput('approval', payload) })
    } else if (event.type === 'clarify.request') {
      this.publish({ ...this.state, pendingInput: pendingInput('clarify', payload) })
    } else if (event.type === 'sudo.request') {
      this.publish({ ...this.state, pendingInput: pendingInput('sudo', payload) })
    } else if (event.type === 'secret.request') {
      this.publish({ ...this.state, pendingInput: pendingInput('secret', payload) })
    } else if (event.type === 'sudo.expire' || event.type === 'secret.expire') {
      const requestId = stringValue(payload.request_id)

      if (!requestId || requestId === this.state.pendingInput?.requestId) {
        this.publish({ ...this.state, pendingInput: undefined })
      }
    } else if (event.type === 'session.info') {
      const activeModel = modelSelection(payload)

      if (activeModel) {
        this.publish({ ...this.state, activeModel })
      }
    } else if (event.type === 'status.update') {
      const label = textFromContent(payload.text)

      if (label) {
        this.upsertActivity({
          id: `status-${textFromContent(payload.kind) || 'current'}`,
          kind: 'status',
          label,
          state: 'running'
        })
      }
    } else if (event.type === 'tool.start' || event.type === 'tool.progress' || event.type === 'tool.complete') {
      const id = textFromContent(payload.tool_call_id) || textFromContent(payload.id) || `tool-${textFromContent(payload.name)}`
      const label = textFromContent(payload.summary) || textFromContent(payload.context) || textFromContent(payload.preview) || textFromContent(payload.name)

      if (id && label) {
        this.upsertActivity({
          id,
          kind: 'tool',
          label,
          state: event.type === 'tool.complete' ? 'complete' : 'running'
        })
      }
    } else if (event.type === 'background.complete') {
      const taskId = textFromContent(payload.task_id)
      const text = textFromContent(payload.text).trim()

      if (text) {
        const failed = /^error:/i.test(text)
        this.upsertActivity({
          id: taskId || `task-${crypto.randomUUID()}`,
          kind: 'task',
          label: failed ? text.replace(/^error:\s*/i, '') : 'Parallel task finished',
          state: failed ? 'failed' : 'complete'
        })
        this.publish({
          ...this.state,
          messages: [
            ...this.state.messages,
            { id: `assistant-${crypto.randomUUID()}`, role: 'assistant', taskId: taskId || undefined, text }
          ]
        })
      }
    } else if (event.type === 'error') {
      const message = textFromContent(payload.message) || textFromContent(payload.error) || 'MacMan hit an unexpected error.'
      this.streamMessageId = undefined
      this.publish({
        ...this.state,
        busy: false,
        error: message,
        limitedModels: this.limitsAfterError(message)
      })
    }
  }

  private async open(generation: number): Promise<void> {
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
          this.scheduleReconnect()
        }
      })
      await gateway.connect(wsUrl)

      if (generation !== this.connectionGeneration) {
        gateway.close()

        return
      }

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

      if (generation !== this.connectionGeneration) {
        gateway.close()

        return
      }

      this.runtimeSessionId = session.session_id
      this.reconnectAttempt = 0
      this.reconnectEnabled = true
      const hydratedMessages = hydrateLiveMessages(session)
      const pendingMessages = [...this.pendingDispatches.values()].flatMap(pending =>
        hydratedMessages.some(message => message.role === 'user' && message.text === pending.text)
          ? []
          : [{
              dispatch: { clientMessageId: pending.clientMessageId, route: 'routing', state: 'routing' } as MacManDispatchReceipt,
              id: pending.localMessageId,
              role: 'user' as const,
              text: pending.text
            }]
      )
      this.publish({
        activities: [],
        activeModel: modelSelection(session.info) ?? this.state.activeModel,
        busy: Boolean(session.running),
        error: undefined,
        limitedModels: this.state.limitedModels,
        messages: [...hydratedMessages, ...pendingMessages],
        pendingInput: session.pending_approval
          ? pendingInput('approval', session.pending_approval)
          : session.pending_clarify
            ? pendingInput('clarify', session.pending_clarify)
            : undefined,
        status: 'ready'
      })
      this.pendingDispatches.forEach(pending => void this.dispatchPending(pending))
    } catch (error) {
      if (generation !== this.connectionGeneration) {
        return
      }

      this.gateway?.close()
      this.gateway = undefined
      this.publish({ ...this.state, busy: false, error: errorMessage(error), status: 'error' })
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (!this.reconnectEnabled || this.reconnectTimer) {
      return
    }

    const delay = Math.min(5_000, 250 * 2 ** this.reconnectAttempt++)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.connect()
    }, delay)
  }

  private publish(next: MacManChatSnapshot): void {
    this.state = next
    this.listeners.forEach(listener => listener(next))
  }

  private limitsAfterError(message: string): Record<string, MacManModelLimit> {
    const activeModel = this.state.activeModel
    const kind = modelLimitKind(message)

    if (!activeModel || !kind) {
      return this.state.limitedModels ?? {}
    }

    return {
      ...this.state.limitedModels,
      [modelKey(activeModel)]: { ...activeModel, kind, message }
    }
  }

  private limitsAfterSuccess(): Record<string, MacManModelLimit> {
    const activeModel = this.state.activeModel
    const limitedModels = this.state.limitedModels ?? {}

    if (!activeModel || !limitedModels[modelKey(activeModel)]) {
      return limitedModels
    }

    const next = { ...limitedModels }
    delete next[modelKey(activeModel)]

    return next
  }
}

export function createMacManChatClient(
  host?: MacManGatewayHost,
  createTransport?: MacManChatTransportFactory
): MacManChatClient {
  return new MacManChatGatewayClient(host, createTransport)
}
