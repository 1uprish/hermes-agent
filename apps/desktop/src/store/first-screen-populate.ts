/**
 * First-screen population — the generative pass that turns the deterministic
 * artifact into a PRE-BUILT one: every block ships with real content shaped
 * for its prompt (feed items with sources, a voice skeleton, concrete steps,
 * an input→output example) instead of opening as bare Run buttons.
 *
 * Contract with the rest of onboarding:
 *  - `compileFirstScreen` stays deterministic and offline — it is the
 *    fallback and the theater script. Population is a LAYER on top.
 *  - Population runs in the MAIN renderer over the existing gateway RPC
 *    (hidden agent session → one JSON turn → session.close). No new backend
 *    surface; the agent may use its real tools (web search) for feed items,
 *    so the content is genuine, not confabulated-fresh.
 *  - The result is merged into screen.json next to the prompts. The pane's
 *    file watcher repaints it the moment the write lands — the user sees
 *    their screen fill in a few seconds after it opens. Any failure leaves
 *    the deterministic artifact exactly as it was: blocks without content
 *    render as today's compact rows.
 *  - Idempotent per materialization: callers guard, and a re-run just
 *    rewrites the same file.
 */

import { activeGateway } from '@/store/gateway'

import { FIRST_SCREEN_PLUGIN_DIR, type FirstScreenBlock, type FirstScreenConfig, VOICE_RULES } from './onboarding-first-screen'

// ── Content shapes (mirrored by the plugin renderer in plugin.js) ───────────

export interface FeedContentItem {
  line: string
  source: string
}

export interface ChoiceOption {
  label: string
  prompt: string
}

export type FirstScreenBlockContent =
  | { kind: 'action'; steps: string[] }
  | { kind: 'choice'; options: ChoiceOption[]; question: string }
  | { kind: 'draft'; skeleton: string }
  | { kind: 'feed'; items: FeedContentItem[] }
  | { kind: 'input'; placeholder: string; promptPrefix: string }
  | { kind: 'skill'; learned: string[]; version: number }
  | { kind: 'tool'; example: { input: string; output: string } }

export type FirstScreenContentMap = Record<string, FirstScreenBlockContent>

/** The full authored result: content per block, label/prompt re-aims, and
 *  up to two model-added blocks — the screen's SHAPE is authorable, not just
 *  its filling. */
export interface PopulateResult {
  content: FirstScreenContentMap
  extra: { content?: FirstScreenBlockContent; id: string; kind: string; label: string; prompt: string }[]
  overrides: Record<string, { label?: string; prompt?: string }>
}

// Length clamps — generated copy drifts long and ornate; the pane is narrow.
const MAX_LINE = 110
const MAX_SOURCE = 40
const MAX_SKELETON = 320
const MAX_STEP = 90
const MAX_EXAMPLE = 160
const MAX_LABEL = 48
const MAX_QUESTION = 120
const MAX_OPTION = 40
const MAX_PROMPT = 400
const MAX_EXTRA = 2

