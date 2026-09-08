"""
Scripted onboarding scenario for the mock gateway — the Setup-bot flow
(PR #13 shape): cinematic → solo guided chat with the Setup bot → fork →
options card → handoff → the task bot's chat. Deterministic, no LLM.

Session routing is by PROFILE:
  * `hermes-setup` profile's hidden canonical (title "Bot Chat") = the guide.
    Its step machine walks name → look → connectors → layout → fork →
    (options card) → handoff, then answers the [setup] handoff notes.
  * a minted task-bot profile's hidden canonical (title "Bot Chat") = the
    build chat. Its first visible turn is the brief; it replies with the
    permissions note + ::onboarding{step="progress"} cards.
  * any other session falls through to generic replies.

Directive contract (onboarding-wizard.ts runbook + FLOW.md):
  name/connectors/layout/look picks report as hidden `[setup] …` turns;
  ::ask pills and the `first`-card chips land as VISIBLE user turns.

The module-gen / populate prompts (first-screen-live/populate) are kept for
the dormant dashboard flow so the JSON stays validator-clean.

The fork's pills are NOT copied here. The runbook that pins them is seeded
into the guide session at session.create, so the mock reads the ::ask lines
back out of it and emits them verbatim — the same thing the model is told to
do. Reword the options, reorder them, add the machine tier: the mock follows,
because it is quoting the same source the real turn quotes. What the mock
still has to know is what each pill MEANS, and that is matched loosely, on the
one word carrying the branch (see FORK_BRANCHES).
"""

import json
import re

ASK_RE = re.compile(r'::ask\{[^}]*\}')

# The runbook's own worked example of the ::ask syntax, which is not a question
# anyone is being asked.
ASK_EXAMPLE_RE = re.compile(r'options="A\|B\|C"')

# Which branch a tapped pill means, by the one word that carries it. Loose on
# purpose: the wording of these options is the runbook's business.
FORK_BRANCHES = (
    ('set up this', 'machine'),
    ('something else', 'fallback'),
    ('in mind', 'task'),
    ('automate', 'first'),
    ('skip', 'skip'),
)


def _fork_branch(text):
    lowered = text.lower()

    for needle, branch in FORK_BRANCHES:
        if needle in lowered:
            return branch

    # A typed answer, or "let's figure it out together".
    return 'probe'


def _scripted_asks(session):
    """Every ::ask the seeded runbook pins, in the order it pins them: the fork
    first, then the "Something else" follow-up when the machine earned one."""
    seed = next((m['content'] for m in session['messages'] if m.get('display_kind') == 'hidden'), '')

    return [ask for ask in ASK_RE.findall(seed) if not ASK_EXAMPLE_RE.search(ask)]


def _ask(session, index, fallback=''):
    asks = _scripted_asks(session)

    return asks[index] if index < len(asks) else fallback

MODULES_RE = re.compile(r'Design starter-screen modules')
POPULATE_RE = re.compile(r'Fill in the starter screen')
POPULATE_FEED_RE = re.compile(r'use web search to find genuinely current items')
BLOCKS_RE = re.compile(r'Blocks:\s*(\[.*\])', re.S)


# ── module generation (dormant dashboard flow) ──────────────────────────────

