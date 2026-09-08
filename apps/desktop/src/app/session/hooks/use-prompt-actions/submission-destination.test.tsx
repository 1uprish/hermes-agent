import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { en } from '@/i18n/en'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $activeGatewayProfile } from '@/store/profile'
import { $connection, $sessions } from '@/store/session'
import { $sessionStates } from '@/store/session-states'

import { useSlashCommand } from './slash'
import { captureSubmissionDestination } from './submission-destination'
import { useSubmitPrompt } from './submit'
import type { GatewayRequest } from './utils'

const wire = vi.hoisted(() => ({ request: vi.fn(), release: vi.fn() }))
vi.mock('@/store/gateway', async original => ({
  ...(await original<Record<string, unknown>>()),
  requestGatewayForAgent: wire.request,
  requestGatewayForProfile: wire.request,
  retainGatewayForSessionTurn: vi.fn(async () => wire.release)
}))

function deferred<T>() {
  let resolve!: (value: T) => void

  const promise = new Promise<T>(done => {
    resolve = done
  })

  return { promise, resolve }
}

function setup() {
  const activeSessionIdRef = { current: 'runtime-a' as string | null }
  const selectedStoredSessionIdRef = { current: 'stored-a' as string | null }

  const requestGateway = vi.fn(
    async (_method: string, params?: Record<string, unknown>) =>
      ({ admission_id: params?.submission_id, status: 'started' }) as never
  )

  const busyRef = { current: false }
  const state = createClientSessionState()

  const deps = {
    activeSessionIdRef,
    selectedStoredSessionIdRef,
    busyRef,
    copy: en.desktop,
    createBackendSessionForSend: vi.fn(async () => null),
    getRoutedStoredSessionId: () => null,
    getRuntimeIdForStoredSession: () => 'runtime-a',
    getRouteToken: () => 'same-route',
    requestGateway: requestGateway as GatewayRequest,
    runtimeIdByStoredSessionIdRef: { current: new Map([['stored-a', 'runtime-a']]) },
    resumeStoredSession: vi.fn(),
    syncAttachmentsForSubmit: vi.fn(async (sessionId: string) => ({ sessionId, attachments: [] })),
    updateSessionState: vi.fn((_sid, updater) => updater(state))
  }

  return { deps, requestGateway }
}

