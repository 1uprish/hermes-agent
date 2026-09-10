import { IconArrowUp, IconRefresh } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'

import type { MacManChatClient, MacManChatSnapshot } from './macman-chat-client'
import { MacManThinkingMark } from './macman-thinking-mark'

interface MacManChatProps {
  client: MacManChatClient
}

export function MacManChat({ client }: MacManChatProps) {
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

  const submit = () => {
    const message = draft.trim()

    if (!message || snapshot.busy || snapshot.status !== 'ready') {
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
        <span className={`mm-chat-status mm-chat-status--${snapshot.status}`}>
          <span />
          {snapshot.status === 'ready' ? 'Ready' : snapshot.status === 'connecting' ? 'Connecting' : 'Offline'}
        </span>
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
              </article>
            ))}
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
          <button
            aria-label="Send message"
            className="mm-chat-send"
            disabled={!draft.trim() || snapshot.busy || snapshot.status !== 'ready'}
            onClick={submit}
            type="button"
          >
            <IconArrowUp aria-hidden size={17} stroke={2.2} />
          </button>
        </div>
        <p className="mm-chat-hint">Return to send · Shift–Return for a new line</p>
      </div>
    </section>
  )
}
