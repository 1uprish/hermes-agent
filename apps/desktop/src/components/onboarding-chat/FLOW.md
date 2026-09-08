# Guided Onboarding — "Setup Bot" Flow

The first-run chain: **cinematic → solo guided chat with the Setup bot → the
user's first task, built live by a bot minted for it.** No wizard window, no
sign-in card, no survey-for-its-own-sake. The user walks out having *done
something* — and with two agents in their roster: the one that built it, and
the guide that stays.

Bot mode's twist on the first-build flow: the guided chat is not an anonymous
session. It is the canonical **Bot Chat of a persistent `hermes-setup`
profile** ("Setup" in the agents roster). Setup runs the same beats as before,
but it does not build the task itself — once the task is decided it hands off
to a **new bot minted around that task, or to a plain session** (the user's
call — see "The surface fork"), and stays alive as training wheels:
it hears how the handoff went, schedules its own check-in crons, and offers
the next step when there is a genuinely useful one.

## Script (the model's runbook)

0. **The banked greeting** — Setup's opening line is pre-written: seeded as a
   real assistant row at `session.create` (the canonical Bot Chat must
   rehydrate with it) AND typed in client-side like a streamed turn
   (`OnboardingGreetingRow`), so the first paint is instant and alive. The
   runbook tells the model it already spoke; its first real turn answers the
   user's name. Setup's guided turns ride the fast lane (DeepSeek flash,
   minimal reasoning) pinned on the `hermes-setup` profile — the user's real
   default model is untouched.
