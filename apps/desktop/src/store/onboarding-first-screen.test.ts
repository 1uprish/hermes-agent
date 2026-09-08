import { beforeEach, describe, expect, test } from 'vitest'

import {
  $firstScreenKind,
  buildTheaterBeats,
  compileFirstScreen,
  firstScreenFileContent,
  materializeFirstScreen,
  resetFirstScreenForTests,
  setFirstScreenKind,
  theaterDuration
} from './onboarding-first-screen'

describe('first-screen artifact', () => {
  beforeEach(() => resetFirstScreenForTests())

  test('prompts speak in the user voice; the title carries the name', () => {
    const config = compileFirstScreen({ focus: ['Writing', 'Research'], name: 'Sam' }, 'dashboard')

    expect(config.title).toContain('Sam')

    for (const block of config.blocks) {
      // First person, never third-person narration about the user.
      expect(block.prompt).toMatch(/\b(my|me|I)\b/)
      expect(block.prompt).not.toContain("Sam's daily starter")
      expect(block.prompt).not.toMatch(/^You are/)
    }

    expect(config.blocks[0].prompt.toLowerCase()).toContain('writing')
  })

  test('empty profile still compiles a working config (fallback path)', () => {
    for (const kind of ['dashboard', 'document', 'app'] as const) {
      const config = compileFirstScreen({ focus: [], name: '' }, kind)

      expect(config.blocks.length).toBeGreaterThanOrEqual(3)
      expect(config.title.length).toBeGreaterThan(0)

      for (const block of config.blocks) {
        expect(block.prompt.length).toBeGreaterThan(20)
        expect(block.stepLine.length).toBeGreaterThan(0)
      }
    }
  })

  test('theater beats: one assemble + one prompt per block, then validate', () => {
    const config = compileFirstScreen({ focus: ['Coding'], name: 'Jo' }, 'document')
    const beats = buildTheaterBeats(config)

    expect(beats[0].cue).toBe('header')
    expect(beats[0].t).toBe(0)

    const assembles = beats.filter(b => b.cue === 'assemble')
    const prompts = beats.filter(b => b.cue === 'prompt')

    expect(assembles).toHaveLength(config.blocks.length)
    expect(prompts).toHaveLength(config.blocks.length)
    expect(beats.at(-1)?.cue).toBe('validate')

    // Prompt beats show the block's real prompt text.
    for (const p of prompts) {
      expect(config.blocks.some(b => b.prompt === p.prompt)).toBe(true)
    }

    // Monotonic non-decreasing timeline.
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i].t).toBeGreaterThanOrEqual(beats[i - 1].t)
    }
  })

  test('theater duration covers the final beat', () => {
    const config = compileFirstScreen({ focus: [], name: '' }, 'app')
    const beats = buildTheaterBeats(config)
    const lastT = beats.at(-1)?.t ?? 0

    expect(theaterDuration(config)).toBeGreaterThan(lastT)
  })

  test('kind pick persists to storage and survives a re-read', () => {
    setFirstScreenKind('document')
    expect($firstScreenKind.get()).toBe('document')

    setFirstScreenKind(null)
    expect($firstScreenKind.get()).toBeNull()
  })

  test('screen.json content carries the profile and every block prompt', () => {
    const config = compileFirstScreen({ focus: ['Coding', 'Automation'], name: 'Ada' }, 'app')
    const file = firstScreenFileContent(config)
    const parsed = JSON.parse(file)

    expect(parsed.kind).toBe('app')
    expect(parsed.title).toContain('Ada')
    expect(parsed.generatedFrom.name).toBe('Ada')
    expect(parsed.blocks).toHaveLength(config.blocks.length)

    for (const [i, block] of config.blocks.entries()) {
      expect(parsed.blocks[i].prompt).toBe(block.prompt)
      expect(parsed.blocks[i].label).toBe(block.label)
    }

    // The reveal names this exact shape — the file must parse as one object.
    expect(() => JSON.parse(file)).not.toThrow()
  })

  test('materialize writes the file through the bridge', async () => {
    const calls: Array<{ content: string; path: string }> = []
    const original = window.hermesDesktop

    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        desktopPluginsRoot: async () => '/tmp/hermes/desktop-plugins',
        mkdirDesktopPlugin: async (name: string) => ({ ok: name === 'first-screen', path: '/tmp/hermes/desktop-plugins/first-screen' }),
        materializeSkill: async (name: string, content: string) => {
          calls.push({ content, path: `skills/${name}/SKILL.md` })

          return { ok: true, path: `skills/${name}/SKILL.md` }
        },
        writeTextFile: async (path: string, content: string) => {
          calls.push({ content, path })

          return { path }
        }
      }
    })

    try {
      const config = compileFirstScreen({ focus: ['Writing'], name: 'Sam' }, 'dashboard')
      const result = await materializeFirstScreen(config)

      expect(result).toEqual({ ok: true, path: '/tmp/hermes/desktop-plugins/first-screen/screen.json' })
      expect(calls).toHaveLength(3)

      const byPath = Object.fromEntries(calls.map(c => [c.path, c.content]))

      expect(byPath['/tmp/hermes/desktop-plugins/first-screen/plugin.js']).toContain("id: 'first-screen'")
      expect(JSON.parse(byPath['/tmp/hermes/desktop-plugins/first-screen/screen.json']).title).toContain('Sam')

      // The companion skill rides along: schema + contracts, path baked in.
      const skill = byPath['skills/onboarding-dashboard/SKILL.md']

      expect(skill).toContain('name: onboarding-dashboard')
      expect(skill).toContain('/tmp/hermes/desktop-plugins/first-screen/screen.json')
      expect(skill).toContain('steps are STRINGS')
      expect(skill).toContain('[Onboarding Dashboard button]')
    } finally {
      Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: original })
    }
  })

  test('materialize without a bridge reports no-electron, never throws', async () => {
    const original = window.hermesDesktop

    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: undefined })

    try {
      const result = await materializeFirstScreen(compileFirstScreen({ focus: [], name: '' }, 'document'))

      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toBe('no electron bridge')
    } finally {
      Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: original })
    }
  })
})
