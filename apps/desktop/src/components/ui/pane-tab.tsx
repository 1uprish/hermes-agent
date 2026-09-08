import './pane-tab.css'

import * as React from 'react'

import { type MenuKit, renderActionItem } from '@/components/ui/actions-menu'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { translateNow } from '@/i18n'
import { isMetaClose, middleClickHandlers } from '@/lib/middle-click'
import { cn } from '@/lib/utils'

/** Inset stroke for a vertical tab rail — content-facing edge. */
export const PANE_TAB_STRIP_LINE_LEFT = 'shadow-[inset_1px_0_0_var(--ui-stroke-tertiary)]'
export const PANE_TAB_STRIP_LINE_RIGHT = 'shadow-[inset_-1px_0_0_var(--ui-stroke-tertiary)]'

// Vertical rails retain their glass-aware surface. Horizontal faces and
// gutters are resolved together in pane-tab.css so their contrast survives Glass.
const TAB =
  'group/tab relative flex shrink-0 items-center border-transparent bg-(--tab-bg) text-[0.6875rem] font-medium [-webkit-app-region:no-drag] [--tab-face:var(--tab-bg)] [--tab-bg:var(--glass-field,var(--tab-surface))]'

// Horizontal tabs share Chrome's curved silhouette; vertical rails stay compact.
const TAB_HORIZONTAL = 'pane-tab-horizontal min-w-0'

// Closeable tabs keep a floor; horizontal geometry reserves the close slot.
const TAB_CLOSEABLE = 'min-w-13'

const TAB_VERTICAL =
  'w-full max-h-48 justify-center not-first:border-t not-first:border-t-(--ui-stroke-quaternary) [writing-mode:vertical-rl]'

const TAB_ACTIVE =
  'h-full text-foreground [--tab-surface:var(--pane-tab-active-bg,var(--ui-editor-surface-background))]'

// Vertical rails keep their existing darkening hover wash.
const TAB_IDLE =
  'text-(--ui-text-tertiary) [--tab-surface:var(--pane-tab-strip-bg,var(--ui-sidebar-surface-background))] hover:shadow-[inset_0_0_0_100vmax_color-mix(in_srgb,#000_var(--ui-tab-hover-darken),transparent)] hover:[--tab-face:color-mix(in_srgb,#000_var(--ui-tab-hover-darken),var(--tab-bg))] hover:text-(--ui-text-secondary)'

// Selected rails use an accent wash; horizontal faces get the same tint in CSS.
const TAB_SELECTED =
  '[background-image:linear-gradient(color-mix(in_srgb,var(--ui-accent)_14%,transparent),color-mix(in_srgb,var(--ui-accent)_14%,transparent))] [--tab-face:color-mix(in_srgb,var(--ui-accent)_14%,var(--tab-bg))] text-foreground'

interface PaneTabProps extends React.ComponentProps<'div'> {
  active?: boolean
  dirty?: boolean
  hoverTitle?: React.ReactNode
  hoverDescription?: React.ReactNode
  /** Close verb. Horizontal tabs reserve a compact ✕ on the right;
   *  middle-click and ⌘-click always work, and stay the only gestures on
   *  vertical rails (no room for a chip ✕).
   *  There is no way to take the ✕ off a tab that HAS this verb: the chip and
   *  the pointer gestures are one affordance, so a closeable tab always says
   *  so. Omit `onClose` to make a tab uncloseable. */
  onClose?: () => void
  /** Part of a multi-tab selection (⌥/Ctrl-click, Shift-click) — an accent
   *  wash marks every tab that a drag would carry, Chrome-style. */
  selected?: boolean
  /** Vertical rail form (collapsed sidebar zones). */
  vertical?: boolean
  /** Content-facing edge of a vertical rail — the strip line the active tab cuts. */
  side?: 'left' | 'right'
}

/**
 * Editor tab shell — preview rail + zone headers + collapsed vertical rails.
 *
 * Defaults need no vars: the active tab takes the editor surface, inactive the
 * sidebar one. Override `--pane-tab-active-bg` to change what the active tab
 * merges into, `--pane-tab-strip-bg` for a gutter unlike the bar around it.
 */
