import { IconArrowUp, IconPlayerStop, IconRefresh } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'

import type { MacManChatClient, MacManChatSnapshot, MacManPendingInput } from './macman-chat-client'
import { MacManModelSelector } from './macman-model-selector'
import { MacManThinkingMark } from './macman-thinking-mark'
import type { MacManModelCatalog } from './native-contract'

interface MacManChatProps {
  client: MacManChatClient
  loadModelCatalog?: () => Promise<MacManModelCatalog>
  onActiveModelChange?: (model: { model: string; provider: string }) => void
  onManageModels?: () => void
}

const DISPATCH_LABELS = {
  foreground: 'Working on it',
  parallel: 'Running in parallel',
  queue: 'Queued next',
  redirect: 'Updating current task',
  routing: 'Choosing the best route',
  steer: 'Added to current task'
} as const

const APPROVAL_LABELS: Record<string, string> = {
  always: 'Always allow',
  deny: 'Deny',
  once: 'Allow once',
  session: 'Allow for session'
}

function MacManInputCard({ input, onRespond }: { input: MacManPendingInput; onRespond(value: string): void }) {
  const [value, setValue] = useState('')
  const choices = input.choices ?? []
  const requiresTypedValue = input.kind === 'secret' || input.kind === 'sudo' || choices.length === 0

  return (
    <section aria-label="MacMan needs input" className="mm-chat-input-card">
      <strong>{input.kind === 'approval' ? 'Approval needed' : input.kind === 'clarify' ? 'Quick question' : 'Private input needed'}</strong>
      <p>{input.description}</p>
      {input.command ? <code>{input.command}</code> : null}
      {choices.length ? (
        <div className="mm-chat-input-actions">
          {choices.map(choice => (
            <button key={choice} onClick={() => onRespond(choice)} type="button">
              {input.kind === 'approval' ? APPROVAL_LABELS[choice] ?? choice : choice}
            </button>
          ))}
        </div>
      ) : null}
      {requiresTypedValue ? (
        <form
          className="mm-chat-input-form"
          onSubmit={event => {
            event.preventDefault()
            const response = value.trim()

            if (response) {
              onRespond(response)
              setValue('')
            }
          }}
        >
          <input
            aria-label={input.kind === 'clarify' ? 'Answer MacMan' : 'Private response'}
            autoComplete="off"
            onChange={event => setValue(event.currentTarget.value)}
            type={input.kind === 'secret' || input.kind === 'sudo' ? 'password' : 'text'}
            value={value}
          />
          <button disabled={!value.trim()} type="submit">Continue</button>
        </form>
      ) : null}
    </section>
  )
}