const clamp = (value: string, max: number) => {
  const text = value.trim()

  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

// ── JSON contract ────────────────────────────────────────────────────────────

/** One prompt for the whole screen: every block populated in a single turn.
 *  The agent is told which blocks want live lookups (feed) and which are
 *  written from the profile alone, and must answer with ONLY a JSON object. */
export function buildPopulatePrompt(config: FirstScreenConfig, phase: 'fast' | 'feed' = 'fast'): string {
  // Tier from the same signals the module generator used (block count is the
  // strongest proxy after materialization: simple screens have 3 blocks).
  const tier: 'power' | 'simple' | 'standard' = config.blocks.length <= 3 ? 'simple' : config.blocks.length >= 5 ? 'power' : 'standard'

  const wanted = phase === 'feed' ? config.blocks.filter(b => b.kind === 'feed') : config.blocks.filter(b => b.kind !== 'feed')
  const blocks = wanted.map(({ id, kind, label, prompt }) => ({ id, kind, label, prompt }))

  return [
    `Fill in the starter screen you just built for ${config.userName === 'you' ? 'the user' : config.userName} (${config.rationale.toLowerCase()}).`,
    'Each block below carries the prompt it will run later; produce the content a user would expect to ALREADY see on a well-made screen before pressing anything. Everything must be specific to what the user is working on (named in the blocks and rationale). Generic filler defeats the screen.',
    phase === 'fast'
      ? 'Answer IMMEDIATELY from what you know. Do NOT use any tools. No web search. (Feed blocks are being filled separately — ignore any instruction below that mentions web search.)'
      : 'These are live-content blocks: use web search to find genuinely current items. One or two quick searches, then answer.',
    'For "feed" blocks: use web search to find 3 genuinely current items matching the block\'s prompt; each item is {"line": one plain sentence <=100 chars, "source": publication or site name only}. Real items only — if search fails, return fewer or none rather than inventing.',
    'For "draft" blocks: {"skeleton": a fill-in-the-blank template <=300 chars in a plain, direct voice with [bracketed] slots} matching the block\'s prompt.',
    'For "action" blocks: {"steps": [3 concrete steps, each <=80 chars]} the user could take right now, specific to the block\'s prompt.',
    'For "skill" blocks: {"learned": [3-5 short plain sentences, each one concrete thing you know about this user from their answers: who they are, the project, preferences], "version": 1}. This is the playbook Hermes keeps about them; write it in second person ("You are…", "You prefer…").',
    'For "tool" blocks: {"example": {"input": <=150 chars, "output": <=150 chars}} showing one honest before→after for the tool the prompt describes.',
    'You may also RESHAPE the screen: any block\'s entry may include "label" (<=40 chars) and/or "prompt" (a first-person prompt the user would send) to re-aim it at their actual project.',
    `${tier === 'simple' ? 'Do NOT add extra blocks — three calm cards is the point for this user.' : 'And add an "extra" array (up to 2 new blocks) when their project calls for something the starter blocks miss: each is {"id": short-slug, "kind": "action"|"draft"|"feed"|"choice"|"input", "label", "prompt", "content": <per its kind>}.'}`,
    tier === 'simple' ? 'Keep every block its own kind — no re-kinding, at most ONE interactive block total.' : 'Interactive kinds — USE AT LEAST ONE (as an extra or by re-kinding a weak starter block via extra): "choice" content is {"question": <=100 chars, "options": [2-4 of {"label": <=32 chars, "prompt": first-person prompt sent when clicked}]} asking a real fork about their project; "input" content is {"placeholder": <=60 chars, "promptPrefix": text the typed value is appended to} giving them a type-and-go box. Pick the kind by the work itself: a genuine decision → choice; needs material only the user has (a paste, a number, a name) → input; a sequence they will physically do → action (its steps render as a checkable to-do list); reference text → draft. Do not force interactivity onto blocks that are naturally reading material.',
    VOICE_RULES,
    `Blocks: ${JSON.stringify(blocks)}`,
    'Reply with ONLY a JSON object, no prose, no code fences: {"blocks": {"<id>": <content, optionally + label/prompt>, ...}, "extra": [...]}.'
  ].join('\n')
}

/** Strict-ish parse of the model's reply: fences tolerated, shape validated
 *  per block kind, lengths clamped. Returns only the blocks that validated —
 *  a half-good answer populates half the screen rather than nothing. */
/** Validate one block-content payload by kind. Shared by starter-block
 *  content and extra-block content. */
function parseContent(kind: string, v: Record<string, unknown>): FirstScreenBlockContent | null {
  if (kind === 'feed' && Array.isArray(v['items'])) {
    const items = (v['items'] as unknown[])
      .filter(
        (item): item is { line: string; source: string } =>
          !!item &&
          typeof item === 'object' &&
          typeof (item as Record<string, unknown>)['line'] === 'string' &&
          typeof (item as Record<string, unknown>)['source'] === 'string' &&
          ((item as Record<string, unknown>)['line'] as string).trim().length > 0
      )
      .slice(0, 4)
      .map(item => ({ line: clamp(item.line, MAX_LINE), source: clamp(item.source, MAX_SOURCE) }))

    return items.length > 0 ? { items, kind: 'feed' } : null
  }

  if (kind === 'draft' && typeof v['skeleton'] === 'string' && v['skeleton'].trim()) {
    return { kind: 'draft', skeleton: clamp(v['skeleton'], MAX_SKELETON) }
  }

  if (kind === 'action' && Array.isArray(v['steps'])) {
    const steps = (v['steps'] as unknown[])
      .filter((step): step is string => typeof step === 'string' && step.trim().length > 0)
      .slice(0, 4)
      .map(step => clamp(step, MAX_STEP))

    return steps.length > 0 ? { kind: 'action', steps } : null
  }

  if (kind === 'tool' && v['example'] && typeof v['example'] === 'object') {
    const example = v['example'] as Record<string, unknown>

    if (typeof example['input'] === 'string' && typeof example['output'] === 'string' && example['input'].trim()) {
      return {
        example: { input: clamp(example['input'], MAX_EXAMPLE), output: clamp(example['output'], MAX_EXAMPLE) },
        kind: 'tool'
      }
    }

    return null
  }

  if (kind === 'choice' && typeof v['question'] === 'string' && Array.isArray(v['options'])) {
    const options = (v['options'] as unknown[])
      .filter(
        (option): option is { label: string; prompt: string } =>
          !!option &&
          typeof option === 'object' &&
          typeof (option as Record<string, unknown>)['label'] === 'string' &&
          typeof (option as Record<string, unknown>)['prompt'] === 'string' &&
          ((option as Record<string, unknown>)['label'] as string).trim().length > 0 &&
          ((option as Record<string, unknown>)['prompt'] as string).trim().length > 0
      )
      .slice(0, 4)
      .map(option => ({ label: clamp(option.label, MAX_OPTION), prompt: clamp(option.prompt, MAX_PROMPT) }))

    return v['question'].trim() && options.length >= 2
      ? { kind: 'choice', options, question: clamp(v['question'], MAX_QUESTION) }
      : null
  }

  if (kind === 'input' && typeof v['promptPrefix'] === 'string' && v['promptPrefix'].trim()) {
    return {
      kind: 'input',
      placeholder: typeof v['placeholder'] === 'string' ? clamp(v['placeholder'], 60) : '',
      promptPrefix: clamp(v['promptPrefix'], MAX_PROMPT)
    }
  }

  return null
}

const EXTRA_KINDS = new Set(['action', 'choice', 'draft', 'feed', 'input', 'tool'])

/** Full parse: content + label/prompt overrides + extra blocks. Every part
 *  degrades independently — a bad extra never poisons good content. */
export function parsePopulate(text: string, blocks: FirstScreenBlock[]): PopulateResult {
  const empty: PopulateResult = { content: {}, extra: [], overrides: {} }

  // Candidate JSON segments, best first: every ```json fence (models put
  // prose around the fence, and prose with a stray '{' breaks the naive
  // first-brace slice — live failure), then the outermost brace span.
  const candidates: string[] = []
  const fences = text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)

  for (const fence of fences) {
    const body = (fence[1] ?? '').trim()

    if (body.startsWith('{')) {
      candidates.push(body)
    }
  }

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')

  if (start >= 0 && end > start) {
    candidates.push(text.slice(start, end + 1))
  }

  let parsed: unknown = null

  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate)

      break
    } catch {
      // Try the next candidate.
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return empty
  }

  const root = parsed as Record<string, unknown>
  // The contract asks for {"blocks": {"<id>": {...}}} but models regularly
  // mirror screen.json's shape instead — {"blocks": [{"id", "kind",
  // "content": {...}}]}. A live run produced a perfect 17KB fill in exactly
  // that form and the strict reader dropped ALL of it. Accept both.
  const rawBlocks = root['blocks']
  const raw: Record<string, unknown> = {}

  if (Array.isArray(rawBlocks)) {
    for (const entry of rawBlocks) {
      const e = entry as Record<string, unknown>

      if (e && typeof e === 'object' && typeof e['id'] === 'string') {
        raw[e['id']] = e
      }
    }
  } else if (rawBlocks && typeof rawBlocks === 'object') {
    Object.assign(raw, rawBlocks as Record<string, unknown>)
  }

  const result: PopulateResult = { content: {}, extra: [], overrides: {} }

  for (const block of blocks) {
    const value = raw[block.id]

    if (!value || typeof value !== 'object') {
      continue
    }

    const v = value as Record<string, unknown>
    // Content may sit inline on the entry OR nested under "content" (the
    // screen.json shape). A starter block may also be re-KINDED by shipping
    // content of another kind — try its own kind first, then the declared.
    const inner = v['content'] && typeof v['content'] === 'object' ? (v['content'] as Record<string, unknown>) : null
    const declared = typeof v['kind'] === 'string' ? v['kind'] : block.kind
    const innerDeclared = inner && typeof inner['kind'] === 'string' ? (inner['kind'] as string) : declared

    const content =
      parseContent(block.kind, v) ??
      (inner ? parseContent(block.kind, inner) : null) ??
      (declared !== block.kind ? parseContent(declared, v) : null) ??
      (inner && innerDeclared !== block.kind ? parseContent(innerDeclared, inner) : null)

    if (content) {
      result.content[block.id] = content
    }

    const label = typeof v['label'] === 'string' && v['label'].trim() ? clamp(v['label'], MAX_LABEL) : undefined
    const prompt = typeof v['prompt'] === 'string' && v['prompt'].trim() ? clamp(v['prompt'], MAX_PROMPT) : undefined

    if (label || prompt) {
      result.overrides[block.id] = { ...(label ? { label } : {}), ...(prompt ? { prompt } : {}) }
    }
  }

  const extras = Array.isArray(root['extra']) ? (root['extra'] as unknown[]) : []
  const seen = new Set(blocks.map(b => b.id))

  for (const entry of extras) {
    if (result.extra.length >= MAX_EXTRA || !entry || typeof entry !== 'object') {
      continue
    }

    const v = entry as Record<string, unknown>
    const kind = typeof v['kind'] === 'string' ? v['kind'] : ''
    const id = typeof v['id'] === 'string' && v['id'].trim() ? v['id'].trim().slice(0, 24) : ''
    const label = typeof v['label'] === 'string' && v['label'].trim() ? clamp(v['label'], MAX_LABEL) : ''
    const prompt = typeof v['prompt'] === 'string' && v['prompt'].trim() ? clamp(v['prompt'], MAX_PROMPT) : ''

    if (!EXTRA_KINDS.has(kind) || !id || seen.has(id) || !label || !prompt) {
      continue
    }

    const content =
      v['content'] && typeof v['content'] === 'object'
        ? parseContent(kind, v['content'] as Record<string, unknown>)
        : parseContent(kind, v)

    seen.add(id)
    result.extra.push({ id, kind, label, prompt, ...(content ? { content } : {}) })
  }

  return result
}

