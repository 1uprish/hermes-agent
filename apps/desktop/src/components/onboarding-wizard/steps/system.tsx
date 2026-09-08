import { useStore } from '@nanostores/react'

import { Blurb, StepControls, ToggleRow } from '@/components/wizard-shell'
import { $wizardAnswers, setWizardAnswers } from '@/store/onboarding-wizard'

export function SystemStep() {
  const answers = useStore($wizardAnswers)

  return (
    <div>
      <Blurb>Small things that make Hermes feel like part of your machine.</Blurb>
      <StepControls className="flex flex-col gap-3">
        <ToggleRow
          label="Keep Hermes in your Dock"
          on={answers.keepInDock}
          onToggle={() => setWizardAnswers({ keepInDock: !answers.keepInDock })}
          sub="One click away, always"
        />
        <ToggleRow
          label="Open Hermes at login"
          on={answers.openAtLogin}
          onToggle={() => setWizardAnswers({ openAtLogin: !answers.openAtLogin })}
          sub="Your agent is ready when you are"
        />
      </StepControls>
    </div>
  )
}
