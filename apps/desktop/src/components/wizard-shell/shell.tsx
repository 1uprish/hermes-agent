/**
 * WizardShell — the generic Dia-style setup card. This component IS the card:
 * it fills its host 100%×100%, and the host decides what that means (a
 * transparent dedicated window sized to the card, or a centered box on a dim
 * ground). Reusable by any curated flow, not just first-run onboarding.
 *
 * Layout is a two-column grid: a content column (progress strip at the top,
 * keyed/animated body, pinned footer) on the theme surface, and an optional
 * media column bleeding flush to the card's top/right/bottom edges.
 *
 * Type reads pure black/white on this surface (Dia's registers): the text
 * tokens are overridden to the poles while the theme keeps owning surfaces,
 * controls, and the primary accent.
 */

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { useTheme } from '@/themes'

import { WizardProgress } from './progress'
import { CARD_RADIUS, dragRegion, EASE } from './tokens'

const SHELL_CSS = `
@keyframes wizard-card-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes wizard-shell-in { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
@keyframes wizard-step-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
.wizard-shell-drag :is(button, input, textarea, select, a, label, [role="slider"], [data-wizard-no-drag]) { -webkit-app-region: no-drag }
`

export interface WizardShellProps {
  /** Media column content. Bleeds flush to the card's top/right/bottom. */
  art?: ReactNode
  /** Media column width in px. */
  artWidth?: number
  children: ReactNode
  /** Rendered above the body, outside the slide — it fades in place on step
   *  change instead of riding the body's translate (steadier for titles). */
  header?: ReactNode
  /** Frameless-window affordance: the whole card drags the window (interactive
   *  elements opt out). */
  draggable?: boolean
  /** Pinned footer row (left/right groups laid out by the consumer). */
  footer?: ReactNode
  /** 0..1 — the accent bar across the content column's top. */
  progress: number
  /** Changing this key replays the body's entrance animation. */
  stepKey?: string
}

export function WizardShell({
  art,
  artWidth = 225,
  children,
  draggable = true,
  footer,
  header,
  progress,
  stepKey
}: WizardShellProps) {
  const { renderedMode } = useTheme()
  const dark = renderedMode === 'dark'

  return (
    <div
      className={cn(
        // No border — the host's shadow defines the edge, and a border would
        // inset the media column by a pixel (the art must touch the edge).
        'relative grid size-full overflow-hidden bg-background text-foreground',
        // The whole card is the drag handle (Dia-style frameless window);
        // interactive elements opt back out via the SHELL_CSS rule above.
        draggable && 'wizard-shell-drag',
        CARD_RADIUS
      )}
      style={{
        // Tour-style entrance: the card slides up + fades in over the bare
        // desktop (the host window is transparent). The tiny delay keeps the
        // first painted frame invisible so the OS window reveal can't clip
        // the start of the motion.
        animation: `wizard-shell-in 650ms ${EASE} 80ms both`,
        gridTemplateColumns: art ? `minmax(0, 1fr) ${artWidth}px` : 'minmax(0, 1fr)',
        ['--dt-foreground' as string]: dark ? '#ffffff' : '#000000',
        ['--dt-muted-foreground' as string]: dark ? 'rgba(255, 255, 255, 0.65)' : 'rgba(0, 0, 0, 0.6)',
        ...dragRegion(draggable)
      }}
    >
      <style>{SHELL_CSS}</style>

      {/* Content column: progress flush at the top (scoped to this column so
          the media column keeps the full right edge), body, pinned footer. */}
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="shrink-0">
          <WizardProgress value={progress} />
        </div>
        {header && (
          <div
            className="shrink-0 px-6 pt-8"
            key={stepKey && `header-${stepKey}`}
            style={{ animation: `wizard-card-in 500ms ${EASE} both` }}
          >
            {header}
          </div>
        )}
        <div
          className={cn('flex min-h-0 flex-1 flex-col px-6 pb-4', !header && 'pt-8')}
          key={stepKey}
          style={{ animation: `wizard-step-in 500ms ${EASE} both` }}
        >
          {children}
        </div>
        {footer && <div className="flex items-center justify-between px-6 pb-5 pt-2">{footer}</div>}
      </div>

      {/* Media column. Bleeds 1px past the card's top/right/bottom (negative
          margins) so fractional-pixel layout rounding can never leave a
          background sliver — the card's radius clips it back. */}
      {art && (
        <div aria-hidden className="relative -my-px -mr-px overflow-hidden">
          {art}
        </div>
      )}
    </div>
  )
}
