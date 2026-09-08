/**
 * First-screen artifact — the personalized thing onboarding hands the user at
 * the finale. The dialogue collects a profile (name + focus); this store turns
 * that profile plus the user's pick (dashboard / document / app) into a
 * self-contained config, and the finale theater reveals it block by block.
 *
 * The fiction contract: theater copy narrates real mechanical work (compile,
 * write, validate), and the per-block prompts ASSEMBLE DURING THE SEQUENCE are
 * shown verbatim — their text interpolates the user's answers, so the
 * personalization is visible, not claimed. Everything here is pure assembly:
 * no model call, no file write, no backend. The config is deterministic from
 * the profile, so a failed anything falls back to a generic-but-working deck.
 */

import { atom } from 'nanostores'

import { readJson, writeJson } from '@/lib/storage'
import { FIRST_SCREEN_PLUGIN_JS } from '@/store/first-screen-plugin-source'

export { FIRST_SCREEN_PLUGIN_JS }

const KIND_KEY = 'hermes-onboarding-first-screen-kind-v1'

export type FirstScreenKind = 'app' | 'dashboard' | 'document'

export const FIRST_SCREEN_KINDS: readonly FirstScreenKind[] = ['dashboard', 'document', 'app']

/** A single tile/button/document step. `prompt` is the full instruction sent
 *  to the agent when the block is used; it already embeds the profile. */
export interface FirstScreenBlock {
  id: string
  /** Which template rendered this block (drives the preview mock's shape). */
  kind: 'action' | 'draft' | 'feed' | 'skill' | 'tool'
  label: string
  /** Theater copy — the "doing" line shown while this block assembles. */
  stepLine: string
  /** The full prompt behind this block — the real personalization payload. */
  prompt: string
}

export interface FirstScreenConfig {
  blocks: FirstScreenBlock[]
  kind: FirstScreenKind
  /** Absolute path of screen.json once materialized — stamped so the pane's
   *  regenerate control can name the exact file in its rewrite prompt. */
  path?: string
  /** One-line why-it-fits summary, from the profile ("Mornings, writing…"). */
  rationale: string
  /** Evolution stage of the living screen: 'sketch' (wireframe, appears at
   *  the focus answer), 'proposals' (personalized modules landed, content
   *  pending), 'final' (built + populating). Absent = final (back-compat). */
  stage?: 'final' | 'proposals' | 'sketch'
  title: string
  userName: string
}

/** A module candidate generated from the user's own answers mid-conversation
 *  (see first-screen-live.ts). Kept modules become blocks at build. */
export interface DraftModule {
  id: string
  kind: FirstScreenBlock['kind']
  label: string
  prompt: string
}

export interface FirstScreenProfile {
  /** One-line summary of what they're working on right now (their words,
   *  captured by the guide). Empty until the context step lands. */
  context?: string
  focus: string[]
  name: string
}

/** How much dashboard this user should get. INFERRED, never asked — a 1-5
 *  self-rating is a calibration question new users can't answer, and the
 *  flow already carries the signal (focus picks + how they describe their
 *  project). Conservative default: simple. The refinement dialogue offers a
 *  one-click "simpler / more" correction afterwards. */
export type ScreenTier = 'power' | 'simple' | 'standard'

/** Compact humanizer ruleset appended to every model-facing prompt in the
 *  onboarding flow (guide, module generation, fill, button work orders).
 *  Distilled from the humanizer skill — the full skill can't be loaded here
 *  because these sessions run on fresh profiles that don't ship it. */
export const VOICE_RULES =
  'Voice rules for EVERYTHING you write: plain declaratives in active voice. No em dashes (use commas or periods). No exclamation marks. Never praise the user. No AI diction (delve, seamless, robust, crucial, pivotal, landscape, testament, elevate, empower). No "not just X, it\'s Y" constructions. No forced lists of three. No generic closers ("you\'re all set", "happy to help", "the future looks bright") — end on the last real point. Contractions are fine. Specifics over adjectives.'

const TECHNICAL_CONTEXT =
  /\b(api|repo|deploy|cod(e|ing)|sdk|infra|pipeline|model|backend|frontend|server|k8s|kubernetes|database|sql|compiler|agent|llm|prompt|open.?source|github|ci|cli)\b/i

