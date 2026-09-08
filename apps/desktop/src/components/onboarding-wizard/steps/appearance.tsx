import { useStore } from '@nanostores/react'

import { Field } from '@/components/ui/field'
import { Blurb, StepControls } from '@/components/wizard-shell'
import { $wizardAnswers, setWizardAnswers } from '@/store/onboarding-wizard'
import { useTheme } from '@/themes'
import { setAccentOverride } from '@/themes/accent-override'

import { AccentSwatch, accentsFor, LAYOUTS, LayoutPreviewCard, NOUS_ACCENT } from '../options'

export function AppearanceStep() {
  const answers = useStore($wizardAnswers)
  const { renderedMode } = useTheme()
  const accents = accentsFor(renderedMode === 'dark')
  const accent = answers.accent ?? NOUS_ACCENT

  const pickAccent = (hex: string) => {
    const seed = hex === NOUS_ACCENT ? null : hex

    setWizardAnswers({ accent: seed })
    setAccentOverride(seed)
  }

  return (
    <div>
      <Blurb>Pick the color and layout that feel right for you — change both anytime.</Blurb>

      <StepControls className="grid gap-6">
        <div className="flex flex-wrap justify-between">
          {accents.map(swatch => (
            <AccentSwatch
              active={accent.toLowerCase() === swatch.hex}
              hex={swatch.hex}
              key={swatch.name}
              name={swatch.name}
              onPick={() => pickAccent(swatch.hex)}
            />
          ))}
        </div>

        <Field label="Choose your vibe">
          <div className="grid max-w-[400px] grid-cols-2 gap-3 pt-0.5">
            {LAYOUTS.map(layout => (
              <LayoutPreviewCard
                active={answers.layout === layout.id}
                key={layout.id}
                name={layout.name}
                onSelect={() => setWizardAnswers({ layout: layout.id })}
                tree={layout.tree}
              />
            ))}
          </div>
        </Field>
      </StepControls>
    </div>
  )
}
