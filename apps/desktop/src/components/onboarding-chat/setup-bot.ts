/**
 * Setup bot — the bot-mode variant of the guided onboarding.
 *
 * The guided chat is no longer an anonymous session: it is the canonical
 * "Bot Chat" of a persistent `hermes-setup` profile ("Setup" in the Bots
 * roster). Setup walks the user through the same beats as before, but when
 * the first task is decided it does NOT build it here — it emits
 * `::onboarding{step="handoff" task="…" brief="…"}` and the renderer mints a
 * NEW bot around that task, opens the new bot's chat, and starts the build
 * there. Setup stays alive: it gets a hidden [setup] note about the handoff,
 * schedules its own check-ins (cronjob tool), and remains one roster click
 * away — training wheels the user can ignore or retire whenever.
 *
 * This module owns the pure pieces (names, souls, seed prompts, the handoff
 * request atom). The side effects — profiles.create, session.create, the
 * chat switch — live in the wiring's handoff effect so they run with real
 * gateway/session hooks.
 */

import { atom } from 'nanostores'

import type { GatewayRequest } from '@/app/session/hooks/use-prompt-actions/utils'
import { ELITE_LAYOUT_ID } from '@/components/onboarding-wizard/options'
import { readKey, writeKey } from '@/lib/storage'
import { machineDescription } from '@/store/machine'
import type { WizardAnswers } from '@/store/onboarding-wizard'

/** Profile name of the onboarding guide. Prefixed so it can't collide with a
 *  profile a user actually named "setup". */
export const SETUP_BOT_PROFILE = 'hermes-setup'
export const SETUP_BOT_TITLE = 'Setup'

/** Roster looks (ui_meta['hermes-bots'] shape/color). */
export const SETUP_BOT_LOOK = { color: '#f2b04c', shape: 'blobatar' }
export const TASK_BOT_LOOK = { color: '#7aa2f7', shape: 'blobatar' }

const HANDOFF_DONE_KEY = 'hermes-setup-handoff-done-v1'

export type SetupHandoffPhase = 'done' | 'error' | 'minting' | 'pending'

/** Where the first build lands. A bot is a STANDING relationship — its own
 *  profile, its own canonical chat, it can check in later. A session is a
 *  discrete piece of work on the user's default profile: visible in the
 *  Sessions list, git strip and panels intact, the normal app. Setup proposes
 *  one from the conversation; the user picks on the handoff card. */
export type HandoffSurface = 'bot' | 'session'

/** What KIND of first job this is. 'machine-setup' is the one shape we script
 *  ourselves: the work is known (audit the box, then install), the user can't
 *  brief it, and the agent needs permission discipline the moment it starts
 *  touching the system. Everything else is 'build' — the user's own idea. */
export type HandoffPlan = 'build' | 'machine-setup'

export function parseHandoffPlan(raw: string | undefined): HandoffPlan {
  return (raw ?? '').trim().toLowerCase() === 'machine-setup' ? 'machine-setup' : 'build'
}

export interface SetupHandoffState {
  task: string
  brief: string
  phase: SetupHandoffPhase
  plan: HandoffPlan
  surface: HandoffSurface
  /** Set once the task bot exists (bot surface only). */
  botName?: string
  botTitle?: string
}

/** Read the model's `surface="…"` attr; null when absent or unrecognized so
 *  the card can fall back to its own default. */
export function parseHandoffSurface(raw: string | undefined): HandoffSurface | null {
  const value = (raw ?? '').trim().toLowerCase()

  return value === 'bot' || value === 'session' ? value : null
}

/** The layout pick decides the surface: Elite is a deliberate tap on a
 *  terminal deck — the clearest "I work in sessions" a user gives us, and a
 *  harder signal than reading developer-ness out of how they phrase things.
 *  Setup is told the same rule, so this is both the fallback when it omits
 *  the attr and the floor its proposal is measured against. */
export function defaultHandoffSurface(layout: string): HandoffSurface {
  return layout === ELITE_LAYOUT_ID ? 'session' : 'bot'
}

/** The handoff beacon: HandoffCard raises it, the wiring effect performs it.
 *  Null until the model emits the handoff directive. */
export const $setupHandoff = atom<null | SetupHandoffState>(null)

