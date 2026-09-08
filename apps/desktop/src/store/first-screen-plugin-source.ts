/**
 * First-screen plugin source — the DESIGNED artifact renderer.
 *
 * This string is written to `<desktop-plugins>/first-screen/plugin.js` at
 * onboarding handoff. It renders screen.json as a real interface, not a list
 * of prompt buttons:
 *
 *  - dashboard → a command-center: masthead, indexed live-feed items,
 *    a first-move checklist, a voice panel — every element clickable.
 *  - document  → a typeset daily-brief issue: dateline, lede, sectioned
 *    stories, delivery panel.
 *  - app       → a working tool: input area, transform action, IN/OUT
 *    example pair.
 *
 * Interaction contract (the self-modifying-app demo):
 *  - Clicking any content element sends a *scoped* prompt into the active
 *    chat (host.submitPrompt) — headline → "tell me more", step → "walk me
 *    through this".
 *  - The masthead's "regenerate" instructs the agent to REWRITE screen.json
 *    in place (the file's absolute path rides inside the JSON), and the
 *    watcher repaints — the pane the user is looking at rebuilds itself.
 *
 * Rendering rules: plain ESM, no JSX (runtime loader restriction), CSS in an
 * injected <style> tag, app theme vars only, no continuously-repainting
 * animations (transitions on state changes only).
 */

