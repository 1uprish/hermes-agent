import assert from 'node:assert/strict'

import { test } from 'vitest'

import { createMacManNativeBridgeController, MACMAN_PERMISSION_SETTINGS_URLS } from './macman-native-bridge'

function fakeBridgeDependencies() {
  let permissions = { accessibility: false, screenRecording: true }
  let microphone: 'denied' | 'granted' | 'not-determined' | 'restricted' | 'unknown' = 'not-determined'
  const events: string[] = []

  const controller = {
    async refreshPermissions() {
      events.push('cua:refresh')

      return { permissions, state: permissions.accessibility ? ('running' as const) : ('permission-required' as const) }
    },
    async requestPermissionsFromUserAction() {
      events.push('cua:request')
      permissions = { accessibility: true, screenRecording: true }

      return { permissions, state: 'running' as const }
    },
    snapshot() {
      return { permissions, state: permissions.accessibility ? ('running' as const) : ('permission-required' as const) }
    }
  }

  return {
    controller,
    events,
    dependencies: {
      async getCuaController() {
        return controller
      },
      getMicrophoneStatus() {
        return microphone
      },
      async openExternal(url: string) {
        events.push(`open:${url}`)
      },
      async requestMicrophone() {
        events.push('microphone:request')
        microphone = 'granted'

        return true
      }
    },
    setMicrophone(status: typeof microphone) {
      microphone = status
    }
  }
}

test('MacMan native wrapper maps authoritative host and microphone status into the standalone contract', async () => {
  const fake = fakeBridgeDependencies()
  const bridge = createMacManNativeBridgeController(fake.dependencies)

  const snapshot = await bridge.snapshot()

  assert.equal(snapshot.wrapper, 'connected')
  assert.equal(snapshot.permissions.accessibility, 'not-granted')
  assert.equal(snapshot.permissions.screenRecording, 'granted')
  assert.equal(snapshot.permissions.microphone, 'ask-when-used')
  assert.equal(snapshot.permissions.fullDiskAccess, 'optional')
  assert.deepEqual(fake.events, ['cua:refresh'])
})

test('explicit permission actions return refreshed truth instead of optimistic grants', async () => {
  const fake = fakeBridgeDependencies()
  const bridge = createMacManNativeBridgeController(fake.dependencies)

  const accessibility = await bridge.requestPermission('accessibility')
  assert.equal(accessibility.permissions.accessibility, 'granted')
  assert.deepEqual(fake.events, ['cua:request'])

  const microphone = await bridge.requestPermission('microphone')
  assert.equal(microphone.permissions.microphone, 'granted')
  assert.deepEqual(fake.events.slice(-2), ['microphone:request', 'cua:refresh'])

  const disk = await bridge.requestPermission('fullDiskAccess')
  assert.equal(disk.permissions.fullDiskAccess, 'optional')
  assert.equal(fake.events.at(-2), `open:${MACMAN_PERMISSION_SETTINGS_URLS.fullDiskAccess}`)
})

test('wrapper startup failure is surfaced as disconnected state rather than a false ready state', async () => {
  const bridge = createMacManNativeBridgeController({
    async getCuaController() {
      throw new Error('embedded host failed')
    },
    getMicrophoneStatus: () => 'unknown',
    openExternal: async () => undefined,
    requestMicrophone: async () => false
  })

  const snapshot = await bridge.snapshot()

  assert.equal(snapshot.wrapper, 'disconnected')
  assert.match(snapshot.error ?? '', /embedded host failed/)
  assert.equal(snapshot.permissions.accessibility, 'unavailable')
  assert.equal(snapshot.permissions.screenRecording, 'unavailable')
})
