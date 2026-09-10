import { IconBrandGoogle, IconBrandWhatsapp, IconCheck, IconMail, IconMessageCircle, IconX } from '@tabler/icons-react'
import { toDataURL } from 'qrcode'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'

import type {
  MacManConnectionId,
  MacManConnectionSnapshot,
  MacManConnectionStatus,
  MacManNativeBridge,
  MacManWhatsAppSetup
} from './native-contract'

type ConnectionsBridge = Pick<
  MacManNativeBridge,
  | 'applyWhatsAppConnection'
  | 'authorizeIMessage'
  | 'cancelWhatsAppConnection'
  | 'connectGmail'
  | 'getConnectionCatalog'
  | 'pollWhatsAppConnection'
  | 'startWhatsAppConnection'
>

export interface MacManConnectionsProps {
  bridge: ConnectionsBridge
  pollIntervalMs?: number
}

const STATUS_LABELS: Record<MacManConnectionStatus, string> = {
  attention: 'Needs attention',
  connected: 'Connected',
  connecting: 'Connecting',
  'needs-permission': 'Needs permission',
  ready: 'Not connected',
  syncing: 'Syncing',
  unavailable: 'Unavailable'
}

const CAPABILITY_LABELS = {
  attachments: 'Attachments',
  read: 'Read',
  reactions: 'Reactions',
  search: 'Search',
  send: 'Send'
} as const

const CONNECTION_ICONS = {
  gmail: IconBrandGoogle,
  imessage: IconMessageCircle,
  whatsapp: IconBrandWhatsapp
} as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function actionLabel(connection: MacManConnectionSnapshot): string {
  if (connection.status === 'connected') {
    return `Reconnect ${connection.name}`
  }

  return connection.id === 'imessage' ? 'Set up iMessage' : `Connect ${connection.name}`
}

