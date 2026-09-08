/**
 * Wizard-shell design tokens. The shell is a generic surface: colors come from
 * the active theme; these are the shape/motion/type constants every consumer
 * shares.
 */

import type { CSSProperties } from 'react'

export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/** The card's corner radius — one shape shared by every full-bleed state so a
 *  transparent host window keeps a single silhouette. */
export const CARD_RADIUS = 'rounded-[10px]'

/** Display faces. Sigurd/Courier are loaded by the consumer (@font-face);
 *  when absent the stacks fall back gracefully. */
export const FONT_SERIF = "'Sigurd', ui-serif, Georgia, serif"
export const FONT_MONO = "'Courier Prime', ui-monospace, monospace"

/** Frameless-window drag region (no-op outside a dedicated window). */
export const dragRegion = (on: boolean): CSSProperties | undefined =>
  on ? ({ WebkitAppRegion: 'drag' } as CSSProperties) : undefined
