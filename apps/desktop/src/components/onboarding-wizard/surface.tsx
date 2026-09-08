/**
 * The onboarding wizard card — the generic WizardShell dressed in the Hermes
 * brand: per-step engraving art on the media column, Sigurd display type, and
 * the step bodies. The host decides what "fills 100%×100%" means:
 *
 * - Dedicated window (`?win=onboarding`): the transparent window is sized to
 *   the card, so the card's radius is the window shape and the desktop sits
 *   directly behind it. Native window shadow, no CSS lift.
 * - Browser fallback (gate, dev/screenshots): a wrapper centers a card-sized
 *   box on a plain ground.
 *
 * Not dismissable: Esc does nothing; Enter advances (except on the provider
 * step, whose forms own the key). The escape hatch is the explicit "Skip
 * setup" link. The finale is a pure-ground cinematic that auto-advances into
 * the app.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Title, WizardShell } from '@/components/wizard-shell'
import { $desktopOnboarding } from '@/store/onboarding'
import {
  $firstScreenKind,
  compileFirstScreen,
  theaterDuration
} from '@/store/onboarding-first-screen'
import {
  $onboardingWizard,
  $wizardAnswers,
  backWizardStep,
  nextWizardStep,
  onboardingDevStage,
  skipOnboardingWizard,
  wizardStepIndex
} from '@/store/onboarding-wizard'
import { useTheme } from '@/themes'
import { setAccentOverride } from '@/themes/accent-override'

import { StepArt } from './art'
import { FONT_CSS } from './brand'
import { Finale } from './finale'
import { STEP_DEFS, WizardStepBody } from './steps'

/** Hold AFTER the theater's reveal — how long the finished screen fills the
 *  card before the app takes over. The theater's own duration comes from the
 *  compiled config (see the finale timer below). */
const FINALE_HOLD_MS = 2400
/** The card's dissolve after the hold, before the window closes. Matches the
 *  `wizard-finale-card-out` duration in finale.tsx. */
const FINALE_LEAVE_MS = 500

export interface WizardSurfaceProps {
  /** Called when the finale finishes — commit answers and start the chat. */
  onComplete: () => void
  /** Skip override for the dedicated window (reports the outcome over IPC).
   *  Defaults to marking the wizard done in-place. */
  onSkip?: () => void
}

