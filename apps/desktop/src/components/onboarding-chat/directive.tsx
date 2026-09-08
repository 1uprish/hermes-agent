/**
 * In-chat onboarding cards — the `::onboarding{step="…"}` transcript
 * directive. The conversational twin of the wizard window: Hermes walks the
 * user through setup in the transcript, and each step's paragraph renders as
 * an interactive picker (same option catalog, same persistence).
 *
 * Everything applies LIVE on click — accent retints the app, the layout
 * preset rearranges the panes behind the chat — that's the trick. "Continue"
 * reports the pick as a hidden composer submit (no user bubble) so the model
 * carries on to the next step.
 *
 * The model never enumerates options in prose; it only places the card. The
 * renderer owns the catalog (options.tsx), so chat and wizard can't drift.
 */

import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useEffect, useState } from 'react'

import { requestComposerSubmit } from '@/app/chat/composer/focus'
import { $chatLayoutPicked, assembleChatOnboarding } from '@/components/onboarding-chat/assembly'
import { rememberOnboardingSubmit } from '@/components/onboarding-chat/retry'
import {
  $setupHandoff,
  defaultHandoffSurface,
  type HandoffSurface,
  hasCompletedSetupHandoff,
  parseHandoffPlan,
  parseHandoffSurface,
  requestSetupHandoff,
  taskBotTitle
} from '@/components/onboarding-chat/setup-bot'
import {
  accentsFor,
  AccentSwatch,
  CONNECTORS,
  FOCUS_OPTIONS,
  LayoutPreviewCard,
  LAYOUTS,
  NOUS_ACCENT
} from '@/components/onboarding-wizard/options'
import type { LayoutNode } from '@/components/pane-shell/tree/model'
import { Button } from '@/components/ui/button'
import { ConnectorLogo } from '@/components/ui/connector-logo'
import { Chip } from '@/components/wizard-shell'
import { registry } from '@/contrib/registry'
import { cn } from '@/lib/utils'
import {
  $droppedModuleIds,
  $livePaneOpen,
  $moduleCandidates,
  $speculativeFill,
  advanceSketch,
  compileLiveScreen,
  generateModuleCandidates,
  openSketchPane,
  redockLivePane,
  stopSpeculativeWrites
} from '@/store/first-screen-live'
import {
  compileFirstScreen,
  materializeFirstScreen
} from '@/store/onboarding-first-screen'
import { $wizardAnswers, setWizardAnswers } from '@/store/onboarding-wizard'
import { useTheme } from '@/themes'
import { setAccentOverride } from '@/themes/accent-override'

type ChatStep =
  | 'connectors'
  | 'context'
  | 'first'
  | 'first-screen'
  | 'focus'
  | 'handoff'
  | 'layout'
  | 'look'
  | 'name'
  | 'progress'
  | 'ready'
  | 'working'

function isChatStep(value: string | undefined): value is ChatStep {
  return (
    value === 'focus' ||
    value === 'connectors' ||
    value === 'context' ||
    value === 'look' ||
    value === 'layout' ||
    value === 'first' ||
    value === 'first-screen' ||
    value === 'handoff' ||
    value === 'name' ||
    value === 'progress' ||
    value === 'ready' ||
    value === 'working'
  )
}

/** Report a pick and let the model move on — hidden, so no user bubble.
 *  Remembered for the quiet single retry (see retry.ts): if the turn dies
 *  before delivering anything, the report replays once instead of a red
 *  HTTP row interrupting the setup. */
function report(summary: string): boolean {
  const text = `[setup] ${summary}`
  const sent = requestComposerSubmit(text, { displayKind: 'hidden' })

  if (sent) {
    rememberOnboardingSubmit(text)
  }

  return sent
}

type CardProps = {
  /** True while the surrounding turn is still streaming — same card, no clicks. */
  locked?: boolean
}

/** No chrome — the picker sits directly in the transcript like any other
 *  message content. The interaction IS the affordance; a border would make it
 *  read as a form. */
