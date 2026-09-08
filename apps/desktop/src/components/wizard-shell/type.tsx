import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { FONT_SERIF } from './tokens'

/** Serif display heading. */
export function Title({ children }: { children: ReactNode }) {
  return (
    <h1
      className="mb-4 text-[48px] font-medium leading-[1.05] tracking-[-0.02em] text-foreground"
      style={{ fontFamily: FONT_SERIF }}
    >
      {children}
    </h1>
  )
}

export function Blurb({ children }: { children: ReactNode }) {
  return <p className="mb-5 max-w-[46ch] text-[14px] leading-relaxed text-muted-foreground">{children}</p>
}

/** The step's interactive block — full width, set off from the copy above by
 *  a consistent breath of air. */
export function StepControls({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('w-full pt-3', className)}>{children}</div>
}
