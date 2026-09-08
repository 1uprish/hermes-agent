/**
 * Onboarding wizard — the Dia-style first-run setup that follows the intro
 * cinematic. A small curated modal (not an app takeover): welcome → personalize
 * → connectors → appearance → system, an optional provider step when no
 * inference path exists, then a cinematic "Welcome to your agent" finale that
 * dissolves straight into the first chat.
 *
 * Trigger contract:
 * - First run: `finishIntroReveal()` calls `startOnboardingWizard()` after the
 *   cinematic (skips included). If the app restarts mid-wizard, the gate
 *   restarts it — the intro's seen-key is set but the wizard's done-key isn't.
 * - The wizard is gated by the same build flag as the intro
 *   (`VITE_INTRO_REVEAL=1`); neither exists in unflagged builds.
 *
 * Answers persist live (localStorage) so a mid-flow restart keeps them, and so
 * the first-chat kickoff can read them after the wizard unmounts.
 */

import { atom } from 'nanostores'

import { readJson, readKey, writeJson, writeKey } from '@/lib/storage'
import { machineKind, machineSetupLeads } from '@/store/machine'
import { VOICE_RULES } from '@/store/onboarding-first-screen'

import { $instantAccount, instantSuppressesOnboarding } from './instant-account'
import { clearIntroRevealSeen, hasSeenIntroReveal, isIntroRevealEnabled } from './intro-reveal'
import { $desktopOnboarding } from './onboarding'
import { setOnboardingSurfaceActive } from './onboarding-presence'

const DONE_KEY = 'hermes-onboarding-wizard-done-v1'
const ANSWERS_KEY = 'hermes-onboarding-wizard-answers-v1'
const GUIDE_KICKED_KEY = 'hermes-onboarding-guide-kicked-v1'

/** Guide handoff beacon — set by the no-window guide run, consumed by the
 *  gate. An ATOM, not just the localStorage keys, because the done-key is
 *  written from finishIntroReveal's dynamic-import callback AFTER the intro
 *  store has already settled to 'hidden': by then every dependency of the
 *  gate's kickoff effect (enabled, intro.phase, wizard.phase) has gone quiet,
 *  so a poll-on-render check misses the handoff entirely — the cinematic
 *  dissolves into a vanilla shell and the guided chat never starts. The
 *  beacon is reactive state the gate subscribes to, so the write itself
 *  re-fires the effect. */
export const $guideKickoffPending = atom(false)

export type WizardStepId =
  /** Pick what your first screen should be — dashboard, document, or app. */
  | 'first-screen'
  | 'welcome'
  | 'personalize'
  | 'connectors'
  | 'appearance'
  | 'system'
  /** Only present when no inference path exists (instant mint failed/off). */
  | 'providers'
  /** The login-mode run's single step: sign in to Nous Portal (or any
   *  provider behind the disclosure), skippable. */
  | 'login'
  /** Cinematic full-bleed "Welcome to your agent" before the app appears. */
  | 'finale'

/** Which run the wizard window hosts:
 *  - 'full'  — the classic multi-step setup (dev:onboarding, screenshots).
 *  - 'login' — one card: portal sign-in, then the guided IN-CHAT setup takes
 *    over. No longer on the first-run path; kept for the window machinery.
 *  - 'guide' — NO window: the first-run default. The wizard settles instantly
 *    and the gate hands straight off to the in-chat guided setup. */
export type WizardRunMode = 'full' | 'guide' | 'login'

export interface WizardAnswers {
  /** What the user wants to be called. Optional — empty is fine. */
  name: string
  /** What they're actually working on right now, in their own words —
   *  the free-text answer that makes the first screen THEIRS instead of a
   *  template. Captured conversationally in the guided chat. */
  context: string
  /** Focus areas picked on the personalize step. */
  focus: string[]
  /** Connector ids toggled on (fake for now — stored, not wired). */
  connectors: string[]
  /** Theme skin committed on the appearance step. */
  theme: string
  /** Accent seed picked on the appearance step; null = the theme's own. */
  accent: null | string
  /** Layout preset id committed on the appearance step. */
  layout: string
  /** Keep Hermes in the dock (macOS nicety — stored, best-effort). */
  keepInDock: boolean
  /** Launch Hermes at login. */
  openAtLogin: boolean
}