function CardFrame({
  children,
  disabled = false,
  done,
  locked = false,
  onContinue
}: {
  children: React.ReactNode
  disabled?: boolean
  done: boolean
  locked?: boolean
  onContinue: () => void
}) {
  return (
    <div
      className={cn(
        'my-3 grid w-full min-w-0 max-w-md gap-4 duration-300 animate-in fade-in-0 slide-in-from-bottom-2',
        done && 'opacity-75 transition-opacity duration-500'
      )}
      data-onboarding-card
      inert={locked || undefined}
    >
      {children}
      <div className="flex justify-start">
        <Button
          className={cn(done && 'scale-95 transition-transform duration-200')}
          disabled={done || disabled || locked}
          onClick={onContinue}
          size="sm"
        >
          {done ? '✓ Done' : 'Continue'}
        </Button>
      </div>
    </div>
  )
}

function FocusCard({ locked = false }: CardProps) {
  const answers = useStore($wizardAnswers)
  const [done, setDone] = useState(false)

  return (
    <CardFrame
      done={done}
      locked={locked}
      onContinue={() => {
        if (
          report(
            `they want help with: ${answers.focus.length > 0 ? answers.focus.join(', ') : 'no picks — keep it open'}`
          )
        ) {
          setDone(true)
          // The living screen opens HERE — the earliest personal moment.
          // A wireframe sketch docks beside the chat and every answer from
          // now on repaints it (see first-screen-live.ts).
          openSketchPane()
        }
      }}
    >
      <div className="flex flex-wrap gap-2">
        {FOCUS_OPTIONS.map(option => (
          <Chip
            key={option}
            label={option}
            on={answers.focus.includes(option)}
            onToggle={() =>
              setWizardAnswers({
                focus: answers.focus.includes(option)
                  ? answers.focus.filter(item => item !== option)
                  : [...answers.focus, option]
              })
            }
            variant="pill"
          />
        ))}
      </div>
    </CardFrame>
  )
}

function ConnectorsCard({ locked = false }: CardProps) {
  const answers = useStore($wizardAnswers)
  const [done, setDone] = useState(false)

  const toggle = (id: string) =>
    setWizardAnswers({
      connectors: answers.connectors.includes(id)
        ? answers.connectors.filter(item => item !== id)
        : [...answers.connectors, id]
    })

  return (
    <CardFrame
      done={done}
      locked={locked}
      onContinue={() => {
        const picked = CONNECTORS.filter(connector => answers.connectors.includes(connector.id))

        if (report(`connect later: ${picked.length > 0 ? picked.map(c => c.name).join(', ') : 'none for now'}`)) {
          setDone(true)
        }
      }}
    >
      <div className="grid grid-cols-3 gap-2">
        {CONNECTORS.map(connector => (
          <Chip
            icon={
              <ConnectorLogo
                className="size-7 rounded-full text-sm"
                connector={{ homepage: connector.homepage, name: connector.id, title: connector.name }}
              />
            }
            key={connector.id}
            label={connector.name}
            on={answers.connectors.includes(connector.id)}
            onToggle={() => toggle(connector.id)}
          />
        ))}
      </div>
    </CardFrame>
  )
}

function LookCard({ locked = false }: CardProps) {
  const answers = useStore($wizardAnswers)
  const { renderedMode } = useTheme()
  const [done, setDone] = useState(false)
  const accents = accentsFor(renderedMode === 'dark')
  const accent = answers.accent ?? NOUS_ACCENT
  const picked = accents.find(swatch => swatch.hex === accent.toLowerCase())

  const pickAccent = (hex: string) => {
    const seed = hex === NOUS_ACCENT ? null : hex

    setWizardAnswers({ accent: seed })
    setAccentOverride(seed)
  }

  return (
    <CardFrame
      done={done}
      locked={locked}
      onContinue={() => {
        if (report(`accent color: ${picked?.name ?? accent}`)) {
          setDone(true)
        }
      }}
    >
      <div className="flex flex-wrap gap-2.5">
        {accents.map(swatch => (
          <AccentSwatch
            active={accent.toLowerCase() === swatch.hex}
            hex={swatch.hex}
            key={swatch.name}
            name={swatch.name}
            onPick={() => pickAccent(swatch.hex)}
          />
        ))}
      </div>
    </CardFrame>
  )
}