export function MacManChat({ client, loadModelCatalog, onActiveModelChange, onManageModels }: MacManChatProps) {
  const [draft, setDraft] = useState('')
  const [snapshot, setSnapshot] = useState<MacManChatSnapshot>(() => client.getSnapshot())
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsubscribe = client.subscribe(setSnapshot)
    void client.connect()

    return () => {
      unsubscribe()
      client.dispose()
    }
  }, [client])

  useEffect(() => {
    const transcript = transcriptRef.current

    if (!transcript) {
      return
    }

    if (typeof transcript.scrollTo === 'function') {
      transcript.scrollTo({ behavior: 'smooth', top: transcript.scrollHeight })
    } else {
      transcript.scrollTop = transcript.scrollHeight
    }
  }, [snapshot.messages])

  useEffect(() => {
    if (snapshot.activeModel) {
      onActiveModelChange?.(snapshot.activeModel)
    }
  }, [onActiveModelChange, snapshot.activeModel])

  const submit = () => {
    const message = draft.trim()

    if (!message || snapshot.status !== 'ready') {
      return
    }

    setDraft('')
    void client.send(message)
  }

  return (
    <section aria-label="MacMan chat" className="mm-chat">
      <header className="mm-chat-header">
        <div>
          <h1>MacMan</h1>
          <p>One continuous conversation on this Mac.</p>
        </div>
        <div className="mm-chat-header-actions">
          {snapshot.busy ? (
            <button aria-label="Stop current task" className="mm-chat-stop" onClick={() => void client.interrupt()} type="button">
              <IconPlayerStop aria-hidden size={13} stroke={2} /> Stop
            </button>
          ) : null}
          <span className={`mm-chat-status mm-chat-status--${snapshot.status}`}>
            <span />
            {snapshot.status === 'ready' ? 'Ready' : snapshot.status === 'connecting' ? 'Connecting' : 'Offline'}
          </span>
        </div>
      </header>

      <div aria-live="polite" className="mm-chat-transcript" ref={transcriptRef}>
        {snapshot.status === 'connecting' && snapshot.messages.length === 0 ? (
          <div className="mm-chat-empty">
            <img alt="" src="./macman-mark-transparent.png" />
            <h2>Opening your conversation</h2>
            <p>MacMan is reconnecting to your continuous chat.</p>
          </div>
        ) : snapshot.status === 'error' && snapshot.messages.length === 0 ? (
          <div className="mm-chat-empty">
            <img alt="" src="./macman-mark-transparent.png" />
            <h2>Chat could not connect</h2>
            <p>{snapshot.error}</p>
            <button className="mm-button mm-button--quiet" onClick={() => void client.retry()} type="button">
              <IconRefresh aria-hidden size={16} stroke={1.8} /> Retry
            </button>
          </div>
        ) : snapshot.messages.length === 0 ? (
          <div className="mm-chat-empty">
            <img alt="" src="./macman-mark-transparent.png" />
            <h2>What should we do?</h2>
            <p>This is your ongoing conversation with MacMan.</p>
          </div>
        ) : (
          <div className="mm-chat-thread">
            {snapshot.messages.map(message => (
              <article className={`mm-chat-message mm-chat-message--${message.role}`} key={message.id}>
                <span>{message.role === 'user' ? 'You' : 'MacMan'}</span>
                <p>{message.text}</p>
                {message.dispatch ? (
                  <small className={`mm-chat-route mm-chat-route--${message.dispatch.state}`}>
                    {message.dispatch.state === 'failed' ? 'Could not route' : DISPATCH_LABELS[message.dispatch.route]}
                  </small>
                ) : null}
              </article>
            ))}
            {snapshot.activities?.length ? (
              <section aria-label="Live activity" className="mm-chat-activity">
                <strong>Live activity</strong>
                <ul>
                  {snapshot.activities.slice(-4).map(activity => (
                    <li className={`mm-chat-activity--${activity.state}`} key={activity.id}>
                      <span aria-hidden />
                      {activity.label}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {snapshot.pendingInput ? (
              <MacManInputCard
                input={snapshot.pendingInput}
                key={`${snapshot.pendingInput.kind}-${snapshot.pendingInput.requestId ?? 'current'}`}
                onRespond={value => void client.respondToInput(value)}
              />
            ) : null}
            {snapshot.busy ? <MacManThinkingMark /> : null}
          </div>
        )}
      </div>

      <div className="mm-chat-composer-wrap">
        {snapshot.error && snapshot.messages.length > 0 ? (
          <p className="mm-chat-error" role="status">
            {snapshot.error}
          </p>
        ) : null}
        <div className="mm-chat-composer">
          <textarea
            aria-label="Message MacMan"
            disabled={snapshot.status !== 'ready'}
            onChange={event => setDraft(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                submit()
              }
            }}
            placeholder={snapshot.status === 'ready' ? 'Message MacMan' : 'Connecting to MacMan…'}
            rows={1}
            value={draft}
          />
          <div className="mm-chat-composer-actions">
            {loadModelCatalog ? (
              <MacManModelSelector
                activeModel={snapshot.activeModel}
                busy={snapshot.busy || snapshot.status !== 'ready'}
                limitedModels={snapshot.limitedModels}
                loadCatalog={loadModelCatalog}
                onManageModels={onManageModels}
                onSelectModel={(provider, model, confirm) =>
                  confirm ? client.switchModel(provider, model, true) : client.switchModel(provider, model)
                }
              />
            ) : (
              <span />
            )}
            <button
              aria-label="Send message"
              className="mm-chat-send"
              disabled={!draft.trim() || snapshot.status !== 'ready'}
              onClick={submit}
              type="button"
            >
              <IconArrowUp aria-hidden size={17} stroke={2.2} />
            </button>
          </div>
        </div>
        <p className="mm-chat-hint">Return to send · Shift–Return for a new line</p>
      </div>
    </section>
  )
}