def _modules_for(prompt):
    if 'EXACTLY 3 modules' in prompt:
        tier = 'simple'
    elif '5 or 6 modules' in prompt:
        tier = 'power'
    else:
        tier = 'standard'

    sets = {
        'simple': [
            ('signal', 'feed', 'The signal',
             'The latest developments that matter to this project, with sources.'),
            ('moves', 'action', 'Three moves',
             'The next three concrete things to do, in order.'),
            ('the-ask', 'draft', 'The ask',
             'A fill-in-the-blank draft for the next message that needs sending.'),
        ],
        'standard': [
            ('signal', 'feed', 'The signal',
             'The latest developments that matter to this project, with sources.'),
            ('moves', 'action', 'Three moves',
             'The next three concrete things to do, in order.'),
            ('the-ask', 'draft', 'The ask',
             'A fill-in-the-blank draft for the next message that needs sending.'),
            ('fork', 'choice', 'Fork in the road',
             'A real decision about the project, with options to pick from.'),
        ],
        'power': [
            ('signal', 'feed', 'The signal',
             'The latest developments that matter to this project, with sources.'),
            ('moves', 'action', 'Three moves',
             'The next three concrete things to do, in order.'),
            ('the-ask', 'draft', 'The ask',
             'A fill-in-the-blank draft for the next message that needs sending.'),
            ('fork', 'choice', 'Fork in the road',
             'A real decision about the project, with options to pick from.'),
            ('capture', 'input', 'Quick capture',
             'A type-and-go box that turns your words into a task.'),
            ('workhorse', 'tool', 'Workhorse',
             'An input-to-output helper for the repetitive part of this project.'),
        ],
    }
    modules = [
        {'id': mid, 'kind': kind, 'label': label, 'prompt': prompt_text}
        for mid, kind, label, prompt_text in sets[tier]
    ]
    return json.dumps({'modules': modules})


# ── populate (dormant dashboard flow) ───────────────────────────────────────

def _content_for(kind, label):
    if kind == 'feed':
        return {
            'kind': 'feed',
            'items': [
                {'line': f'{label}: the moves that matter this week', 'source': 'Field Notes'},
                {'line': f'{label}: one quiet signal worth watching', 'source': 'The Wire'},
                {'line': f'{label}: what changed since last check', 'source': 'Dispatch'},
            ],
        }
    if kind == 'action':
        return {
            'kind': 'action',
            'steps': [
                f'Block time for {label.lower()} on the calendar',
                f'Do the one thing that unblocks {label.lower()}',
                'Send the update and note what landed',
            ],
        }
    if kind == 'draft':
        return {
            'kind': 'draft',
            'skeleton': '[Opening line] — here is where [the ask] lands, with [the follow-up] and [the close].',
        }
    if kind == 'skill':
        return {
            'kind': 'skill',
            'learned': [
                'You are working on a project you care about and want it unblocked this week.',
                f'You kept the "{label}" module, so this angle matters to you.',
                'You prefer drafts that are plain, direct, and copy-ready.',
            ],
            'version': 1,
        }
    if kind == 'tool':
        return {
            'kind': 'tool',
            'example': {
                'input': f'Run the usual pass on {label.lower()}',
                'output': 'Here is the pass, formatted and ready to send.',
            },
        }
    if kind == 'choice':
        return {
            'kind': 'choice',
            'question': f'Which way do you want to take {label.lower()}?',
            'options': [
                {'label': 'Push forward', 'prompt': f'Take {label.lower()} forward now'},
                {'label': 'Hold and think', 'prompt': f'Think through {label.lower()} before acting'},
                {'label': 'Ask someone', 'prompt': f'Draft the ask to get outside input on {label.lower()}'},
            ],
        }
    if kind == 'input':
        return {
            'kind': 'input',
            'placeholder': f'Paste or type the raw bit for {label.lower()}',
            'promptPrefix': f'Take this and turn it into the next step for {label.lower()}: ',
        }
    return None


