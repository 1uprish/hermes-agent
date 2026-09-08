/**
 * Login step — the one card of the login-mode run (animation → THIS →
 * in-chat guided setup).
 *
 * A trimmed provider step: same classic `$desktopOnboarding` store, same
 * `Picker`/`FlowPanel` machinery (OAuth PKCE/device-code, the featured Nous
 * Portal row, API keys behind the disclosure) — but framed as a sign-in
 * moment, not a settings screen. Completing a flow (or already having one
 * configured) flips the CTA to continue; skipping is always allowed, and the
 * in-chat guide picks up either way.
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

// Same scroll-flattening the provider step needs (classic picker carries its
// own max-h scrollers, the card body is already the scroll container).
const LOGIN_CSS = `
.wizard-login [class*='max-h-'] { max-height: none; overflow: visible; }
`

export function LoginStep() {
  const onboarding = useStore($desktopOnboarding)
  const ctx = useMemo(() => createWizardOnboardingContext(() => undefined), [])

  useEffect(() => {
    startManualOnboarding(null)

    return () => closeManualOnboarding()
  }, [])

  const { flow } = onboarding

  // The classic flow ends on a model-confirm card; auto-accept it here the
  // same way the provider step does — the login card closes on "Connected",
  // not on a second confirmation screen.
  useEffect(() => {
    if (flow.status === 'confirming_model' && !flow.saving) {
      confirmOnboardingModel(ctx)
    }
  }, [flow, ctx])

  // Sign-in landed: hold on "Connected" and let the surface auto-advance
  // (surface.tsx completes the run ~900ms after `configured` flips). WITHOUT
  // this hold, the classic flow resets to an idle picker after success and
  // the card re-renders a SECOND sign-in — users obliged (two device-code
  // logins in one first run, seen live in gui.log).
  if (onboarding.configured === true) {
    return (
      <div className="wizard-login">
        <Blurb>Connected. Your agent is thinking — one moment.</Blurb>
      </div>
    )
  }

  const showPicker = flow.status === 'idle' || flow.status === 'success' || flow.status === 'confirming_model'

  return (
    <div className="wizard-login">
      <style>{LOGIN_CSS}</style>
      <Blurb>
        Sign in with your Nous Portal account and Hermes is ready to think. Another provider or an API key works too
        — or skip and connect later in Settings.
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