/** Back-compat content-only view (existing tests + callers). */
export function parsePopulateReply(text: string, blocks: FirstScreenBlock[]): FirstScreenContentMap {
  return parsePopulate(text, blocks).content
}

// ── screen.json rewrite ──────────────────────────────────────────────────────

/** screen.json with the authored result merged in — content per block,
 *  label/prompt re-aims applied, extra blocks appended (their rendered kind
 *  follows their content when present), and a `populatedAt` stamp. Accepts
 *  the full PopulateResult or a bare content map (legacy callers/tests). */
export function populatedFileContent(
  config: FirstScreenConfig,
  result: FirstScreenContentMap | PopulateResult,
  options: { stillPopulating?: boolean } = {}
): string {
  const authored: PopulateResult =
    'content' in result && ('overrides' in result || 'extra' in result)
      ? (result as PopulateResult)
      : { content: result as FirstScreenContentMap, extra: [], overrides: {} }

  const starters = config.blocks.map(({ id, kind, label, prompt }) => {
    const content = authored.content[id]
    const override = authored.overrides[id] ?? {}

    return {
      id,
      // A re-kinded block renders as what its content IS.
      kind: content ? content.kind : kind,
      label: override.label ?? label,
      prompt: override.prompt ?? prompt,
      ...(content ? { content } : {})
    }
  })

  const extras = authored.extra.map(({ content, id, kind, label, prompt }) => ({
    id,
    kind: content ? content.kind : kind,
    label,
    prompt,
    ...(content ? { content } : {})
  }))

  return `${JSON.stringify(
    {
      blocks: [...starters, ...extras],
      generatedAt: new Date().toISOString(),
      generatedFrom: { focus: config.rationale, name: config.userName },
      kind: config.kind,
      ...(config.path ? { path: config.path } : {}),
      populatedAt: new Date().toISOString(),
      ...(options.stillPopulating ? { populating: true } : {}),
      title: config.title
    },
    null,
    2
  )}\n`
}