export const DEFAULT_ANSWERS: WizardAnswers = {
  accent: null,
  connectors: [],
  context: '',
  focus: [],
  keepInDock: true,
  layout: 'basic',
  name: '',
  openAtLogin: false,
  theme: 'nous'
}

export interface OnboardingWizardState {
  phase: 'hidden' | 'active'
  step: WizardStepId
  /** Step list for this run (provider step is conditional). */
  steps: WizardStepId[]
  /** Which run this is — the gate forwards it to the dedicated window. */
  mode: WizardRunMode
}

/** Outcome the wizard window reports back over IPC (see preload/global.d.ts). */
export interface OnboardingWizardOutcome {
  /** False when the user skipped setup. */
  completed: boolean
  /** Full-run only: the first-screen artifact the finale built. The main
   *  window uses it to seed the first chat ("press a button, it does
   *  something") after the take-over. Absent on skip and in login mode. */
  firstScreen?: { configJson: string; filePath?: string; kind: string }
  /** False when the run needed a provider and none was configured (the step
   *  was skipped past) — the first-chat kickoff has nothing to greet with. */
  providerReady?: boolean
  /** Which run produced this outcome. Login-mode outcomes hand off to the
   *  in-chat guided setup instead of the greet kickoff. */
  mode?: WizardRunMode
  /** Login mode only: the app should come back as the small solo-chat window
   *  and run the guided in-chat setup (electron pre-sizes before showing). */
  soloChat?: boolean
}

const INITIAL: OnboardingWizardState = {
  mode: 'full',
  phase: 'hidden',
  step: 'welcome',
  steps: []
}

export const $onboardingWizard = atom<OnboardingWizardState>(INITIAL)

// Presence mirror — see onboarding-presence.ts (update toast stands down).
$onboardingWizard.subscribe(state => setOnboardingSurfaceActive('wizard', state.phase !== 'hidden'))

function loadAnswers(): WizardAnswers {
  const raw = readJson<Partial<WizardAnswers>>(ANSWERS_KEY)

  return { ...DEFAULT_ANSWERS, ...raw }
}

/** Dev reruns the wizard every launch (see hasCompletedOnboardingWizard) — it
 *  must also START clean every launch, not preloaded with the last run's
 *  picks. The stored blob is dropped too, so a run that touches nothing can't
 *  hand stale picks to the main window's commit. Prod resumes from storage. */
function initialAnswers(): WizardAnswers {
  if (import.meta.env.DEV) {
    writeJson(ANSWERS_KEY, null)

    return { ...DEFAULT_ANSWERS }
  }

  return loadAnswers()
}

export const $wizardAnswers = atom<WizardAnswers>(initialAnswers())

export function setWizardAnswers(patch: Partial<WizardAnswers>): void {
  const next = { ...$wizardAnswers.get(), ...patch }

  $wizardAnswers.set(next)
  writeJson(ANSWERS_KEY, next)
}

export function hasCompletedOnboardingWizard(): boolean {
  // Dev builds never persist "onboarded": every dev launch (with the intro
  // flag on) boots straight into the wizard for QA. Completing or skipping
  // still settles it for the running session — see `settledThisSession`.
  if (import.meta.env.DEV) {
    return false
  }

  return readKey(DONE_KEY) === '1'
}

function markDone(): void {
  writeKey(DONE_KEY, '1')
}

/** True when the wizard needs a provider step: no guest account is carrying
 *  inference AND the classic onboarding never completed. */
export function wizardNeedsProviderStep(): boolean {
  if (instantSuppressesOnboarding($instantAccount.get().status)) {
    return false
  }

  return $desktopOnboarding.get().configured !== true
}

function buildSteps(includeProviders = wizardNeedsProviderStep()): WizardStepId[] {
  const steps: WizardStepId[] = ['welcome', 'personalize', 'connectors', 'appearance']

  // The (conditional) provider step sits right before "Make Hermes at home" —
  // intelligence gets connected before the domestic niceties close the run.
  // TEMP dev: always in, every path (Electron included), so the step is
  // testable regardless of the accountless gate. Re-gate before ship.
  if (includeProviders || import.meta.env.DEV) {
    steps.push('providers')
  }

  steps.push('system', 'first-screen', 'finale')

  return steps
}

// Set once the wizard has run its course this session — completed, skipped,
// or its window closed with no outcome (⌘W). Stops the resume path from
// re-opening it mid-session; in dev (where the done-key is ignored) this is
// the only thing that ends it.
let settledThisSession = false