/** The setup bot's own session ids (+ owning profile, null in the profile-less
 *  fallback), kept so the handoff can whisper a hidden [setup] note back into
 *  the guide chat — on the guide's own backend — after the task bot takes
 *  over. */
export const $setupBotSession = atom<null | {
  profile: null | string
  runtimeId: string
  storedId: null | string
}>(null)

/** Raise the handoff request (once per task — re-parses and re-mounts of the
 *  directive are no-ops, and a relaunch after a completed handoff stays
 *  quiet thanks to the storage latch). */
export function requestSetupHandoff(
  task: string,
  brief: string,
  surface: HandoffSurface,
  plan: HandoffPlan = 'build'
): boolean {
  if ($setupHandoff.get() !== null || readKey(HANDOFF_DONE_KEY) === '1') {
    return false
  }

  $setupHandoff.set({ brief, phase: 'pending', plan, surface, task })

  return true
}

/** Burn the relaunch latch — the task bot exists and its chat is open. */
export function markSetupHandoffDone(): void {
  writeKey(HANDOFF_DONE_KEY, '1')
}

/** True once a handoff completed on this install (survives relaunch) — used
 *  by the card to render its settled state when the atom is long gone. */
export function hasCompletedSetupHandoff(): boolean {
  return readKey(HANDOFF_DONE_KEY) === '1'
}

export function resetSetupHandoffForTests(): void {
  writeKey(HANDOFF_DONE_KEY, null)
  $setupHandoff.set(null)
  $setupBotSession.set(null)
}

/** Slug a task title into a valid profile name (^[a-z0-9][a-z0-9_-]{0,63}$). */
export function taskBotSlug(task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 48)
    .replace(/^[-_]+|[-_]+$/g, '')

  return slug && /^[a-z0-9]/.test(slug) ? slug : 'first-build'
}

/** Short display title for the task bot's roster row. */
export function taskBotTitle(task: string): string {
  const trimmed = task.trim()

  return trimmed.length > 28 ? `${trimmed.slice(0, 27).trimEnd()}…` : trimmed || 'First build'
}

/** SOUL.md for the Setup profile — its standing identity across the guide
 *  chat, later check-ins, and every cron run. */
export function composeSetupBotSoul(): string {
  return [
    '# Setup',
    '',
    "You are Setup, this user's Hermes onboarding guide. You walked them through their first-run setup, and you stay with them after it: a calm, brief companion who tracks how their setup is going and offers the next helpful step at the right moment.",
    '',
    '- You are training wheels: useful early, ignorable later. Never guilt-trip, never nag. If the user asks you to stop checking in, stop.',
    '- When you check in, look at what has actually changed (their bots, sessions, connectors, scheduled jobs) before offering anything. One concrete suggestion beats a menu.',
    '- Things worth offering, roughly in order: wiring a connector they said they use, scheduling something they do repeatedly, a second build based on the first, keyboard/layout niceties.',
    '- Keep every message short. No headers, no bullet walls, no emoji.'
  ].join('\n')
}

/** SOUL.md for a freshly minted task bot. */
export function composeTaskBotSoul(task: string, answers: WizardAnswers, plan: HandoffPlan = 'build'): string {
  const name = (answers.name ?? '').trim()
  const context = (answers.context ?? '').trim()
  const tools = (answers.connectors ?? []).filter(Boolean)

  return [
    `# ${taskBotTitle(task)}`,
    '',
    `You are a Hermes agent minted for one job: ${task.trim()}.${name ? ` You work for ${name}.` : ''}`,
    ...(context ? ['', `What they are working on: ${context}`] : []),
    ...(tools.length ? [`Tools they use day to day: ${tools.join(', ')} (not connected yet — wiring one up is a later step, on their request).`] : []),
    '',
    '- Own this task end to end: build it, improve it, keep it running.',
    '- Be direct and brief; show your work as you go.',
    ...(plan === 'machine-setup'
      ? [
          "- This machine is your job for good: you know what is installed on it and why. When they hit something missing later, you are the one who fixes it.",
          '- Look before you install, propose before you change, and never touch what they did not agree to.'
        ]
      : ['- Ask before touching anything outside your task.'])
  ].join('\n')
}