def _populate_for(prompt):
    feed_only = bool(POPULATE_FEED_RE.search(prompt))
    no_extras = 'Do NOT add extra blocks' in prompt

    match = BLOCKS_RE.search(prompt)
    blocks = []
    if match:
        try:
            parsed = json.loads(match.group(1))
            if isinstance(parsed, list):
                blocks = parsed
        except (ValueError, TypeError):
            blocks = []

    out = {}
    extra = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        bid = block.get('id')
        kind = block.get('kind')
        label = block.get('label') or bid
        if not bid or not kind:
            continue
        if feed_only and kind != 'feed':
            continue
        if not feed_only and kind == 'feed':
            continue
        content = _content_for(kind, label)
        if content:
            out[bid] = {'content': content, 'kind': kind}

    if not feed_only and not no_extras:
        extra.append({
            'id': 'postmortem',
            'kind': 'draft',
            'label': 'Postmortem notes',
            'prompt': 'A fill-in-the-blank template for the post-mortem once this lands.',
            'content': _content_for('draft', 'Postmortem notes'),
        })
        if '5 or 6 modules' in prompt:
            extra.append({
                'id': 'status-update',
                'kind': 'input',
                'label': 'Status update',
                'prompt': 'Type where things stand and get it shaped for the group chat.',
                'content': _content_for('input', 'Status update'),
            })

    return json.dumps({'blocks': out, 'extra': extra})


# ── Setup guide dialogue ────────────────────────────────────────────────────

def _clean_name(text):
    name = re.sub(r'[^\w\s\'-]', '', text.strip())
    words = name.split()
    if not words:
        return 'there'
    if len(words) == 1:
        return words[0][:20]
    return ' '.join(words[:3])[:30]


def _short(text, limit=140):
    clean = ' '.join(text.strip().split())
    if len(clean) <= limit:
        return clean
    return clean[: limit - 1].rstrip() + '…'


def _brief_for(task):
    return _short(f'{task} — build the first working version and show your work as you go.', 190)


def _surface_for(layout_report):
    return 'session' if 'Elite' in layout_report else 'bot'


