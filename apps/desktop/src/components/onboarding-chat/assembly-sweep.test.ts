import { atom } from 'nanostores'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { allPaneIds, findGroupOfPane, group, split } from '@/components/pane-shell/tree/model'
import {
  $dismissedPanes,
  $layoutTree,
  bindToolPaneCollapse
} from '@/components/pane-shell/tree/store'
import { registry } from '@/contrib/registry'

import { $chatOnboardingSolo, assembleChatOnboarding } from './assembly'

vi.mock('@/store/first-screen-live', () => ({ redockLivePane: vi.fn() }))
vi.mock('@/store/zoom', () => ({ setZoomPercent: vi.fn() }))

const BOTS_PANE = 'hermes-bots:pane'

const disposers: (() => void)[] = []

function registerPane(id: string, data: Record<string, unknown>) {
  const dispose = registry.register({ area: 'panes', data, id, render: () => null, title: id })

  disposers.push(dispose)

  return dispose
}

beforeEach(() => {
  window.localStorage.clear()
  $dismissedPanes.set(new Set())
  // The state a layout card is clicked in: the guided chat, still solo.
  $chatOnboardingSolo.set(true)

  for (const dispose of disposers.splice(0)) {
    dispose()
  }

  registerPane('workspace', { placement: 'main', uncloseable: true })
  registerPane('sessions', { collapsible: true, placement: 'left', width: '237px' })
  registerPane(BOTS_PANE, {
    collapsible: true,
    dock: { enforce: true, pane: 'sessions', pos: 'center' },
    placement: 'left',
    width: '260px'
  })
})

/** The Basic layout: sessions sidebar beside the conversation. */
const basic = () => split('row', [group(['sessions']), group(['workspace'])])

describe('onboarding assembly dismisses panes it never asked for', () => {
  it('drops a main pane the layout never declared', () => {
    registerPane('hermes-bots:routines', {
      dock: { enforce: true, pane: 'workspace', pos: 'right' },
      placement: 'main',
      width: '250px'
    })

    assembleChatOnboarding('basic', basic())

    expect(allPaneIds($layoutTree.get()!)).not.toContain('hermes-bots:routines')
  })

  it('keeps what the layout does declare', () => {
    assembleChatOnboarding('basic', basic())

    const placed = allPaneIds($layoutTree.get()!)

    expect(placed).toContain('workspace')
    expect(placed).toContain('sessions')
  })

  // A layout pick is about the window around the chat they are already in.
  // Fronting Bots (or Sessions) here yanked the active tab off the conversation.
  it('leaves the conversation as the active pane', () => {
    assembleChatOnboarding('basic', basic())

    expect(findGroupOfPane($layoutTree.get()!, 'workspace')?.active).toBe('workspace')
    expect(findGroupOfPane($layoutTree.get()!, BOTS_PANE)?.active).not.toBe(BOTS_PANE)
  })
})

// Layouts are re-pickable from the card, and everything assembly writes
// persists — dismissals most of all. A re-pick that only swapped the preset
// tree inherited the previous layout's records, so the two came up mixed:
// Elite's terminal was placed and invisible because Basic had dismissed it.
describe('picking a different layout replaces the previous one', () => {
  const elite = () => split('row', [group(['sessions']), split('column', [group(['workspace']), group(['terminal'])])])

  beforeEach(() => {
    registerPane('terminal', { collapsible: true, placement: 'bottom' })

    // Through the real binding, or the pane isn't a collapse pane and the
    // sweep has no reason to touch it — the test would prove nothing.
    const $open = atom(true)

    bindToolPaneCollapse(
      'terminal',
      $open,
      () => $open.set(false),
      () => $open.set(true)
    )
  })

  it('brings back a pane the previous layout dismissed', () => {
    assembleChatOnboarding('basic', basic())
    expect($dismissedPanes.get().has('terminal'), 'Basic should have dismissed it').toBe(true)

    assembleChatOnboarding('terminal-deck', elite())

    expect($dismissedPanes.get().has('terminal')).toBe(false)
    expect(allPaneIds($layoutTree.get()!)).toContain('terminal')
  })

  it('drops it again on the way back', () => {
    assembleChatOnboarding('terminal-deck', elite())
    assembleChatOnboarding('basic', basic())

    expect(allPaneIds($layoutTree.get()!)).not.toContain('terminal')
  })

  it('stays on the conversation after every pick', () => {
    assembleChatOnboarding('basic', basic())
    assembleChatOnboarding('terminal-deck', elite())
    assembleChatOnboarding('basic', basic())

    expect(findGroupOfPane($layoutTree.get()!, 'workspace')?.active).toBe('workspace')
    expect(findGroupOfPane($layoutTree.get()!, BOTS_PANE)?.active).not.toBe(BOTS_PANE)
  })
})
