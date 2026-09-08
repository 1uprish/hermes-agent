/**
 * `::ask{...}` — the model's interactive question, inline in its message.
 *
 * The conversational counterpart of a wall of text: whenever the agent needs
 * a decision, it emits ONE line and the transcript renders real controls —
 * option pills (single-click submits the pick as a visible user turn) and an
 * optional free-text row. Works in every session (it is a core transcript
 * directive, not an onboarding-only one), so dashboard button responses,
 * refinement dialogues, and ordinary chats can all fork interactively.
 *
 *   ::ask{question="Which angle leads?" options="Lead story|Exclusive|Embargoed brief"}
 *   ::ask{question="Paste the runway number" input="true" placeholder="e.g. 24 months"}
 *
 * Options are pipe-separated; `input="true"` adds a type-and-go row (with
 * optional placeholder); both may be combined. A pick submits VISIBLY so the
 * user sees their choice become a turn.
 */

import { useState } from 'react'

import { requestComposerSubmit } from '@/app/chat/composer/focus'
import { cn } from '@/lib/utils'

// Picked questions, module-scoped: transcript virtualization remounts
// directives with fresh local state, which would resurrect a settled picker.
// Keyed by question text — good enough at transcript scale.
const settled = new Set<string>()

export function AskDirective({ attrs, streaming }: { attrs: Record<string, string>; streaming: boolean }) {
  const question = (attrs.question ?? '').trim()

  const options = (attrs.options ?? '')
    .split('|')
    .map(option => option.trim())
    .filter(Boolean)
    .slice(0, 6)

  const wantsInput = attrs.input === 'true' || attrs.input === 'yes'
  const [picked, setPicked] = useState<null | string>(() => (settled.has(question) ? '' : null))
  const [text, setText] = useState('')

  if (!question || (options.length === 0 && !wantsInput)) {
    return null
  }

  const submit = (value: string) => {
    if (picked !== null || streaming || !value.trim()) {
      return
    }

    if (requestComposerSubmit(value.trim())) {
      settled.add(question)
      setPicked(value.trim())
    }
  }

  return (
    <div className="my-3 flex flex-col gap-2 duration-300 animate-in fade-in-0 slide-in-from-bottom-2" data-onboarding-card>
      <div className="text-[13px] font-medium">{question}</div>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {options.map(option => (
            <button
              className={cn(
                'rounded-full border px-3 py-1.5 text-[12px] transition-all duration-150 active:scale-95',
                picked === option
                  ? 'scale-105 border-primary bg-primary text-primary-foreground'
                  : picked !== null
                    ? 'border-border/60 text-muted-foreground/50'
                    : 'border-border bg-card hover:-translate-y-px hover:border-primary/50 hover:bg-primary/10'
              )}
              disabled={picked !== null || streaming}
              key={option}
              onClick={() => submit(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {wantsInput && picked === null && (
        <form
          className="flex gap-2"
          onSubmit={event => {
            event.preventDefault()
            submit(text)
          }}
        >
          <input
            className="min-w-0 flex-1 rounded-[8px] border border-border bg-card px-3 py-1.5 text-[12px] outline-none transition-colors focus:border-primary/60"
            onChange={event => setText(event.target.value)}
            placeholder={attrs.placeholder || 'Type your answer…'}
            value={text}
          />
          <button
            className="rounded-full bg-primary px-3.5 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-85 disabled:opacity-40"
            disabled={!text.trim() || streaming}
            type="submit"
          >
            Send
          </button>
        </form>
      )}
    </div>
  )
}