// ── The population run ───────────────────────────────────────────────────────

const COMPLETE_TIMEOUT_MS = 150_000
const CREATE_TIMEOUT_MS = 20_000
// The no-tools pass must FEEL instant — cap it tight; a miss falls to catch.
const FAST_TIMEOUT_MS = 45_000

/** Fire-and-forget: generate content for every block and rewrite screen.json.
 *  Resolves true when the file was rewritten with at least one populated
 *  block. Never throws — every failure path resolves false and leaves the
 *  deterministic artifact untouched. */
/** The content-fill engine: one hidden fast-lane session, two passes (fast:
 *  no tools, lands in seconds; feed: web search). `onPartial` fires as each
 *  pass lands so callers can paint progressively. Never throws — null means
 *  nothing usable was produced. */
export async function fillScreenContent(
  config: FirstScreenConfig,
  options: { onPartial?: (partial: PopulateResult) => void } = {}
): Promise<null | PopulateResult> {
  const gateway = activeGateway()

  if (!gateway) {
    return null
  }

  let sessionId = ''

  try {
    const created = await gateway
      .request<{ session_id?: string }>(
        'session.create',
        { cols: 96, hidden: true, model: 'deepseek/deepseek-v4-flash-0731', provider: 'nous', source: 'desktop' },
        CREATE_TIMEOUT_MS
      )
      .catch(() =>
        gateway.request<{ session_id?: string }>(
          'session.create',
          { cols: 96, hidden: true, source: 'desktop' },
          CREATE_TIMEOUT_MS
        )
      )

    sessionId = created?.session_id ?? ''

    if (!sessionId) {
      return null
    }

    void gateway
      .request('session.title', { session_id: sessionId, title: 'First screen content' })
      .catch(() => undefined)

    // Thinking OFF: reasoning buys nothing on a structured fill and
    // multiplies latency (the exact slow-populate complaint from live runs).
    await gateway
      .request('config.set', { key: 'reasoning', session_id: sessionId, value: 'none' })
      .catch(() => undefined)

    // Both listeners are parse-gated: tool-using turns emit an interim
    // message.complete per assistant segment and the first is usually prose,
    // not the JSON (live failure: resolved on segment one, dropped the real
    // JSON that landed 40s later).
    const runPass = (phase: 'fast' | 'feed', timeoutMs: number) =>
      new Promise<PopulateResult>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          off()
          reject(new Error('populate timeout'))
        }, timeoutMs)

        const off = gateway.onEvent(event => {
          if (event.type !== 'message.complete' || event.session_id !== sessionId) {
            return
          }

          const payload = (event.payload ?? {}) as { status?: string; text?: string }

          if (payload.status === 'error') {
            window.clearTimeout(timer)
            off()
            reject(new Error('populate turn failed'))

            return
          }

          const parsed = parsePopulate(payload.text ?? '', config.blocks)

          if (Object.keys(parsed.content).length > 0 || parsed.extra.length > 0) {
            window.clearTimeout(timer)
            off()
            resolve(parsed)
          }
          // Unparseable segment: an interim tool-turn message. Keep waiting.
        })

        void gateway
          .request('prompt.submit', { session_id: sessionId, text: buildPopulatePrompt(config, phase) })
          .catch(error => {
            window.clearTimeout(timer)
            off()
            reject(error instanceof Error ? error : new Error(String(error)))
          })
      })

    const hasFast = config.blocks.some(block => block.kind !== 'feed')
    const hasFeed = config.blocks.some(block => block.kind === 'feed')
    const empty: PopulateResult = { content: {}, extra: [], overrides: {} }
    const fast = hasFast ? await runPass('fast', FAST_TIMEOUT_MS) : empty

    if (hasFast) {
      options.onPartial?.(fast)
    }

    if (!hasFeed) {
      return fast
    }

    try {
      const feed = await runPass('feed', COMPLETE_TIMEOUT_MS)

      const merged: PopulateResult = {
        content: { ...fast.content, ...feed.content },
        extra: [...fast.extra, ...feed.extra],
        overrides: { ...fast.overrides, ...feed.overrides }
      }

      options.onPartial?.(merged)

      return merged
    } catch {
      return hasFast ? fast : null
    }
  } catch {
    return null
  } finally {
    if (sessionId) {
      void gateway.request('session.close', { session_id: sessionId }).catch(() => undefined)
    }
  }
}