function LayoutCard({ locked = false }: CardProps) {
  const answers = useStore($wizardAnswers)
  const [done, setDone] = useState(false)

  // The stored answer defaults to 'basic', but the CHOICE is the point of this
  // step — nothing renders selected (and Continue stays off) until they click.
  // Store-backed: the pick's own layout apply remounts this card (the pane
  // tree is replaced), so local state would drop the highlight instantly.
  const picked = useStore($chatLayoutPicked)

  const pickLayout = (id: string) => {
    $chatLayoutPicked.set(true)
    setWizardAnswers({ layout: id })

    // Live, behind the chat — the panes rearrange as the option is clicked.
    const preset = registry.getArea('layouts').find(contribution => contribution.id === id)

    if (!preset?.data) {
      return
    }

    // Every pick goes through assembly, including re-picks. The first grows
    // the window and legos the panes in, keeping the chat (and the cursor over
    // this card) pixel-fixed; later ones re-arrange in place. Swapping just the
    // preset tree on a re-pick left the previous layout's dismissals and dock
    // records in force, and the two layouts came up mixed together.
    assembleChatOnboarding(preset.id, preset.data as LayoutNode)

    // Assembly dismisses panes the preset doesn't declare — the living
    // screen must survive the rearrangement and stay beside the chat.
    redockLivePane()
  }

  return (
    <CardFrame
      disabled={!picked}
      done={done}
      locked={locked}
      onContinue={() => {
        const choice = LAYOUTS.find(layout => layout.id === answers.layout)

        if (report(`layout: ${choice?.name ?? answers.layout}`)) {
          setDone(true)
        }
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        {LAYOUTS.map(layout => (
          <LayoutPreviewCard
            active={picked && answers.layout === layout.id}
            key={layout.id}
            name={layout.name}
            onSelect={() => pickLayout(layout.id)}
            tree={layout.tree}
          />
        ))}
      </div>
    </CardFrame>
  )
}

/**
 * The "first build" card — the close of the get-to-know-you beat. The model
 * asks a thoughtful question about what the user wants to BUILD first, then
 * places this card with the options IT generated from the whole conversation:
 * `::onboarding{step="first" options="A Discord bot|A habit tracker|…"}`.
 *
 * The options are untrusted model output riding the directive attrs — the
 * card validates (count, length), renders them as tappable chips, and a tap
 * sends the pick back as the user's next turn (visible — it IS their answer),
 * so the model continues from a real reply, not a hidden [setup] note.
 */
function FirstBuildCard({ attrs, locked = false }: CardProps & { attrs: Record<string, string> }) {
  const [picked, setPicked] = useState<null | string>(null)

  // Parse + validate the model's options: 2-4 of them, each short enough to
  // sit on a chip, deduped case-insensitively (models repeat themselves).
  const seen = new Set<string>()

  const options = (attrs.options ?? '')
    .split('|')
    .map(option => option.trim().replace(/\s+/g, ' '))
    .filter(option => {
      const key = option.toLowerCase()

      if (option.length === 0 || option.length > 60 || seen.has(key)) {
        return false
      }

      seen.add(key)

      return true
    })
    .slice(0, 4)

  const pick = (option: string) => {
    if (picked || locked) {
      return
    }

    // The pick is the user's reply — a REAL visible turn, so the model's next
    // message answers it like anything they typed.
    if (requestComposerSubmit(option)) {
      setPicked(option)
    }
  }

  // Garbage in (0-1 usable options) must not strand the user: the model's
  // prose says "pick one below", so silent null leaves them staring at
  // nothing. Degrade to the one option we can always offer.
  if (options.length < 2) {
    return (
      <div className="my-3 grid max-w-md gap-4" data-onboarding-card inert={locked || undefined}>
        <div className="flex flex-wrap gap-2">
          <Chip
            label="Let's figure it out together"
            on={picked !== null}
            onToggle={() => pick("Let's figure it out together")}
            variant="pill"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="my-3 grid max-w-md gap-4" data-onboarding-card inert={locked || undefined}>
      <div className="flex flex-wrap gap-2">
        {options.map(option => (
          <Chip
            key={option}
            label={option}
            on={picked === option}
            onToggle={() => pick(option)}
            variant="pill"
          />
        ))}
      </div>
    </div>
  )
}

const HANDOFF_SURFACE_LABELS: Record<HandoffSurface, string> = {
  bot: 'Give it its own agent',
  session: 'Open it as a session'
}

/**
 * The handoff card — where the first build leaves this chat. Setup emits
 * `::onboarding{step="handoff" task="…" brief="…" surface="…"}` once the task
 * is decided, and the card asks the one question the conversation can't
 * answer for the user: should this be a standing agent or a plain session?
 * Setup's `surface` is the proposal (from everything they've said) and leads;
 * the other option sits beside it. The pick raises the handoff beacon and the
 * wiring effect does the real work — mint or not, seed, move the user there.
 * After that the card just narrates: spinning up → built. Both latches (atom
 * + storage) make re-parses, re-mounts, and relaunches inert.
 */
function HandoffCard({ attrs, locked = false }: CardProps & { attrs: Record<string, string> }) {
  const task = (attrs.task ?? '').trim().slice(0, 60)
  const brief = (attrs.brief ?? '').trim().slice(0, 240)
  const answers = useStore($wizardAnswers)
  const state = useStore($setupHandoff)

  if (!task || !brief) {
    return null
  }

  const settled = state?.phase === 'done' || (state === null && hasCompletedSetupHandoff())
  const failed = state?.phase === 'error'
  const title = state?.botTitle ?? taskBotTitle(task)

  // Unanswered: the user hasn't chosen yet and nothing has run. A locked
  // (replayed) transcript never re-asks — it falls through to the narration.
  if (!state && !settled && !locked) {
    // Setup's proposal leads; when it omits the attr the layout pick — the
    // same rule Setup was given — answers instead.
    const suggested = parseHandoffSurface(attrs.surface) ?? defaultHandoffSurface(answers.layout)
    const order: HandoffSurface[] = suggested === 'session' ? ['session', 'bot'] : ['bot', 'session']
    const plan = parseHandoffPlan(attrs.plan)

    return (
      <div className="my-3 grid max-w-md gap-2" data-onboarding-card>
        <span className="text-sm text-(--ui-text-secondary)">How should we run it?</span>
        <div className="flex flex-wrap gap-2">
          {order.map(surface => (
            <Chip
              key={surface}
              label={HANDOFF_SURFACE_LABELS[surface]}
              on={false}
              onToggle={() => void requestSetupHandoff(task, brief, surface, plan)}
              variant="pill"
            />
          ))}
        </div>
      </div>
    )
  }

  const asSession = state?.surface === 'session'

  return (
    <div className="my-3 flex max-w-md items-center gap-2 text-sm" data-onboarding-card>
      <span
        aria-hidden
        className={cn(
          'inline-block size-1.5 shrink-0 rounded-full',
          settled || failed ? 'bg-(--ui-text-quaternary)' : 'animate-pulse bg-(--ui-accent)'
        )}
      />
      <span className="text-(--ui-text-secondary)">
        {failed
          ? 'Couldn\u2019t open it separately — building here instead'
          : settled
            ? asSession
              ? `${title} is on it — find it in your sessions`
              : `${title} is on it — find it in your agents`
            : `Spinning up ${title}\u2026`}
      </span>
    </div>
  )
}

/**
 * The progress card — the build's live status, inline in the transcript. The
 * model re-emits `::onboarding{step="progress" title="…"}` as it works; each
 * emission appends a step row to a session-wide list (module-scope, keyed by
 * nothing — the onboarding thread is the only consumer), the newest row
 * pulsing while the turn streams. Read-only: the user watches the build
 * breathe; permissions prompts ride the session concurrently.
 *
 * No fake percentages — the model can't know N-of-M mid-build, so the card
 * is an honest growing step list, not a bar that lies.
 */
const progressSteps: string[] = []

function ProgressCard({ attrs, locked = false }: CardProps & { attrs: Record<string, string> }) {
  const title = (attrs.title ?? '').trim() || 'Working on it'

  // Append on first sight of a new title (re-emits of the same step are the
  // model re-rendering mid-stream, not a new step).
  const [index] = useState(() => {
    if (progressSteps[progressSteps.length - 1] !== title) {
      progressSteps.push(title)
    }

    return progressSteps.length - 1
  })

  return (
    <div className="my-3 grid max-w-md gap-1.5" data-onboarding-card>
      {progressSteps.slice(0, index + 1).map((step, i) => {
        const current = i === index

        return (
          <div className="flex items-center gap-2 text-sm" key={`${i}-${step}`}>
            <span
              aria-hidden
              className={cn(
                'inline-block size-1.5 shrink-0 rounded-full',
                current ? 'bg-(--ui-accent)' : 'bg-(--ui-text-quaternary)',
                current && !locked && 'animate-pulse'
              )}
            />
            <span className={current ? 'text-(--ui-text-secondary)' : 'text-(--ui-text-quaternary)'}>
              {current && !locked ? `${step}…` : step}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Built receipt, shared across every mount of the card: transcript
 *  virtualization remounts directives with fresh local state, which would
 *  resurrect the keep/drop picker after the build. An atom survives that. */
const $firstScreenBuiltConfig = atom<null | ReturnType<typeof compileFirstScreen>>(null)

/** The invisible data steps (name/context) mutate stores — that is an
 *  EFFECT, not a render fact. Doing it inline in the directive's render
 *  triggered React's cross-component setState warning and re-entrant
 *  renders (live desktop.log). */
function DataDirective({ step, value }: { step: 'context' | 'name' | 'working'; value: string }) {
  // 'working' is the setup-bot flow's name for the context answer — same
  // storage, same downstream consumers (task options, any artifact build).
  const field = step === 'working' ? 'context' : step

  useEffect(() => {
    if (!value || $wizardAnswers.get()[field] === value) {
      return
    }

    setWizardAnswers({ [field]: value })

    // The screen evolves with the conversation: a fresh name retitles the
    // sketch; the context answer is the big one — it fires the module
    // generation (their screen, from their words) and the pane advances to
    // proposals the moment candidates land.
    advanceSketch()

    if (field === 'context') {
      generateModuleCandidates()
    }
  }, [field, value])

  return null
}

function FirstScreenCard({ locked = false }: CardProps) {
  const answers = useStore($wizardAnswers)
  const [building, setBuilding] = useState(false)
  const built = useStore($firstScreenBuiltConfig)
  const profile = { context: answers.context, focus: answers.focus, name: answers.name }
  // The generated modules — THEIR screen's parts, from their own words. When
  // generation produced candidates the card is keep/drop rows; when it
  // failed (or hasn't landed) the kind tiles carry the fallback.
  const candidates = useStore($moduleCandidates)
  const dropped = useStore($droppedModuleIds)
  const keptCount = candidates ? candidates.length - dropped.length : 0
  // This card now appears right after the context answer, so generation is
  // usually still in flight for its first seconds: show an honest designing
  // state, and degrade to the template confirm only if generation never
  // lands (grace expires).
  const [waitedOut, setWaitedOut] = useState(false)

  useEffect(() => {
    if (candidates) {
      return
    }

    const grace = window.setTimeout(() => setWaitedOut(true), 45_000)

    return () => window.clearTimeout(grace)
  }, [candidates])

  // Continue = build. The config compiles synchronously, then materializes
  // (screen.json lands on disk) before the model is told — so when the chat
  // says "it's built", the pane IS ALREADY OPEN beside the conversation —
  // the app assembles itself around the user; nobody hunts for a button.
  const build = () => {
    if (building || (candidates !== null && keptCount === 0)) {
      return
    }

    setBuilding(true)
    // Build owns the file from here — the speculative writer stands down,
    // and whatever it already wrote rides into the final file so the kept
    // modules are usually ALREADY filled (the selectors were the fill's
    // working time).
    stopSpeculativeWrites()
    const config = candidates ? compileLiveScreen('dashboard') : compileFirstScreen(profile, 'dashboard')

    void materializeFirstScreen(config).then(result => {
      // Population runs behind the reveal: a hidden fast-lane session fills
      // every block with real content (feed items via live search, skeletons,
      // steps) and rewrites screen.json — the pane's file watcher repaints it
      // as the content lands, seconds after it opens. Fire-and-forget: any
      // failure leaves the deterministic screen exactly as materialized.
      if (result.ok) {
        void import('@/store/first-screen-populate').then(({ populateFirstScreenArtifact }) =>
          populateFirstScreenArtifact(config, $speculativeFill.get())
        )
      }

      if (
        !report(
          `built their dashboard "${config.title}" with ${config.blocks.length} modules${candidates ? ' they hand-picked' : ''}${result.ok ? `, saved to ${result.path}` : ''}. It is open beside this chat and writes itself while you finish the remaining setup steps together — acknowledge briefly and move to the next step.`
        )
      ) {
        setBuilding(false)

        return
      }
      // The living pane is usually ALREADY open (since the focus step). Only
      // a run where the sketch never opened needs the grow+dock; otherwise a
      // reveal is enough — growing again would widen the window twice.
      void (async () => {
        const [{ registry }, { dockPaneBeside, revealTreePane }, loader] = await Promise.all([
          import('@/contrib/registry'),
          import('@/components/pane-shell/tree/store'),
          import('@/contrib/runtime-loader')
        ])

        // Skip the disk watcher's tick — rescan now so the pane docks the
        // moment the build lands.
        await loader.discoverRuntimePlugins().catch(() => undefined)

        const deadline = Date.now() + 15_000

        while (Date.now() < deadline) {
          if (registry.getArea('panes').some(c => c.id === 'first-screen:pane')) {
            if (!$livePaneOpen.get()) {
              window.hermesDesktop?.chatOnboarding?.grow({ bottom: 0, left: 0, right: 380, top: 0 })
            }

            dockPaneBeside('first-screen:pane', 'workspace')
            revealTreePane('first-screen:pane')

            return
          }

          await new Promise(resolve => setTimeout(resolve, 500))
        }
      })()

      $firstScreenBuiltConfig.set(config)
    })
  }

  if (built) {
    // The real artifact is the PANE that just opened beside this chat — the
    // transcript keeps only a quiet one-line receipt. Less in the session,
    // more in the GUI: the app visibly assembled around the user.
    return (
      <div className="my-3 flex items-center gap-1.5 text-muted-foreground text-xs" data-onboarding-card>
        <span aria-hidden>✓</span>
        <span>
          <strong className="font-medium text-foreground">{built.title}</strong> is open beside this chat and sits in
          your sidebar as <strong className="font-medium">Onboarding Dashboard</strong>.
        </span>
      </div>
    )
  }

  if (!candidates && !waitedOut) {
    // Generation in flight — honest designing state with a live spinner.
    // Continue stays away entirely; the card swaps to keep/drop rows the
    // moment candidates land.
    return (
      <div className="my-3 flex items-center gap-2.5 text-[12px] text-muted-foreground" data-onboarding-card>
        <span className="size-3.5 flex-none animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
        Designing your dashboard from what you told me…
      </div>
    )
  }

  if (candidates) {
    // THEIR modules, generated from their own answers mid-conversation:
    // keep/drop rows (the choosing IS the interaction) + arrangement chips.
    return (
      <CardFrame disabled={keptCount === 0} done={built !== null} locked={locked || building} onContinue={build}>
        <div className="flex min-w-0 flex-col gap-1 overflow-hidden">
          {candidates.map(module => {
            const off = dropped.includes(module.id)

            return (
              <button
                aria-pressed={!off}
                className={cn(
                  'flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-[8px] border px-3 py-2 text-left transition-colors',
                  off ? 'border-transparent opacity-45 hover:opacity-70' : 'border-border bg-card hover:border-primary/40'
                )}
                key={module.id}
                onClick={() => {
                  $droppedModuleIds.set(off ? dropped.filter(id => id !== module.id) : [...dropped, module.id])
                  // Mirror the pick into the pane immediately: the dropped
                  // module grays out beside the chat as the box unchecks.
                  advanceSketch()
                }}
                type="button"
              >
                <span
                  className={cn(
                    'grid size-4 flex-none place-items-center rounded-[4px] border text-[10px] leading-none',
                    off ? 'border-muted-foreground/40 text-transparent' : 'border-primary bg-primary text-primary-foreground'
                  )}
                >
                  ✓
                </span>
                <span className="min-w-0">
                  <span className={cn('block truncate text-[13px] font-medium', off && 'line-through')}>
                    {module.label}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">{module.prompt}</span>
                </span>
                <span className="ml-auto flex-none font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  {module.kind}
                </span>
              </button>
            )
          })}
        </div>
      </CardFrame>
    )
  }

  return (
    <CardFrame done={built !== null} locked={locked || building} onContinue={build}>
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <span className="grid size-4 flex-none place-items-center rounded-[4px] border border-primary bg-primary text-[10px] leading-none text-primary-foreground">✓</span>
        Your dashboard is drafted from what you told me. Press Continue and it opens beside this chat.
      </div>
    </CardFrame>
  )
}

const CARDS: Record<Exclude<ChatStep, 'first' | 'handoff' | 'progress' | 'working'>, (props: CardProps) => React.JSX.Element> = {
  connectors: ConnectorsCard,
  // 'context' and 'first-screen' are handled inline in the wrapper below
  // (data effect + card mount); these entries are never reached.
  context: () => <></>,
  'first-screen': () => <></>,
  focus: FocusCard,
  layout: LayoutCard,
  look: LookCard,
  // 'name' renders nothing — it's the model handing the renderer the name it
  // was told, so the artifact compiler personalizes for real (see the
  // OnboardingChatDirective wrapper: the value lands before this lookup).
  name: () => <></>,
  ready: () => <></>
}

/** Cards that need the directive's raw attrs (the model-written payload). */
function CardForStep({ attrs, locked, step }: CardProps & { attrs: Record<string, string>; step: ChatStep }) {
  if (step === 'first') {
    return <FirstBuildCard attrs={attrs} locked={locked} />
  }

  if (step === 'handoff') {
    return <HandoffCard attrs={attrs} locked={locked} />
  }

  if (step === 'progress') {
    return <ProgressCard attrs={attrs} locked={locked} />
  }

  // 'working' is handled by the wrapper (data-only) — it never reaches here,
  // but the union says it could, so keep the lookup total.
  if (step === 'working') {
    return <></>
  }

  const Card = CARDS[step]

  return <Card locked={locked} />
}

export function OnboardingChatDirective({ attrs, streaming }: { attrs: Record<string, string>; streaming: boolean }) {
  const step = attrs.step

  if (!isChatStep(step)) {
    return null
  }

  // Data directives: the model hands the renderer what the user said — the
  // name, and the one-line summary of what they're working on. Stored in an
  // effect (never during render). The CONTEXT directive also mounts the
  // dashboard keep/drop card right there: the card no longer depends on the
  // model remembering to emit a second directive (a live run narrated the
  // card without emitting it — the user was stranded with nothing to do).
  if (step === 'name' || step === 'context' || step === 'working') {
    const value = (attrs.value ?? '').trim()

    return (
      <>
        <DataDirective step={step} value={value} />
        {step === 'context' ? <FirstScreenCard locked={streaming} /> : null}
      </>
    )
  }

  // Legacy/compat: an explicitly emitted first-screen directive renders
  // nothing — the card already lives at the context directive. 'ready' is the
  // model's invisible ack of the pre-banked greeting (kickoff step 1).
  if (step === 'first-screen' || step === 'ready') {
    return null
  }

  // Mount as soon as the directive is parsed — returning null until settle
  // grows the transcript by a card when the turn finishes. Keep it inert
  // mid-stream so the growing paragraph can't be clicked through.
  return <CardForStep attrs={attrs} locked={streaming} step={step} />
}