/** The hidden runbook seeded into the task bot's chat — the work-side half of
 *  the old single-chat script: no-auth first build, the permissions note, and
 *  the live progress cards. */
export function buildTaskBotRunbook(
  task: string,
  answers: WizardAnswers,
  surface: HandoffSurface,
  plan: HandoffPlan = 'build'
): string {
  const name = (answers.name ?? '').trim()
  const context = (answers.context ?? '').trim()
  const tools = (answers.connectors ?? []).filter(Boolean)

  return [
    surface === 'bot'
      ? `You are a brand-new agent that Setup (the onboarding guide) just created around one task: ${task.trim()}.`
      : `Setup (the onboarding guide) just opened this session for one task: ${task.trim()}.`,
    'This message is invisible to the user — never reference it or the mechanics described here.',
    name ? `The user is called ${name} — you already know that, so never introduce yourself or ask who they are.` : '',
    context ? `They told Setup what they are working on: ${context}. Let it shape your choices without re-asking.` : '',
    tools.length
      ? `Tools they use day to day: ${tools.join(', ')} — none are connected yet; never require one for this first build.`
      : '',
    'Their next message is the go signal: really begin the work — plan briefly, then build (scaffold, research, first artifact).',
    'As you start, tell them in one short sentence: you\'ll ask for permissions as you go, and they can say no to anything or redirect you.',
    ...(plan === 'machine-setup' ? machineSetupRunbook() : [NO_AUTH_RULE]),
    'While the work runs, place ::onboarding{step="progress" title="what you\'re doing"} as its own paragraph at the start of each status turn — the card shows the build breathing live. Keep the titles short and present-tense ("Scaffolding the project", "Wiring the reminder"). Emit each exactly like that, alone on its own line.',
    'When the first pass of the build is DONE: end that turn with ::ask{question="Does this match what you wanted?" options="Looks right|Change something|Take it further"} alone as its own paragraph, emitted EXACTLY as written. Act on their pick immediately. One unreviewed first output is how a build reads as broken; the ask is how it reads as a collaboration.',
    'Keep every turn short. No headers, no bullet lists, no emoji.'
  ]
    .filter(Boolean)
    .join(' ')
}

const NO_AUTH_RULE =
  'CRITICAL: this first build must need NO external account or OAuth (no Gmail, no Slack, no Google sign-in) — connectors get wired later, on their request. Everything else is fair game and the more visible the better: web research with the browser shown to the user as you work, scripts, computer use, a small app, a file-based tracker, a scheduled reminder, a generated page. If the idea needs an account, build the no-auth core first and say the connection is a later step.'

/** The one first job we script end to end. Setting up a machine is the task a
 *  brand-new user most wants and can least brief, so the agent does the
 *  briefing: look first, propose, then install with consent. Audit-before-plan
 *  is the load-bearing part — a plan invented before looking is how an agent
 *  ends up installing a second copy of something, or "fixing" drivers that
 *  were already fine. */
const MACHINE_SETUP_RUNBOOK = [
  'THIS IS A MACHINE SETUP JOB: get this computer genuinely ready to use, end to end, with the terminal. It is the one first task that does not need an account anywhere — never send them to a sign-in to complete it.',
  'START BY LOOKING, NOT PLANNING. Before proposing anything, use the terminal to find out what is actually here: OS name and version, architecture, pending system updates, free disk, which package manager exists (Homebrew / winget / apt / dnf), and which everyday things are already installed (a browser, an editor, git, python, node, docker, and whatever tools they told Setup they use). On an NVIDIA machine also check the GPU and driver (nvidia-smi) and whether a container runtime and CUDA toolchain are present. Report what you found in a few short lines — plainly, no tables.',
  'THEN PROPOSE, THEN ASK. Turn the gaps into a short numbered plan, cheapest and most obviously useful first: system updates, a package manager if missing, their everyday tools, sane defaults, and only then anything exotic. End that turn with ::ask{question="Want me to run this?" options="Go ahead|Change the list|Just the essentials"} alone as its own paragraph, emitted EXACTLY as written.',
  'THEN WORK IT ONE STEP AT A TIME, saying in one short line what each step is for before you run it. Prefer the official package manager over downloading installers. Never install something they did not agree to, never overwrite existing config without asking first, never disable security settings, and stop and ask the moment anything looks destructive or wants a password you were not given.',
  'Hardware and drivers: on Windows, check for missing/unknown devices and vendor GPU drivers, and say plainly when the OS already has it handled. On macOS, system updates and the App Store cover drivers — say so instead of inventing work. On Linux, check the kernel/driver pairing for the GPU before touching it.',
  'If the machine is Arm (an Arm64 Windows PC, an Apple silicon Mac), architecture is the first thing you check for every install: prefer the native arm64 build, say so when only an emulated x64 one exists, and never assume a tool has an Arm release because it is popular. On an Arm Windows PC with NVIDIA silicon, treat CUDA and anything GPU-adjacent as arm64-specific — verify the build before installing it.',
  'Anything that genuinely needs their sign-in, a licence key, or a payment: do not attempt it. Collect those into a short "yours to do" list for the end.',
  'FINISH with a few lines: what changed, what you skipped and why, and what is left for them. If a reboot is needed, say so plainly.'
]

