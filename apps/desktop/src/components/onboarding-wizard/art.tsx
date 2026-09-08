/**
 * The wizard's media column — the landing page's engraving art over pure
 * Hermes blue (nousnet-web's hero/feature treatment: `mix-blend-lighten`,
 * `object-cover`). Each step carries its own plate; steps crossfade between
 * them on the shared blue ground.
 *
 * A picked accent retints the whole column with a hue-rotate/saturate filter:
 * both preserve neutrals, so the white engraving stays white while the blue
 * ground (and the plates' baked-in blue) swing to the accent. Approximate on
 * purpose — it's a live echo of the pick, not color management.
 */

import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'

import { EASE } from '@/components/wizard-shell'
import { cn } from '@/lib/utils'
import { $wizardAnswers, type WizardStepId } from '@/store/onboarding-wizard'

import { assetPath, HERMES_BLUE } from './brand'

interface Plate {
  /** `object-position` focal point — where the interesting part of the plate
   *  lives, since the narrow column only shows a slice of each image. */
  position?: string
  src: string
}

/** One engraving per step, from the Hermes site's art set. */
const STEP_ART: Partial<Record<WizardStepId, Plate>> = {
  appearance: { src: 'onboarding/art-angel.webp' },
  connectors: { src: 'onboarding/art-hermes-run.webp' },
  'first-screen': { src: 'onboarding/art-sandbox.webp' },
  login: { position: '71% 40%', src: 'onboarding/art-hermes-dither.webp' },
  personalize: { src: 'onboarding/art-caduceus.webp' },
  providers: { position: '71% 40%', src: 'onboarding/art-hermes-dither.webp' },
  system: { src: 'onboarding/art-sandbox.webp' },
  welcome: { src: 'onboarding/hero-art.webp' }
}

const PLATES = [...new Map(Object.values(STEP_ART).map(plate => [plate.src, plate])).values()]

/** HERMES_BLUE in HSL — the ground every rotation is measured from. */
const BLUE_HUE = 240

/** CSS filter carrying a hex accent's hue/saturation, relative to pure blue. */
function accentFilter(hex: string | null | undefined): string | undefined {
  if (!hex) {
    return undefined
  }

  const match = /^#([0-9a-f]{6})$/i.exec(hex)

  if (!match) {
    return undefined
  }

  const int = parseInt(match[1], 16)
  const r = ((int >> 16) & 0xff) / 255
  const g = ((int >> 8) & 0xff) / 255
  const b = (int & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  if (delta === 0) {
    return 'saturate(0)'
  }

  let hue: number

  if (max === r) {
    hue = ((g - b) / delta) % 6
  } else if (max === g) {
    hue = (b - r) / delta + 2
  } else {
    hue = (r - g) / delta + 4
  }

  hue = (hue * 60 + 360) % 360
  const saturation = delta / (1 - Math.abs(max + min - 1))

  return `hue-rotate(${Math.round(hue - BLUE_HUE)}deg) saturate(${saturation.toFixed(2)})`
}

const TINT_FADE_CSS = `
@keyframes wizard-art-tint-in { from { opacity: 0 } to { opacity: 1 } }
`

function ArtLayer({ active, filter }: { active: string | undefined; filter: string | undefined }) {
  return (
    <div className="absolute inset-0" style={{ background: HERMES_BLUE, filter }}>
      {/* All plates stay mounted (they're local assets) so the crossfade never
          flashes the bare ground while a newly-shown image decodes. */}
      {PLATES.map(plate => (
        <img
          alt=""
          className={cn(
            'absolute inset-0 size-full object-cover mix-blend-lighten transition-opacity duration-700',
            plate.src === active ? 'opacity-100' : 'opacity-0'
          )}
          key={plate.src}
          src={assetPath(plate.src)}
          style={{ objectPosition: plate.position, transitionTimingFunction: EASE }}
        />
      ))}
    </div>
  )
}

export function StepArt({ step }: { step: WizardStepId }) {
  const accent = useStore($wizardAnswers).accent
  const filter = useMemo(() => accentFilter(accent), [accent])
  const active = (STEP_ART[step] ?? STEP_ART.welcome)?.src

  // Accent changes CROSSFADE between the old and new tint. Transitioning the
  // filter itself tweens the hue-rotate angle, which sweeps through every hue
  // in between — green → purple visibly bounced off blue (0°) mid-tween. Two
  // stacked layers fading is a direct blend.
  const [tint, setTint] = useState<{ from?: string | undefined; to: string | undefined }>({ to: filter })

  if (tint.to !== filter) {
    setTint({ from: tint.to, to: filter })
  }

  // `from: undefined` is a real fade origin (the unfiltered default blue) —
  // presence of the key, not its value, says a fade is in flight.
  const fading = 'from' in tint

  return (
    <div className="absolute inset-0">
      <style>{TINT_FADE_CSS}</style>
      {fading && <ArtLayer active={active} filter={tint.from} />}
      <div
        className="absolute inset-0"
        key={tint.to ?? 'none'}
        onAnimationEnd={() => setTint({ to: filter })}
        style={fading ? { animation: `wizard-art-tint-in 450ms ${EASE} both` } : undefined}
      >
        <ArtLayer active={active} filter={tint.to} />
      </div>
    </div>
  )
}