// ── Write ownership ──────────────────────────────────────────────────────────
// Machine writers (speculative fill, final fill) must never clobber an edit
// made by the AGENT or the USER while a fill turn was in flight (live
// failure: the user deleted cards mid-fill; the fill finished 90s later and
// resurrected them). Every machine write records the exact text it wrote;
// before the next machine write we re-read the file — if it no longer
// matches our last write, another author owns the file and the machine
// stands down.
let lastMachineWrite: null | string = null

export function resetPopulateOwnershipForTests(): void {
  lastMachineWrite = null
}

async function machineWrite(
  desktop: NonNullable<Window['hermesDesktop']>,
  filePath: string,
  text: string,
  options: { force?: boolean } = {}
): Promise<boolean> {
  if (!desktop.writeTextFile) {
    return false
  }

  if (!options.force && lastMachineWrite !== null && typeof desktop.readFileText === 'function') {
    try {
      const current = (await desktop.readFileText(filePath)) as unknown

      const text =
        typeof current === 'string'
          ? current
          : current && typeof current === 'object' && 'text' in current
            ? String((current as { text: unknown }).text)
            : null

      if (text !== null && text !== lastMachineWrite) {
        // Foreign edit since our last write — the file has a new owner.
        return false
      }
    } catch {
      // Unreadable (deleted?) — do not resurrect it.
      return false
    }
  }

  await desktop.writeTextFile(filePath, text)
  lastMachineWrite = text

  return true
}

