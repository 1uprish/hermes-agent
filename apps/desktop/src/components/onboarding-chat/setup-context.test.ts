import { describe, expect, it } from 'vitest'

import type { WizardAnswers } from '@/store/onboarding-wizard'

import { buildTaskBotRunbook, composeTaskBotSoul } from './setup-bot'

/**
 * What Setup learns has to reach the agent Setup hands to.
 *
 * The whole promise of the handoff is "an agent dedicated to you" — an agent
 * that opens by asking their name again has just told them the last five
 * minutes went nowhere. The facts travel twice on purpose: SOUL.md is who the
 * agent IS across every future session, the seeded runbook is what it knows on
 * this turn, and only the second one survives if the profile is ever rebuilt.
 */
const ANSWERS = {
  connectors: ['Notion', 'Slack'],
  context: 'kitchen reno, contractor quotes due Friday',
  name: 'Sam'
} as unknown as WizardAnswers

const soul = () => composeTaskBotSoul('Plant tracker', ANSWERS)
const runbook = () => buildTaskBotRunbook('Plant tracker', ANSWERS, 'bot')

describe('the picture Setup hands to the agent it mints', () => {
  it('carries every fact the user gave, into both halves', () => {
    for (const fact of ['Sam', 'kitchen reno', 'Notion', 'Slack']) {
      expect(soul(), `SOUL.md drops "${fact}"`).toContain(fact)
      expect(runbook(), `the runbook drops "${fact}"`).toContain(fact)
    }
  })

  it('tells the agent not to ask again for what it was handed', () => {
    expect(runbook()).toMatch(/never introduce yourself or ask who they are/i)
    expect(runbook()).toMatch(/without re-asking/i)
  })

  // Naming the tools without this reads as "you have Slack" — and the first
  // build is the one thing that must never bounce the user into an OAuth page.
  it('names their tools as NOT connected', () => {
    expect(runbook()).toMatch(/none are connected yet/i)
    expect(soul()).toMatch(/not connected yet/i)
  })

  // Setup can be skipped, and every answer is optional on the way through.
  it('says nothing at all about a user who told Setup nothing', () => {
    const bare = { connectors: [] } as unknown as WizardAnswers

    for (const text of [composeTaskBotSoul('Plant tracker', bare), buildTaskBotRunbook('Plant tracker', bare, 'bot')]) {
      expect(text).not.toMatch(/undefined|\bnull\b/)
      expect(text).not.toMatch(/user is called\b/i)
    }
  })
})