export function inferScreenTier(profile: FirstScreenProfile): ScreenTier {
  const focus = profile.focus.map(f => f.toLowerCase())
  const context = (profile.context ?? '').trim()
  const technical = focus.includes('coding') || focus.includes('automation') || TECHNICAL_CONTEXT.test(context)

  if (technical) {
    return 'power'
  }

  // Exploring with no concrete project (or a one-liner): keep it calm.
  const exploring = focus.includes('just exploring') || focus.length === 0

  if (exploring && context.length < 25) {
    return 'simple'
  }

  return context.length < 25 && focus.length <= 1 ? 'simple' : 'standard'
}

// DEV iteration aid: initialAnswers() in onboarding-wizard.ts wipes stored
// answers every boot, which would reset the pick to the default on every HMR.
// The pick persists per-PROFILE here instead — same durability rule the rest
// of onboarding uses, isolated from the answers wipe.
function loadKind(): FirstScreenKind | null {
  const value = readJson<string>(KIND_KEY)

  return typeof value === 'string' && FIRST_SCREEN_KINDS.includes(value as FirstScreenKind)
    ? (value as FirstScreenKind)
    : null
}

export const $firstScreenKind = atom<FirstScreenKind | null>(loadKind())

export function setFirstScreenKind(kind: FirstScreenKind | null): void {
  $firstScreenKind.set(kind)
  writeJson(KIND_KEY, kind)
}

/** The sequence the user will see — used by the picker previews AND the
 *  theater, so what the card sketches is what's delivered.
 *
 *  `modules` — when the living screen generated personalized module
 *  candidates from the user's own words (first-screen-live.ts) and the user
 *  kept ≥1 of them, those REPLACE the deterministic template blocks: the
 *  screen is literally made of things named after their answers. The
 *  templates below remain the preview shapes and the no-generation fallback. */