1. **Name** — "What should I call you?" — the reply is saved via the invisible
   `::onboarding{step="name" value="…"}` data directive (it feeds the task
   bot's soul later)
2. **Theme** — `::onboarding{step="look"}` (accent pick, live retint)
3. **Connectors** — `::onboarding{step="connectors"}` (tools they use; stored, not wired)
4. **Layout** — `::onboarding{step="layout"}` (the app assembles around the chat)
5. **The fork** — one sentence, then `::ask{question="Know what you'd like it
   to make?" options="…" input="true"}` — clickable pills, typed answers
   welcome. (`::ask` is the general capability: any fork Setup or the task bot
   needs to pose renders as pills, never a prose wall.)

    The options come from `forkOptions()`, because the machine decides the
    shape (see **The machine fork** below): a lived-in computer gets all five
    at once, a new one gets the machine-setup offer plus "Something else",
    which opens the rest as a second ask.

### Branch A — they have something in mind (general or specific)

6a. If general or not-sure: ask **what they're working on right now** —
    saved with `::onboarding{step="working" value="…"}`, which writes the same
    `context` answer the rest of the flow reads. Then surface **generated
    options** as tappable chips — `::onboarding{step="first" options="…|…|…"}`
    — 2–4 options spanning simple (a reminder) to complex (a dashboard), built
    from that answer plus their tools. If specific: skip both, go straight to
    7a — that user already told us the task, and the options card they'd never
    see is the only thing the question feeds.

    **Every branch is NO-AUTH, not local-only.** The first build must need
    zero external accounts — but the browser, web search, scripts, and
    computer use are all fair game, and the more VISIBLE the better (research
    with the browser shown to the user as it works is the strongest demo).
    Never Gmail/Slack/Google sign-in: connectors get wired later, on the
    user's request. If their idea needs one, shape the task around its
    no-auth core and name the connection as a later step.
7a. **The handoff.** The chip tap (or their message) decides the task. Setup
    replies with ONE short framing sentence and emits
    `::onboarding{step="handoff" task="…" brief="…"}` — it does NOT start the
    work. The renderer mints a profile around the task (soul from the
    conversation, name from the task), seeds its hidden Bot Chat with the
    work-side runbook, moves the user into it, and submits Setup's brief as
    the user's first visible turn. The build starts from that turn.
8a. **Permissions note** (task bot, one short sentence as work begins):
    "I'll ask for permissions as we go — say no to anything."
9a. **Progress artifact** — `::onboarding{step="progress"}` renders a
    live-updating card in the TASK bot's transcript while the build runs.

### Branch B — not sure

6c. Same question as 6a, asked the way a stuck user can answer it: "what do you
    wish you spent less time doing on the computer?" One follow-up to get
    concrete, then the options card.

### Branch C — set up this machine

6d. The machine itself is the job. Setup asks ONE question (what they mainly
    want the machine for) and hands off with `plan="machine-setup"`. It does
    not plan the setup or list what it would install — the agent that takes the
    job audits the box first.

### After the handoff — Setup stays alive

- The renderer whispers a hidden `[setup] handoff complete` note into Setup's
  chat. Setup says one goodbye-for-now line and **schedules itself a check-in
  cron** (cronjob tool) that reviews what the user has actually set up so far
  and offers ONE next step when a useful one exists — wiring a connector they
  named, scheduling something they repeat, a second build.
- The desktop backend ticks every profile's cron store (live-enumerated), so
  those check-ins fire without the app babysitting a per-profile backend.
- If minting the task bot fails, the whisper says so instead and Setup builds
  the task in its own chat — the PR-12 single-chat shape as the fallback, so
  the flow never dead-ends.

## What the user walks away with

- A configured app (theme, layout, connectors noted) — the old wizard's job,
  done conversationally.
- A first task *started or built* — the competence moment.
- **A roster**: the task bot that owns their first build, and Setup — a guide
  they can always come back to, ignore, or retire. Training wheels.
- A mental model of how Hermes works: agents are minted around jobs, they ask,
  they build, they show progress, they check in.

## What deliberately does NOT happen

- **No login wall.** Inference is already configured (or the classic runtime
  check catches the first send). The chain never stops to authenticate.
  (When the sign-in / cloud-vs-local moment lands, it belongs AFTER the task
  has been decided and begun — likely anchored at the handoff — not here.)
- **No survey fatigue.** Every question either configures the app or feeds the
  first build. Nothing is collected "for later."
- **No nagging.** Setup's check-ins are one concrete suggestion or silence;
  "stop checking in" stops them.

## Flow graph

```
                ┌─────────────┐
                │  cinematic  │  (intro reveal — welcome splash)
                └──────┬──────┘
                       ▼
                ┌──────────────────┐
                │  solo chat        │  small window, no sidebar/statusbar —
                │  = Setup's        │  the hidden canonical Bot Chat of the
                │  Bot Chat         │  hermes-setup profile
                │  1. name          │
                └──────┬───────────┘
                       ▼
                (2. theme → 3. connectors → 4. layout — cards as before,
                 app assembles at the layout pick)
                       ▼
                ┌─────────────┐
                │ 5. the fork │  "Do you know what you'd like to build?"
                └──┬───┬───┬──┘
                   │   │   │
        ┌──────────┘   │   └──────────┐
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────┐  ┌──────────────┐
  │ specific │  │ general  │  │  not sure    │
  │ in mind  │  │  idea    │  │ (6c/7d probe)│
  └────┬─────┘  └────┬─────┘  └──────┬───────┘
       │             ▼               │
       │      ┌──────────────┐       │
       │      │ 6a. generated │◀──────┘
       │      │ options card  │  ::onboarding{step="first" options="…"}
       │      └──────┬───────┘
       │             │ tap = the task is decided
       ▼             ▼
       ┌─────────────────────────┐
       │ 7a. HANDOFF              │  ::onboarding{step="handoff" task brief}
       │ mint task bot + its      │  renderer: profiles.create → seeded
       │ hidden Bot Chat          │  session.create → switch → visible brief
       └───────┬─────────────┬───┘
               ▼             ▼
   ┌───────────────────┐   ┌────────────────────────┐
   │ TASK BOT's chat   │   │ SETUP's chat (alive)   │
   │ 8a. permissions   │   │ hidden [setup] note →  │
   │ 9a. progress cards│   │ goodbye-for-now line + │
   │ the build runs    │   │ check-in cron schedule │
   └───────────────────┘   └────────────────────────┘
```

## The cards (transcript directives)

| step | attrs | renders | tap does |
|------|-------|---------|----------|
| `name` | `value="…"` | nothing | saves the name into the wizard answers (soul fuel) |
| `look` | — | accent swatches | retints live, hidden `[setup]` report |
| `connectors` | — | connector chips | stored, hidden `[setup]` report |
| `layout` | — | layout previews | assembles the app live, hidden `[setup]` report |
| `working` | `value="…"` | nothing | saves what they're working on (same `context` field the options card is built from) |
| `first` | `options="A\|B\|C"` | generated chips | **visible user turn** — decides the task |
| `handoff` | `task="…" brief="…" surface="bot\|session" plan="machine-setup"?` | the surface choice, then a one-line status (spinning up → built) | the pick raises the handoff beacon; the wiring mints (or doesn't) + switches |
| `progress` | `title="…"` | live build card (task bot's chat) | read-only; updates as the work streams |

Plus the general-purpose `::ask{question="…" options="A|B|C" input="true"}`
(ask-directive.tsx) — clickable pills for any fork; the pick is the user's
next visible turn.

Hidden `[setup]` reports are remembered (retry.ts): if a machine turn dies
before delivering anything, the report replays once, quietly — no red HTTP
row mid-setup. The skip affordance (skip.tsx) stays available throughout.

Session identity follows the bots contract: the kickoff ADOPTS before it
mints — an exact-title `session.list` lookup for the setup profile's
`Bot Chat` resumes an existing canonical (relaunch mid-onboarding, dev
re-kick) instead of forking a second one whose title stamp would silently
lose to the UNIQUE index and fall to the auto-titler.

The first-run frame: floating panes (user/plugin panels) stay hidden while
solo AND while the active session is any onboarding thread (Setup's chat,
then a bot-surface first build); the composer's git strip is dropped on those
threads too. A layout pick assembles the window around the conversation and
leaves them in it — it does not jump the sidebar to Bots or Sessions.

## The surface fork

Not every first task wants to be a bot. A bot is a **standing relationship** —
its own profile, its own canonical chat, able to check in later; a session is
**a discrete piece of work** in the normal app. Developers overwhelmingly want
the second, and landing them in a roster with no sessions and no project
machinery reads as a downgrade.

So the handoff asks — and it asks from a position, because the user already
told us. **The layout pick decides it: Elite → session, Basic → bot.** Choosing
the terminal deck is the most explicit thing anyone does in the whole first run
to say how they work, and it's a far harder signal than reading developer-ness
out of a sentence. The task only overrides when it plainly points the other way
(a Basic user wanting a one-off document; an Elite user wanting something
watched daily).

Setup is given that rule and proposes via `surface="…"` on the directive; the
card leads with the proposal, shows the other option beside it, and the user's
tap decides. When Setup omits the attribute the card applies the same layout
rule itself (`defaultHandoffSurface`), so the floor holds either way. Every
earlier card already reports its pick back as a hidden `[setup] …` turn, so
the layout and connector choices are in Setup's context well before the fork.

One value then drives everything downstream:

| | `bot` | `session` |
|---|---|---|
| profile | minted per task | none — the user's `default` |
| chat row | hidden, titled `Bot Chat` | visible, titled after the task |
| roster meta | stamped (look + canonical pin) | none |
| first-run frame | keeps it (no git strip, no panels) | normal app, everything back |
| sidebar | stays on BOTS | fronts SESSIONS |

The task side is told which it is (its runbook opens as "a brand-new agent" or
"this session"), and Setup's check-in note points at wherever the build landed.
Everything else — the no-auth rule, the permissions note, the progress cards,
Setup's cron — is identical across both.

## The machine fork

Before the runbook is composed, the flow asks the host what it is
(`loadMachineProfile`, one IPC): platform, release, arch, whether there's an
NVIDIA GPU, the hardware's own model string, and how many days ago the OS
created this account.

Two things follow from it. **What the machine-setup option is called** — "Help
me set up this Mac", "…this PC", "…this Spark". And **whether it leads**: a
machine younger than three weeks, or a Spark at any age, gets that one option
plus "Something else", which opens the other four as a second ask. Four
alternatives beside the obvious answer is a menu; the obvious answer plus a way
out is an offer. Anything unknown counts as not-new — the option is always in
the list, it just doesn't lead without a reason.

Neither case is reachable from the machine you develop on, so the dev runner
can answer the probe for you: `npm run dev:fresh -- --new` overlays your own
host with an age of zero (a brand-new version of this Mac, this PC), and
`-- --spark` answers as an RTX Spark unboxed today. Add `-- --movie` to play
the cinematic first. They overlay rather than
replace so `--new` stays your platform — the point of it is rehearsing "Help me
set up this Mac", which a wholesale fake payload can't give you. Your unmodified
host is the lived-in case.

The two Sparks are recognised differently because they are different computers.
An **RTX Spark** is a Windows-on-Arm PC (the N1X superchip, in this fall's
ASUS / Dell / HP / Lenovo / Surface / MSI laptops and mini desktops); the OEM
badge on the case isn't a name we can enumerate, so it's identified by shape —
Windows + Arm + NVIDIA silicon, which nothing else currently ships. The GPU
vendor comes from Chromium's own GPU enumeration (`app.getGPUInfo('basic')`, PCI
vendor `0x10DE`), so it's a lookup rather than a probe: no subprocess and no
vendor tooling a just-unboxed machine may not have yet. A **DGX Spark** is the
older Linux GB10 developer box and says so in `/proc/device-tree/model` — as
`NVIDIA_DGX_Spark`, where the underscores are separators, which is why the match
splits on them before applying word boundaries.

Picking it hands off with `plan="machine-setup"`, and the plan (not the task
text) is what swaps the task agent's runbook: audit the box with the terminal
first — OS, updates, package manager, what's already installed, GPU and driver
on NVIDIA hardware — report what's there, propose a numbered plan, and only
install after an explicit `::ask`. Setting a machine up is the first task a new
user most wants and can least brief, so the agent does the briefing. It is also
the one job that needs no account anywhere, which is what the first build has
to be regardless.

The runbook opens with `machineDescription()`, and that line leads with age,
because age is what decides whether this job is real. On a machine unboxed this
week the drivers, updates and toolchain are genuinely undone and doing them is
worth an afternoon of someone's life; on a two-year-old machine most of it is
handled already, and an agent that doesn't know will "fix" things that were
never broken. Setup's offer says the same thing out loud — it names the machine
as new, and names the work as the setup nobody enjoys — because being recognised
is what makes the offer land.

Also in the tree from the same lineage (dormant in bot mode, used by the
login-mode dashboard flow): the generative first-screen system —
`FirstScreenCard` keep/drop picker, the living sketch pane
(first-screen-live.ts), populate pipeline (first-screen-populate.ts), and the
`context`/`first-screen`/`ready` directives. Bot mode's runbook doesn't place
them; the components stay available for the task bot's future artifacts.