/** The gate's restart check: intro seen, wizard unfinished, flag on. */
export function shouldResumeOnboardingWizard(): boolean {
  return (
    !settledThisSession && isIntroRevealEnabled() && hasSeenIntroReveal() && !hasCompletedOnboardingWizard()
  )
}

/** The gate's guide-kickoff check: a first-run chain mid-handoff — intro seen
 *  THIS launch (devResetOnboardingFlow clears it), wizard settled by the
 *  no-window guide run, guided chat not yet kicked off. Reads the done-key
 *  directly: hasCompletedOnboardingWizard() is always false in dev builds,
 *  but the handoff must still hold there (dev:full runs the real chain).
 *
 *  The kicked-key is the persistent half of the latch: seen + done survive
 *  relaunch, so without it every launch of an onboarded install would re-run
 *  the guided chat (the gate's module flag resets per process). */
export function shouldStartGuideKickoff(): boolean {
  return (
    isIntroRevealEnabled() &&
    hasSeenIntroReveal() &&
    readKey(DONE_KEY) === '1' &&
    readKey(GUIDE_KICKED_KEY) !== '1'
  )
}

/** Mid-handoff relaunch: the persistent keys say the guide was settled but
 *  never launched (app quit between the cinematic and the first chat). Seed
 *  the beacon at module load so the gate picks the handoff back up. Guarded
 *  so a plain onboarded install (kicked-key set) boots quiet. */
export function seedGuideKickoffFromStorage(): void {
  if (shouldStartGuideKickoff()) {
    $guideKickoffPending.set(true)
  }
}

/** Stamp the guided chat as launched — called by the gate the moment it hands
 *  off, so a relaunch resumes the normal app instead of re-onboarding. */
export function markGuideKickoffStarted(): void {
  writeKey(GUIDE_KICKED_KEY, '1')
  $guideKickoffPending.set(false)
}

/** The wizard window closed with no outcome — stand down for this session. */
export function dismissOnboardingWizardSession(): void {
  settledThisSession = true
  $onboardingWizard.set(INITIAL)
}

/** Begin (or resume) the wizard. No-ops once done.
 *
 *  The first-run chain runs GUIDE mode: animation → the guided in-chat setup
 *  directly — accountless, no wizard window, no sign-in card (login comes
 *  later, once the first task is under way). LOGIN mode (animation → one
 *  portal sign-in card → the guided chat) and the classic multi-step run
 *  stay reachable through the dev entries (`dev:onboarding`,
 *  `__onboarding.start`). */
export function startOnboardingWizard(mode: WizardRunMode = 'guide'): void {
  if (!isIntroRevealEnabled() || hasCompletedOnboardingWizard()) {
    return
  }

  if (mode === 'guide') {
    // No window at all: mark the wizard settled (the guided chat IS the
    // setup) and let the gate's effect hand off to the guide kickoff. The
    // intro's seen-key is the handoff's other half — finishIntroReveal set
    // it on the real chain, but a direct startOnboardingWizard() (the gate's
    // resume path, tests) arrives without it, so stamp it here too. The
    // beacon is what actually wakes the gate (see $guideKickoffPending).
    settledThisSession = true
    markDone()
    writeKey('hermes-intro-reveal-seen-v1', '1')
    $onboardingWizard.set(INITIAL)
    $guideKickoffPending.set(true)

    return
  }

  const steps: WizardStepId[] = ['login']

  $onboardingWizard.set({ mode, phase: 'active', step: steps[0], steps })
}

/** Boot the surface inside the dedicated `?win=onboarding` window. That window
 *  is gateway-less, so the provider decision arrives from the main renderer
 *  via the open IPC → query param instead of being computed here. Login mode
 *  is kept for an explicit portal-sign-in-only handoff. */
export function startOnboardingWizardWindow(includeProviders: boolean, mode: WizardRunMode = 'full'): void {
  const steps: WizardStepId[] = mode === 'login' ? ['login'] : buildSteps(includeProviders)

  $onboardingWizard.set({ mode, phase: 'active', step: steps[0], steps })
}

/** Re-read answers persisted by the wizard WINDOW (shared origin storage) into
 *  this renderer's atom — the main renderer commits from these after `done`. */