/** The same runbook, opening with what the app already knows about the machine
 *  — freshness first. That fact decides whether the job is an afternoon of real
 *  work or a tour of things already handled, and the agent should not spend its
 *  first two turns discovering what one IPC already answered. */
function machineSetupRunbook(): string[] {
  const description = machineDescription()

  return description
    ? [`What the app can already see about it: ${description}.`, ...MACHINE_SETUP_RUNBOOK]
    : MACHINE_SETUP_RUNBOOK
}

/** Seed rows for the task bot's session.create — just the hidden runbook; the
 *  visible go-signal (the task brief) is submitted as a real turn right after,
 *  which is what starts the build. */
export function buildTaskBotSeedMessages(
  task: string,
  answers: WizardAnswers,
  surface: HandoffSurface,
  plan: HandoffPlan = 'build'
): { content: string; display_kind?: 'hidden'; role: 'assistant' | 'user' }[] {
  return [{ content: buildTaskBotRunbook(task, answers, surface, plan), display_kind: 'hidden', role: 'user' }]
}

/** The hidden note whispered into the Setup chat once the task bot is live —
 *  Setup's cue to close the loop and schedule its check-ins. */
export function buildHandoffCompleteNote(task: string, botTitle: string, surface: HandoffSurface): string {
  const where = surface === 'bot' ? `the ${botTitle} bot's chat` : 'a new session'

  return `[setup] handoff complete — "${task.trim()}" is now building in ${where}, and the user is watching it there. Say one short line: you'll check in as they get going, and this chat is always here. Then schedule yourself a check-in cron job (cronjob tool, e.g. daily) that reviews what the user has set up so far and offers ONE next step if a genuinely useful one exists. VERIFY the schedule landed in the same turn: after creating it, list your cron jobs (cronjob action=list) and confirm the job is there — if it is missing, create it again once; if it still fails, say one honest line that check-ins are off and they can ask for one anytime. Never claim you scheduled something you did not confirm. Your check-in cron reviews their FIRST BUILD too: on its first run, look at what the ${surface === 'bot' ? 'task bot' : 'session'} produced and ask the user in one line whether it matched what they wanted — if not, offer to steer it.`
}

/** The hidden note when minting the task bot failed — Setup falls back to
 *  building in its own chat, PR-12 style, so the flow never dead-ends. */
export function buildHandoffFailedNote(task: string): string {
  return `[setup] handoff failed — the separate task bot could not be created. Start the task ("${task.trim()}") right here in this conversation instead: begin the work now, mention the permissions note, and place ::onboarding{step="progress" title="…"} cards as you go.`
}

// ── gateway helpers (called from the wiring's kickoff + handoff effects) ─────

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && /exist/i.test(error.message)
}

/** Stamp a bot's roster look + canonical-chat pin (ui_meta['hermes-bots'] —
 *  the gateway merges per key). Best-effort: a miss only costs roster polish,
 *  never the flow. */
export async function stampBotMeta(
  request: GatewayRequest,
  name: string,
  meta: { chat?: string; color: string; shape: string; title: string }
): Promise<void> {
  await request('profiles.configure', {
    name,
    ui_meta: { 'hermes-bots': { created: Date.now(), ...meta } }
  }).catch(() => undefined)
}

