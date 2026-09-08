import type { WizardStepId } from '@/store/onboarding-wizard'

export interface StepDef {
  cta: string
  title: string
}

export const STEP_DEFS: Record<WizardStepId, StepDef> = {
  appearance: { cta: 'Next', title: 'Pick your look' },
  connectors: { cta: 'Next', title: 'Connect your world' },
  finale: { cta: '', title: '' },
  'first-screen': { cta: 'Build it', title: 'Pick your first screen' },
  login: { cta: 'Continue', title: 'Sign in to Hermes' },
  personalize: { cta: 'Next', title: 'Make it yours' },
  providers: { cta: 'Next', title: 'Connect intelligence' },
  system: { cta: 'Next', title: 'Make Hermes at home' },
  welcome: { cta: "Let's go", title: 'Welcome to Hermes' }
}
