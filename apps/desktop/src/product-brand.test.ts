import { describe, expect, it } from 'vitest'

import { brandVisibleText, brandVisibleTree, productWordmark, supportsLegacyWakeWord } from './product-brand'

describe('MacMan surface branding', () => {
  it('rebrands product-facing Hermes names without rewriting runtime commands and paths', () => {
    expect(
      brandVisibleText(
        'Hermes Desktop starts the Hermes Agent. The hermes binary stays at ~/.hermes and https://hermes-agent.nousresearch.com.',
        true
      )
    ).toBe(
      'MacMan starts the MacMan runtime. The hermes binary stays at ~/.hermes and https://hermes-agent.nousresearch.com.'
    )
  })

  it('rebrands strings returned by nested translation functions', () => {
    const source = {
      boot: {
        ready: 'Hermes Desktop is ready',
        connected: (version: string) => `Hermes ${version}`
      }
    }

    const branded = brandVisibleTree(source, true)

    expect(branded.boot.ready).toBe('MacMan is ready')
    expect(branded.boot.connected('0.22.1')).toBe('MacMan 0.22.1')
    expect(brandVisibleTree(source, false)).toBe(source)
  })

  it('uses the MacMan wordmark and does not expose the legacy Hermes wake phrase', () => {
    expect(productWordmark(true)).toBe('MACMAN')
    expect(supportsLegacyWakeWord(true)).toBe(false)
    expect(productWordmark(false)).toBe('HERMES AGENT')
    expect(supportsLegacyWakeWord(false)).toBe(true)
  })
})
