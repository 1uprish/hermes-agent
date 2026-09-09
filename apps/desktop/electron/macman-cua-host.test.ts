import assert from 'node:assert/strict'

import { test } from 'vitest'

import { createMacManCuaHostController, type MacManCuaHostDependencies } from './macman-cua-host'

const HOST_BUNDLE_ID = 'com.macman.app'

function connection(generation: string) {
  return {
    contractVersion: '1',
    driverVersion: '0.24.0',
    generation,
    mcp: { args: ['mcp', '--embedded'], command: '/MacMan.app/Contents/Resources/cua-driver', environment: [] },
    mcpProtocolVersion: '2025-06-18',
    pid: generation === 'generation-1' ? 41 : 42,
    socketPath: `/private/tmp/macman-${generation}.sock`
  }
}

function fakeDependencies(overrides: Partial<MacManCuaHostDependencies> = {}) {
  let permissions = { accessibility: false, screenRecording: false }
  const events: string[] = []
  let generation = 0

  const host = {
    async restart() {
      generation += 1
      events.push(`host:restart:${generation}`)
      return connection(`generation-${generation}`)
    },
    async start() {
      generation += 1
      events.push(`host:start:${generation}`)
      return connection(`generation-${generation}`)
    },
    async stop() {
      events.push('host:stop')
    },
    uniffiDestroy() {
      events.push('host:destroy')
    },
    async waitForExit() {
      return new Promise<never>(() => {})
    }
  }

  const dependencies: MacManCuaHostDependencies = {
    connect(socketPath) {
      events.push(`driver:connect:${socketPath}`)
      return {
        async metadata() {
          events.push('driver:metadata')
          return {
            capabilityVersion: '1',
            contractVersion: '1',
            driverVersion: '0.24.0',
            embedded: true,
            hostBundleId: HOST_BUNDLE_ID,
            mcpProtocolVersion: '2025-06-18',
            pid: 42,
            toolsListSchemaVersion: '1'
          }
        },
        async shutdown() {
          events.push('driver:shutdown')
        },
        uniffiDestroy() {
          events.push('driver:destroy')
        }
      }
    },
    createHost() {
      events.push('host:create')
      return host
    },
    hasRequiredPermissions(status) {
      return status.accessibility && status.screenRecording
    },
    hostBundleId: HOST_BUNDLE_ID,
    async openScreenRecordingSettings() {
      events.push('permissions:open-screen-settings')
    },
    readPermissions() {
      events.push('permissions:read')
      return permissions
    },
    requestPermissions() {
      events.push('permissions:request')
      return permissions
    },
    ...overrides
  }

  return {
    dependencies,
    events,
    grantPermissions() {
      permissions = { accessibility: true, screenRecording: true }
    }
  }
}

test('MacMan owns permission onboarding and starts one embedded generation only after both grants', async () => {
  const fake = fakeDependencies()
  const controller = createMacManCuaHostController(fake.dependencies)

  assert.deepEqual(await controller.requestPermissionsAndStart(), {
    connection: undefined,
    permissions: { accessibility: false, screenRecording: false },
    state: 'permission-required'
  })
  assert.equal(fake.events.includes('host:create'), false, 'the daemon must not exist before host grants are ready')
  assert.equal(
    fake.events.filter(event => event === 'permissions:open-screen-settings').length,
    1,
    'Screen Recording settings should open once, not on every poll'
  )

  fake.grantPermissions()
  const [first, concurrent] = await Promise.all([controller.refreshPermissions(), controller.refreshPermissions()])

  assert.equal(first.state, 'running')
  assert.deepEqual(concurrent, first)
  assert.equal(first.connection?.generation, 'generation-1')
  assert.equal(fake.events.filter(event => event.startsWith('host:start:')).length, 1)

  const restarted = await controller.restartAfterPermissionChange()
  assert.equal(restarted.connection?.generation, 'generation-2')
  assert.deepEqual(fake.events.slice(-6), [
    'driver:shutdown',
    'driver:destroy',
    'host:restart:2',
    'driver:connect:/private/tmp/macman-generation-2.sock',
    'driver:metadata',
    'permissions:read'
  ])

  await controller.stop()
  assert.deepEqual(fake.events.slice(-4), ['driver:shutdown', 'driver:destroy', 'host:stop', 'host:destroy'])
})

test('MacMan fails closed and tears down a daemon that does not report the host identity', async () => {
  const fake = fakeDependencies({
    requestPermissions: () => ({ accessibility: true, screenRecording: true }),
    connect: () => ({
      metadata: async () => ({ embedded: false, hostBundleId: 'com.trycua.driver' }),
      shutdown: async () => {
        fake.events.push('driver:shutdown')
      },
      uniffiDestroy: () => {
        fake.events.push('driver:destroy')
      }
    })
  })
  const controller = createMacManCuaHostController(fake.dependencies)

  await assert.rejects(controller.requestPermissionsAndStart(), /refused Cua Driver identity/)
  assert.equal(controller.snapshot().state, 'failed')
  assert.deepEqual(fake.events.slice(-4), ['driver:shutdown', 'driver:destroy', 'host:stop', 'host:destroy'])
})
