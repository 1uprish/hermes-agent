/**
 * Wizard step bodies. Each step edits `$wizardAnswers` (persisted live) and
 * the surface owns navigation — a body never advances the wizard itself (the
 * one exception: the provider step advances when a provider flow completes).
 */

import type { WizardStepId } from '@/store/onboarding-wizard'

import { AppearanceStep } from './appearance'
import { ConnectorsStep } from './connectors'
import { FirstScreenStep } from './first-screen'
import { LoginStep } from './login'
import { PersonalizeStep } from './personalize'
import { ProvidersStep } from './providers'
import { SystemStep } from './system'
import { WelcomeStep } from './welcome'

export { STEP_DEFS, type StepDef } from './defs'

export function WizardStepBody({ step }: { step: WizardStepId }) {
  switch (step) {
    case 'welcome':
      return <WelcomeStep />

    case 'personalize':
      return <PersonalizeStep />

    case 'connectors':
      return <ConnectorsStep />

    case 'appearance':
      return <AppearanceStep />

    case 'system':
      return <SystemStep />

    case 'providers':
      return <ProvidersStep />

    case 'first-screen':
      return <FirstScreenStep />

    case 'login':
      return <LoginStep />

    default:
      return null
  }
}