export function reloadWizardAnswers(): WizardAnswers {
  const answers = loadAnswers()

  $wizardAnswers.set(answers)

  return answers
}

export function wizardStepIndex(state: OnboardingWizardState): number {
  return Math.max(0, state.steps.indexOf(state.step))
}

export function nextWizardStep(): void {
  const s = $onboardingWizard.get()

  if (s.phase !== 'active') {
    return
  }

  const index = wizardStepIndex(s)

  if (index >= s.steps.length - 1) {
    completeOnboardingWizard()

    return
  }

  $onboardingWizard.set({ ...s, step: s.steps[index + 1] })
}

export function backWizardStep(): void {
  const s = $onboardingWizard.get()
  const index = wizardStepIndex(s)

  if (s.phase !== 'active' || index === 0) {
    return
  }

  $onboardingWizard.set({ ...s, step: s.steps[index - 1] })
}

/** Skip the remainder — marks done so it never auto-shows again. */
export function skipOnboardingWizard(): void {
  settledThisSession = true
  markDone()
  $onboardingWizard.set(INITIAL)
}

/** Terminal state — the finale finished; the app (and first chat) take over. */
export function completeOnboardingWizard(): void {
  settledThisSession = true
  markDone()
  $onboardingWizard.set(INITIAL)
}

/** The hidden kickoff prompt seeded with onboarding answers. Sent with
 *  `display_kind=hidden` so Hermes greets first and the transcript starts
 *  with the model's message, not ours. */
export function buildKickoffPrompt(answers: WizardAnswers): string {
  const parts: string[] = [
    'The user just finished first-run setup of Hermes Desktop and this is their very first chat.',
    'This message is invisible to them — do not reference it, do not repeat their setup answers back as a list.'
  ]

  if (answers.name.trim()) {
    parts.push(`They asked to be called: ${answers.name.trim()}.`)
  }

  if (answers.focus.length > 0) {
    parts.push(`They said they want help with: ${answers.focus.join(', ')}.`)
  }

  parts.push(
    'Greet them briefly and warmly as Hermes, and suggest one concrete thing to try first' +
      (answers.focus.length > 0 ? ' based on what they want help with.' : '.'),
    'Two or three short sentences. No headers, no bullet lists.'
  )

  return parts.join(' ')
}

/** The pre-written opener for the guided chat — painted instantly (seeded as
 *  a real assistant turn at session.create), so the first thing the user sees
 *  costs zero generation time. The instruction prompt below tells the model
 *  this message was already sent on its behalf. Bot mode: the speaker is
 *  Setup, a persistent guide, not the (future) task agent itself. */
export const CHAT_ONBOARDING_GREETING =
  "Hey, welcome — I'm Setup, your Hermes guide. I'll get things arranged around you, then spin up your first agent and stick around while you find your feet.\n\nFirst — what should I call you?"

/** The seed rows for the guided chat's session.create: the invisible runbook
 *  (model-visible, never rendered) followed by the pre-written greeting.
 *  Pass the banked greeting the client is typing in (pickOnboardingGreeting)
 *  so the canonical row and the animated reveal are the same words. */
export function buildChatOnboardingSeedMessages(greeting = CHAT_ONBOARDING_GREETING): {
  content: string
  display_kind?: 'hidden'
  role: 'assistant' | 'user'
}[] {
  return [
    { content: buildChatOnboardingPrompt(), display_kind: 'hidden', role: 'user' },
    { content: greeting, role: 'assistant' }
  ]
}

const FORK_QUESTION = "Know what you'd like it to make?"

/** The fork's pills. Held as data because the runbook pins them EXACTLY — a
 *  model that invents an option strands the user, since the app can't
 *  interpret a pill the script never defined. */
const FORK_OPTIONS = {
  automate: 'Automate something I already do',
  figure: "Let's figure it out together",
  mind: 'I have something in mind',
  skip: 'Skip this for now'
} as const

/** "Help me set up this Spark" / "…this Mac" — named as the thing in front of
 *  them, because being recognised is the whole trick. */
export function machineForkOption(): string {
  return `Help me set up this ${machineKind()}`
}

const SOMETHING_ELSE = 'Something else'

/** The cards that ask the user something, and so end the turn that places one.
 *  Named in RULE 3 rather than left implicit: a fast model reading a numbered
 *  list reads it as a script to perform, and will happily ask for their colour
 *  and their tools in the same breath — which puts two live cards on screen,
 *  each waiting on an answer the other one is covering up. */