export function WizardSurface({ onComplete, onSkip }: WizardSurfaceProps) {
  const wizard = useStore($onboardingWizard)
  const accented = Boolean(useStore($wizardAnswers).accent)
  const [finaleLeaving, setFinaleLeaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { previewTheme, renderedMode, themeName } = useTheme()
  const dark = renderedMode === 'dark'
  const index = wizardStepIndex(wizard)
  const step = wizard.step
  const finale = step === 'finale'
  // Progress excludes the finale — the bar completes on the last real step.
  const progress = Math.min(1, (index + 1) / Math.max(1, wizard.steps.length - 1))

  // Answers persist but the live accent override doesn't — reseed it on mount
  // so a reopened wizard resumes with the picked tint already painted.
  useEffect(() => {
    setAccentOverride($wizardAnswers.get().accent)
  }, [])

  // Enter advances (unless a control that owns Enter is focused); Esc is a
  // deliberate no-op — onboarding is skipped through the explicit link. The
  // provider step opts out entirely: its forms (auth codes, API keys) own
  // Enter, and a stray advance mid-flow would abandon the sign-in.
  useEffect(() => {
    if (finale || step === 'providers' || step === 'login') {
      return
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing || event.defaultPrevented) {
        return
      }

      const target = event.target as HTMLElement | null

      if (target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) {
        return
      }

      event.preventDefault()
      nextWizardStep()
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [finale, step])

  // TEMP dev-only: 'x' flips light/dark. Preview paint — nothing persisted,
  // so the real system-derived mode is untouched. Remove before ship.
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'x' || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      const target = event.target as HTMLElement | null

      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return
      }

      previewTheme(themeName, renderedMode === 'dark' ? 'light' : 'dark')
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [previewTheme, renderedMode, themeName])

  // A step body that autofocuses a control below the fold (the provider
  // step's key input) would drag the scroll container down on entry, hiding
  // the step's own copy. Focus lands during commit; this runs after — the
  // step always opens from its top.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [step])

  // Login mode auto-advance: the moment sign-in lands (classic store flips
  // configured), the card completes itself after a short "Connected" beat.
  // The old shape waited for a Continue click — and a user who reads
  // "Connected ✓" as done CLOSES the window instead, which the gate reads
  // as a dismissal and the classic overlay then pops a SECOND sign-in.
  // No click, no closable gap.
  const configured = useStore($desktopOnboarding).configured === true

  useEffect(() => {
    if (step !== 'login' || !configured) {
      return
    }

    const settle = window.setTimeout(onComplete, 900)

    return () => window.clearTimeout(settle)
  }, [configured, onComplete, step])

  // Finale: the build theater runs its own rAF clock inside Finale; the
  // surface waits for its duration (config-dependent) plus a hold on the
  // revealed artifact, then hands the app over. The onboarding-only dev entry
  // (`npm run dev:onboarding`) pauses the wizard one step earlier so the whole
  // finale can be iterated on from the store without a timer racing it.
  const finaleMs = useMemo(
    () => {
      const a = $wizardAnswers.get()
      const kind = $firstScreenKind.get() ?? 'dashboard'

      return theaterDuration(compileFirstScreen({ context: a.context, focus: a.focus, name: a.name }, kind))
    },
    // Recomputed only when the finale mounts — the profile is final by then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finale]
  )

  useEffect(() => {
    if (!finale || onboardingDevStage() === 'wizard') {
      return
    }

    const hold = window.setTimeout(() => setFinaleLeaving(true), finaleMs + FINALE_HOLD_MS)
    const done = window.setTimeout(onComplete, finaleMs + FINALE_HOLD_MS + FINALE_LEAVE_MS)

    return () => {
      window.clearTimeout(hold)
      window.clearTimeout(done)
    }
  }, [finale, finaleMs, onComplete])

  if (finale) {
    return (
      <>
        <style>{FONT_CSS}</style>
        <Finale leaving={finaleLeaving} />
      </>
    )
  }

  const def = STEP_DEFS[step]
  // The closing step reads "Ready" wherever it lands — which step is last
  // depends on the provider gate, so it's decided by position, not by id.
  // A single-step run (login mode) keeps its own CTA.
  const cta = wizard.steps.length > 1 && index >= wizard.steps.length - 2 ? 'Ready' : def.cta
  // The classic run ends through the finale's timer; a run WITHOUT a finale
  // (login mode) completes straight from the footer CTA. (The finale itself
  // returned above, so reaching here on the last step means there is none.)
  const lastAndNoFinale = index >= wizard.steps.length - 1

  return (
    <>
      <style>{FONT_CSS}</style>
      <WizardShell
        art={<StepArt step={step} />}
        footer={
          <>
            <Button onClick={onSkip ?? skipOnboardingWizard} size="inline" variant="text">
              {step === 'login' ? 'Skip sign-in' : 'Skip setup'}
            </Button>

            <div className="flex items-center gap-2.5">
              {index > 0 && (
                <Button onClick={backWizardStep} size="lg" variant="ghost">
                  Back
                </Button>
              )}
              <Button
                autoFocus
                onClick={lastAndNoFinale ? onComplete : nextWizardStep}
                size="lg"
                // Dark derives a light-blue/dark-text primary for contrast; the
                // CTA stays electric blue + white in both modes. Once the user
                // picks an accent the retinted primary takes over — the pick
                // must visibly repaint this button.
                style={
                  dark && !accented
                    ? {
                        ['--dt-primary' as string]: '#0053fd',
                        ['--dt-primary-foreground' as string]: '#ffffff'
                      }
                    : undefined
                }
              >
                {cta}
                <span aria-hidden className="text-[12px] text-primary-foreground/60">
                  ↵
                </span>
              </Button>
            </div>
          </>
        }
        header={<Title>{def.title}</Title>}
        progress={progress}
        stepKey={step}
      >
        {/* no-drag: a drag region swallows wheel events in Electron, which
            would make this — the step's one scroll container — unscrollable. */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1" data-wizard-no-drag ref={bodyRef}>
          <WizardStepBody step={step} />
        </div>
      </WizardShell>
    </>
  )
}