export const PaneTab = React.forwardRef<HTMLDivElement, PaneTabProps>(function PaneTab(
  {
    active = false,
    dirty = false,
    hoverTitle,
    hoverDescription,
    onClose,
    onMouseDown,
    onPointerDown,
    onPointerDownCapture,
    onContextMenuCapture,
    onPointerUp,
    onClickCapture,
    selected = false,
    vertical = false,
    side = 'left',
    children,
    className,
    ...props
  },
  ref
) {
  // Vertical rails only. Horizontal tabs draw no bottom border — the strip owns
  // that rule, and a per-tab border stacked a second translucent line over it.
  const edge = vertical ? (side === 'right' ? 'border-l' : 'border-r') : undefined
  const middle = middleClickHandlers(onClose)
  const [previewOpen, setPreviewOpen] = React.useState(false)

  const tab = (
    <div
      className={cn(
        TAB,
        vertical ? TAB_VERTICAL : TAB_HORIZONTAL,
        !vertical && onClose && TAB_CLOSEABLE,
        edge,
        active ? TAB_ACTIVE : cn(TAB_IDLE, edge && `${edge}-(--ui-stroke-tertiary)`),
        selected && TAB_SELECTED,
        className
      )}
      data-active={active}
      data-closeable={(onClose && !vertical) || undefined}
      data-glass-field=""
      data-selected={selected || undefined}
      data-vertical={vertical || undefined}
      onClickCapture={event => {
        // Sites whose tab activates on the label's own onClick (the preview
        // rail) fire it AFTER our pointerdown close — swallow that stray click
        // in the capture phase so it can't re-select the just-closed tab.
        if (onClose && isMetaClose(event)) {
          event.preventDefault()
          event.stopPropagation()
        }

        onClickCapture?.(event)
      }}
      onContextMenuCapture={event => {
        setPreviewOpen(false)
        onContextMenuCapture?.(event)
      }}
      onMouseDown={event => {
        middle.onMouseDown(event)
        onMouseDown?.(event)
      }}
      onPointerDown={event => {
        middle.onPointerDown(event)

        // ⌘-click closes. Preempt here — the tab strips activate/drag on
        // pointerdown (drag-session onTap), so we must claim the press before
        // the shell's own handler starts a drag, and skip it entirely.
        if (onClose && isMetaClose(event)) {
          event.preventDefault()
          event.stopPropagation()
          onClose()

          return
        }

        onPointerDown?.(event)
      }}
      onPointerDownCapture={event => {
        // Pane drag handlers prevent default before Radix can dismiss the tip.
        setPreviewOpen(false)
        onPointerDownCapture?.(event)
      }}
      onPointerUp={event => {
        middle.onPointerUp(event)
        onPointerUp?.(event)
      }}
      ref={ref}
      {...props}
    >
      {!vertical && <span aria-hidden className="pane-tab-background" />}
      {!vertical && <span aria-hidden className="pane-tab-divider" />}
      {children}
      {dirty && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute grid size-4 place-items-center',
            vertical ? 'bottom-1.5 left-1/2 -translate-x-1/2' : 'pane-tab-dirty right-3 top-1/2 -translate-y-1/2'
          )}
        >
          <span className="size-2 rounded-full bg-amber-500 shadow-[0_0_0_2px_var(--tab-bg),0_1px_2px_rgba(0,0,0,0.45)] dark:bg-amber-400" />
        </span>
      )}
      {onClose && !vertical && (
        <span className="pane-tab-close">
          <Button
            aria-label={translateNow('common.close')}
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }}
            onPointerDown={event => {
              // Closing must never also activate or start dragging the tab.
              if (event.button === 0 && !isMetaClose(event)) {
                event.stopPropagation()
              }
            }}
            size="icon-tab"
            tabIndex={-1}
            type="button"
            variant="ghost"
          >
            <Codicon name="close" size="0.6875rem" />
          </Button>
        </span>
      )}
    </div>
  )

  return !vertical && hoverTitle ? (
    <Tip
      align="start"
      alignOffset={9}
      collisionPadding={8}
      delayDuration={600}
      label={
        <>
          <div className="text-xs font-medium leading-5 break-words">{hoverTitle}</div>
          {hoverDescription && (
            <div className="mt-1 text-[11px] leading-4 break-all text-(--ui-text-secondary)">{hoverDescription}</div>
          )}
        </>
      }
      onOpenChange={setPreviewOpen}
      open={previewOpen}
      side="bottom"
      sideOffset={4}
      variant="card"
    >
      {tab}
    </Tip>
  ) : tab
})

interface PaneTabLabelProps extends React.ComponentProps<'button'> {
  /** `button` when the label is the activation target (preview rail);
   *  default `span` defers to the shell (zone drag/activate). */
  as?: 'button' | 'span'
}

/** Truncating label inside a `PaneTab`. `className` merges into the text span.
 *  Horizontal labels fade before the reserved close slot, never underneath it. */
export const PaneTabLabel = React.forwardRef<HTMLElement, PaneTabLabelProps>(function PaneTabLabel(
  { as = 'span', className, children, ...props },
  ref
) {
  const Comp = as as React.ElementType

  return (
    <Comp
      className="pane-tab-label flex h-full min-w-0 max-w-full items-center overflow-hidden px-2 text-left outline-none group-data-[vertical]/tab:h-auto group-data-[vertical]/tab:w-full group-data-[vertical]/tab:justify-center group-data-[vertical]/tab:py-2"
      ref={ref}
      {...props}
    >
      <span
        className={cn(
          'block min-w-0 truncate text-[9px] font-medium tracking-wide uppercase group-data-[closeable]/tab:text-clip',
          className
        )}
      >
        {children}
      </span>
    </Comp>
  )
})