/** Fire-and-forget FINAL fill: write `precomputed` content (the speculative
 *  fill that ran while the user was picking selectors) immediately, then fill
 *  only the gaps. Resolves true when the file ends populated. Never throws —
 *  every failure path resolves false and leaves the deterministic artifact
 *  untouched. */
export async function populateFirstScreenArtifact(
  config: FirstScreenConfig,
  precomputed: null | PopulateResult = null
): Promise<boolean> {
  const desktop = window.hermesDesktop

  if (!desktop?.desktopPluginsRoot || !desktop.writeTextFile) {
    return false
  }

  try {
    const root = await desktop.desktopPluginsRoot()
    const filePath = `${root}/${FIRST_SCREEN_PLUGIN_DIR}/screen.json`

    // Keep only precomputed content that belongs to blocks that survived the
    // keep/drop pass.
    const ids = new Set(config.blocks.map(block => block.id))

    const carried: PopulateResult = precomputed
      ? {
          content: Object.fromEntries(Object.entries(precomputed.content).filter(([id]) => ids.has(id))),
          extra: [],
          overrides: Object.fromEntries(Object.entries(precomputed.overrides).filter(([id]) => ids.has(id)))
        }
      : { content: {}, extra: [], overrides: {} }

    const missing = config.blocks.filter(block => !carried.content[block.id])

    // Everything the user kept is already written — finalize in one write.
    // Build's first write takes ownership unconditionally (it follows the
    // user's explicit Continue); later writes must still hold the file.
    if (missing.length === 0) {
      await machineWrite(desktop, filePath, populatedFileContent(config, carried), { force: true })

      return true
    }

    await machineWrite(desktop, filePath, populatedFileContent(config, carried, { stillPopulating: true }), {
      force: true
    })

    const gap = await fillScreenContent({ ...config, blocks: missing })

    if (!gap) {
      // Clear the flag so the shimmer can't run forever; carried content
      // stays. Skipped silently if the agent/user edited meanwhile.
      await machineWrite(desktop, filePath, populatedFileContent(config, carried))

      return Object.keys(carried.content).length > 0
    }

    const merged: PopulateResult = {
      content: { ...carried.content, ...gap.content },
      extra: gap.extra,
      overrides: { ...carried.overrides, ...gap.overrides }
    }

    await machineWrite(desktop, filePath, populatedFileContent(config, merged))

    return true
  } catch {
    try {
      if (desktop.desktopPluginsRoot) {
        const root = await desktop.desktopPluginsRoot()

        await machineWrite(
          desktop,
          `${root}/${FIRST_SCREEN_PLUGIN_DIR}/screen.json`,
          populatedFileContent(config, { content: {}, extra: [], overrides: {} })
        )
      }
    } catch {
      // Nothing left to do — the age heuristic expires the shimmer.
    }

    return false
  }
}