/** The guided chat's model. Every Setup turn is a short scripted beat, and the
 *  cards LOCK (inert) until the turn settles — so model latency is dead UI in
 *  the user's hands, not just a slow reply. A live run on a thinking default
 *  left the colour card unclickable for five minutes.
 *
 *  MINIMAL reasoning, not 'none': with the channel fully closed the model
 *  plans in VISIBLE prose instead (live runs: walls of "Let me re-read the
 *  steps…"). Minimal gives that planning a hidden home while staying fast. */
export const FAST_LANE = {
  model: 'deepseek/deepseek-v4-flash-0731',
  provider: 'nous',
  reasoningEffort: 'minimal'
} as const

const FAST_LANE_MODEL = `${FAST_LANE.model} --provider ${FAST_LANE.provider}`

/**
 * Put a guided session on the fast lane — session scope first so it takes
 * effect on this very turn, then global so Setup's later turns stay there.
 *
 * This is the ONLY route for an ADOPTED chat, which already exists and cannot
 * be re-born. A chat being created must not rely on it: the desktop stamps the
 * composer's current model onto every `session.create`, so a new guided chat
 * starts on the user's default and this switch is a race against its own first
 * turn — which is what left a fresh run reading "opus 5" in the picker. Creates
 * pass `FAST_LANE` through `session.create` and are born correct; this then
 * only moves the profile default.
 *
 * Scoped to the ACTIVE backend, which in bot mode is the hermes-setup
 * profile, so the user's real default is never touched.
 *
 * `confirm_expensive_model` is required: with no agent built yet the switch
 * otherwise answers `confirm_required` (a selection warning) instead of
 * switching. Failures are survivable — the profile default still works — but
 * they are NOT silent: a swallowed refusal here is indistinguishable from a
 * slow model, which is the whole bug this exists to prevent.
 */
export async function pinFastLane(request: GatewayRequest, sessionId: string): Promise<void> {
  // `model` carries its scope as a flag in the value; `reasoning` takes a
  // `scope` param. Mirrored rather than unified — this is the gateway's shape.
  const set = (label: string, params: Record<string, unknown>) =>
    request('config.set', { session_id: sessionId, ...params }).catch(error => {
      console.warn(`[setup-bot] fast lane ${label} refused — guided turns stay on the profile default`, error)
    })

  await set('model', { confirm_expensive_model: true, key: 'model', value: `${FAST_LANE_MODEL} --session` })
  await set('reasoning', { key: 'reasoning', value: 'minimal' })
  await set('model (global)', { confirm_expensive_model: true, key: 'model', value: `${FAST_LANE_MODEL} --global` })
  await set('reasoning (global)', { key: 'reasoning', scope: 'global', value: 'minimal' })
}

/** Make sure the `hermes-setup` profile exists (idempotent — an existing one
 *  is adopted). Returns false when the backend can't create profiles at all;
 *  the kickoff then falls back to the profile-less guided chat. */
export async function ensureSetupBotProfile(request: GatewayRequest): Promise<boolean> {
  try {
    await request('profiles.create', {
      description: 'Onboarding guide — walks first-run setup, then checks in as you find your feet.',
      name: SETUP_BOT_PROFILE,
      share_auth: true,
      soul: composeSetupBotSoul()
    })
  } catch (error) {
    if (!isAlreadyExists(error)) {
      return false
    }
  }

  await stampBotMeta(request, SETUP_BOT_PROFILE, { ...SETUP_BOT_LOOK, title: SETUP_BOT_TITLE })

  return true
}

/** Mint the task bot's profile, suffixing past name collisions (dev reruns,
 *  a second onboarding on the same machine). Returns the final name. */
export async function mintTaskBotProfile(
  request: GatewayRequest,
  task: string,
  answers: WizardAnswers,
  plan: HandoffPlan = 'build'
): Promise<string> {
  const base = taskBotSlug(task)

  for (let attempt = 0; attempt < 4; attempt++) {
    const name = attempt === 0 ? base : `${base}-${attempt + 1}`

    try {
      await request('profiles.create', {
        description: task.trim(),
        name,
        share_auth: true,
        soul: composeTaskBotSoul(task, answers, plan)
      })

      return name
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error
      }
    }
  }

  throw new Error(`no free profile name for ${base}`)
}