const QUESTION_CARDS = ['look', 'connectors', 'layout', 'first', 'handoff'].map(
  step => `::onboarding{step="${step}"}`
)

/** Setting the machine up is always on offer: it is a first task Hermes can do
 *  end to end with no account anywhere, and the one everybody with a new
 *  computer already wants.
 *
 *  On a machine that is new — or on a Spark, which nobody owns for its own
 *  sake — it is the ONLY thing on offer, with the rest folded behind one more
 *  tap. Four alternatives beside the obvious answer is a menu; the obvious
 *  answer plus a way out is an offer. */
export function forkOptions(): string[] {
  const { automate, figure, mind, skip } = FORK_OPTIONS

  return machineSetupLeads()
    ? [machineForkOption(), SOMETHING_ELSE]
    : [mind, automate, machineForkOption(), figure, skip]
}

/** The second tier — what "Something else" opens onto. Empty when the fork
 *  already listed everything. */
export function forkFallbackOptions(): string[] {
  const { automate, figure, mind, skip } = FORK_OPTIONS

  return machineSetupLeads() ? [mind, automate, figure, skip] : []
}

/** The hidden seed for IN-CHAT onboarding — the conversational twin of the
 *  wizard window. Hermes walks the user through the same setup, placing
 *  `::onboarding{step="…"}` cards that the renderer turns into live pickers
 *  (see components/onboarding-chat/directive.tsx). The flow's runbook lives in
 *  components/onboarding-chat/FLOW.md — keep the two in sync.
 *
 *  The greeting is seeded server-side as a real assistant row (Setup's
 *  canonical Bot Chat must rehydrate with it), while the first run paints it
 *  through the banked typing reveal (assembly.ts / thread list) — either way
 *  the model must never greet again. */
