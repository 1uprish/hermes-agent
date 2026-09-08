/**
 * The LIVING SCREEN — the evolution engine behind in-chat onboarding's pane.
 *
 * The old flow revealed the artifact once, at the end, with three template
 * buttons. This store makes the pane a participant in the conversation
 * instead: it opens as a wireframe SKETCH the moment the user says what they
 * want help with, and every subsequent answer rewrites screen.json → the
 * pane's file watcher repaints → the user watches their app take shape while
 * they talk. The module list itself is GENERATED from their own words (a
 * hidden fast-lane turn), so no two users see the same screen.
 *
 * Stages (config.stage in screen.json):
 *   sketch    — wireframe modules from the focus picks; muted, "taking shape"
 *   proposals — generated modules landed; titles real, content pending
 *   final     — user kept/dropped modules and built; population fills content
 *
 * Everything here is fire-and-forget and fail-open: a failed generation or a
 * missing bridge leaves the deterministic template flow exactly as it was.
 */

import { atom } from 'nanostores'

import { fillScreenContent, type PopulateResult } from '@/store/first-screen-populate'
import { activeGateway } from '@/store/gateway'
import {
  compileFirstScreen,
  type DraftModule,
  FIRST_SCREEN_PLUGIN_DIR,
  type FirstScreenBlock,
  type FirstScreenConfig,
  firstScreenFileContent,
  type FirstScreenKind,
  inferScreenTier,
  materializeFirstScreen,
  VOICE_RULES
} from '@/store/onboarding-first-screen'
import { $wizardAnswers } from '@/store/onboarding-wizard'

// ── State ────────────────────────────────────────────────────────────────────

/** Generated module candidates for the first-screen card's keep/drop rows.
 *  null = generation not finished (card falls back to kind tiles if it must
 *  render before candidates land or after generation failed). */
export const $moduleCandidates = atom<DraftModule[] | null>(null)

/** Candidate ids the user has toggled OFF in the first-screen card. */
export const $droppedModuleIds = atom<readonly string[]>([])

/** True once the sketch pane is open beside the chat. */
export const $livePaneOpen = atom(false)

let generationInFlight = false

/** Speculative content fill, keyed by module id — runs DURING the selector
 *  steps (connectors/color/layout are dead time for the builder), so at Build
 *  the kept modules' content is usually already written. null until the
 *  first pass lands. */
export const $speculativeFill = atom<null | PopulateResult>(null)

let speculativeInFlight = false
// Build takes ownership of screen.json — the speculative writer must never
// clobber the final file with a proposals-stage rewrite after that.
let speculativeWritesStopped = false

export function resetLiveScreenForTests(): void {
  $moduleCandidates.set(null)
  $droppedModuleIds.set([])
  $livePaneOpen.set(false)
  generationInFlight = false
  $speculativeFill.set(null)
  speculativeInFlight = false
  speculativeWritesStopped = false
}

// ── Sketch + rewrite plumbing ────────────────────────────────────────────────

