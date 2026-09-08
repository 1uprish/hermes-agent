import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { CARD_RADIUS, dragRegion, EASE } from '@/components/wizard-shell'
import { cn } from '@/lib/utils'
import {
  $firstScreenKind,
  buildTheaterBeats,
  compileFirstScreen,
  theaterDuration
} from '@/store/onboarding-first-screen'
import { $wizardAnswers } from '@/store/onboarding-wizard'

import { HERMES_BLUE } from './brand'
import { FirstScreenSurface, FirstScreenTheater } from './first-screen'

const FINALE_CSS = `
@keyframes wizard-finale-card-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes wizard-finale-card-out { from { opacity: 1 } to { opacity: 0 } }
@keyframes first-screen-block-in { from { opacity: 0; transform: translateY(6px) scale(0.98) } to { opacity: 1 } }
@keyframes first-screen-stage-in { from { opacity: 0; transform: translateY(10px) } to { opacity: 1 } }
`

/** The build sequence: the log narrates while the artifact assembles beside
 *  it, then the finished thing fills the card for one beat before handoff.
 *  One rAF clock drives every row, typewriter line, and block snap-in. The
 *  config compiles up front (pure) — a stalled clock strands only the
 *  animation, never the artifact. */
export function Finale({ leaving = false }: { leaving?: boolean }) {
  const answers = useStore($wizardAnswers)
  const pickedKind = useStore($firstScreenKind)
  const kind = pickedKind ?? 'dashboard'

  const config = useMemo(
    () => compileFirstScreen({ context: answers.context, focus: answers.focus, name: answers.name }, kind),
    // Compiled once at mount from the finished profile — the theater replays
    // it, it must not re-derive mid-sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const beats = useMemo(() => buildTheaterBeats(config), [config])
  const totalMs = useMemo(() => theaterDuration(config), [config])

  const [t, setT] = useState(0)
  const [reveal, setReveal] = useState(false)

  useEffect(() => {
    const start = performance.now()
    let raf = 0

    const tick = () => {
      const elapsed = performance.now() - start

      setT(elapsed)

      if (elapsed >= totalMs) {
        setReveal(true)

        return
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(raf)
  }, [totalMs])

  return (
    <div
      className={cn('flex size-full flex-col overflow-hidden', CARD_RADIUS)}
      style={{
        animation: leaving
          ? `wizard-finale-card-out 500ms ${EASE} both`
          : `wizard-finale-card-in 900ms ${EASE} both`,
        background: HERMES_BLUE,
        ...dragRegion(true)
      }}
    >
      <style>{FINALE_CSS}</style>

      {reveal ? (
        <div className="size-full" style={{ animation: `first-screen-stage-in 700ms ${EASE} both` }}>
          <FirstScreenSurface config={config} />
        </div>
      ) : (
        <FirstScreenTheater
          beats={beats}
          config={config}
          progressStyle={{ animation: `first-screen-stage-in 600ms ${EASE} both` }}
          t={t}
        />
      )}
    </div>
  )
}
