import { describe, expect, it } from 'vitest'

import { applySessionCreateOverrides } from './create-overrides'

/** What `desktopSessionCreateParams` derives from the visible selection. */
const selection = () => ({
  cols: 96,
  fast: false,
  model: 'claude-opus-5',
  provider: 'anthropic',
  reasoning_effort: 'high',
  source: 'desktop'
})

describe('session create overrides', () => {
  it('leaves the selection alone when nothing is overridden', () => {
    expect(applySessionCreateOverrides(selection(), undefined)).toEqual(selection())
  })

  // The guided chat's whole problem: the desktop stamps the composer's model
  // onto every create, so a session that needs a specific model has to say so
  // HERE. Switching afterwards races the session's own first turn.
  it('replaces model and provider together', () => {
    const params = applySessionCreateOverrides(selection(), {
      model: { model: 'deepseek/deepseek-v4-flash-0731', provider: 'nous' }
    })

    expect(params.model).toBe('deepseek/deepseek-v4-flash-0731')
    expect(params.provider).toBe('nous')
  })

  // A model from one provider next to another provider is a mismatched pair,
  // not a partial override.
  it('never leaves the previous provider beside a new model', () => {
    const params = applySessionCreateOverrides(selection(), {
      model: { model: 'deepseek/deepseek-v4-flash-0731', provider: 'nous' }
    })

    expect(params.provider).not.toBe('anthropic')
  })

  it('takes the reasoning effort when given, keeps the selection when not', () => {
    const pinned = applySessionCreateOverrides(selection(), {
      model: { model: 'm', provider: 'p', reasoningEffort: 'minimal' }
    })

    const unpinned = applySessionCreateOverrides(selection(), { model: { model: 'm', provider: 'p' } })

    expect(pinned.reasoning_effort).toBe('minimal')
    expect(unpinned.reasoning_effort).toBe('high')
  })

  it('carries the canonical-chat flags', () => {
    const params = applySessionCreateOverrides(selection(), { hidden: true, title: 'Bot Chat' })

    expect(params.hidden).toBe(true)
    expect(params.title).toBe('Bot Chat')
  })
})