export const FIRST_SCREEN_PLUGIN_JS = `/** first-screen — the interface Hermes built at first setup.
 *
 *  screen.json in this folder IS this pane: edit it (or ask Hermes to) and
 *  it repaints on save. Plain DOM (no JSX) so the runtime loader can import
 *  the file as-is.
 */

import React, { useEffect, useState } from 'react'

import { host } from '@hermes/plugin-sdk'

const h = React.createElement

const CSS = [
  /* ── Frame ── */
  '.fsx{--mono:ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;flex-direction:column;height:100%;overflow-y:auto;padding:0 16px 16px;color:var(--dt-foreground);font-size:14px;line-height:1.55}',
  '.fsx > *{flex:none}',
  '.fsx *{box-sizing:border-box;min-width:0}',
  '.fsx-titlerow{align-items:center;display:flex;gap:10px;justify-content:space-between;margin-top:16px;padding-bottom:6px}',
  '.fsx-title{font-size:24px;font-weight:650;letter-spacing:-.02em;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  
  '.fsx-regen{align-items:center;background:transparent;border:1px solid var(--dt-border);border-radius:999px;color:var(--dt-muted-foreground);cursor:pointer;display:inline-flex;flex:none;font-family:var(--mono);font-size:11px;gap:4px;letter-spacing:.04em;padding:4px 12px;transition:color 120ms ease,border-color 120ms ease}',
  '.fsx-regen:hover{border-color:color-mix(in srgb, var(--dt-primary) 50%, var(--dt-border));color:var(--dt-foreground)}',

  /* ── Module card ── */
  '.fsx-sec{background:var(--dt-card);border:1px solid var(--dt-border);border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.14);margin-top:10px;overflow:hidden}',
  '.fsx-sechead{align-items:center;display:flex;gap:9px;padding:12px 14px 9px}',
  '.fsx-dot{background:var(--dt-primary);border-radius:999px;flex:none;height:6px;width:6px}',
  '.fsx-seclabel{color:var(--dt-foreground);flex:1;font-size:15px;font-weight:600;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fsx-kindtag{background:color-mix(in srgb, var(--dt-muted-foreground) 10%, transparent);border-radius:4px;color:var(--dt-muted-foreground);flex:none;font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;padding:2.5px 7px;text-transform:uppercase}',
  '.fsx-secrun{align-items:center;background:var(--dt-primary);border:0;border-radius:999px;box-shadow:0 1px 2px rgba(0,0,0,.22);color:var(--dt-primary-foreground);cursor:pointer;display:inline-flex;flex:none;font-size:12px;font-weight:600;gap:4px;letter-spacing:.02em;padding:5px 14px;transition:transform 120ms ease,box-shadow 120ms ease}',
  '.fsx-secrun:hover{box-shadow:0 2px 7px rgba(0,0,0,.3);transform:translateY(-1px)}',
  '.fsx-secrun[disabled]{cursor:default;opacity:.4;pointer-events:none}',
  '.fsx-secbody{padding:0 14px 13px}',

  /* ── Feed items: chip-indexed clickable rows ── */
  '.fsx-item{align-items:flex-start;border:1px solid transparent;border-radius:8px;cursor:pointer;display:flex;gap:9px;margin:0 -6px;padding:7px 6px;transition:background 120ms ease,border-color 120ms ease}',
  '.fsx-item:hover{background:color-mix(in srgb, var(--dt-primary) 7%, transparent);border-color:color-mix(in srgb, var(--dt-primary) 22%, transparent)}',
  '.fsx-idx{background:color-mix(in srgb, var(--dt-primary) 12%, transparent);border-radius:5px;color:var(--dt-primary);flex:none;font-family:var(--mono);font-size:10.5px;font-weight:600;line-height:1;margin-top:2px;padding:4px 6px}',
  '.fsx-itembody{display:flex;flex:1;flex-direction:column;gap:3px}',
  '.fsx-line{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;font-size:13.5px;font-weight:500;line-height:1.5;overflow:hidden}',
  '.fsx-meta{align-items:center;color:var(--dt-muted-foreground);display:flex;flex-wrap:wrap;font-family:var(--mono);font-size:11px;gap:6px}',
  '.fsx-srcchip{background:color-mix(in srgb, var(--dt-muted-foreground) 11%, transparent);border-radius:4px;color:var(--dt-muted-foreground);flex:none;font-family:var(--mono);font-size:10.5px;padding:2px 7px}',
  '.fsx-open{color:var(--dt-primary);font-family:var(--mono);font-size:11px;opacity:0;transition:opacity 120ms ease;white-space:nowrap}',
  '.fsx-item:hover .fsx-open{opacity:1}',
  '.fsx-lede{border-left:2px solid var(--dt-primary);color:var(--dt-muted-foreground);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;font-size:13.5px;font-style:italic;line-height:1.55;margin:2px 0 9px;overflow:hidden;padding:1px 0 1px 11px}',

  /* ── Action steps: checklist rows ── */
  '.fsx-steps{display:flex;flex-direction:column;gap:2px;margin-top:2px}',
  '.fsx-step{align-items:flex-start;border-radius:6px;cursor:pointer;display:flex;gap:9px;margin:0 -6px;padding:5px 6px;transition:background 120ms ease;user-select:none}',
  '.fsx-step:hover{background:color-mix(in srgb, var(--dt-muted-foreground) 7%, transparent)}',
  '.fsx-check{align-items:center;border:1.5px solid color-mix(in srgb, var(--dt-muted-foreground) 55%, transparent);border-radius:5px;color:var(--dt-primary-foreground);display:inline-flex;flex:none;font-size:10px;font-weight:700;height:15px;justify-content:center;line-height:1;margin-top:2.5px;transition:background 120ms ease,border-color 120ms ease;width:15px}',
  '.fsx-checkon{background:var(--dt-primary);border-color:var(--dt-primary)}',
  '.fsx-stepdone .fsx-steptext{color:var(--dt-muted-foreground);text-decoration:line-through}',
  '.fsx-progress{color:var(--dt-muted-foreground);flex:none;font-family:var(--mono);font-size:10.5px}',
  '.fsx-steptext{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;flex:1;font-size:13.5px;line-height:1.5;overflow:hidden}',

  /* ── Draft skeleton page ── */
  '.fsx-page{background:color-mix(in srgb, var(--dt-background) 55%, var(--dt-card));border:1px solid var(--dt-border);border-radius:8px;font-family:var(--mono);font-size:12.5px;line-height:1.7;margin-top:4px;max-height:220px;overflow-y:auto;padding:11px 13px;white-space:pre-wrap}',
  '.fsx-slot{color:var(--dt-primary)}',

  /* ── Tool panel ── */
  '.fsx-io{display:flex;flex-direction:column;gap:8px;margin-top:8px}',
  '.fsx-iolabel{color:var(--dt-muted-foreground);font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;margin-bottom:4px}',
  '.fsx-iobox{background:color-mix(in srgb, var(--dt-background) 55%, var(--dt-card));border:1px solid var(--dt-border);border-radius:8px;font-family:var(--mono);font-size:12px;line-height:1.6;max-height:150px;overflow-y:auto;padding:10px 12px;white-space:pre-wrap}',
  '.fsx-input{background:color-mix(in srgb, var(--dt-background) 55%, var(--dt-card));border:1px solid var(--dt-border);border-radius:8px;color:var(--dt-foreground);font-family:var(--mono);font-size:12.5px;line-height:1.6;min-height:64px;outline:none;padding:10px 12px;resize:vertical;transition:border-color 120ms ease;width:100%}',
  '.fsx-input:focus{border-color:color-mix(in srgb, var(--dt-primary) 60%, var(--dt-border))}',
  '.fsx-go{align-items:center;background:var(--dt-primary);border:0;border-radius:999px;box-shadow:0 1px 2px rgba(0,0,0,.22);color:var(--dt-primary-foreground);cursor:pointer;display:inline-flex;font-size:12px;font-weight:600;gap:4px;letter-spacing:.02em;margin-top:9px;padding:6px 16px;transition:transform 120ms ease,box-shadow 120ms ease}',
  '.fsx-go:hover{box-shadow:0 2px 7px rgba(0,0,0,.3);transform:translateY(-1px)}',

  /* ── Pending / writing states ── */
  '.fsx-pending{align-items:center;color:var(--dt-muted-foreground);display:flex;font-size:13px;font-style:italic;gap:7px;padding:8px 0 4px}',
  '@keyframes fsx-shimmer{0%{background-position:-200px 0}100%{background-position:200px 0}}',
  '.fsx-fill{display:flex;flex-direction:column;gap:7px;padding:8px 0 4px}',
  '.fsx-fillbar{animation:fsx-shimmer 1.2s linear infinite;background:linear-gradient(90deg, color-mix(in srgb, var(--dt-muted-foreground) 18%, transparent) 25%, color-mix(in srgb, var(--dt-primary) 40%, transparent) 50%, color-mix(in srgb, var(--dt-muted-foreground) 18%, transparent) 75%);background-size:200px 100%;border-radius:4px;height:9px}',
  '.fsx-fillnote{align-items:center;color:var(--dt-primary);display:flex;font-family:var(--mono);font-size:11px;gap:7px;letter-spacing:.08em;text-transform:uppercase}',
  '@keyframes fsx-spin{to{transform:rotate(360deg)}}',
  '.fsx-spinner{animation:fsx-spin .8s linear infinite;border:2px solid color-mix(in srgb, var(--dt-muted-foreground) 30%, transparent);border-radius:999px;border-top-color:var(--dt-primary);flex:none;height:12px;width:12px}',

  /* ── Sketch / proposals stages ── */
  '.fsx-sketchrow{animation:fsx-cardin 380ms cubic-bezier(.22,1,.36,1) both;align-items:center;border:1px dashed color-mix(in srgb, var(--dt-muted-foreground) 35%, transparent);border-radius:10px;display:flex;gap:10px;margin-top:8px;min-height:44px;padding:10px 12px}',
  '.fsx-sketchlabel{color:var(--dt-muted-foreground);font-family:var(--mono);font-size:12px;letter-spacing:.04em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fsx-sketchbars{display:flex;flex:1;flex-direction:column;gap:4px}',
  '.fsx-sketchbar{animation:fsx-shimmer 1.6s linear infinite;background:linear-gradient(90deg, color-mix(in srgb, var(--dt-muted-foreground) 14%, transparent) 25%, color-mix(in srgb, var(--dt-muted-foreground) 26%, transparent) 50%, color-mix(in srgb, var(--dt-muted-foreground) 14%, transparent) 75%);background-size:200px 100%;border-radius:3px;height:6px}',
  '.fsx-stagecap{align-items:center;color:var(--dt-primary);display:flex;font-family:var(--mono);font-size:11px;gap:7px;letter-spacing:.1em;margin-top:14px;text-transform:uppercase}',
  '.fsx-proprow{animation:fsx-cardin 380ms cubic-bezier(.22,1,.36,1) both;background:var(--dt-card);border:1px solid var(--dt-border);border-radius:10px;display:flex;flex-direction:column;gap:2px;margin-top:8px;padding:9px 12px}',
  '.fsx-dropped{opacity:.38}',
  '.fsx-dropped .fsx-proplabel{text-decoration:line-through}',
  '.fsx-propkind{color:var(--dt-primary);font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase}',
  '.fsx-proplabel{font-size:14px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

  '.fsx-subtitle{color:var(--dt-muted-foreground);font-size:11.5px;line-height:1.4;margin-top:-2px;opacity:.8}',
  '.fsx-question{font-size:13.5px;font-weight:550;line-height:1.45;margin-bottom:8px}',
  '.fsx-options{display:flex;flex-wrap:wrap;gap:7px}',
  '.fsx-opt{background:color-mix(in srgb, var(--dt-primary) 10%, transparent);border:1px solid color-mix(in srgb, var(--dt-primary) 35%, var(--dt-border));border-radius:999px;color:var(--dt-foreground);cursor:pointer;font-size:12px;font-weight:500;padding:5px 13px;transition:background 120ms ease,border-color 120ms ease}',
  '.fsx-opt:hover{background:color-mix(in srgb, var(--dt-primary) 22%, transparent);border-color:var(--dt-primary)}',
  '.fsx-go[disabled]{cursor:default;opacity:.4;pointer-events:none}',
  '@keyframes fsx-pop{0%{transform:scale(.5)}60%{transform:scale(1.22)}100%{transform:scale(1)}}',
  '@keyframes fsx-cardin{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}',
  '.fsx-sec{animation:fsx-cardin 380ms cubic-bezier(.22,1,.36,1) both;position:relative}',
  '@keyframes fsx-arrive{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
  '@keyframes fsx-glowring{0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--dt-primary) 34%, transparent)}100%{box-shadow:0 0 0 14px transparent}}',
  '.fsx-arrived{animation:fsx-glowring 750ms ease-out 1,fsx-cardin 380ms cubic-bezier(.22,1,.36,1) both}',
  '.fsx-arrived .fsx-secbody{animation:fsx-arrive 420ms ease both}',
  '.fsx-checkon{animation:fsx-pop 260ms cubic-bezier(.34,1.56,.64,1)}',
  '.fsx-steptext{transition:color 200ms ease,opacity 200ms ease}',
  '.fsx-progress-done{animation:fsx-pop 300ms cubic-bezier(.34,1.56,.64,1);background:color-mix(in srgb, var(--dt-primary) 16%, transparent);border-radius:5px;color:var(--dt-primary);font-weight:700;padding:1.5px 7px}',
  '.fsx-secrun:active{box-shadow:none;transform:translateY(0) scale(.94)}',
  '.fsx-go:active{box-shadow:none;transform:translateY(0) scale(.94)}',
  '.fsx-opt:active{transform:scale(.94)}',
  '.fsx-opt{transition:background 120ms ease,border-color 120ms ease,transform 90ms ease}',
  '.fsx-item:active{transform:scale(.99)}',
  '.fsx-regen:active{transform:scale(.94)}',
  '@keyframes fsx-levelup{0%{transform:scale(1)}30%{transform:scale(1.012)}100%{transform:scale(1)}}',
  '.fsx-skillup{animation:fsx-levelup 900ms cubic-bezier(.22,1,.36,1)}',
  '.fsx-skillbadge{align-items:center;background:color-mix(in srgb, var(--tool-memory-legendary-mid, var(--dt-primary)) 14%, transparent);border-radius:999px;display:inline-flex;flex:none;font-family:var(--mono);font-size:10.5px;font-weight:700;gap:4px;letter-spacing:.04em;padding:2.5px 9px}',
  '.fsx-skillbadge span{background-image:linear-gradient(105deg, var(--tool-memory-legendary-from, var(--dt-primary)) 0%, var(--tool-memory-legendary-mid, var(--dt-primary)) 48%, var(--tool-memory-legendary-to, var(--dt-primary)) 100%);-webkit-background-clip:text;background-clip:text;color:transparent}',
  '@keyframes fsx-badgepop{0%{transform:scale(.6)}60%{transform:scale(1.25)}100%{transform:scale(1)}}',
  '.fsx-skillbadge-pop{animation:fsx-badgepop 420ms cubic-bezier(.34,1.56,.64,1)}',
  '.fsx-learned{border-left:2px solid color-mix(in srgb, var(--tool-memory-legendary-mid, var(--dt-primary)) 45%, transparent);display:flex;flex-direction:column;gap:7px;margin-top:2px;padding-left:11px}',
  '.fsx-learnedline{font-size:13px;line-height:1.5}',
  '.fsx-learnedline-new{animation:fsx-arrive 500ms ease both;color:var(--tool-memory-legendary-meta, var(--dt-primary))}',
  '.fsx-skillfoot{color:var(--dt-muted-foreground);font-size:11px;margin-top:9px;opacity:.85}',
  '.fsx-foot{display:none}'
].join('')

/* The live screen.json path, set by the pane on every config load — work
 * orders carry it so ANY session can edit the dashboard when asked. */
let screenPath = ''

/* Send a prompt through the active chat; toast when no surface owns it. */
function send(prompt) {
  const ok = typeof host.submitPrompt === 'function' && host.submitPrompt(prompt)
  if (!ok) host.notify({ kind: 'info', message: 'Open a chat first. The buttons here send prompts into it.' })
}

/* Choice picks and typed inputs are DECISIONS about the user's project: do
 * the work in chat AND ripple the decision through the other cards it
 * affects (they pick Zigbee, so the shopping checklist gains the Zigbee
 * parts; prompts that assumed another option get re-aimed). */
function sendRipple(header, task) {
  send(
    header +
      ' ' +
      task +
      '\\n\\nRules: plain declaratives, no em dashes, no praise. First give me the finished deliverable for this in chat. Then update my dashboard to match the decision: read ' +
      (screenPath || 'screen.json in my first-screen plugin folder') +
      ' and edit ONLY the blocks this decision genuinely affects, in the same turn: add decision-specific steps or items to checklists and shopping lists, re-aim prompts that assumed a different option, and record the decision on the card I answered (e.g. its question becomes the decision, or it gains the follow-up question). ALSO update the hermes-skill block: add one short second-person line capturing what this decision taught you about me and increment its content.version by 1 (the card plays its self-improvement animation on the bump). Card bodies stay nested under "content" with their own "kind"; untouched blocks stay byte-identical; never write a populating flag; keep populatedAt. Save so the pane repaints, then end with one line naming the cards you updated (or saying none were affected).'
  )
}

/* A feed Refresh is the ONE dashboard button that edits the file: the card
 * itself must update. The agent searches, rewrites that block's content in
 * screen.json, and the pane repaints on save. */
function sendRefresh(block, filePath) {
  send(
    '[Onboarding Dashboard refresh] Refresh the "' +
      block.label +
      '" feed on my dashboard. Search the web for 3 genuinely current items matching: ' +
      block.prompt +
      '\\nThen read ' +
      filePath +
      ' and rewrite ONLY that block so it reads {"id": same, "kind": "feed", "label": same, "prompt": same, "content": {"kind": "feed", "items": [{"line": "one sentence under 100 chars", "source": "site name"}]}}. The items MUST be nested under "content" exactly like that or the card cannot render them. Keep every other block untouched, update the top-level populatedAt, save. Reply in chat with one line when done — the card repaints from the file.'
  )
}

/* Every dashboard button ships its work order inline: buttons mean DO THE
 * WORK now, in chat — never describe the module, never edit the dashboard.
 * The contract has to ride with the prompt because clicks can land in ANY
 * session (the guided onboarding chat, a fresh chat weeks later). */
function sendWork(task) {
  send(
    '[Onboarding Dashboard button] Do this task now and give me the finished output directly in chat: ' +
      task +
      '\\n\\nRules: write like a person: plain declaratives, active voice, no em dashes, no exclamation marks, no praise, no AI diction (delve, seamless, robust, crucial), end on the last real point. Never think out loud (no Let-me-check narration; tool turns get one short sentence before and after). Text deliverable FIRST; after it, at most one image and only when a visual genuinely helps, introduced with a line naming what you made. Produce the actual deliverable (list, draft, plan), not a description of it. Reusable text goes in a fenced code block. When the next move is a decision or you need one fact from me, END with one interactive question as its own paragraph: ::ask{question="..." options="A|B|C"} (2-6 short options; add input="true" for free text) instead of asking in prose. Do not talk about, edit, or rebuild the dashboard or its config unless I explicitly ask you to change the dashboard. If I DO ask for a dashboard change (save a result as a module, rename, rewire a card), make the edit yourself in that same turn: read ' + (screenPath || 'screen.json in my first-screen plugin folder') + ' , keep the JSON schema: each block is {id, kind, label, prompt, content} and the card body ALWAYS lives nested under content with its own kind, e.g. {"kind": "action", "steps": []} or {"kind": "feed", "items": [{"line", "source"}]}. When you change what a card is about, rewrite its label, prompt, AND content together (a renamed card with stale content is a failure). When removing or reordering cards, keep every surviving block byte-identical, content included; stripping content from kept cards is a failure. Never write a populating flag; keep populatedAt. Write it back, confirm in one line. Never end a turn with a promise to wire something in later.'
  )
}

/* One clickable content row: index, line, source/tag meta, hover affordance. */
function FeedItem(props) {
  const raw = props.item
  const it = { line: asText(raw && raw.line !== undefined ? raw.line : raw), source: asText(raw && raw.source), tag: asText(raw && raw.tag) }
  return h(
    'div',
    { className: 'fsx-item', onClick: () => send('Tell me more about this, briefly (answer in chat; do not touch the dashboard): "' + it.line + '"' + (it.source ? ' (' + it.source + ')' : '')) },
    h('span', { className: 'fsx-idx' }, String(props.n).padStart(2, '0')),
    h(
      'div',
      { className: 'fsx-itembody' },
      h('span', { className: 'fsx-line' }, it.line),
      h(
        'span',
        { className: 'fsx-meta' },
        it.source ? h('span', { className: 'fsx-srcchip' }, it.source) : null,
        it.tag ? h('span', { className: 'fsx-srcchip' }, it.tag) : null,
        h('span', { className: 'fsx-open' }, '\\u2192 open in chat')
      )
    )
  )
}

function Steps(props) {
  /* A real to-do list: checking a box TOGGLES local done-state (plugin
   * storage — instant, persistent, never a chat submission). The Run pill
   * stays the card's do-the-work action. */
  const todo = props.todo || { done: {}, toggle: function () {} }
  return h(
    'div',
    { className: 'fsx-steps' },
    (props.steps || []).map((s, i) => {
      const key = props.blockId + '|' + s
      const done = Boolean(todo.done[key])
      return h(
        'div',
        {
          className: 'fsx-step' + (done ? ' fsx-stepdone' : ''),
          key: i,
          onClick: () => todo.toggle(key),
          role: 'checkbox',
          'aria-checked': done
        },
        h('span', { className: 'fsx-check' + (done ? ' fsx-checkon' : '') }, done ? '\\u2713' : ''),
        h('span', { className: 'fsx-steptext' }, s)
      )
    })
  )
}

/* Draft skeleton with [slots] highlighted. */
function Page(props) {
  const parts = String(props.text || '').split(/(\\[[^\\]]+\\])/g)
  return h(
    'div',
    { className: 'fsx-page' },
    parts.map((p, i) => (p.startsWith('[') ? h('span', { className: 'fsx-slot', key: i }, p) : p))
  )
}

function ToolPanel(props) {
  const [value, setValue] = useState('')
  const c = props.content || {}
  const ex = c.example ? { input: asText(c.example.input), output: asText(c.example.output) } : null
  return h(
    'div',
    null,
    h('textarea', {
      className: 'fsx-input',
      onChange: e => setValue(e.target.value),
      placeholder: ex && ex.input ? 'e.g. ' + ex.input : 'Paste raw material here…',
      value
    }),
    h('button', { className: 'fsx-go', onClick: () => sendWork(props.prompt + '\\n\\nInput:\\n' + (value || (ex && ex.input) || '')), type: 'button' }, 'Transform'),
    ex
      ? h(
          'div',
          { className: 'fsx-io' },
          h('div', null, h('div', { className: 'fsx-iolabel' }, 'IN'), h('div', { className: 'fsx-iobox' }, ex.input)),
          h('div', null, h('div', { className: 'fsx-iolabel' }, 'OUT'), h('div', { className: 'fsx-iobox' }, ex.output))
        )
      : null
  )
}


/* The skill card: the playbook Hermes keeps about this user, visibly
 * versioned. A version bump plays the level-up sweep and pops the badge —
 * self-improvement you can SEE. Previous version remembered per mount. */
function SkillCard(props) {
  const c = props.content
  const version = c.version || 1
  const prevRef = React.useRef(version)
  const prevLinesRef = React.useRef(null)
  const [leveled, setLeveled] = useState(false)
  useEffect(() => {
    if (version > prevRef.current) {
      setLeveled(true)
      const t = setTimeout(() => setLeveled(false), 1800)
      prevRef.current = version
      return () => clearTimeout(t)
    }
    prevRef.current = version
  }, [version])
  const prevLines = prevLinesRef.current
  prevLinesRef.current = c.learned
  return h(
    'div',
    { className: leveled ? 'fsx-skillup' : undefined },
    // Level-up ring: the SAME arc-border the chat wears (styles.css), aimed
    // at the whole card (.fsx-sec is the positioned host), recolored to the
    // legendary gold\\u2192purple of the in-chat self-improvement row.
    leveled
      ? h('span', {
          className: 'arc-border',
          style: {
            '--arc-c0': 'var(--tool-memory-legendary-from)',
            '--arc-c1': 'var(--tool-memory-legendary-mid)',
            '--arc-c2': 'var(--tool-memory-legendary-to)',
            '--arc-radius': '12px',
            '--arc-standoff': '2px'
          }
        })
      : null,
    h(
      'div',
      { className: 'fsx-learned' },
      c.learned.map((line, i) =>
        h(
          'div',
          {
            className:
              'fsx-learnedline' + (prevLines && prevLines.indexOf(line) < 0 ? ' fsx-learnedline-new' : ''),
            key: i
          },
          line
        )
      )
    ),
    h('div', { className: 'fsx-skillfoot' }, 'Hermes updates this as you work together. Correct it anytime.')
  )
}

function Section(props) {
  return h(
    'div',
    { className: 'fsx-sec' + (props.arrived ? ' fsx-arrived' : ''), style: props.style },
    h(
      'div',
      { className: 'fsx-sechead' },
      h('span', { className: 'fsx-dot' }),
      h('span', { className: 'fsx-seclabel' }, props.label),
      props.skillVersion ? h('span', { className: 'fsx-skillbadge' + (props.arrived ? ' fsx-skillbadge-pop' : '') }, h('span', null, 'v' + props.skillVersion)) : null,
      props.progress ? h('span', { className: props.progressDone ? 'fsx-progress fsx-progress-done' : 'fsx-progress' }, props.progressDone ? props.progress + ' \\u2713' : props.progress) : null,
      props.kind && !props.skillVersion ? h('span', { className: 'fsx-kindtag' }, props.kind) : null,
      props.noRun ? null : h('button', { className: 'fsx-secrun', disabled: props.busy || undefined, onClick: props.onRun, type: 'button' }, props.busy ? (props.runLabel && props.runLabel.indexOf('\\u2026') >= 0 ? props.runLabel : 'Writing\\u2026') : (props.runLabel || 'Run'), props.busy ? null : ' \\u25B8')
    ),
    h('div', { className: 'fsx-secbody' }, props.children)
  )
}

/* The agent edits screen.json by hand mid-conversation, and small models put
 * content in almost-right places: block-level items/steps instead of nested
 * under "content", or content missing its own kind. Accept all of it — the
 * card must render whatever plausible shape was written (live failure: a
 * refresh added 16 lines of items and the card stayed on its empty state). */
/* Coerce any plausible leaf to text. The editing model writes strings,
 * {line, detail} objects, {text}, {label} — a live run crashed the WHOLE
 * pane with 'Objects are not valid as a React child (found: {line,
 * detail})'. The renderer never crashes on shape again: objects render
 * their best text field, arrays join, everything else String()s. */
function asText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(' — ')
  if (typeof value === 'object') {
    const first = ['line', 'text', 'label', 'step', 'title', 'name', 'detail', 'description']
      .map(k => value[k])
      .find(v => typeof v === 'string' && v.trim())
    if (first) {
      const detail = typeof value.detail === 'string' && value.detail.trim() && value.detail !== first ? ': ' + value.detail : ''
      return first + (first === value.detail ? '' : detail)
    }
    try { return JSON.stringify(value) } catch { return '' }
  }
  return String(value)
}

function normalizeContent(block) {
  let c = block.content && typeof block.content === 'object' ? block.content : null
  if (!c) {
    if (Array.isArray(block.items) && block.items.length) c = { kind: 'feed', items: block.items, lede: block.lede }
    else if (Array.isArray(block.steps) && block.steps.length) c = { kind: 'action', steps: block.steps }
    else if (typeof block.skeleton === 'string' && block.skeleton) c = { kind: 'draft', skeleton: block.skeleton }
    else if (block.example && typeof block.example === 'object') c = { kind: 'tool', example: block.example }
    else if (block.question && Array.isArray(block.options)) c = { kind: 'choice', question: block.question, options: block.options }
    else if (typeof block.promptPrefix === 'string' && block.promptPrefix) c = { kind: 'input', promptPrefix: block.promptPrefix, placeholder: block.placeholder }
    else if (Array.isArray(block.learned) && block.learned.length) c = { kind: 'skill', learned: block.learned, version: block.version || 1 }
    else return null
  }
  if (!c.kind) c = Object.assign({ kind: block.kind }, c)
  return c
}

function blockBody(block, freshPending, todo) {
  const c = normalizeContent(block)
  if (!c) {
    if (freshPending) {
      // Live shimmer: unmistakably in progress, never a static sentence.
      return h(
        'div',
        { className: 'fsx-fill' },
        h('div', { className: 'fsx-fillnote' }, h('span', { className: 'fsx-spinner' }), 'writing yours now'),
        h('div', { className: 'fsx-fillbar', style: { width: '86%' } }),
        h('div', { className: 'fsx-fillbar', style: { width: '64%' } }),
        h('div', { className: 'fsx-fillbar', style: { width: '73%' } })
      )
    }
    return h('div', { className: 'fsx-pending' }, block.kind === 'feed' ? 'Press Refresh and Hermes pulls in live items.' : 'Press Run and Hermes fills this in.')
  }
  if (c.kind === 'feed' && Array.isArray(c.items) && c.items.length) {
    const lede = c.lede
    return h(
      'div',
      null,
      lede ? h('div', { className: 'fsx-lede' }, lede) : null,
      c.items.map((it, i) => h(FeedItem, { item: it, key: i, n: i + 1 }))
    )
  }
  if (c.kind === 'action' && Array.isArray(c.steps) && c.steps.length) return h(Steps, { blockId: block.id, steps: c.steps, todo })
  if (c.kind === 'draft' && c.skeleton) return h(Page, { text: c.skeleton })
  if (c.kind === 'tool' && c.example) return null // tool renders its own panel
  if (c.kind === 'choice' && c.question && Array.isArray(c.options) && c.options.length) {
    return h(
      'div',
      null,
      h('div', { className: 'fsx-question' }, c.question),
      h(
        'div',
        { className: 'fsx-options' },
        c.options.map((opt, i) =>
          h('button', { className: 'fsx-opt', key: i, onClick: () => sendRipple('[Onboarding Dashboard choice] On my "' + (block.label || 'choice') + '" card I picked: "' + asText(opt.label) + '".', asText(opt.prompt || opt.label)), type: 'button' }, asText(opt.label))
        )
      )
    )
  }
  if (c.kind === 'input' && c.promptPrefix) return h(InputPanel, { content: c, label: block.label })
  if (c.kind === 'skill' && Array.isArray(c.learned) && c.learned.length) return h(SkillCard, { content: c })
  return null
}

/* Input block: type-and-go. The typed value rides the block's promptPrefix. */
function InputPanel(props) {
  const [value, setValue] = useState('')
  return h(
    'div',
    { className: 'fsx-io' },
    h('textarea', {
      className: 'fsx-input',
      onChange: e => setValue(e.target.value),
      placeholder: asText(props.content.placeholder) || 'Type here\\u2026',
      value
    }),
    h(
      'button',
      {
        className: 'fsx-go',
        disabled: !value.trim() || undefined,
        onClick: () => value.trim() && sendRipple('[Onboarding Dashboard input] On my "' + (props.label || 'input') + '" card I entered: "' + value.trim() + '".', asText(props.content.promptPrefix) + value.trim()),
        type: 'button'
      },
      'Send \\u25B8'
    )
  )
}

export default {
  id: 'first-screen',
  name: 'Onboarding Dashboard',
  description: 'The example dashboard Hermes built during onboarding — a live, editable pane.',
  register(ctx) {
    function FirstScreenPane() {
      const [config, setConfig] = useState(() => ctx.storage.get('config', null))
      // Checked-off to-do steps, keyed blockId|stepText — survives restarts,
      // resets naturally when a step's text changes (new key).
      const [doneSteps, setDoneSteps] = useState(() => ctx.storage.get('doneSteps', {}))
      // Which blocks JUST gained content this repaint — they enter with a
      // glow ring so every fill lands as a visible little arrival. Primed on
      // mount so reopening an already-full dashboard stays calm.
      const filledRef = React.useRef(null)
      // Feed refreshes in flight: press → working state → arrival glow.
      const [refreshing, setRefreshing] = useState({})
      const todo = {
        done: doneSteps,
        toggle: key => {
          const next = Object.assign({}, doneSteps)
          if (next[key]) delete next[key]
          else next[key] = true
          setDoneSteps(next)
          ctx.storage.set('doneSteps', next)
        }
      }

      useEffect(() => {
        let alive = true
        const load = () =>
          ctx.os
            .readPluginFileText('screen.json')
            .then(({ text }) => {
              if (alive) {
                setConfig(JSON.parse(text))
                setRefreshing({})
              }
            })
            .catch(() => {})
        void load()
        const stop = ctx.os.watchPluginFile('screen.json', load)
        return () => {
          alive = false
          stop()
        }
      }, [])

      const blocks = (config && config.blocks) || []
      const stage = (config && config.stage) || 'final'
      const populated = Boolean(config && config.populatedAt)
      // In-progress: populating:true means the fill is STILL RUNNING. The
      // writing state must be INCAPABLE of sticking forever (live failure: an
      // agent edit left stale flags + stripped content and every card sat
      // disabled on 'WRITING YOURS NOW' with no fill running). Shimmer only
      // while the file's newest stamp is under 3 minutes old; after that the
      // cards fall back to their enabled Run/Refresh states.
      const stamp = Math.max(
        (config && config.populatedAt && Date.parse(config.populatedAt)) || 0,
        (config && config.generatedAt && Date.parse(config.generatedAt)) || 0
      )
      const fresh = stamp > 0 && Date.now() - stamp < 180000
      const freshPending = Boolean(config && (config.populating || !populated) && fresh)
      // Exit the writing state LIVE when the window lapses — the file watcher
      // only fires on changes, so without this the stale shimmer would hold
      // until the next unrelated repaint.
      const [, bumpClock] = useState(0)
      useEffect(() => {
        if (!freshPending) return
        const left = Math.max(180000 - (Date.now() - stamp), 0) + 1000
        const t = setTimeout(() => bumpClock(n => n + 1), left)
        return () => clearTimeout(t)
      }, [freshPending, stamp])
      const filePath = (config && config.path) || '~/.hermes/desktop-plugins/first-screen/screen.json'
      screenPath = filePath

      const regen = () =>
        send(
          'Rebuild my first screen\\u2019s content in place: read ' +
            filePath +
            ' , re-run each block\\u2019s prompt fresh (search the web for feed blocks), and rewrite ONLY each block\\u2019s nested content object (its own kind plus its fields: feed → items[{line, source}], action → steps[], draft → skeleton, tool → example{input, output}) — keep ids, labels, and prompts exactly as they are, update populatedAt. Reply in chat with one line when done.'
        )


      // ── Living-screen early stages ────────────────────────────────────────
      // sketch: wireframe rows under a "taking shape" caption — the pane is
      // ALIVE during the conversation, visibly unfinished on purpose.
      // proposals: the generated module list, titles real, content pending —
      // the moment the screen becomes THEIRS, mid-conversation.
      if (stage === 'sketch' || stage === 'proposals') {
        return h(
          'div',
          { className: 'fsx', 'data-tour': 'first-screen' },
          h('style', null, CSS),
          h('div', { className: 'fsx-titlerow' }, h('div', { className: 'fsx-title' }, (config && config.title) || 'Your Dashboard')),
          h('div', { className: 'fsx-stagecap' }, h('span', { className: 'fsx-spinner' }), stage === 'sketch' ? 'Taking shape as you talk' : 'Drafted from your answers'),
          stage === 'sketch'
            ? blocks.map((block, i) =>
                h(
                  'div',
                  { className: 'fsx-sketchrow', key: block.id || i, style: { animationDelay: Math.min(i * 60, 300) + 'ms' } },
                  h('span', { className: 'fsx-sketchlabel' }, block.label || '\\u2026'),
                  h(
                    'div',
                    { className: 'fsx-sketchbars' },
                    h('div', { className: 'fsx-sketchbar', style: { width: '72%' } }),
                    h('div', { className: 'fsx-sketchbar', style: { width: '46%' } })
                  )
                )
              )
            : blocks.map((block, i) =>
                h(
                  'div',
                  { className: 'fsx-proprow' + (block.dropped ? ' fsx-dropped' : ''), key: block.id || i, style: { animationDelay: Math.min(i * 60, 300) + 'ms' } },
                  h('span', { className: 'fsx-propkind' }, block.dropped ? 'dropped' : block.kind || 'module'),
                  h('span', { className: 'fsx-proplabel' }, block.label),
                  block.dropped ? null : blockBody(block, true)
                )
              ),
          null
        )
      }

      // Arrival detection: a block whose content JUST appeared gets a one-shot
      // glow. Primed on first render so an already-full dashboard opens calm.
      const filledNow = {}
      for (const b of blocks) filledNow[b.id] = Boolean(normalizeContent(b))
      const prevFilled = filledRef.current
      filledRef.current = filledNow
      const justArrived = id => prevFilled !== null && filledNow[id] && !prevFilled[id]

      return h(
        'div',
        { className: 'fsx', 'data-tour': 'first-screen' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'fsx-titlerow' },
          h('div', { className: 'fsx-title' }, (config && config.title) || 'Your Dashboard'),
          h('button', { className: 'fsx-regen', onClick: regen, title: 'Ask Hermes to rewrite this screen\\u2019s content in place', type: 'button' }, 'regenerate \\u21bb')
        ),
        h('div', { className: 'fsx-subtitle' }, 'An example Hermes built during onboarding. Ask for another screen like it anytime.'),
        blocks.map((block, i) => {
          const content = normalizeContent(block)
          const steps = content && content.kind === 'action' && Array.isArray(content.steps) ? content.steps.map(asText).filter(Boolean) : null
          const doneCount = steps ? steps.filter(s => todo.done[block.id + '|' + s]).length : 0
          return h(
            Section,
            {
              arrived: justArrived(block.id) || undefined,
              busy: (freshPending && !content) || refreshing[block.id],
              key: block.id,
              kind: block.kind,
              label: block.label,
              noRun: (block.kind === 'choice' || block.kind === 'input') && Boolean(content),
              onRun:
                block.kind === 'feed'
                  ? () => {
                      setRefreshing(Object.assign({}, refreshing, (function () { const o = {}; o[block.id] = true; return o })()))
                      sendRefresh(block, filePath)
                    }
                  : () => sendWork(block.prompt),
              progress: steps ? doneCount + '/' + steps.length : null,
              progressDone: Boolean(steps && steps.length > 0 && doneCount === steps.length),
              runLabel: block.kind === 'feed' ? (refreshing[block.id] ? 'Refreshing\\u2026' : 'Refresh') : block.kind === 'skill' ? 'Review' : 'Run',
              skillVersion: content && content.kind === 'skill' ? content.version || 1 : null,
              // Stagger the first paint so the dashboard assembles as a
              // cascade instead of a slam.
              style: prevFilled === null ? { animationDelay: Math.min(i * 70, 350) + 'ms' } : undefined
            },
            block.kind === 'tool' ? h(ToolPanel, { content: normalizeContent(block), prompt: block.prompt }) : blockBody(block, freshPending, todo)
          )
        }),
        null
      )
    }

    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'Onboarding Dashboard',
      data: { collapsible: true, dock: { pane: 'workspace', pos: 'right' }, minWidth: '340px', placement: 'right', width: '430px' },
      render: () => React.createElement(FirstScreenPane)
    })

    ctx.register({
      id: 'nav',
      area: 'sidebar.nav',
      isNew: true,
      data: {
        codicon: 'sparkle',
        label: 'Onboarding Dashboard',
        onClick: () => {
          if (typeof host.revealPane === 'function') {
            host.revealPane('first-screen:pane')
          }
        }
      }
    })
  }
}
`