/** "sam" -> "Sam" — the pane masthead reads as a proper title. */
function titleCaseName(name: string): string {
  return name.replace(/(^|[\s-])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

function currentProfile() {
  const answers = $wizardAnswers.get()

  return { context: answers.context, focus: answers.focus, name: answers.name }
}

/** Wireframe placeholder modules, deterministic from the focus picks — shown
 *  in the sketch stage before generation lands. Deliberately unfinished
 *  ("…"): the sketch must read as in-progress, not as the product. */
export function sketchBlocks(focus: string[]): FirstScreenBlock[] {
  const picks = focus.filter(Boolean).slice(0, 3)
  const names = picks.length > 0 ? picks : ['your day']

  const blocks = names.map((pick, i) => ({
    id: `sketch-${i}`,
    kind: (['feed', 'action', 'draft'] as const)[i % 3],
    label: `${pick} …`,
    prompt: '',
    stepLine: ''
  }))

  return [...blocks, { id: 'sketch-more', kind: 'tool', label: '…', prompt: '', stepLine: '' }]
}

async function writeScreenJson(config: FirstScreenConfig): Promise<boolean> {
  return writeScreenText(firstScreenFileContent({ ...config, path: await screenJsonPath() ?? undefined }))
}

async function screenJsonPath(): Promise<null | string> {
  const desktop = window.hermesDesktop

  if (!desktop?.desktopPluginsRoot) {
    return null
  }

  try {
    const root = await desktop.desktopPluginsRoot()

    return `${root}/${FIRST_SCREEN_PLUGIN_DIR}/screen.json`
  } catch {
    return null
  }
}

async function writeScreenText(text: string): Promise<boolean> {
  const desktop = window.hermesDesktop

  if (!desktop?.desktopPluginsRoot || !desktop.writeTextFile) {
    return false
  }

  try {
    const filePath = await screenJsonPath()

    if (!filePath) {
      return false
    }

    await desktop.writeTextFile(filePath, text)

    return true
  } catch {
    return false
  }
}

function sketchConfig(): FirstScreenConfig {
  const profile = currentProfile()
  const name = profile.name.trim()

  return {
    blocks: sketchBlocks(profile.focus),
    kind: 'dashboard',
    rationale: 'Taking shape as you talk…',
    stage: 'sketch',
    title: name ? `${titleCaseName(name)}'s Dashboard` : 'Your Dashboard',
    userName: name || 'you'
  }
}

/** Open the living screen as a sketch beside the chat. Called when the focus
 *  answer lands — the earliest moment there is anything personal to show.
 *  Materializes the plugin (sketch-stage screen.json), waits for the disk
 *  loader to register the pane, then grows the window and docks it. Safe to
 *  call more than once. */
export function openSketchPane(): void {
  if ($livePaneOpen.get()) {
    return
  }

  $livePaneOpen.set(true)

  void (async () => {
    const result = await materializeFirstScreen(sketchConfig())

    if (!result.ok) {
      // No bridge / write failure: the flow continues exactly as the old
      // build-at-the-end flow did. The first-screen card still works.
      $livePaneOpen.set(false)

      return
    }

    const [{ registry }, { dockPaneBeside, revealTreePane }, loader] = await Promise.all([
      import('@/contrib/registry'),
      import('@/components/pane-shell/tree/store'),
      import('@/contrib/runtime-loader')
    ])

    // Don't wait for the disk watcher's scan tick (up to ~5s): rescan NOW so
    // the sketch pane appears the moment the guide mentions it.
    await loader.discoverRuntimePlugins().catch(() => undefined)

    const deadline = Date.now() + 15_000

    while (Date.now() < deadline) {
      if (registry.getArea('panes').some(c => c.id === 'first-screen:pane')) {
        window.hermesDesktop?.chatOnboarding?.grow({ bottom: 0, left: 0, right: 400, top: 0 })
        dockPaneBeside('first-screen:pane', 'workspace')
        revealTreePane('first-screen:pane')

        return
      }

      await new Promise(resolve => setTimeout(resolve, 500))
    }
  })()
}

/** Re-dock the living pane after a layout preset replaced the tree (the
 *  assembly dismisses panes the preset doesn't declare). No-op when the pane
 *  isn't open or is already in the tree. */
export function redockLivePane(): void {
  if (!$livePaneOpen.get()) {
    return
  }
  void (async () => {
    const [{ registry }, { dockPaneBeside, revealTreePane }] = await Promise.all([
      import('@/contrib/registry'),
      import('@/components/pane-shell/tree/store')
    ])

    if (!registry.getArea('panes').some(c => c.id === 'first-screen:pane')) {
      return
    }

    window.hermesDesktop?.chatOnboarding?.grow({ bottom: 0, left: 0, right: 400, top: 0 })
    dockPaneBeside('first-screen:pane', 'workspace')
    revealTreePane('first-screen:pane')
  })()
}

/** Advance the sketch after an answer step: rewrite screen.json from the
 *  freshest answers (name may have landed after the sketch opened; context
 *  retitles the rationale line). Cheap, idempotent, fail-open. */
export function advanceSketch(): void {
  if (!$livePaneOpen.get()) {
    return
  }

  const candidates = $moduleCandidates.get()

  if (candidates && candidates.length > 0) {
    // The speculative writer owns the file once a fill exists; either way the
    // proposals rewrite carries the live keep/drop state so unchecking a box
    // grays the module out in the pane immediately.
    const fill = $speculativeFill.get()

    if (!speculativeWritesStopped) {
      void writeScreenText(speculativeFileContent(candidates, fill ?? { content: {}, extra: [], overrides: {} }))
    }

    return
  }

  void writeScreenJson(sketchConfig())
}

// ── Module generation (the personalization engine) ──────────────────────────

function proposalsConfig(candidates: DraftModule[]): FirstScreenConfig {
  const profile = currentProfile()
  const name = profile.name.trim()
  const context = (profile.context ?? '').trim()

  return {
    blocks: candidates.map(module => ({
      id: module.id,
      kind: module.kind,
      label: module.label,
      prompt: module.prompt,
      stepLine: ''
    })),
    kind: 'dashboard',
    rationale: context ? `Sketched around: ${context}` : 'Sketched from what you told me',
    stage: 'proposals',
    title: name ? `${titleCaseName(name)}'s Dashboard` : 'Your Dashboard',
    userName: name || 'you'
  }
}

const GEN_TIMEOUT_MS = 90_000
const CREATE_TIMEOUT_MS = 20_000
const MAX_LABEL = 40
const MAX_PROMPT = 400
const VALID_KINDS = new Set(['action', 'draft', 'feed', 'tool'])

const clamp = (value: string, max: number) => {
  const text = value.trim()

  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** One-turn generation brief: 5-6 module candidates from the user's answers.
 *  Exported for tests. */
export function buildModulePrompt(profile: { context?: string; focus: string[]; name: string }): string {
  const tier = inferScreenTier(profile)

  const shape =
    tier === 'simple'
      ? 'Return EXACTLY 3 modules — this user is new to agentic tools, so keep it calm: everyday labels (no jargon), one obvious purpose per card, at most 2 kinds among them.'
      : tier === 'power'
        ? 'Return 5 or 6 modules, at least 3 kinds among them — this user works in technical tools; specific, dense modules are welcome.'
        : 'Return 4 modules, at least 3 kinds among them.'

  return [
    `Design starter-screen modules for ${profile.name.trim() || 'a new user'} inside Hermes Desktop.`,
    `They said they want help with: ${profile.focus.filter(Boolean).join(', ') || 'their day'}.`,
    (profile.context ?? '').trim()
      ? `They are working on RIGHT NOW: ${(profile.context ?? '').trim()}. At least ${tier === 'simple' ? 'two' : 'three'} modules must be specifically about THIS — name it in the label.`
      : 'They gave no current project — keep modules concrete to their focus areas.',
    'Each module is one card on their personal screen backed by one reusable agent prompt.',
    'Kinds: "feed" (fresh items with sources, e.g. news/updates watch), "action" (a checklist/next-steps generator), "draft" (writes something in their voice, fill-in-template), "tool" (paste input → one shaped output).',
    `${shape} Each: {"id": short-slug, "kind": one of feed|action|draft|tool, "label": <=5 words, imperative or possessive, plain (no title case, no exclamation), "prompt": <=350 chars, first person AS THE USER ("my", "I"), self-contained, concrete}.`,
    'Labels must read like THEIR screen, not generic software ("PR review queue", not "Productivity assistant"). Never praise. No emoji.',
    VOICE_RULES,
    'Reply with ONLY a JSON object, no prose, no fences: {"modules": [...]}.'
  ].join('\n')
}

/** Tolerant parse: fences stripped, per-module validation, length clamps,
 *  id dedupe/slugging. Returns [] on any structural miss. Exported for tests. */
export function parseModuleReply(text: string): DraftModule[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')

  if (start < 0 || end <= start) {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }

  const raw =
    parsed && typeof parsed === 'object' && 'modules' in parsed && Array.isArray((parsed as { modules: unknown }).modules)
      ? ((parsed as { modules: unknown[] }).modules as unknown[])
      : null

  if (!raw) {
    return []
  }

  const seen = new Set<string>()
  const modules: DraftModule[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const v = entry as Record<string, unknown>
    const kind = typeof v['kind'] === 'string' ? v['kind'].trim() : ''
    const label = typeof v['label'] === 'string' ? clamp(v['label'], MAX_LABEL) : ''
    const prompt = typeof v['prompt'] === 'string' ? clamp(v['prompt'], MAX_PROMPT) : ''

    if (!VALID_KINDS.has(kind) || !label || !prompt) {
      continue
    }

    let id = (typeof v['id'] === 'string' ? v['id'] : label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32)

    if (!id) {
      id = `module-${modules.length}`
    }

    while (seen.has(id)) {
      id = `${id.slice(0, 28)}-${modules.length}`
    }

    seen.add(id)
    modules.push({ id, kind: kind as DraftModule['kind'], label, prompt })

    if (modules.length === 7) {
      break
    }
  }

  return modules.length >= 3 ? modules : []
}

/** Generate module candidates from the answers so far. Fired when the context
 *  answer lands (the moment the screen has something real to build around).
 *  On success: candidates land in $moduleCandidates AND the pane advances to
 *  the proposals stage. On any failure: candidates stay null and the flow
 *  falls back to the deterministic templates — invisible to the user.
 *
 *  Gated on the pane, like advanceSketch: this spends a hidden session and a
 *  model turn, and the setup-bot flow answers the same context question
 *  without ever opening a screen for the modules to land in. */
export function generateModuleCandidates(): void {
  if (generationInFlight || $moduleCandidates.get() || !$livePaneOpen.get()) {
    return
  }

  const gateway = activeGateway()

  if (!gateway) {
    return
  }

  generationInFlight = true

  void (async () => {
    let sessionId = ''

    try {
      const created = await gateway
        .request<{ session_id?: string }>(
          'session.create',
          { cols: 96, hidden: true, model: 'deepseek/deepseek-v4-flash-0731', provider: 'nous', source: 'desktop' },
          CREATE_TIMEOUT_MS
        )
        .catch(() =>
          gateway.request<{ session_id?: string }>('session.create', { cols: 96, hidden: true, source: 'desktop' }, CREATE_TIMEOUT_MS)
        )

      sessionId = created?.session_id ?? ''

      if (!sessionId) {
        return
      }

      void gateway.request('session.title', { session_id: sessionId, title: 'Screen design' }).catch(() => undefined)
      // Thinking OFF for this one JSON turn — reasoning buys nothing on a
      // structured fill and multiplies latency (the exact slow-populate
      // complaint from live runs).
      await gateway
        .request('config.set', { key: 'reasoning', session_id: sessionId, value: 'none' })
        .catch(() => undefined)

      const modules = await new Promise<DraftModule[]>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          off()
          reject(new Error('module generation timeout'))
        }, GEN_TIMEOUT_MS)

        const off = gateway.onEvent(event => {
          if (event.type !== 'message.complete' || event.session_id !== sessionId) {
            return
          }

          const payload = (event.payload ?? {}) as { status?: string; text?: string }

          if (payload.status === 'error') {
            window.clearTimeout(timer)
            off()
            reject(new Error('module generation turn failed'))

            return
          }

          // Parse-gated: an interim (tool-turn) segment that doesn't carry
          // the JSON keeps the listener alive instead of resolving empty.
          const parsed = parseModuleReply(payload.text ?? '')

          if (parsed.length > 0) {
            window.clearTimeout(timer)
            off()
            resolve(parsed)
          }
        })

        void gateway
          .request('prompt.submit', { session_id: sessionId, text: buildModulePrompt(currentProfile()) })
          .catch(error => {
            window.clearTimeout(timer)
            off()
            reject(error instanceof Error ? error : new Error(String(error)))
          })
      })

      if (modules.length === 0) {
        return
      }

      $moduleCandidates.set(modules)

      // The pane the user is looking at gains their modules, mid-conversation.
      if ($livePaneOpen.get()) {
        void writeScreenJson(proposalsConfig(modules))
      }

      // The selectors (connectors/color/layout) are dead time for the
      // builder — start writing every candidate's content NOW. Partials
      // stream into screen.json as they land, so the user watches modules
      // fill in while they pick a color. Build later reuses this fill and
      // only writes gaps.
      startSpeculativeFill(modules)
    } catch {
      // Fail open: templates remain the build path.
    } finally {
      generationInFlight = false

      if (sessionId) {
        void gateway.request('session.close', { session_id: sessionId }).catch(() => undefined)
      }
    }
  })()
}