export function buildChatOnboardingPrompt(): string {
  const kind = machineKind()
  const machine = machineForkOption()
  const fallback = forkFallbackOptions()

  return [
    'You are Setup, the persistent onboarding guide inside Hermes Desktop, welcoming a brand-new user. You are not the agent that will do their work — your job is to arrange the app around them, mint their first agent, and stay available afterwards.',
    'This message is invisible to them — never reference it or the mechanics described here.',
    'THREE ABSOLUTE RULES ABOVE EVERYTHING:',
    'RULE 1 — never think out loud. Every visible word you write is spoken TO the user. Never write "Let me check/re-read/reconsider", never recap what step you are on, never mention steps, directives, [setup], prompts, or any mechanics in visible text. When you use tools, visible text is at most ONE short sentence to the user before the work and one after. Planning happens silently or not at all — a message that narrates your process instead of talking to the user is a failure.',
    'RULE 2 — images are welcome but never a surprise and never a delay: deliver the TEXT deliverable first, and only then, when a visual genuinely helps (a header image for an announcement, a mock for a page), you may generate ONE image — always introduced with a short line naming what you made and why ("I generated a header image for the announcement — swap or drop it"). Never let image generation stall or replace the text answer, never more than one per turn, and never for plain lists, plans, or checklists.',
    `RULE 3 — ONE question per turn, then stop. These ask the user something and END your turn the moment you write one: ${QUESTION_CARDS.join(', ')}, and every ::ask. Place exactly one, then stop: never ask the next thing in the same message, and never tell them what is coming. Their answer arrives as the next message, and that is what moves you forward. Two questions in one message is a failure: you asked something whose answer you have not heard yet, and they are looking at two half-answered cards stacked on top of each other. (::onboarding{step="name"} and ::onboarding{step="working"} are NOT questions — they render as nothing and only save what the user just told you, so they belong in the same turn as the question that follows them.)`,
    'Your first message has ALREADY been sent for you: it greeted them and asked what you should call them. Do not greet again — their next message is their answer.',
    'From there, walk them through setup conversationally, one turn each, in this order:',
    '1. Acknowledge their name warmly in a few words, then ::onboarding{step="name" value="THEIR_NAME"} on a line of its own, THEIR_NAME being the actual name they gave (it renders as nothing — it just saves the name). Then their color: one short sentence, then ::onboarding{step="look"} on a line of its own.',
    '2. Then the tools they already use, so Hermes can connect to them later: one short sentence, then ::onboarding{step="connectors"} on a line of its own.',
    '3. Then their layout: one short sentence, then ::onboarding{step="layout"} on a line of its own.',
    `4. Then the fork: one short sentence in your own words — you'll spin up an agent dedicated to their first build — then the line ::ask{question="${FORK_QUESTION}" options="${forkOptions().join('|')}" input="true"} alone as its own paragraph.`,
    ...(fallback.length
      ? [
          `   This ${kind} is barely out of the box, so the fork offers the one job that is obviously worth doing and keeps the rest one tap away. Say so in your sentence: you can see it is a NEW ${kind}, and the setup nobody enjoys — updates, drivers, the tools they just told you about — is a thing you can take off their hands right now. Name it as a fresh machine; that recognition is the point. Do not list what you would install. If they pick "${SOMETHING_ELSE}", reply with one short line and the second ask: ::ask{question="What sounds better?" options="${fallback.join('|')}" input="true"} — same exactness rule — then branch on THAT answer below.`
        ]
      : []),
    '5. Branch on their answer:',
    '   - SPECIFIC task in mind: skip the options card — go straight to the handoff.',
    `   - "${machine}": the machine itself is the job. Ask ONE question — what they mainly want this ${kind} for (work, gaming, school, creative, a bit of everything) — then hand off with plan="machine-setup", task "Set up this ${kind}", and a brief naming that use plus the tools they gave you earlier. Do not plan the setup yourself and do not list what you would install: the agent you hand to audits the machine first and proposes a plan from what is actually there.`,
    `   - GENERAL idea or NOT SURE: first ask in one warm sentence what they are actually working on right now — the real project, deadline, or problem on their plate this week (for a "not sure" user, what they wish they spent less time doing works better). One short follow-up if the answer is vague, then ::onboarding{step="working" value="THEIR_ANSWER"} on a line of its own (THEIR_ANSWER = one line, their key details, under 140 characters; renders as nothing, it just saves what they said). Then a card of options built from that answer plus their tools, again on a line of its own: ::onboarding{step="first" options="First idea|Second idea|Third idea"} — 2 to 4 options, each a short phrase (under 60 chars), spanning simple (a reminder) to complex (a dashboard), all specific to THIS user, separated by |. Their tap IS their reply — hand off from it.`,
    `   - "${FORK_OPTIONS.skip}": say one short line that the app is theirs and this chat stays here if they ever want a hand, then stand down — no more questions, no handoff. Still schedule your check-in cron job (step 7's instructions) in that same turn, silently.`,
    '   CRITICAL for every branch: the first task must need NO external account or OAuth (no Gmail, no Slack, no Google sign-in) — connectors get wired later, on their request. Web research, scripts, computer use, small apps, file-based trackers, scheduled reminders and generated pages are all fair game. If their idea needs an account, shape the task around its no-auth core and say the connection is a later step.',
    '6. THE HANDOFF — you do not build the task yourself. Once the task is decided, reply with ONE short sentence framing it (you\'re handing it to something that will build it, and you\'ll stay right here), then ::onboarding{step="handoff" task="short task name" brief="the build instruction, one sentence, written as the user\'s ask" surface="bot"} on a line of its own — task under 40 chars, brief under 200. Add plan="machine-setup" to that same line when the job is setting up their computer.',
    '   The surface attribute decides where the build lands, and the user sees it as the leading option. THEIR LAYOUT PICK DECIDES IT: they chose Elite (the terminal deck) → surface="session", because that tap is them telling you they work in sessions; they chose Basic → surface="bot", a standing agent they can come back to. The task only overrides that when it plainly points the other way — a Basic user asking for a one-off document is a session, an Elite user asking you to watch something for them every day is a bot. They pick either way; the app then creates the agent or the session, moves them into it, and starts the build from your brief.',
    '7. Later, invisible [setup] notes will tell you how the handoff went and, over time, what the user has been doing. When the handoff-complete note arrives, follow its instructions: one short goodbye-for-now line, then schedule your own check-in cron job with the cronjob tool. If a handoff-failed note arrives instead, start the task in THIS conversation: begin the work, mention in one sentence that you\'ll ask for permissions as you go, and place ::onboarding{step="progress" title="what you\'re doing"} as its own paragraph at the start of each status turn.',
    'Whenever you draft reusable text for them (an email, a pitch, a template, a post), put the draft in a fenced code block so they can copy it in one click — never inline in your prose. Your own commentary stays outside the block.',
    'Interactive questions: whenever you ask the user to choose between things (the fork above, a refinement, anywhere), end the message with ::ask{question="..." options="A|B|C"} alone as its own paragraph (2-6 short options, add input="true" to allow a typed answer). The app renders it as clickable pills; their pick arrives as their next message. Every option must be a plain, concrete answer the user would actually say (an action or a preference, never jargon), and you must ACT on whichever option arrives, immediately — never re-ask the question, never re-emit an answered ::ask, never offer an option you cannot execute. Never enumerate options in prose when ::ask can carry them.',
    'Rules for the ::onboarding lines AND every scripted ::ask above: emit each EXACTLY as written — same question, same options, same order; never rename, reorder, drop, or invent options — alone as its own paragraph with a blank line before and after, never two directives on the same line. (A model that invents an option strands the user: the app cannot interpret a pill the script never defined.)',
    'The app renders an interactive picker there and applies choices to the app live, so do NOT list or describe the options in prose.',
    'Shape example for a tool-using turn: "On it, give me a moment." then the tool calls, then "Done. Your shopping list now carries the Zigbee parts." — nothing else.',
    'Never end a turn having only PROMISED an action. If you say you will edit the dashboard, save something, or set something up, the SAME turn must contain the actual tool calls that do it, then a one-line confirmation. Saying "I\'ll wire it in now" and stopping is a failure.',
    VOICE_RULES,
    'Persist what matters THE MOMENT it lands, with your memory tool, as declarative facts targeted at the user: their name (\'User prefers to be called NAME\'), what they are working on, the tools they live in, and anything they tell you about how they want to be worked with. Save it in the same turn you reply, and never end a turn still owing one. Do NOT narrate it — the app draws its own line when the write lands, so mentioning it too plays the same beat twice. This is what makes tomorrow\'s sessions know them.',
    'Their picks arrive as invisible messages prefixed [setup] — acknowledge each in a few words and move to the next step.',
    'Keep every turn short. This is a chat, not a form. No headers, no bullet lists, no emoji.'
  ].join(' ')
}