class Scenario:
    def __init__(self, gateway):
        self.gateway = gateway
        self.layout_report = ''

    def reply(self, sid, text, display_kind):
        session = self.gateway.get_session(sid)
        if not session:
            return None
        text = (text or '').strip()
        profile = session.get('profile') or 'default'

        if profile == 'hermes-setup':
            return self._setup_reply(session, text, display_kind)

        if profile != 'default':
            # A minted task bot's canonical chat.
            return self._taskbot_reply(session, text, display_kind)

        # Hidden helper sessions (module gen / populate) and anything else.
        if MODULES_RE.search(text):
            return _modules_for(text)
        if POPULATE_RE.search(text):
            return _populate_for(text)
        return 'I am still with you. Anything else you want built?'

    def _handoff(self, session, task, brief, plan=None):
        """The one line Setup exists to emit. `plan` marks the jobs the app
        scripts itself rather than taking from the user's own words."""
        self.gateway.touch_step(session['id'], 'handoff')
        attrs = f'step="handoff" task="{task}" brief="{brief}" surface="{_surface_for(self.layout_report)}"'

        if plan:
            attrs += f' plan="{plan}"'

        return (
            'Perfect — I am handing that to an agent built just for it. '
            f'I will stay right here.\n\n::onboarding{{{attrs}}}'
        )

    # ── Setup (the guide) ──
    def _setup_reply(self, session, text, display_kind):
        step = session.get('step', 'name')
        hidden = display_kind == 'hidden'

        if hidden:
            if text.startswith('[setup] accent color'):
                self.gateway.touch_step(session['id'], 'connectors')
                return (
                    'Noted. Now the tools you already use, so Hermes can connect '
                    'to them later.\n\n'
                    '::onboarding{step="connectors"}'
                )
            if text.startswith('[setup] connect later'):
                self.gateway.touch_step(session['id'], 'layout')
                return (
                    'Good. Last one: how should the window feel?\n\n'
                    '::onboarding{step="layout"}'
                )
            if text.startswith('[setup] layout'):
                self.layout_report = text
                self.gateway.touch_step(session['id'], 'fork')
                return (
                    'Almost there. If you have a first build in mind, I can spin '
                    'up an agent just for it.\n\n' + _ask(session, 0)
                )
            if text.startswith('[setup] handoff complete'):
                self.gateway.touch_step(session['id'], 'after')
                return (
                    "It's in motion. I'll check in as you get going, and this "
                    'chat is always here.'
                )
            if text.startswith('[setup] handoff failed'):
                self.gateway.touch_step(session['id'], 'after')
                return (
                    "The separate agent could not be created, so I'll build it "
                    "right here instead. I'll ask for permissions as I go — say "
                    "no to anything.\n\n"
                    '::onboarding{step="progress" title="Starting the build"}'
                )
            return None

        # Visible turns.
        if step == 'name':
            name = _clean_name(text)
            self.gateway.touch_step(session['id'], 'look')
            return (
                f'::onboarding{{step="name" value="{name}"}}\n\n'
                f'Good to meet you, {name}. Let us pick a color for the app '
                'while we talk.\n\n'
                '::onboarding{step="look"}'
            )

        if step in ('fork', 'fallback'):
            branch = _fork_branch(text)

            if branch == 'fallback':
                self.gateway.touch_step(session['id'], 'fallback')
                return 'No problem — what sounds better?\n\n' + _ask(session, 1)

            if branch == 'machine':
                self.gateway.touch_step(session['id'], 'machine')
                return (
                    'Good — that I can do end to end. What do you mainly want '
                    'this machine for: work, gaming, school, creative, a bit of '
                    'everything?'
                )

            if branch == 'skip':
                self.gateway.touch_step(session['id'], 'after')
                return (
                    "Then it's yours — go poke at it. I'll be right here if you "
                    'ever want a hand.'
                )

            if branch == 'task':
                self.gateway.touch_step(session['id'], 'task')
                return 'Great — tell me what it is, in a sentence or two.'

            # "Automate something I already do", "let's figure it out together",
            # or a typed answer: all of them need to hear what they are working
            # on before the options card can be built from it.
            self.gateway.touch_step(session['id'], 'working')
            return "What are you working on right now — the real thing on your plate this week?"

        if step == 'working':
            self.gateway.touch_step(session['id'], 'first')
            return (
                f'::onboarding{{step="working" value="{_short(text)}"}}\n\n'
                'Got it — that narrows things nicely. Tap the one that fits '
                'best.\n\n'
                '::onboarding{step="first" options="A daily briefing that lands each morning|A tracker for the thing you repeat every week|A page that turns your notes into a plan|A reminder that nudges you at the right time"}'
            )

        if step == 'machine':
            return self._handoff(session, 'Set up this computer', _brief_for(f'get this machine ready for {text}'),
                                 plan='machine-setup')

        if step in ('task', 'first'):
            return self._handoff(session, _short(text, 40), _brief_for(text))

        if step == 'handoff':
            # The user may tap the handoff card more than once; stay quiet.
            return 'One moment — the handoff card below decides where the build lands.'

        if step == 'after':
            return 'Still here whenever you want the next step.'

        return 'I am still with you. Anything else you want set up?'

    # ── Task bot ──
    def _taskbot_reply(self, session, text, display_kind):
        step = session.get('step', 'name')
        hidden = display_kind == 'hidden'
        if hidden:
            return None
        if step == 'name':
            self.gateway.touch_step(session['id'], 'build')
            return (
                "I'll ask for permissions as we go — say no to anything, or "
                'point me somewhere else.\n\n'
                '::onboarding{step="progress" title="Scaffolding the first piece"}\n\n'
                'First piece is already in motion. I will keep the card above '
                'updated as it lands.'
            )
        # Later turns cycle progress cards so the demo shows the build breathing.
        titles = [
            'Wiring the first run',
            'Testing the happy path',
            'Polishing the edges',
        ]
        visible = [m for m in session['messages'] if m.get('display_kind') != 'hidden' and m['role'] == 'user']
        idx = min(len(visible) - 1, len(titles) - 1)
        return (
            f'::onboarding{{step="progress" title="{titles[idx]}"}}\n\n'
            'Done with this step — next one is under way.'
        )


def setup(gateway):
    gateway.scenario = Scenario(gateway)
