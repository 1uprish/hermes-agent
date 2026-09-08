import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { selectableClass } from '@/components/wizard-shell'
import { Blurb, StepControls } from '@/components/wizard-shell'
import { cn } from '@/lib/utils'
import {
  $firstScreenKind,
  compileFirstScreen,
  type FirstScreenConfig,
  type FirstScreenKind,
  setFirstScreenKind
} from '@/store/onboarding-first-screen'
import { $wizardAnswers } from '@/store/onboarding-wizard'

import { FirstScreenPreview } from '../first-screen'

const OPTIONS: Array<{ blurb: string; kind: FirstScreenKind; title: string }> = [
  {
    blurb: 'Buttons that start things. Morning brief, drafts, feeds — one click each.',
    kind: 'dashboard',
    title: 'Dashboard'
  },
  {
    blurb: 'A page that arrives written for you. Your interests, a cadence you set.',
    kind: 'document',
    title: 'Document'
  },
  {
    blurb: 'One small machine: drop something in, get one shaped thing out.',
    kind: 'app',
    title: 'App'
  }
]

/** The pick lives in the profile-keyed store (not the answers blob) so the
 *  dev boot wipe can't reset the card mid-iteration. The compiled config —
 *  the same one the theater plays and the reveal shows — renders into a live
 *  thumbnail on each card, so the user picks their actual thing, not a label. */
export function FirstScreenStep() {
  const answers = useStore($wizardAnswers)
  const picked = useStore($firstScreenKind)
  const profile = { context: answers.context, focus: answers.focus, name: answers.name }

  return (
    <div>
      <Blurb>
        We&apos;ll build your first screen from what you&apos;ve told us — you just pick the shape.
      </Blurb>

      <StepControls className="flex flex-col gap-3">
        {OPTIONS.map(option => {
          const config: FirstScreenConfig = compileFirstScreen(profile, option.kind)

          return (
            <Button
              className={cn(
                'group h-auto items-center gap-3 px-3 py-3 text-left',
                selectableClass(picked === option.kind)
              )}
              key={option.kind}
              onClick={() => setFirstScreenKind(option.kind)}
              type="button"
              variant="ghost"
            >
              <div className="w-[120px] shrink-0">
                <FirstScreenPreview config={config} />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-medium">{option.title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{option.blurb}</div>
              </div>
            </Button>
          )
        })}
      </StepControls>
    </div>
  )
}