/** The modules the user kept, in candidate order. null when generation never
 *  produced candidates (template fallback). */
export function keptModules(): DraftModule[] | null {
  const candidates = $moduleCandidates.get()

  if (!candidates || candidates.length === 0) {
    return null
  }

  const dropped = new Set($droppedModuleIds.get())
  const kept = candidates.filter(module => !dropped.has(module.id))

  return kept.length > 0 ? kept : null
}

/** Serialize a proposals-stage config WITH whatever content the speculative
 *  fill has produced so far — the pane shows real content materializing
 *  under the modules while the user is still on the selector steps. */
function speculativeFileContent(modules: DraftModule[], fill: PopulateResult): string {
  const config = proposalsConfig(modules)

  const body = JSON.parse(firstScreenFileContent(config)) as { blocks: Record<string, unknown>[] } & Record<
    string,
    unknown
  >

  const dropped = new Set($droppedModuleIds.get())

  body['blocks'] = config.blocks.map(({ id, kind, label, prompt }) => ({
    id,
    kind: fill.content[id] ? fill.content[id].kind : kind,
    label: fill.overrides[id]?.label ?? label,
    prompt: fill.overrides[id]?.prompt ?? prompt,
    ...(fill.content[id] ? { content: fill.content[id] } : {}),
    ...(dropped.has(id) ? { dropped: true } : {})
  }))
  // Still mid-fill while the user picks — the pane keeps spinners on the
  // blocks that have no content yet.
  body['populating'] = true

  return `${JSON.stringify(body, null, 2)}\n`
}

