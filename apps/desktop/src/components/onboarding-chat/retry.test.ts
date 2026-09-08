// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/chat/composer/focus', () => ({
  requestComposerSubmit: vi.fn(() => true)
}))

import { requestComposerSubmit } from '@/app/chat/composer/focus'

import { $chatOnboardingSolo, $chatOnboardingThreadIds } from './assembly'
import { rememberOnboardingSubmit, resetOnboardingRetryForTests, scheduleOnboardingRetry } from './retry'

describe('onboarding quiet retry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(requestComposerSubmit).mockClear()
    resetOnboardingRetryForTests()
    $chatOnboardingSolo.set(false)
    $chatOnboardingThreadIds.set([])
  })

  it('replays the remembered submit once for the onboarding session', () => {
    $chatOnboardingSolo.set(true)
    rememberOnboardingSubmit('[setup] accent color: Ultraviolet')

    expect(scheduleOnboardingRetry('sess-1')).toBe(true)

    vi.runAllTimers()
    expect(requestComposerSubmit).toHaveBeenCalledExactlyOnceWith('[setup] accent color: Ultraviolet', {
      displayKind: 'hidden'
    })

    // Budget spent — the second failure surfaces normally.
    expect(scheduleOnboardingRetry('sess-1')).toBe(false)
  })

  it('matches by onboarding thread id after solo mode ends', () => {
    $chatOnboardingThreadIds.set(['stored-1', 'runtime-1'])
    rememberOnboardingSubmit('[setup] layout: Basic')

    expect(scheduleOnboardingRetry('runtime-1')).toBe(true)
  })

  it('never claims failures outside the onboarding chat', () => {
    rememberOnboardingSubmit('[setup] focus: Coding')

    expect(scheduleOnboardingRetry('some-other-session')).toBe(false)
    expect(requestComposerSubmit).not.toHaveBeenCalled()
  })

  it('never claims without a remembered submit', () => {
    $chatOnboardingSolo.set(true)

    expect(scheduleOnboardingRetry('sess-1')).toBe(false)
  })
})