beforeEach(() => {
  $sessions.set([])
  $sessionStates.set({})
  $connection.set(null)
  $activeGatewayProfile.set('default')
  wire.request.mockReset()
  wire.request.mockImplementation(async (_connection, _profile, _method, params) => ({
    admission_id: params?.submission_id,
    status: 'started'
  }))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('submission intent destinations', () => {
  it('reuses a prepared direct submission after ambiguous failure without restaging attachments', async () => {
    const { deps, requestGateway } = setup()
    requestGateway.mockRejectedValueOnce(new Error('connection closed'))
    const { result, rerender } = renderHook(() => useSubmitPrompt(deps))
    await act(async () => {
      expect(await result.current('retry me')).toBe(false)
    })
    rerender()
    await act(async () => {
      expect(await result.current('retry me')).toBe(true)
    })
    const calls = requestGateway.mock.calls.filter(call => call[0] === 'prompt.submit')
    expect(calls).toHaveLength(2)
    expect(calls[1][1]).toEqual(calls[0][1])
    expect(deps.syncAttachmentsForSubmit).toHaveBeenCalledTimes(1)
    await act(async () => {
      expect(await result.current('retry me')).toBe(true)
    })
    expect(requestGateway.mock.calls[2][1]?.submission_id).not.toBe(calls[0][1]?.submission_id)
  })

  it('assigns one direct ID before preprocessing and keeps it through busy retries', async () => {
    const { deps, requestGateway } = setup()
    let attempts = 0
    requestGateway.mockImplementation(async (_method, params) => {
      if (++attempts === 1) {
        throw new Error('session busy')
      }

      return { admission_id: params?.submission_id, status: 'started' } as never
    })
    const { result } = renderHook(() => useSubmitPrompt(deps))
    await act(async () => {
      expect(await result.current('hello')).toBe(true)
    })
    const ids = requestGateway.mock.calls.map(call => call[1]?.submission_id)
    expect(ids.length).toBeGreaterThan(1)
    expect(ids[0]).toEqual(expect.any(String))
    expect(new Set(ids).size).toBe(1)
  })

  it('pins the exact owner before attachment preprocessing changes connection and profile', async () => {
    const { deps, requestGateway } = setup()
    $sessions.set([{ id: 'stored-a', connection_id: 'owner-a', profile: 'alice' }] as never)
    const gate = deferred<{ sessionId: string; attachments: [] }>()
    deps.syncAttachmentsForSubmit.mockImplementation(() => gate.promise)
    const { result } = renderHook(() => useSubmitPrompt(deps))
    let pending!: Promise<boolean>
    act(() => {
      pending = result.current('private text')
    })
    $sessions.set([{ id: 'stored-a', connection_id: 'owner-b', profile: 'bob' }] as never)
    $activeGatewayProfile.set('bob')
    await act(async () => {
      gate.resolve({ sessionId: 'runtime-a', attachments: [] })
      expect(await pending).toBe(true)
    })
    expect(deps.syncAttachmentsForSubmit).toHaveBeenCalledWith(
      'runtime-a',
      [],
      expect.objectContaining({
        storedSessionId: 'stored-a',
        requestGateway: expect.any(Function)
      })
    )
    expect(requestGateway).not.toHaveBeenCalled()
    expect(wire.request).toHaveBeenCalledWith(
      'owner-a',
      'alice',
      'prompt.submit',
      expect.objectContaining({ session_id: 'runtime-a', text: 'private text', submission_id: expect.any(String) }),
      expect.any(Number),
      undefined
    )
  })

  it('captures an attachment upload owner before native byte reading yields', async () => {
    const { uploadComposerAttachment } = await import('.')
    const gate = deferred<string>()
    const original = window.hermesDesktop
    window.hermesDesktop = { ...original, readFileDataUrl: vi.fn(() => gate.promise) } as never
    $sessions.set([{ id: 'stored-a', connection_id: 'owner-a', profile: 'alice' }] as never)
    wire.request.mockResolvedValue({ attached: true, ref_text: '@file:staged.txt' })
    const ambient = vi.fn(async () => ({ attached: true, ref_text: '@file:wrong.txt' })) as GatewayRequest
    const captured = captureSubmissionDestination('stored-a', ambient)
    $sessions.set([{ id: 'stored-a', connection_id: 'owner-b', profile: 'bob' }] as never)

    try {
      const pending = uploadComposerAttachment(
        { id: 'file-a', kind: 'file', label: 'private.txt', path: '/private.txt' },
        {
          remote: true,
          sessionId: 'runtime-a',
          storedSessionId: 'stored-a',
          requestGateway: captured.requestGateway
        }
      )

      $sessions.set([{ id: 'stored-a', connection_id: 'owner-b', profile: 'bob' }] as never)
      $activeGatewayProfile.set('bob')
      gate.resolve('data:text/plain;base64,cHJpdmF0ZQ==')
      await pending
      expect(wire.request).toHaveBeenCalledWith(
        'owner-a',
        'alice',
        'file.attach',
        expect.objectContaining({
          session_id: 'runtime-a',
          data_url: 'data:text/plain;base64,cHJpdmF0ZQ=='
        })
      )
      expect(ambient).not.toHaveBeenCalled()
    } finally {
      window.hermesDesktop = original
    }
  })

  it('pins slash fallback and generated kickoff to the entry owner and stored session', async () => {
    const { deps } = setup()
    $sessions.set([{ id: 'stored-a', connection_id: 'owner-a', profile: 'alice' }] as never)
    const gate = deferred<unknown>()
    const requests: Array<[string, string, string]> = []
    wire.request.mockImplementation(async (connection, profile, method) => {
      requests.push([connection, profile, method])

      if (method === 'slash.exec') {
        return gate.promise
      }

      return { type: 'skill', name: 'private-skill', message: 'expanded private skill' }
    })
    deps.requestGateway = vi.fn(async (method: string) => {
      if (method === 'slash.exec') {
        return gate.promise
      }

      return { type: 'skill', name: 'private-skill', message: 'expanded private skill' }
    }) as GatewayRequest
    const submitPromptText = vi.fn(async () => true)

    const { result } = renderHook(() =>
      useSlashCommand({
        ...deps,
        submitPromptText,
        appendSessionTextMessage: vi.fn(),
        branchCurrentSession: async () => true,
        handleSkinCommand: () => '',
        handoffSession: async () => ({ ok: true }),
        openMemoryGraph: vi.fn(),
        refreshSessions: async () => undefined,
        startFreshSessionDraft: vi.fn()
      })
    )

    let pending!: Promise<boolean>
    await act(async () => {
      pending = result.current('/private-skill')
    })
    deps.activeSessionIdRef.current = 'runtime-b'
    deps.selectedStoredSessionIdRef.current = 'stored-b'
    $sessions.set([{ id: 'stored-a', connection_id: 'owner-b', profile: 'bob' }] as never)
    $activeGatewayProfile.set('bob')
    await act(async () => {
      gate.resolve({ type: 'skill', name: 'private-skill', message: 'expanded private skill' })
      await pending
    })
    expect(requests).toEqual([['owner-a', 'alice', 'slash.exec']])
    expect(submitPromptText).toHaveBeenCalledWith(
      'expanded private skill',
      expect.objectContaining({
        sessionId: 'runtime-a',
        storedSessionId: 'stored-a',
        submission_id: expect.any(String),
        destination: expect.any(Object)
      })
    )
  })
})
