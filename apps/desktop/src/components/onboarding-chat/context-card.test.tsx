// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/chat/composer/focus', () => ({
  requestComposerSubmit: vi.fn(() => true)
}))
vi.mock('@/store/gateway', () => ({
  activeGateway: () => null
}))

import { OnboardingChatDirective } from '@/components/onboarding-chat/directive'
import { resetLiveScreenForTests } from '@/store/first-screen-live'
import { $wizardAnswers, DEFAULT_ANSWERS } from '@/store/onboarding-wizard'

describe('context directive mounts the dashboard card', () => {
  beforeEach(() => {
    resetLiveScreenForTests()
    $wizardAnswers.set({ ...DEFAULT_ANSWERS })
  })

  afterEach(cleanup)

  it('stores the context value and shows the designing state without a second directive', async () => {
    render(<OnboardingChatDirective attrs={{ step: 'context', value: 'series a pr outreach' }} streaming={false} />)

    // The data effect landed the answer…
    await vi.waitFor(() => {
      expect($wizardAnswers.get().context).toBe('series a pr outreach')
    })

    // …and the card is ALREADY on screen in its designing state (no
    // ::onboarding{step="first-screen"} emission required).
    expect(screen.getByText(/designing your dashboard/i)).toBeTruthy()
  })

  it('renders nothing for a legacy first-screen directive (card lives at context)', () => {
    const { container } = render(<OnboardingChatDirective attrs={{ step: 'first-screen' }} streaming={false} />)

    expect(container.textContent).toBe('')
  })
})
