import { useStore } from '@nanostores/react'

import { $chatOnboardingSolo, $chatOnboardingThreadIds } from '@/components/onboarding-chat/assembly'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'

/**
 * True while the user is inside the first-run story — the solo guided chat,
 * or any thread the flow owns afterwards (Setup's chat, a bot-surface first
 * build). Chrome that would read as noise over those conversations checks
 * this: floating panels, the profile-swap spinner.
 *
 * Threads are matched on BOTH ids because consumers key sessions differently
 * (the thread list by stored id, the composer by runtime id).
 */
export function useOnboardingChatActive(): boolean {
  const solo = useStore($chatOnboardingSolo)
  const threadIds = useStore($chatOnboardingThreadIds)
  const runtimeId = useStore($activeSessionId)
  const storedId = useStore($selectedStoredSessionId)

  return (
    solo ||
    (runtimeId != null && threadIds.includes(runtimeId)) ||
    (storedId != null && threadIds.includes(storedId))
  )
}