export function MacManConnections({ bridge, pollIntervalMs = 1_200 }: MacManConnectionsProps) {
  const [connections, setConnections] = useState<MacManConnectionSnapshot[]>([])
  const [catalogError, setCatalogError] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const [busyConnection, setBusyConnection] = useState<MacManConnectionId>()
  const [whatsAppSetup, setWhatsAppSetup] = useState<MacManWhatsAppSetup>()
  const [whatsAppQr, setWhatsAppQr] = useState<string>()
  const [gmailOpen, setGmailOpen] = useState(false)
  const [gmailEmail, setGmailEmail] = useState('')
  const catalogGeneration = useRef(0)
  const appliedPairing = useRef<string | undefined>(undefined)

  const refresh = useCallback(async () => {
    const generation = ++catalogGeneration.current

    try {
      const catalog = await bridge.getConnectionCatalog()

      if (generation === catalogGeneration.current) {
        setConnections(catalog.connections)
        setCatalogError(undefined)
      }
    } catch (error) {
      if (generation === catalogGeneration.current) {
        setCatalogError(errorMessage(error))
      }
    }
  }, [bridge])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    let active = true

    if (!whatsAppSetup?.qrPayload) {
      setWhatsAppQr(undefined)
      return () => {
        active = false
      }
    }

    void toDataURL(whatsAppSetup.qrPayload, { margin: 1, width: 236 })
      .then(url => {
        if (active) {
          setWhatsAppQr(url)
        }
      })
      .catch(error => {
        if (active) {
          setActionError(`Could not draw the WhatsApp code: ${errorMessage(error)}`)
        }
      })

    return () => {
      active = false
    }
  }, [whatsAppSetup?.qrPayload])

  useEffect(() => {
    const pairingId = whatsAppSetup?.pairingId
    const shouldPoll = ['installing', 'starting', 'waiting'].includes(whatsAppSetup?.status ?? '')

    if (!pairingId || !shouldPoll) {
      return
    }

    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const next = await bridge.pollWhatsAppConnection(pairingId)

        if (!active) {
          return
        }

        if (next.status === 'connected') {
          if (appliedPairing.current !== pairingId) {
            appliedPairing.current = pairingId
            await bridge.applyWhatsAppConnection(pairingId)
          }

          if (active) {
            await refresh()
            setWhatsAppSetup(undefined)
            setWhatsAppQr(undefined)
          }

          return
        }

        setWhatsAppSetup(next)

        if (['installing', 'starting', 'waiting'].includes(next.status)) {
          timer = setTimeout(() => void poll(), pollIntervalMs)
        }
      } catch (error) {
        if (active) {
          setActionError(errorMessage(error))
        }
      }
    }

    timer = setTimeout(() => void poll(), pollIntervalMs)

    return () => {
      active = false

      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [bridge, pollIntervalMs, refresh, whatsAppSetup?.pairingId, whatsAppSetup?.status])

  const startWhatsApp = async () => {
    setActionError(undefined)
    setBusyConnection('whatsapp')

    try {
      const setup = await bridge.startWhatsAppConnection({ mode: 'self-chat' })
      appliedPairing.current = undefined
      setWhatsAppSetup(setup)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setBusyConnection(undefined)
    }
  }

  const cancelWhatsApp = async () => {
    const pairingId = whatsAppSetup?.pairingId
    setWhatsAppSetup(undefined)
    setWhatsAppQr(undefined)

    if (!pairingId || whatsAppSetup?.status === 'connected') {
      return
    }

    try {
      await bridge.cancelWhatsAppConnection(pairingId)
    } catch (error) {
      setActionError(errorMessage(error))
    }
  }

  const authorizeIMessage = async () => {
    setActionError(undefined)
    setBusyConnection('imessage')

    try {
      await bridge.authorizeIMessage()
      await refresh()
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setBusyConnection(undefined)
    }
  }

  const connectGmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setActionError(undefined)
    setBusyConnection('gmail')

    try {
      await bridge.connectGmail(gmailEmail.trim().toLocaleLowerCase())
      setGmailOpen(false)
      setGmailEmail('')
      await refresh()
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setBusyConnection(undefined)
    }
  }

  const performAction = (connection: MacManConnectionSnapshot) => {
    if (connection.status === 'unavailable') {
      return
    }

    if (connection.id === 'whatsapp') {
      void startWhatsApp()
    } else if (connection.id === 'imessage') {
      void authorizeIMessage()
    } else {
      setActionError(undefined)
      setGmailEmail(connection.account ?? '')
      setGmailOpen(true)
    }
  }

  return (
    <div className="mm-page mm-page--settings mm-connections-page">
      <header className="mm-page-header">
        <span className="mm-eyebrow">Settings</span>
        <h1>Your connections</h1>
        <p>Link the places MacMan can read, search, and act—with one clear status for each.</p>
      </header>

      {catalogError ? (
        <div className="mm-connections-error" role="alert">
          {catalogError}
        </div>
      ) : null}
      {actionError ? (
        <div className="mm-connections-error" role="alert">
          {actionError}
        </div>
      ) : null}

      <section aria-label="Connected services" className="mm-connections-list">
        {connections.map(connection => {
          const Icon = CONNECTION_ICONS[connection.id]
          const label = actionLabel(connection)

          return (
            <article className="mm-connection-card" key={connection.id}>
              <div className={`mm-connection-icon mm-connection-icon--${connection.id}`}>
                <Icon aria-hidden size={23} stroke={1.7} />
              </div>
              <div className="mm-connection-copy">
                <div className="mm-connection-titleline">
                  <h2>{connection.name}</h2>
                  <span className={`mm-connection-status is-${connection.status}`}>
                    <span aria-hidden />
                    {STATUS_LABELS[connection.status]}
                  </span>
                </div>
                {connection.account ? <strong className="mm-connection-account">{connection.account}</strong> : null}
                {connection.detail ? <p>{connection.detail}</p> : null}
                <div aria-label={`${connection.name} capabilities`} className="mm-connection-capabilities">
                  {connection.capabilities.map(capability => (
                    <span key={capability}>
                      <IconCheck aria-hidden size={11} stroke={2.2} />
                      {CAPABILITY_LABELS[capability]}
                    </span>
                  ))}
                </div>
              </div>
              <button
                aria-label={label}
                className="mm-button mm-button--small"
                disabled={busyConnection === connection.id || connection.status === 'unavailable'}
                onClick={() => performAction(connection)}
                type="button"
              >
                {busyConnection === connection.id ? 'Working…' : label.replace(` ${connection.name}`, '')}
              </button>
            </article>
          )
        })}
        {connections.length === 0 && !catalogError ? (
          <div className="mm-connections-loading" role="status">
            Checking connections…
          </div>
        ) : null}
      </section>

      {whatsAppSetup ? (
        <div className="mm-modal-backdrop">
          <section aria-label="Connect WhatsApp" aria-modal="true" className="mm-connection-dialog" role="dialog">
            <button
              aria-label="Cancel WhatsApp setup"
              className="mm-connection-dialog-close"
              onClick={() => void cancelWhatsApp()}
              type="button"
            >
              <IconX aria-hidden size={17} />
            </button>
            <div className="mm-connection-dialog-icon mm-connection-icon--whatsapp">
              <IconBrandWhatsapp aria-hidden size={25} />
            </div>
            <h2>Connect WhatsApp</h2>
            <p>
              Open WhatsApp on your phone, then go to <strong>Settings → Linked Devices</strong> and scan this code.
            </p>
            <div className="mm-whatsapp-qr">
              {whatsAppQr ? <img alt="WhatsApp pairing code" src={whatsAppQr} /> : <span>Preparing secure code…</span>}
            </div>
            <small>MacMan links as a companion device. You can unlink it from WhatsApp at any time.</small>
          </section>
        </div>
      ) : null}

      {gmailOpen ? (
        <div className="mm-modal-backdrop">
          <section
            aria-label="Connect Gmail"
            aria-modal="true"
            className="mm-connection-dialog mm-gmail-dialog"
            role="dialog"
          >
            <button
              aria-label="Cancel Gmail setup"
              className="mm-connection-dialog-close"
              onClick={() => setGmailOpen(false)}
              type="button"
            >
              <IconX aria-hidden size={17} />
            </button>
            <div className="mm-connection-dialog-icon mm-connection-icon--gmail">
              <IconMail aria-hidden size={24} />
            </div>
            <h2>Connect Gmail</h2>
            <p>MacMan requests Gmail access only. Google opens in your browser so you can review and approve it.</p>
            <form className="mm-gmail-form" onSubmit={event => void connectGmail(event)}>
              <label htmlFor="mm-gmail-email">Google account email</label>
              <input
                autoComplete="email"
                id="mm-gmail-email"
                onChange={event => setGmailEmail(event.currentTarget.value)}
                placeholder="you@gmail.com"
                required
                type="email"
                value={gmailEmail}
              />
              <button className="mm-button mm-button--primary" disabled={busyConnection === 'gmail'} type="submit">
                {busyConnection === 'gmail' ? 'Opening Google…' : 'Continue with Google'}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  )
}