export function compileFirstScreen(
  profile: FirstScreenProfile,
  kind: FirstScreenKind,
  modules?: DraftModule[]
): FirstScreenConfig {
  const focus = profile.focus.filter(Boolean)
  const name = profile.name.trim()
  const context = (profile.context ?? '').trim()
  const primary = focus[0] ?? 'your day'
  const secondary = focus[1] ?? focus[0] ?? 'your projects'
  // Their live project, threaded into every prompt: the focus chips are
  // taxonomy; the context line is the actual work on their plate this week.
  const about = context ? ` I'm currently working on: ${context}.` : ''
  // No name yet → speak in second person, never a fake name. "there's
  // command center" shipped once; never again.
  const userName = profile.name.trim() || 'you'
  const displayName = userName === 'you' ? '' : userName.replace(/(^|[\s-])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
  const possessive = displayName ? `${displayName}'s` : 'Your'

  const generated: FirstScreenBlock[] = (modules ?? []).map(module => ({
    id: module.id,
    kind: module.kind,
    label: module.label,
    prompt: module.prompt,
    stepLine: `Wiring ${module.label.toLowerCase()}`
  }))

  const blocks: FirstScreenBlock[] =
    generated.length > 0
      ? generated
      : kind === 'dashboard'
      ? [
          {
            id: 'start',
            kind: 'action',
            label: `Start today's ${primary.toLowerCase()}`,
            prompt: `Find my single best next task for today in ${primary.toLowerCase()}${focus.length > 1 ? ` or ${secondary.toLowerCase()}` : ''}.${about} One sentence on why it's the one, then the first three concrete steps. No preamble.`,
            stepLine: `Wiring your ${primary.toLowerCase()} starter`
          },
          {
            id: 'draft',
            kind: 'draft',
            label: 'Draft in your voice',
            prompt: `Draft what I describe, in my voice: plain, direct, short sentences.${about} Show me the draft, ask at most one clarifying question, then revise.`,
            stepLine: 'Teaching it your voice'
          },
          {
            id: 'brief',
            kind: 'feed',
            label: 'Morning brief',
            prompt: `Assemble my morning brief: three items on ${primary.toLowerCase()}${focus.length > 1 ? `, two on ${secondary.toLowerCase()}` : ''}, one line each with a source.${about} Close with one sentence on what I should look at first. Offer to save it as a recurring morning job.`,
            stepLine: 'Setting your morning brief'
          }
        ]
      : kind === 'document'
        ? [
            {
              id: 'brief',
              kind: 'feed',
              label: 'Your first issue',
              prompt: `Write the first issue of my personal brief. Lead with ${primary.toLowerCase()}: the three most useful things from the last day, one line each with a source. ${focus.length > 1 ? `Then a short ${secondary.toLowerCase()} section with two items. ` : ''}${about ? `For context,${about} ` : ''}Close with one concrete suggestion for today.`,
              stepLine: 'Composing your first issue'
            },
            {
              id: 'recurring',
              kind: 'action',
              label: 'Make it daily',
              prompt: `Set up a paused recurring job that regenerates my brief every morning, same shape as the first issue. Confirm it's paused and tell me exactly how to turn it on.`,
              stepLine: 'Setting the daily cadence'
            },
            {
              id: 'notebook',
              kind: 'draft',
              label: 'A page that remembers',
              prompt: `Keep a running page for me. When I paste anything, a quote, a link, a thought, file it under ${primary.toLowerCase()} or ${secondary.toLowerCase()} and acknowledge in one line. When I ask what I have on a topic, summarize what's filed.`,
              stepLine: 'Opening your notebook'
            }
          ]
        : [
            {
              id: 'tool',
              kind: 'tool',
              label: `${primary} helper`,
              prompt: `Act as my ${primary.toLowerCase()} helper, a tool rather than a conversation: I paste raw material, you return exactly one shaped result${focus.length > 1 ? ` about ${primary.toLowerCase()} or ${secondary.toLowerCase()}` : ''}, nothing else.${about} If my input is ambiguous, pick the most likely reading and show it. Three sections maximum.`,
              stepLine: `Building your ${primary.toLowerCase()} helper`
            },
            {
              id: 'refine',
              kind: 'action',
              label: 'Refine the last result',
              prompt: `Take your last result and my one-line correction, and return a revised result in the same shape. If my correction changes the rules, say what changed in one sentence.`,
              stepLine: 'Wiring the refine loop'
            },
            {
              id: 'share',
              kind: 'draft',
              label: 'Save as a template',
              prompt: `Turn the current inputs into a reusable template: name it, describe the input it expects in one line, and store it so the next run starts from it. Confirm the name.`,
              stepLine: 'Making it repeatable'
            }
          ]

  const focusSummary =
    focus.length === 0
      ? 'your day'
      : focus.length === 1
        ? primary.toLowerCase()
        : `${primary.toLowerCase()} and ${secondary.toLowerCase()}`

  // Every dashboard carries the SKILL card: the playbook Hermes writes for
  // itself about this user, visibly versioned, updated on every decision —
  // self-improvement as a living artifact instead of a claim.
  const skillCard: FirstScreenBlock = {
    id: 'hermes-skill',
    kind: 'skill',
    label: 'What Hermes has learned',
    prompt: `Read my dashboard's screen.json (the hermes-skill block) and tell me in plain words what you've learned about me and how you're using it. Then ask what to add or correct.`,
    stepLine: 'Starting your skill'
  }

  return {
    blocks: [...blocks, skillCard],
    kind,
    rationale: context ? `Built around what you're working on: ${context}` : `Built around ${focusSummary}`,
    title:
      kind === 'dashboard'
        ? `${possessive} Dashboard`
        : kind === 'document'
          ? `${possessive} Daily Brief`
          : `${possessive} ${primary} Tool`,
    userName
  }
}

// ── Theater timeline ────────────────────────────────────────────────────────
// One declarative beat table the finale's clock reads. Copy stays normie —
// the "real work" it narrates is the config assembly above (compile + write +
// validate), which completes inside the first beat.

export interface TheaterBeat {
  /** Block assembled during this beat (its stepLine drives the row copy). */
  blockIndex?: number
  cue: 'assemble' | 'header' | 'prompt' | 'validate'
  /** Prompt lines are typed out — the personalization is the entertainment. */
  prompt?: string
  /** ms from sequence start. */
  t: number
  text?: string
}

export function buildTheaterBeats(config: FirstScreenConfig): TheaterBeat[] {
  const beats: TheaterBeat[] = []
  const beatMs = 1900

  beats.push({
    cue: 'header',
    t: 0,
    text: `Making ${config.userName === 'you' ? 'your' : `${config.userName}'s`} ${config.kind}`
  })

  config.blocks.forEach((block, i) => {
    const t = 900 + i * beatMs

    beats.push({ blockIndex: i, cue: 'assemble', t, text: block.stepLine })
    // Show the actual prompt being compiled — the user's own words land in it.
    beats.push({ blockIndex: i, cue: 'prompt', prompt: block.prompt, t: t + 500 })
  })

  const last = 900 + config.blocks.length * beatMs

  beats.push({ cue: 'validate', t: last, text: 'Checking everything works' })

  return beats
}

// ── Theater timing ───────────────────────────────────────────────────────────

const BEAT_MS = 1900

/** Total theater length — the surface schedules the reveal hold + handoff
 *  after this. */
export function theaterDuration(config: FirstScreenConfig): number {
  return 900 + config.blocks.length * BEAT_MS + 1400
}

export function resetFirstScreenForTests(): void {
  $firstScreenKind.set(null)
}

// ── Materialization ─────────────────────────────────────────────────────────

/** The plugin folder id the artifact lands in, under the LOCAL desktop-plugins
 *  root. Fixed so a repeat run overwrites the same folder, not a litter of
 *  suffixed copies. */
export const FIRST_SCREEN_PLUGIN_DIR = 'first-screen'

/** The plugin.js source lives in first-screen-plugin-source.ts (the designed
 *  renderer: masthead, dateline, regenerate, indexed feed rows, checklist,
 *  typeset skeleton, working tool panel — every element sends a scoped prompt
 *  into the chat). Imported at the top of this file and re-exported. */

/** Serialize a config into the plugin's screen.json — the file the user edits
 *  later. The prompts carry the profile, and the `generatedFrom` echo is what
 *  makes the file read as theirs when they open it outside the app. `path`
 *  (when known) rides inside so the pane's regenerate control can name the
 *  exact file; `stage` drives the living-screen render states. */
export function firstScreenFileContent(config: FirstScreenConfig): string {
  return `${JSON.stringify(
    {
      blocks: config.blocks.map(({ id, kind, label, prompt }) => ({ id, kind, label, prompt })),
      generatedAt: new Date().toISOString(),
      generatedFrom: { focus: config.rationale, name: config.userName },
      kind: config.kind,
      ...(config.path ? { path: config.path } : {}),
      // The FINAL build immediately enters the populate pass — stamp the
      // in-progress flag so the pane renders shimmer + disabled Run instead
      // of guessing from file age. populate's rewrite (or clear-on-failure)
      // replaces the file without it.
      ...(config.stage && config.stage !== 'final' ? { stage: config.stage } : { populating: true }),
      title: config.title
    },
    null,
    2
  )}\n`
}

/** The dashboard's companion skill, materialized into
 *  `<HERMES_HOME>/skills/onboarding-dashboard/SKILL.md` alongside the plugin.
 *  This is the durable home of the schema + interaction contracts: any
 *  session that touches the dashboard loads this from the skill index
 *  instead of reading renderer source ("Let me find how the renderer reads
 *  this file" happened in a live run — never again). */
export function onboardingDashboardSkill(screenPath: string): string {
  return `---
name: onboarding-dashboard
description: Use when a message mentions the Onboarding Dashboard or edits ${screenPath} — schema and contracts for the user's dashboard.
---

# Onboarding Dashboard

The user's dashboard is a desktop plugin pane rendering ONE file:

    ${screenPath}

Edit that file to change the dashboard; the pane repaints on every save.
It was built during onboarding as an EXAMPLE of Hermes building interfaces.
The user can ask for another screen, tool, or plugin anytime, and may ask
you to delete this one (trash its whole folder).

## screen.json schema

Top-level: { "title", "kind": "dashboard", "path", "populatedAt", "blocks": [] }.
Optional flags you must NEVER write: "populating", "stage".

Each block: { "id", "kind", "label", "prompt", "content" }.
- id: stable slug, never change it on edit.
- kind: action | draft | feed | tool | choice | input | skill.
- label: short title-case card name.
- prompt: the full instruction behind the card's Run button.
- content: the card body, ALWAYS an object nested under "content" with its
  own "kind" matching the block. NEVER put items/steps at the block level.

Content shapes by kind (exact):
- action: {"kind":"action","steps":["plain string", ...]} — steps are STRINGS,
  never objects. 3-5 steps, each a concrete physical action.
- draft: {"kind":"draft","skeleton":"multiline text"}
- feed: {"kind":"feed","lede":"optional line","items":[{"line":"<=100 chars","source":"site name"}]}
- tool: {"kind":"tool","example":{"input":"…","output":"…"}}
- choice: {"kind":"choice","question":"…","options":[{"label":"<=32 chars","prompt":"full instruction"}]}
- input: {"kind":"input","placeholder":"…","promptPrefix":"instruction the typed text is appended to"}
- skill: {"kind":"skill","version":N,"learned":["second-person line", ...]}
  — "What Hermes has learned" card. On EVERY decision the user makes, add
  one short learned line and increment version by 1 (the card plays its
  level-up animation on the bump).

## Interaction contracts

- [Onboarding Dashboard button] prefix: DO the card's task, hand over the
  finished deliverable in chat. Never edit the file on a button press.
- [Onboarding Dashboard refresh]: rewrite ONLY that feed block's content
  (web search for current items), save, one line in chat.
- [Onboarding Dashboard choice] / [input]: a DECISION about their project.
  Deliverable first, then ripple the decision through every card it
  genuinely affects (checklist gains decision-specific items, prompts
  re-aim) and update the skill block (+1 version, one new learned line).
  Untouched blocks stay byte-identical.
- A checklist step click means "help me DO this step" — do the work, never
  reshape the dashboard.
- When changing what a card is about: rewrite label, prompt, AND content
  together. A renamed card with stale content is a failure.
- Never write "populating"; keep "populatedAt" fresh (ISO timestamp) on edits.
- Reusable text (emails, posts, templates) goes in fenced code blocks.
- Never think out loud; tool turns get one short sentence before and after.
- Text deliverable first; at most one image per turn, only when a visual
  genuinely helps, always introduced by a line naming what you made.
`
}

export type MaterializeFirstScreenResult = { ok: true; path: string } | { ok: false; error: string }

/** Persist the artifact into `<desktop-plugins>/first-screen/screen.json`.
 *  No-op (ok) when there is no Electron bridge — browser runs just don't get
 *  the file. Called by the wizard window as it hands off, so the reveal's
 *  promise about the file path is already true when the user opens it. */
export async function materializeFirstScreen(config: FirstScreenConfig): Promise<MaterializeFirstScreenResult> {
  const desktop = window.hermesDesktop

  if (!desktop?.desktopPluginsRoot) {
    return { ok: false, error: 'no electron bridge' }
  }

  try {
    if (desktop.mkdirDesktopPlugin) {
      const made = await desktop.mkdirDesktopPlugin(FIRST_SCREEN_PLUGIN_DIR)

      if (!made.ok) {
        return { ok: false, error: made.error ?? 'mkdir failed' }
      }
    }

    const root = await desktop.desktopPluginsRoot()
    const dir = `${root}/${FIRST_SCREEN_PLUGIN_DIR}`
    const filePath = `${dir}/screen.json`

    if (!desktop.writeTextFile) {
      return { ok: false, error: 'no writeTextFile' }
    }

    // The pane itself: plugin.js (the renderer) + screen.json (the artifact)
    // land in the same folder, so the disk-door loader picks the plugin up on
    // its next scan tick — and any later save to either file hot-reloads it.
    // The absolute path is stamped INTO the config first so the file can name
    // itself (the pane's regenerate control quotes it back to the agent).
    await desktop.writeTextFile(`${dir}/plugin.js`, FIRST_SCREEN_PLUGIN_JS)
    await desktop.writeTextFile(filePath, firstScreenFileContent({ ...config, path: filePath }))

    // The companion SKILL rides along: schema + interaction contracts land in
    // the agent's skill index, so any session that touches the dashboard
    // already knows the file and its shapes. Best-effort — the dashboard
    // works without it; the skill is what makes edits reliable.
    if (desktop.materializeSkill) {
      await desktop.materializeSkill('onboarding-dashboard', onboardingDashboardSkill(filePath)).catch(() => undefined)
    }

    return { ok: true, path: filePath }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
