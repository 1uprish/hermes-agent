import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { renderSync, Text } from '@hermes/ink'
import React from 'react'
import { expect, it, vi } from 'vitest'

import { getUiState, patchUiState, resetUiState } from '../app/uiStore.js'
import { useSessionLifecycle } from '../app/useSessionLifecycle.js'
import { useQueue } from '../hooks/useQueue.js'

it('resumes a successor with a reset epoch while retaining original attempted admission targets', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ink-resume-epoch-'))
  vi.stubEnv('HERMES_HOME', home)
  resetUiState()
  const info = { model: 'test', skills: {}, tools: {}, execution_epoch: 'old', execution_generation: 9, running: true }
  patchUiState({ sid: 'old-session', info, busy: true })
  let queue!: ReturnType<typeof useQueue>
  let lifecycle!: ReturnType<typeof useSessionLifecycle>

  const request = vi.fn(async () => ({ session_id: 'successor', resumed: 'successor', info: {
    ...info, execution_epoch: 'new', execution_generation: 0, running: false
  }, running: false, messages: [] }))

  function Harness() {
    queue = useQueue()
    lifecycle = useSessionLifecycle({ colsRef: { current: 80 }, composerActions: { setComposerTokens: vi.fn() },
      gw: { request }, rpc: async () => ({}), scrollRef: { current: null }, panel: vi.fn(), sys: vi.fn(),
      setHistoryItems: vi.fn(), setLastUserMsg: vi.fn(), setSessionStartedAt: vi.fn(), setStickyPrompt: vi.fn(),
      setVoiceProcessing: vi.fn(), setVoiceRecording: vi.fn() } as any)

    return <Text>{queue.queuedDisplay.join('|')}</Text>
  }

  const instance = renderSync(<Harness />, { stdin: new PassThrough() as any,
    stdout: Object.assign(new PassThrough(), { columns: 80, rows: 20, isTTY: false }) as any,
    stderr: new PassThrough() as any, patchConsole: false })

  try {
    const attempted = queue.stage('ambiguous')
    attempted.settle!(false)
    const waiting = queue.enqueue('not attempted')
    lifecycle.resumeById('old-session')
    await vi.waitFor(() => expect(getUiState().sid).toBe('successor'))
    expect(getUiState().info?.execution_epoch).toBe('new')
    expect(getUiState().busy).toBe(false)
    expect(queue.queueRef.current.map(item => item.submissionId)).toEqual([attempted.submissionId, waiting.submissionId])
    expect(queue.queueRef.current[0]?.destination?.sid).toBe('old-session')
    expect(queue.queueRef.current[1]?.destination?.sid).toBe('successor')
    expect(queue.dequeue()).toBeUndefined()
  } finally {
    instance.unmount()
    resetUiState()
    vi.unstubAllEnvs()
    rmSync(home, { recursive: true, force: true })
  }
})