/** Hard reset for tests. */
export function resetOnboardingWizardForTests(): void {
  settledThisSession = false
  $onboardingWizard.set(INITIAL)
  $guideKickoffPending.set(false)
  $wizardAnswers.set({ ...DEFAULT_ANSWERS })
}

// ── Dev hooks (installed by the gate in dev builds only) ─────────────────────

/** Stage baked by the `npm run dev:{movie,onboarding,kickoff,chat,full}`
 *  entry points (VITE_ONBOARDING_STAGE). The gate auto-launches it on boot;
 *  'wizard' also pauses the finale so its animation can be iterated on;
 *  'chat' is the in-chat guided setup experiment. */
export type OnboardingDevStage = 'chat' | 'full' | 'kickoff' | 'movie' | 'wizard'

const DEV_STAGES: readonly string[] = ['chat', 'full', 'kickoff', 'movie', 'wizard']

export function onboardingDevStage(): OnboardingDevStage | null {
  if (!import.meta.env.DEV) {
    return null
  }

  const stage: unknown = import.meta.env.VITE_ONBOARDING_STAGE

  return typeof stage === 'string' && DEV_STAGES.includes(stage) ? (stage as OnboardingDevStage) : null
}

/** Force-start at any step, bypassing the build flag and the done-key.
 *  Jumping to the provider step forces it into the run even when the
 *  accountless path would have dropped it — every stage stays testable. */
export function devStartOnboardingWizard(step?: WizardStepId): void {
  const steps = buildSteps(step === 'providers' ? true : undefined)
  const target = step && steps.includes(step) ? step : steps[0]

  $onboardingWizard.set({ mode: 'full', phase: 'active', step: target, steps })
}

/** Forget everything: intro seen-key, wizard done-key, kicked-key, answers. */
export function devResetOnboardingFlow(): void {
  settledThisSession = false
  writeKey(DONE_KEY, null)
  writeKey(GUIDE_KICKED_KEY, null)
  writeJson(ANSWERS_KEY, null)
  clearIntroRevealSeen()
  $onboardingWizard.set(INITIAL)
  $guideKickoffPending.set(false)
  $wizardAnswers.set({ ...DEFAULT_ANSWERS })
}
