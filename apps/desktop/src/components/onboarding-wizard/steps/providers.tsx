/**
 * Provider step — the classic provider onboarding, re-homed in the wizard.
 *
 * 1:1 feature parity comes from REUSE, not reimplementation: this step drives
 * the same `$desktopOnboarding` store and renders the same `Picker` /
 * `FlowPanel` the classic overlay does — OAuth (PKCE, device-code, external
 * CLI), the featured Nous row, the full API-key catalog with the local/custom
 * endpoint form, and the model-confirm card. Only the chrome is the wizard's.
 *
 * The step is optional by design: the accountless path never builds it into
 * the run (see `buildSteps`), and even when present the footer's Next lets
 * the user move on unconfigured — same spirit as "I'll choose a provider
 * later". Completing a flow keeps the user here, on the picker with its
 * Connected badge; the model-confirm card is auto-accepted (see below).
 */

import { useStore } from '@nanostores/react'
import { useEffect, useMemo } from 'react'

import { Picker } from '@/components/onboarding'
import { FlowPanel } from '@/components/onboarding/flow'
import { Blurb, StepControls } from '@/components/wizard-shell'
import {
  $desktopOnboarding,
  closeManualOnboarding,
  confirmOnboardingModel,
  startManualOnboarding
} from '@/store/onboarding'

import { createWizardOnboardingContext } from '../gateway'

// The classic picker caps its lists with their own `max-h` scrollers (sized
// for the full-screen overlay). Inside the wizard card that nests scrollbars
// three deep — the step body is already the scroll container, so the inner
// ones are flattened out.
const PROVIDERS_CSS = `
.wizard-providers [class*='max-h-'] { max-height: none; overflow: visible; }
`

export function ProvidersStep() {
  const onboarding = useStore($desktopOnboarding)
  // Completion stays on this step: the picker re-renders with the provider's
  // "Connected" badge and the user moves on with the footer's Next — the
  // wizard never yanks them forward.
  const ctx = useMemo(() => createWizardOnboardingContext(() => undefined), [])

  // Manual mode is the exact contract this step needs from the classic store:
  // the picker shows regardless of configured state, the provider list
  // refreshes, and the first-run "choose later" escape stays hidden (the
  // wizard footer already owns skip/next). Leaving the step mid-flow cancels
  // cleanly back to idle.
  useEffect(() => {
    startManualOnboarding(null)

    return () => closeManualOnboarding()
  }, [])

  const { flow } = onboarding

  // The classic flow ends on a "default model / [BEGIN]" confirm card. In the
  // wizard that screen is noise — accept the default model the moment it
  // lands and let the picker show the Connected badge instead. (The model
  // stays changeable later in Settings.)
  useEffect(() => {
    if (flow.status === 'confirming_model' && !flow.saving) {
      confirmOnboardingModel(ctx)
    }
  }, [flow, ctx])

  const showPicker = flow.status === 'idle' || flow.status === 'success' || flow.status === 'confirming_model'

  return (
    <div className="wizard-providers">
      <style>{PROVIDERS_CSS}</style>
      <Blurb>
        Hermes needs a model to think with. Sign in with a provider or paste an API key — or skip for now and set it
        up later in Settings.
      </Blurb>
      <StepControls>
        {showPicker ? (
          <Picker ctx={ctx} />
        ) : (
          <FlowPanel ctx={ctx} flow={flow} leaving={false} onBegin={() => confirmOnboardingModel(ctx)} />
        )}
      </StepControls>
    </div>
  )
}
