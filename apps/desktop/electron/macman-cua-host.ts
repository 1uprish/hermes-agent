export type MacManPermissionStatus = {
  accessibility: boolean
  screenRecording: boolean
}

export type MacManEmbeddedConnection = {
  contractVersion: string
  driverVersion: string
  generation: string
  mcp: {
    args: string[]
    command: string
    environment: Array<{ name: string; value: string }>
  }
  mcpProtocolVersion: string
  pid: number
  socketPath: string
}

type CuaDriverMetadata = {
  embedded: boolean
  hostBundleId?: string
}

export type MacManCuaDriverClient = {
  metadata(): Promise<CuaDriverMetadata>
  shutdown(): Promise<void>
  uniffiDestroy(): void
}

export type MacManEmbeddedHost = {
  restart(): Promise<MacManEmbeddedConnection>
  start(): Promise<MacManEmbeddedConnection>
  stop(): Promise<void>
  uniffiDestroy(): void
  waitForExit(generation: string): Promise<{ code?: number; generation: string; success: boolean }>
}

export type MacManCuaHostDependencies = {
  connect(socketPath: string): MacManCuaDriverClient
  createHost(): MacManEmbeddedHost
  hasRequiredPermissions(status: MacManPermissionStatus): boolean
  hostBundleId: string
  openScreenRecordingSettings(): Promise<void>
  readPermissions(): MacManPermissionStatus
  requestPermissions(): MacManPermissionStatus
}

export type MacManCuaHostState = 'idle' | 'permission-required' | 'starting' | 'running' | 'failed' | 'stopped'

export type MacManCuaHostSnapshot = {
  connection?: MacManEmbeddedConnection
  permissions: MacManPermissionStatus
  state: MacManCuaHostState
}

export class MacManCuaIdentityError extends Error {
  constructor(expectedBundleId: string, metadata: CuaDriverMetadata) {
    super(
      `MacMan refused Cua Driver identity: expected embedded host ${expectedBundleId}, ` +
        `got embedded=${String(metadata.embedded)} hostBundleId=${metadata.hostBundleId ?? '<missing>'}`
    )
    this.name = 'MacManCuaIdentityError'
  }
}

/**
 * Owns the TCC-to-child-process boundary for the MacMan distribution.
 *
 * Permission probes run before the embedded host is constructed. Every
 * lifecycle mutation is serialized so a grant poll, quit, and restart cannot
 * create two generations or leave a driver client attached to a dead one.
 */
export function createMacManCuaHostController(dependencies: MacManCuaHostDependencies) {
  let state: MacManCuaHostState = 'idle'
  let permissions: MacManPermissionStatus = { accessibility: false, screenRecording: false }
  let connection: MacManEmbeddedConnection | undefined
  let client: MacManCuaDriverClient | undefined
  let host: MacManEmbeddedHost | undefined
  let permissionRequestMade = false
  let screenSettingsOpened = false
  let operationTail = Promise.resolve<void>(undefined)

  const snapshot = (): MacManCuaHostSnapshot => ({ connection, permissions: { ...permissions }, state })

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationTail.then(operation, operation)
    operationTail = result.then(
      () => undefined,
      () => undefined
    )

    return result
  }

  async function disposeClient(): Promise<void> {
    const active = client
    client = undefined
    connection = undefined

    if (!active) {
      return
    }

    try {
      await active.shutdown()
    } finally {
      active.uniffiDestroy()
    }
  }

  async function disposeHost(): Promise<void> {
    const active = host
    host = undefined

    if (!active) {
      return
    }

    try {
      await active.stop()
    } finally {
      active.uniffiDestroy()
    }
  }

  async function teardown(): Promise<void> {
    await disposeClient()
    await disposeHost()
  }

  function observeUnexpectedExit(activeHost: MacManEmbeddedHost, activeConnection: MacManEmbeddedConnection): void {
    void activeHost
      .waitForExit(activeConnection.generation)
      .then(exit => {
        void serialize(async () => {
          if (connection?.generation !== exit.generation) {
            return
          }

          await disposeClient()
          state = exit.success ? 'stopped' : 'failed'
        })
      })
      .catch(() => {
        void serialize(async () => {
          if (connection?.generation !== activeConnection.generation) {
            return
          }

          await disposeClient()
          state = 'failed'
        })
      })
  }

  async function connectGeneration(nextConnection: MacManEmbeddedConnection): Promise<void> {
    const nextClient = dependencies.connect(nextConnection.socketPath)
    client = nextClient

    const metadata = await nextClient.metadata()

    if (!metadata.embedded || metadata.hostBundleId !== dependencies.hostBundleId) {
      throw new MacManCuaIdentityError(dependencies.hostBundleId, metadata)
    }

    connection = nextConnection
  }

  async function startGeneration(restart: boolean): Promise<MacManCuaHostSnapshot> {
    state = 'starting'
    const activeHost = host ?? dependencies.createHost()
    host = activeHost

    try {
      const nextConnection = restart ? await activeHost.restart() : await activeHost.start()
      await connectGeneration(nextConnection)
      permissions = dependencies.readPermissions()
      state = 'running'
      observeUnexpectedExit(activeHost, nextConnection)

      return snapshot()
    } catch (error) {
      state = 'failed'
      await teardown()
      throw error
    }
  }

  async function applyPermissionStatus(next: MacManPermissionStatus): Promise<MacManCuaHostSnapshot> {
    permissions = next

    if (!dependencies.hasRequiredPermissions(next)) {
      if (client || host) {
        await teardown()
      }

      state = 'permission-required'

      return snapshot()
    }

    if (state === 'running' && connection) {
      return snapshot()
    }

    return startGeneration(false)
  }

  return {
    snapshot,

    requestPermissionsAndStart(): Promise<MacManCuaHostSnapshot> {
      return serialize(async () => {
        if (permissionRequestMade) {
          return applyPermissionStatus(dependencies.readPermissions())
        }

        permissionRequestMade = true
        const requested = dependencies.requestPermissions()

        if (!requested.screenRecording && !screenSettingsOpened) {
          screenSettingsOpened = true
          await dependencies.openScreenRecordingSettings()
        }

        return applyPermissionStatus(requested)
      })
    },

    refreshPermissions(): Promise<MacManCuaHostSnapshot> {
      return serialize(() => applyPermissionStatus(dependencies.readPermissions()))
    },

    restartAfterPermissionChange(): Promise<MacManCuaHostSnapshot> {
      return serialize(async () => {
        if (!dependencies.hasRequiredPermissions(permissions)) {
          permissions = dependencies.readPermissions()
        }

        if (!dependencies.hasRequiredPermissions(permissions)) {
          if (client || host) {
            await teardown()
          }

          state = 'permission-required'

          return snapshot()
        }

        await disposeClient()

        return startGeneration(Boolean(host))
      })
    },

    stop(): Promise<void> {
      return serialize(async () => {
        await teardown()
        state = 'stopped'
      })
    }
  }
}

export type MacManCuaHostController = ReturnType<typeof createMacManCuaHostController>
