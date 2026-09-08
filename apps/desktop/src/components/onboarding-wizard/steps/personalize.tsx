import { useStore } from '@nanostores/react'

import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Blurb, Chip, StepControls } from '@/components/wizard-shell'
import { $wizardAnswers, setWizardAnswers } from '@/store/onboarding-wizard'

import { FOCUS_OPTIONS } from '../options'

export function PersonalizeStep() {
  const answers = useStore($wizardAnswers)

  return (
    <div>
      <Blurb>Hermes adapts to you — a name and a sense of what you&apos;re here for is enough to start.</Blurb>

      <StepControls className="grid gap-5">
        <Field htmlFor="wizard-name" label="What should Hermes call you?">
          <Input
            autoFocus
            id="wizard-name"
            onChange={event => setWizardAnswers({ name: event.target.value })}
            placeholder="Your name"
            value={answers.name}
          />
        </Field>

        <Field label="What do you want help with?">
          {/* Free-flowing tag cloud; the max-width breaks it into two rows. */}
          <div className="flex max-w-[290px] flex-wrap gap-2">
            {FOCUS_OPTIONS.map(option => (
              <Chip
                key={option}
                label={option}
                on={answers.focus.includes(option)}
                variant="pill"
                onToggle={() =>
                  setWizardAnswers({
                    focus: answers.focus.includes(option)
                      ? answers.focus.filter(item => item !== option)
                      : [...answers.focus, option]
                  })
                }
              />
            ))}
          </div>
        </Field>
      </StepControls>
    </div>
  )
}