/** Start writing content for EVERY candidate while the user walks the
 *  selector steps. Partials stream into screen.json (proposals stage) as
 *  each pass lands; the result parks in $speculativeFill for Build to carry
 *  into the final file. Idempotent; fail-open. */
export function startSpeculativeFill(modules: DraftModule[]): void {
  if (speculativeInFlight || $speculativeFill.get()) {
    return
  }

  speculativeInFlight = true

  const config = proposalsConfig(modules)

  void fillScreenContent(config, {
    onPartial: partial => {
      $speculativeFill.set(partial)

      if ($livePaneOpen.get() && !speculativeWritesStopped) {
        void writeScreenText(speculativeFileContent(modules, partial))
      }
    }
  })
    .then(result => {
      if (result) {
        $speculativeFill.set(result)

        if ($livePaneOpen.get() && !speculativeWritesStopped) {
          void writeScreenText(speculativeFileContent(modules, result))
        }
      }
    })
    .finally(() => {
      speculativeInFlight = false
    })
}

/** Build takes over screen.json — no speculative write may land after this. */
export function stopSpeculativeWrites(): void {
  speculativeWritesStopped = true
}

/** Build the final config from the current answers + kept modules. */
export function compileLiveScreen(kind: FirstScreenKind): FirstScreenConfig {
  return { ...compileFirstScreen(currentProfile(), kind, keptModules() ?? undefined), stage: 'final' }
}