interface PaneTabStripProps extends React.ComponentProps<'div'> {
  /** The scrolling tab list — receives `role="tablist"`. */
  children: React.ReactNode
  /** Ref on the scroller itself, for `useActiveTabVisible`. */
  listRef?: React.Ref<HTMLDivElement>
  /** Non-scrolling trailing chrome pinned to the right (the minimize chevron). */
  trailing?: React.ReactNode
}

/**
 * The horizontal tab bar every strip in the app sits in. Owns the bar's height
 * and surface, the scroll behaviour (hidden scrollbars, contained overscroll),
 * and the pinned trailing slot — so a new strip inherits all of it instead of
 * re-deriving the geometry and drifting out of alignment.
 *
 * Tabs go in `children` as `PaneTab`s; per-strip extras (drag handlers,
 * `data-zone-tabstrip`, drop carets) ride on the usual div props.
 */
export const PaneTabStrip = React.forwardRef<HTMLDivElement, PaneTabStripProps>(function PaneTabStrip(
  { children, className, listRef, trailing, ...props },
  ref
) {
  return (
    <div
      // The active tab flows into the pane surface; the gutter stays chrome.
      className={cn(
        'pane-tab-strip group/pane-header relative flex shrink-0 select-none bg-(--ui-sidebar-surface-background) [-webkit-app-region:no-drag]',
        className
      )}
      ref={ref}
      {...props}
    >
      <div
        className="pane-tab-list flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        ref={listRef}
        role="tablist"
      >
        {children}
      </div>
      {trailing}
    </div>
  )
})

/** A glyph button on a tab strip: the "+" and anything a pane contributes (a
 *  preview's console / DevTools). Callers pass DATA, never classes — the same
 *  contract as `TitlebarTool`, so every glyph on every strip matches. */
export interface PaneStripTool {
  active?: boolean
  disabled?: boolean
  icon: React.ReactNode
  id: string
  /** Tooltip text and accessible name. */
  label: string
  onSelect: () => void
}

/**
 * Renders one `PaneStripTool` through the app's `Button` + `Tip` primitives, the
 * way `TitlebarToolButton` does: ghost variant, no active background — state
 * reads from the glyph's own opacity, with `aria-pressed` carrying it for a11y.
 *
 * Pointerdown is claimed here so a click can never also activate or drag the
 * zone behind the strip.
 */
export function PaneStripGlyph({ active, disabled, icon, label, onSelect }: Omit<PaneStripTool, 'id'>) {
  return (
    <Tip label={label}>
      <Button
        aria-label={label}
        aria-pressed={active ?? undefined}
        className={cn(
          'self-center bg-transparent select-none',
          active ? 'opacity-100' : 'opacity-60 hover:opacity-100'
        )}
        disabled={disabled}
        onClick={onSelect}
        onPointerDown={event => event.stopPropagation()}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        {icon}
      </Button>
    </Tip>
  )
}

/** Close-verb enablement for `paneTabCloseItems` — how many tabs each verb hits. */
export interface PaneTabCloseCounts {
  all: number
  others: number
  right: number
}

interface PaneTabCloseItemsOptions {
  counts: PaneTabCloseCounts
  /** Omit to hide Close entirely (an uncloseable tab shows no dead action). */
  onClose?: () => void
  onCloseAll: () => void
  onCloseOthers: () => void
  onCloseToRight: () => void
}

/**
 * The four close verbs every tab menu offers — Close / others / to the right /
 * all — so a tab answers a right-click the same way wherever it lives. No ⌘W
 * hint on Close: the keybind closes the FOCUSED zone's active tab, so it would
 * be a lie on the inactive tab the user actually right-clicked.
 */
export function paneTabCloseItems(
  kit: MenuKit,
  { counts, onClose, onCloseAll, onCloseOthers, onCloseToRight }: PaneTabCloseItemsOptions
) {
  return (
    <>
      {onClose &&
        renderActionItem(kit, {
          icon: 'close',
          label: translateNow('common.close'),
          onSelect: onClose
        })}
      {renderActionItem(kit, {
        disabled: !counts.others,
        icon: 'close-all',
        label: translateNow('zones.closeOthers'),
        onSelect: onCloseOthers
      })}
      {renderActionItem(kit, {
        disabled: !counts.right,
        icon: 'arrow-right',
        label: translateNow('zones.closeToRight'),
        onSelect: onCloseToRight
      })}
      {renderActionItem(kit, {
        disabled: !counts.all,
        icon: 'clear-all',
        label: translateNow('zones.closeAll'),
        onSelect: onCloseAll
      })}
    </>
  )
}
