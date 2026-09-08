import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { $machine } from '@/store/machine'

import { OnboardingChatDirective } from './directive'
import {
  $setupHandoff,
  buildTaskBotRunbook,
  composeTaskBotSoul,
  parseHandoffPlan,
  resetSetupHandoffForTests
} from './setup-bot'

const ANSWERS = { connectors: [], name: 'BK' } as unknown as Parameters<typeof buildTaskBotRunbook>[1]

describe('the machine-setup plan', () => {
  beforeEach(() => {
    resetSetupHandoffForTests()
    $machine.set(null)
  })

  it('reads the attr, and anything else is an ordinary build', () => {
    expect(parseHandoffPlan('machine-setup')).toBe('machine-setup')
    expect(parseHandoffPlan(' MACHINE-SETUP ')).toBe('machine-setup')
    expect(parseHandoffPlan('drivers')).toBe('build')
    expect(parseHandoffPlan(undefined)).toBe('build')
  })

  it('sends the machine-setup agent to look before it plans', () => {
    const runbook = buildTaskBotRunbook('Set up this Mac', ANSWERS, 'bot', 'machine-setup')

    expect(runbook).toContain('START BY LOOKING, NOT PLANNING')
    expect(runbook).toContain('nvidia-smi')
    expect(runbook).toContain('Want me to run this?')
  })

  it('hands the agent what the app already knows, freshness first', () => {
    $machine.set({ ageDays: 0, arch: 'arm64', model: '', nvidia: true, platform: 'win32', release: '10.0.26100' })

    const runbook = buildTaskBotRunbook('Set up this Spark', ANSWERS, 'bot', 'machine-setup')

    expect(runbook).toContain('What the app can already see about it: set up today, an NVIDIA Spark')
  })

  it('keeps a plain build on the build rules, with no machine instructions', () => {
    const runbook = buildTaskBotRunbook('Plant tracker', ANSWERS, 'bot')

    expect(runbook).toContain('NO external account')
    expect(runbook).not.toContain('MACHINE SETUP JOB')
  })

  it('never sends either plan to a sign-in to finish the first job', () => {
    for (const plan of ['build', 'machine-setup'] as const) {
      expect(buildTaskBotRunbook('First job', ANSWERS, 'bot', plan)).toMatch(/no external account|not need an account/i)
    }
  })

  it('gives the machine-setup bot a standing relationship with the box', () => {
    expect(composeTaskBotSoul('Set up this Spark', ANSWERS, 'machine-setup')).toContain('This machine is your job')
    expect(composeTaskBotSoul('Plant tracker', ANSWERS)).toContain('Ask before touching anything outside your task')
  })

  it('carries the plan from the card through to the handoff', async () => {
    render(
      <OnboardingChatDirective
        attrs={{
          brief: 'Get this machine ready for work',
          plan: 'machine-setup',
          step: 'handoff',
          surface: 'bot',
          task: 'Set up this Mac'
        }}
        streaming={false}
      />
    )

    screen.getAllByRole('button')[0].click()

    expect($setupHandoff.get()?.plan).toBe('machine-setup')
  })
})
