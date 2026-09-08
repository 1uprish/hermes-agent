/**
 * The onboarding option catalog — accents, layouts, focus tags — plus the
 * small pickers that draw them. Shared by BOTH onboarding surfaces: the
 * wizard window's steps and the in-chat guided setup (`::onboarding{…}`
 * transcript cards), so the two paths always offer the same choices.
 */

import { Tip } from '@/components/ui/tooltip'
import { selectableClass } from '@/components/wizard-shell'
import { cn } from '@/lib/utils'

export const FOCUS_OPTIONS = ['Coding', 'Writing', 'Research', 'Automation', 'Messaging', 'Just exploring']

// Fake for now — stored, surfaced later when connectors ship for real. Marks
// resolve through the shared ConnectorLogo ladder: curated brand glyph first,
// the product's own favicon where simple-icons has no mark (Slack's left over
// trademark), monogram last.
export const CONNECTORS: Array<{ homepage?: string; id: string; name: string }> = [
  { id: 'gmail', name: 'Gmail' },
  { id: 'google-calendar', name: 'Calendar' },
  { id: 'google-drive', name: 'Drive' },
  { homepage: 'https://slack.com', id: 'slack', name: 'Slack' },
  { id: 'github', name: 'GitHub' },
  { id: 'notion', name: 'Notion' },
  { id: 'linear', name: 'Linear' },
  { id: 'figma', name: 'Figma' },
  { id: 'discord', name: 'Discord' },
  { id: 'telegram', name: 'Telegram' },
  { id: 'spotify', name: 'Spotify' },
  { id: 'stripe', name: 'Stripe' }
]

// Big accent swatches, Dia-style. Each seeds `retintTheme` through the accent
// override, so a click repaints the surface live. Nous blue is the default =
// no override. Mono seeds the current mode's pole — black in light, white in
// dark — for a full monochrome look.
export const NOUS_ACCENT = '#0053fd'

export const accentsFor = (dark: boolean): Array<{ hex: string; name: string }> => [
  { hex: dark ? '#ffffff' : '#000000', name: 'Mono' },
  { hex: '#2ea043', name: 'GitHub green' },
  { hex: '#00d5ff', name: 'Cyber cyan' },
  { hex: NOUS_ACCENT, name: 'Nous blue' },
  { hex: '#8a2be2', name: 'Ultraviolet' },
  { hex: '#e0218a', name: 'Barbie pink' },
  { hex: '#ff073a', name: 'Electric red' }
]

export function AccentSwatch({
  active,
  hex,
  name,
  onPick
}: {
  active: boolean
  hex: string
  name: string
  onPick: () => void
}) {
  return (
    <Tip label={name}>
      <button
        aria-label={name}
        aria-pressed={active}
        className={cn(
          // The hairline keeps the mono swatch visible on its own pole.
          'size-9 rounded-full border border-foreground/15 transition-transform duration-150',
          !active && 'hover:scale-105'
        )}
        onClick={onPick}
        style={{
          background: hex,
          boxShadow: active ? `0 0 0 2px var(--dt-background), 0 0 0 4px ${hex}` : undefined
        }}
        type="button"
      />
    </Tip>
  )
}

// Mini layout trees — the two starting layouts, mirroring the real preset
// trees in app/contrib/controller.tsx (BASIC_TREE / TERMINAL_TREE), drawn in
// the layout editor's thumbnail language, upscaled.
export type MiniNode = number | { dir: 'column' | 'row'; children: MiniNode[]; weights: number[] }

/** The power-user layout. Picking it is the most explicit thing a user does
 *  in the whole first run to say how they work, so it also decides where
 *  their first build lands (see `defaultHandoffSurface`). */
export const ELITE_LAYOUT_ID = 'terminal-deck'

export const LAYOUTS: Array<{ id: string; name: string; tree: MiniNode }> = [
  { id: 'basic', name: 'Basic', tree: { children: [1, 1], dir: 'row', weights: [1, 4.6] } },
  {
    id: ELITE_LAYOUT_ID,
    name: 'Elite',
    tree: {
      children: [{ children: [1, 1, 1], dir: 'row', weights: [1, 3.2, 1.2] }, 1],
      dir: 'column',
      weights: [3, 1]
    }
  }
]

export function MiniTree({ node }: { node: MiniNode }) {
  if (typeof node === 'number') {
    return <div className="min-h-0 min-w-0 flex-1 rounded-[3px] bg-foreground/15" />
  }

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 gap-1', node.dir === 'row' ? 'flex-row' : 'flex-col')}>
      {node.children.map((child, i) => (
        <div className="flex min-h-0 min-w-0" key={i} style={{ flex: `${node.weights[i]} ${node.weights[i]} 0px` }}>
          <MiniTree node={child} />
        </div>
      ))}
    </div>
  )
}

export function LayoutPreviewCard({
  active,
  name,
  onSelect,
  tree
}: {
  active: boolean
  name: string
  onSelect: () => void
  tree: MiniNode
}) {
  return (
    <button aria-pressed={active} className="group flex flex-col items-center gap-2" onClick={onSelect} type="button">
      <span className={cn('flex aspect-[10/7] w-full flex-col gap-1.5 rounded-[8px] p-2', selectableClass(active))}>
        <span aria-hidden className="flex gap-1">
          <span className="size-1.5 rounded-full bg-[#ff5f57]" />
          <span className="size-1.5 rounded-full bg-[#febc2e]" />
          <span className="size-1.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="flex min-h-0 flex-1">
          <MiniTree node={tree} />
        </span>
      </span>
      <span className={cn('text-xs', active ? 'text-foreground' : 'text-muted-foreground')}>{name}</span>
    </button>
  )
}
