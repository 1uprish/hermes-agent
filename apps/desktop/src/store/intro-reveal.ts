/**
 * Intro reveal — the Dia-inspired first-run (and replayable) brand sequence.
 *
 * A full-screen, GPU-rendered moment: the Nous badge assembles from a particle
 * field in a transparent always-on-top window covering the entire display (the
 * real desktop shows through), timed typography beats play against a
 * synthesized sound bed, then the surface dissolves into the provider picker
 * (first run) or back to the app (replay).
 *
 * Architecture: the MAIN renderer owns the sequence clock and state; a
 * dedicated overlay BrowserWindow (`?win=intro`) renders particles + type and
 * plays sound locally, driven by beat pushes over IPC. When the bridge is
 * unavailable (tests, web), the store still runs the clock so the logic is
 * exercisable headlessly.
 *
 * Trigger contract:
 * - First run: onboarding reports `configured === false` and the user has
 *   neither completed nor skipped the intro. The reveal mounts *before* the
 *   provider picker.
 * - Replay: Settings → About → "Replay intro" calls `replayIntroReveal()`.
 */

import { atom } from 'nanostores'

import { readKey, writeKey } from '@/lib/storage'

import { setOnboardingSurfaceActive } from './onboarding-presence'

const SEEN_KEY = 'hermes-intro-reveal-seen-v1'

export type IntroRevealPhase =
  /** Idle — nothing on screen. */
  | 'hidden'
  /** Actively playing the sequence. */
  | 'playing'
  /** Exit choreography running (dissolve into whatever comes next). */
  | 'leaving'

export interface IntroRevealState {
  /** Beat index the overlay should be showing (0 = preamble). */
  beat: number
  /** True when opened from Settings (replay) rather than the first-run gate. */
  replay: boolean
  phase: IntroRevealPhase
  /** Wall-clock ms when the current play started. */
  startedAt: number
}

/** Beat clock pushed to the overlay window over IPC. */
export interface IntroRevealBeatPush {
  beat: number
  leaving: boolean
}

const INITIAL: IntroRevealState = {
  beat: 0,
  phase: 'hidden',
  replay: false,
  startedAt: 0
}

export const $introReveal = atom<IntroRevealState>(INITIAL)

// Presence mirror: ambient chrome (the update toast) stands down while the
// cinematic owns the screen. Module-scope subscribe so no start/finish path
// can forget to raise or lower it.
$introReveal.subscribe(state => setOnboardingSurfaceActive('intro', state.phase !== 'hidden'))

export function hasSeenIntroReveal(): boolean {
  return readKey(SEEN_KEY) === '1'
}

function markSeen(): void {
  writeKey(SEEN_KEY, '1')
}

/** Forget the seen-key so the cinematic replays as a true first run (dev). */
export function clearIntroRevealSeen(): void {
  writeKey(SEEN_KEY, null)
}

/** True when the first-run reveal should mount ahead of the provider picker. */
/** The whole feature's off switch: no autoplay, no replay row, no overlay —
 *  the intro does not exist unless the build was baked with
 *  VITE_INTRO_REVEAL=1. Ship-disabled by default while it's iterated on.
 *  Read at call time (not module load) so vitest's stubEnv can reach it. */
export function isIntroRevealEnabled(): boolean {
  return import.meta.env?.VITE_INTRO_REVEAL === '1'
}

export function shouldPlayFirstRunIntro(configured: boolean | null, firstRunSkipped: boolean): boolean {
  if (!isIntroRevealEnabled()) {
    return false
  }

  if (configured !== false) {
    return false
  }

  if (firstRunSkipped) {
    return false
  }

  return !hasSeenIntroReveal()
}

function bridge() {
  return typeof window === 'undefined' ? undefined : window.hermesDesktop?.introReveal
}

function pushBeat(): void {
  const s = $introReveal.get()

  bridge()?.pushBeat?.({ beat: s.beat, leaving: s.phase === 'leaving' })
}

/** Begin the sequence. `replay` distinguishes the Settings entry point. */
export function startIntroReveal(replay: boolean): void {
  if (!isIntroRevealEnabled()) {
    return
  }

  $introReveal.set({
    beat: 0,
    phase: 'playing',
    replay,
    startedAt: Date.now()
  })

  // The cinematic owns the screen: the app window hides so the sequence plays
  // over the bare desktop (replays included — close() hands the screen back).
  void bridge()?.open?.({ hideMain: true }).catch(() => undefined)
  pushBeat()
}

/** Settings → About → "Replay intro". */
export function replayIntroReveal(): void {
  startIntroReveal(true)
}

export function setIntroRevealBeat(beat: number): void {
  const s = $introReveal.get()

  if (s.phase === 'hidden' || beat === s.beat) {
    return
  }

  $introReveal.set({ ...s, beat })
  pushBeat()
}

/** Begin the exit dissolve. */
export function leaveIntroReveal(): void {
  const s = $introReveal.get()

  if (s.phase !== 'playing') {
    return
  }

  $introReveal.set({ ...s, phase: 'leaving' })
  pushBeat()
}

/** Terminal state — records seen and hides the overlay. */
export function finishIntroReveal(): void {
  const wasReplay = $introReveal.get().replay

  markSeen()
  $introReveal.set(INITIAL)

  // First-run handoff: the cinematic ends, the setup wizard begins — the app
  // window STAYS hidden between the two (no flash of the shell mid-chain).
  // The wizard starts BEFORE the overlay closes so its window is already
  // spawning while the cinematic dissolves — the card's slide-up entrance
  // then reads as one continuous motion instead of a gap between windows.
  // Replays and already-onboarded skips hand the screen straight back.
  void import('./onboarding-wizard').then(({ hasCompletedOnboardingWizard, startOnboardingWizard }) => {
    const startWizard = !wasReplay && !hasCompletedOnboardingWizard()

    if (startWizard) {
      startOnboardingWizard()
    }

    void bridge()
      ?.close?.({ showMain: !startWizard })
      .catch(() => undefined)
  })
}

/** The overlay window reports a skip (Esc/click inside it) or closed itself. */
export function handleIntroRevealExternalSkip(): void {
  const s = $introReveal.get()

  if (s.phase === 'hidden') {
    return
  }

  leaveIntroReveal()
  // Give the dissolve a beat to read before the window closes.
  window.setTimeout(() => finishIntroReveal(), 700)
}

/** Wire the external-skip/closed listeners once (call from app boot). */
let listenersInstalled = false

export function installIntroRevealBridgeListeners(): void {
  if (listenersInstalled) {
    return
  }

  listenersInstalled = true
  bridge()?.onSkip?.(() => handleIntroRevealExternalSkip())
  bridge()?.onClosed?.(() => handleIntroRevealExternalSkip())
}

/** Hard reset for tests. */
export function resetIntroRevealForTests(): void {
  $introReveal.set(INITIAL)
}
